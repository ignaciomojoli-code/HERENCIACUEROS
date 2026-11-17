import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Base } from '../server/db/index.js';
import { sembrar } from '../server/services/semilla.js';
import { crearApp } from '../server/http/app.js';

/** Etapa 5: dónde está cada material, entregas al taller y consumo desde lo que tiene el taller. Datos DEMO. */
let dir: string; let base: Base; let app: FastifyInstance; let cookie = '';
const pedir = async (metodo: string, url: string, cuerpo?: unknown) => {
  const r = await app.inject({ method: metodo as 'GET', url: '/api' + url, payload: cuerpo as object, headers: { cookie } });
  return { status: r.statusCode, json: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body };
};
let taller = 0; let cuero = 0; let forro = 0; let mo = 0; let vS = 0; let pedido = 0;
type Det = { stockMil: number; ubicaciones: { ubicacionProveedorId: number | null; cantidadMil: number }[] };
const det = async (id: number) => (await pedir('GET', `/materiales/${id}`)).json as Det;
const en = async (id: number, lugar: number | null) => (await det(id)).ubicaciones.find((u) => u.ubicacionProveedorId === lugar)?.cantidadMil ?? 0;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herencia-cust-'));
  base = new Base(path.join(dir, 'c.db'));
  base.tx((db) => sembrar(db));
  app = await crearApp({ base });
  await pedir('POST', '/setup', { nombre: 'Admin DEMO', usuario: 'admin', password: 'clave-demo-1' });
  cookie = String((await app.inject({ method: 'POST', url: '/api/login', payload: { usuario: 'admin', password: 'clave-demo-1' } })).headers['set-cookie']).split(';')[0];
  taller = (await pedir('POST', '/proveedores', { nombre: 'Taller DEMO', rol: 'taller' })).json.id;
  cuero = (await pedir('POST', '/materiales', { codigo: 'CU-1', nombre: 'Cuero DEMO', unidad: 'm', tipo: 'material', costoCentavos: 2000000, proveedorId: null })).json.id;
  forro = (await pedir('POST', '/materiales', { codigo: 'CU-2', nombre: 'Forro DEMO', unidad: 'm', tipo: 'material', costoCentavos: 100000, proveedorId: null })).json.id;
  mo = (await pedir('POST', '/materiales', { codigo: 'CU-3', nombre: 'Confección DEMO', unidad: 'u', tipo: 'mano_obra', costoCentavos: 3800000, proveedorId: taller })).json.id;
  const cat = (await pedir('POST', '/catalogo/categorias', { nombre: 'Camperas DEMO' })).json.id;
  const tS = (await pedir('POST', '/catalogo/talles', { nombre: 'S' })).json.id;
  const modelo = (await pedir('POST', '/catalogo/modelos', { modelo: { nombre: 'Campera DEMO', categoriaId: cat, proveedorId: taller }, variantes: [{ sku: 'CU-S', talleId: tS }] })).json.id;
  vS = (await pedir('GET', `/catalogo/modelos/${modelo}`)).json.variantes[0].id;
  await pedir('PUT', `/recetas/${modelo}`, { lineas: [{ materialId: cuero, cantidadMil: 1500 }, { materialId: forro, cantidadMil: 1000 }, { materialId: mo, cantidadMil: 1000 }] });
  await pedir('POST', `/materiales/${cuero}/conteo`, { fecha: '2026-11-17', contadoMil: 10000 });
  await pedir('POST', `/materiales/${forro}/conteo`, { fecha: '2026-11-17', contadoMil: 5000 });
});
afterAll(async () => { await app.close(); base.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('entregas de material', () => {
  it('valida origen, destino y cantidades', async () => {
    expect((await pedir('POST', '/traslados', { fecha: '2026-11-18', origenProveedorId: null, destinoProveedorId: null, items: [{ materialId: cuero, cantidadMil: 1000 }] })).status).toBe(400);
    expect((await pedir('POST', '/traslados', { fecha: '2026-11-18', origenProveedorId: null, destinoProveedorId: taller, items: [{ materialId: mo, cantidadMil: 1000 }] })).status).toBe(400);
    expect((await pedir('POST', '/traslados', { fecha: '2026-11-18', origenProveedorId: null, destinoProveedorId: taller, items: [{ materialId: cuero, cantidadMil: 0 }] })).status).toBe(400);
  });
  it('entregar al taller mueve el material de lugar sin cambiar el total, atado al pedido', async () => {
    pedido = (await pedir('POST', '/compras', { proveedorId: taller, tipo: 'confeccion', fecha: '2026-11-18', confirmar: true, items: [{ varianteId: vS, cantidad: 2, costoUnitarioCentavos: 3800000 }] })).json.id;
    const m0 = (await pedir('GET', `/custodia/pedidos/${pedido}`)).json;
    expect(m0.materiales.find((x: { materialId: number }) => x.materialId === cuero)).toMatchObject({ pendienteMil: 3000, entregadoMil: 0, enTallerMil: 0, faltaEntregarMil: 3000 });
    const r = await pedir('POST', '/traslados', { fecha: '2026-11-18', origenProveedorId: null, destinoProveedorId: taller, compraId: pedido, items: [{ materialId: cuero, cantidadMil: 4000 }, { materialId: forro, cantidadMil: 1000 }] });
    expect(r.status).toBe(200);
    expect(r.json.avisos).toEqual([]);
    expect(await en(cuero, null)).toBe(6000);
    expect(await en(cuero, taller)).toBe(4000);
    expect((await det(cuero)).stockMil).toBe(10000);
    const m1 = (await pedir('GET', `/custodia/pedidos/${pedido}`)).json;
    expect(m1.materiales.find((x: { materialId: number }) => x.materialId === cuero)).toMatchObject({ entregadoMil: 4000, enTallerMil: 4000, faltaEntregarMil: 0 });
    expect(m1.materiales.find((x: { materialId: number }) => x.materialId === forro)).toMatchObject({ entregadoMil: 1000, faltaEntregarMil: 1000 });
    const c = (await pedir('GET', '/custodia')).json;
    expect(c.lugares.map((l: { ubicacionProveedorId: number }) => l.ubicacionProveedorId)).toEqual([taller]);
    expect(c.materiales.find((x: { materialId: number }) => x.materialId === cuero)).toMatchObject({ localMil: 6000, totalMil: 10000 });
    const prod = (await pedir('GET', '/custodia/produccion')).json;
    expect(prod[0]).toMatchObject({ compraId: pedido, pedidas: 2, recibidas: 0, faltaEntregar: 1 });
  });
  it('avisa (sin frenar) si en el origen no alcanza', async () => {
    const r = await pedir('POST', '/traslados', { fecha: '2026-11-18', origenProveedorId: taller, destinoProveedorId: null, items: [{ materialId: forro, cantidadMil: 3000 }] });
    expect(r.json.avisos).toHaveLength(1);
    await pedir('POST', `/traslados/${r.json.id}/anular`, { motivo: 'Prueba DEMO' });
    expect(await en(forro, taller)).toBe(1000);
    expect((await pedir('POST', `/traslados/${r.json.id}/anular`, { motivo: 'otra' })).status).toBe(400);
  });
  it('al entregar camperas el taller usa primero lo que tiene; lo que falta sale del local', async () => {
    const k = (await pedir('GET', `/compras/${pedido}`)).json;
    const rec = (await pedir('POST', `/compras/${pedido}/recepciones`, { fecha: '2026-11-20', items: [{ compraItemId: k.items[0].id, cantidad: 2 }] })).json;
    expect(rec.produccion.delTaller).toEqual(expect.arrayContaining(['Cuero DEMO', 'Forro DEMO']));
    expect(await en(cuero, taller)).toBe(1000); // tenía 4, usó 3
    expect(await en(cuero, null)).toBe(6000);
    expect(await en(forro, taller)).toBe(0); // tenía 1, usó 1
    expect(await en(forro, null)).toBe(3000); // el otro metro salió del local
    expect((await pedir('GET', '/custodia/produccion')).json).toEqual([]); // el pedido quedó cerrado
    // anular la recepción devuelve cada cosa a su lugar
    await pedir('POST', `/recepciones/${rec.recepcionId}/anular`, { motivo: 'Prueba DEMO' });
    expect(await en(cuero, taller)).toBe(4000);
    expect(await en(forro, taller)).toBe(1000);
    expect(await en(forro, null)).toBe(4000);
  });
  it('conteo y ajuste en un lugar', async () => {
    const r = (await pedir('POST', `/materiales/${cuero}/conteo`, { fecha: '2026-11-21', contadoMil: 3500, ubicacionProveedorId: taller })).json;
    expect(r).toMatchObject({ anteriorMil: 4000, diferenciaMil: -500 });
    expect(await en(cuero, taller)).toBe(3500);
    await pedir('POST', `/materiales/${cuero}/ajustes`, { fecha: '2026-11-21', cantidadMil: -500, motivo: 'Retazo DEMO', ubicacionProveedorId: taller });
    expect(await en(cuero, taller)).toBe(3000);
    expect((await pedir('GET', `/traslados?compraId=${pedido}`)).json).toHaveLength(1);
  });
});
