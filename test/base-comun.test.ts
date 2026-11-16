import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Base } from '../server/db/index.js';
import { sembrar } from '../server/services/semilla.js';
import { crearApp } from '../server/http/app.js';

/** Etapa 1: tipo de producto, rol y condición de pago de proveedores, motivo al editar. Datos DEMO. */
let dir: string; let base: Base; let app: FastifyInstance; let cookie = '';
const pedir = async (metodo: string, url: string, cuerpo?: unknown) => {
  const r = await app.inject({ method: metodo as 'GET', url: '/api' + url, payload: cuerpo as object, headers: { cookie } });
  return { status: r.statusCode, json: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body };
};
type ModeloR = { id: number; nombre: string; clasificacion: string | null; sugerencia: string | null };
let cat = 0; let taller = 0; let reventa = 0; let mPropio = 0; let mComprado = 0; let mSinDatos = 0; let material = 0;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herencia-base-'));
  base = new Base(path.join(dir, 'b.db'));
  base.tx((db) => sembrar(db));
  app = await crearApp({ base });
  await pedir('POST', '/setup', { nombre: 'Admin DEMO', usuario: 'admin', password: 'clave-demo-1' });
  cookie = String((await app.inject({ method: 'POST', url: '/api/login', payload: { usuario: 'admin', password: 'clave-demo-1' } })).headers['set-cookie']).split(';')[0];
  cat = (await pedir('POST', '/catalogo/categorias', { nombre: 'Camperas DEMO' })).json.id;
  taller = (await pedir('POST', '/proveedores', { nombre: 'Taller DEMO', rol: 'taller', condicionPago: 'al_recibir' })).json.id;
  reventa = (await pedir('POST', '/proveedores', { nombre: 'Mayorista DEMO', rol: 'producto_terminado', condicionPago: 'a_plazo', plazoPagoDias: 30 })).json.id;
  const modelo = async (nombre: string, proveedorId: number | null) =>
    (await pedir('POST', '/catalogo/modelos', { modelo: { nombre, categoriaId: cat, proveedorId }, variantes: [{ sku: nombre.slice(0, 6).toUpperCase(), costoCentavos: 1000000, precios: { '1': 3000000 } }] })).json.id as number;
  mPropio = await modelo('Propia DEMO', null);
  mComprado = await modelo('Comprada DEMO', null);
  mSinDatos = await modelo('Rara DEMO', null);
  material = (await pedir('POST', '/materiales', { codigo: 'DEMO-1', nombre: 'Cuero DEMO', unidad: 'm', tipo: 'material', costoCentavos: 1000000, proveedorId: null, clasificacion: 'materia_prima' })).json.id;
  expect((await pedir('PUT', `/recetas/${mPropio}`, { lineas: [{ materialId: material, cantidadMil: 1500 }] })).status).toBe(200);
  const v = (await pedir('GET', `/catalogo/modelos/${mComprado}`)).json.variantes[0].id;
  expect((await pedir('POST', '/compras', { proveedorId: reventa, tipo: 'reventa', fecha: '2026-11-16', items: [{ varianteId: v, cantidad: 2, costoUnitarioCentavos: 1000000 }] })).status).toBe(200);
});
afterAll(async () => { await app.close(); base.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('proveedores: rol y condición de pago', () => {
  it('se guardan, y a plazo exige los días', async () => {
    const ps = (await pedir('GET', '/proveedores')).json as { id: number; rol: string; condicionPago: string; plazoPagoDias: number }[];
    expect(ps.find((p) => p.id === reventa)).toMatchObject({ rol: 'producto_terminado', condicionPago: 'a_plazo', plazoPagoDias: 30 });
    expect((await pedir('POST', '/proveedores', { nombre: 'Sin plazo DEMO', condicionPago: 'a_plazo' })).status).toBe(400);
  });
  it('editar sin mandar rol no lo borra', async () => {
    expect((await pedir('PUT', `/proveedores/${taller}`, { nombre: 'Taller DEMO', telefono: '1100000000' })).status).toBe(200);
    const p = ((await pedir('GET', '/proveedores')).json as { id: number; rol: string; condicionPago: string }[]).find((x) => x.id === taller)!;
    expect(p).toMatchObject({ rol: 'taller', condicionPago: 'al_recibir' });
  });
});

describe('tipo de producto', () => {
  it('sugiere según receta y pedidos, sin aplicarlo solo', async () => {
    const ms = (await pedir('GET', '/catalogo/modelos?clasificacion=pendiente')).json as ModeloR[];
    const de = (id: number) => ms.find((m) => m.id === id)!;
    expect(de(mPropio)).toMatchObject({ clasificacion: null, sugerencia: 'fabricacion_propia' });
    expect(de(mComprado)).toMatchObject({ clasificacion: null, sugerencia: 'producto_comprado' });
    expect(de(mSinDatos).sugerencia).toBeNull();
  });
  it('clasifica varios de una vez y queda en auditoría', async () => {
    expect((await pedir('POST', '/catalogo/modelos/clasificar', { ids: [mComprado], clasificacion: 'producto_comprado' })).json).toEqual({ cambiados: 1 });
    expect((await pedir('POST', '/catalogo/modelos/clasificar', { ids: [mPropio], clasificacion: 'fabricacion_propia' })).json).toEqual({ cambiados: 1 });
    const pend = (await pedir('GET', '/catalogo/modelos?clasificacion=pendiente')).json as ModeloR[];
    expect(pend.map((m) => m.id)).toEqual([mSinDatos]);
    const comprados = (await pedir('GET', '/catalogo/modelos?clasificacion=producto_comprado')).json as ModeloR[];
    expect(comprados.map((m) => m.id)).toEqual([mComprado]);
    const aud = (await pedir('GET', `/auditoria?entidad=modelo&entidadId=${mComprado}`)).json as { filas: { despues: { clasificacion?: string } | null }[] };
    expect(aud.filas.some((a) => a.despues?.clasificacion === 'producto_comprado')).toBe(true);
  });
  it('un producto comprado no lleva receta', async () => {
    const r = await pedir('PUT', `/recetas/${mComprado}`, { lineas: [{ materialId: material, cantidadMil: 1000 }] });
    expect(r.status).toBe(400);
    // y uno con receta no se puede pasar a comprado
    expect((await pedir('POST', '/catalogo/modelos/clasificar', { ids: [mPropio], clasificacion: 'producto_comprado' })).status).toBe(400);
  });
  it('editar el modelo sin mandar el tipo no lo borra', async () => {
    expect((await pedir('PUT', `/catalogo/modelos/${mComprado}`, { nombre: 'Comprada DEMO', categoriaId: cat })).status).toBe(200);
    expect((await pedir('GET', `/catalogo/modelos/${mComprado}`)).json.clasificacion).toBe('producto_comprado');
  });
  it('los materiales guardan su clasificación', async () => {
    expect((await pedir('GET', `/materiales/${material}`)).json.clasificacion).toBe('materia_prima');
  });
});

describe('motivo al editar', () => {
  it('corregir un gasto pide el motivo y lo guarda', async () => {
    const catG = ((await pedir('GET', '/gastos/categorias')).json as { id: number; padreId: number | null }[]).find((c) => !c.padreId)!.id;
    const cuenta = ((await pedir('GET', '/cuentas')).json as { id: number; nombre: string }[]).find((c) => c.nombre === 'Efectivo')!.id;
    const g = (await pedir('POST', '/gastos', { fecha: '2026-11-16', concepto: 'Luz DEMO', categoriaId: catG, importeCentavos: 500000, cuentaId: cuenta })).json;
    expect((await pedir('PUT', `/gastos/${g.id}`, { concepto: 'Luz de octubre DEMO', categoriaId: catG })).status).toBe(400);
    expect((await pedir('PUT', `/gastos/${g.id}`, { concepto: 'Luz de octubre DEMO', categoriaId: catG, motivo: 'Faltaba el mes' })).status).toBe(200);
  });
});
