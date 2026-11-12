import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Base } from '../server/db/index.js';
import { sembrar } from '../server/services/semilla.js';
import { crearApp } from '../server/http/app.js';

/** Materiales, recetas, costeo, precios sugeridos y consumo por producción, con datos DEMO. */
let dir: string; let base: Base; let app: FastifyInstance; let cookie = '';
const pedir = async (metodo: string, url: string, cuerpo?: unknown, c = cookie) => {
  const r = await app.inject({ method: metodo as 'GET', url: '/api' + url, payload: cuerpo as object, headers: { cookie: c } });
  return { status: r.statusCode, json: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body };
};
const login = async (usuario: string, password: string) => String((await app.inject({ method: 'POST', url: '/api/login', payload: { usuario, password } })).headers['set-cookie']).split(';')[0];

let cuero: number, forro: number, mo: number, prov: number, modelo: number, cat: number;
let vS: number, vT7: number;
const stockMat = async (id: number) => (await pedir('GET', `/materiales/${id}`)).json.stockMil;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herencia-costos-'));
  base = new Base(path.join(dir, 'c.db'));
  base.tx((db) => sembrar(db));
  app = await crearApp({ base });
  await pedir('POST', '/setup', { nombre: 'Admin DEMO', usuario: 'admin', password: 'clave-demo-1' }, '');
  cookie = await login('admin', 'clave-demo-1');
  prov = (await pedir('POST', '/proveedores', { nombre: 'Curtiembre DEMO' })).json.id;
  cat = (await pedir('POST', '/catalogo/categorias', { nombre: 'Camperas DEMO' })).json.id;
  const tS = (await pedir('POST', '/catalogo/talles', { nombre: 'S' })).json.id;
  const t7 = (await pedir('POST', '/catalogo/talles', { nombre: '7' })).json.id;
  modelo = (await pedir('POST', '/catalogo/modelos', { modelo: { nombre: 'Campera DEMO', categoriaId: cat }, variantes: [
    { sku: 'CD-S', talleId: tS, precios: { '1': 30000000 } }, { sku: 'CD-7', talleId: t7 },
  ] })).json.id;
  const det = (await pedir('GET', `/catalogo/modelos/${modelo}`)).json;
  vS = det.variantes.find((v: { sku: string }) => v.sku === 'CD-S').id;
  vT7 = det.variantes.find((v: { sku: string }) => v.sku === 'CD-7').id;
});
afterAll(async () => { await app.close(); base.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('materiales', () => {
  it('crea materiales y mano de obra; no repite códigos', async () => {
    cuero = (await pedir('POST', '/materiales', { codigo: 'mat-d1', nombre: 'Cuero DEMO', unidad: 'm', tipo: 'material', costoCentavos: 2000000, proveedorId: prov })).json.id;
    forro = (await pedir('POST', '/materiales', { codigo: 'MAT-D2', nombre: 'Forro DEMO', unidad: 'm', tipo: 'material', costoCentavos: 160000, proveedorId: null })).json.id;
    mo = (await pedir('POST', '/materiales', { codigo: 'MO-D1', nombre: 'Mano de obra DEMO', unidad: 'u', tipo: 'mano_obra', costoCentavos: 3800000, proveedorId: null })).json.id;
    expect((await pedir('POST', '/materiales', { codigo: 'MAT-D1', nombre: 'Otro', unidad: 'm', tipo: 'material', costoCentavos: null, proveedorId: null })).status).toBe(400);
    const lista = (await pedir('GET', '/materiales')).json;
    expect(lista.map((m: { codigo: string }) => m.codigo)).toEqual(['MAT-D1', 'MAT-D2', 'MO-D1']);
    expect(lista.find((m: { id: number }) => m.id === mo).stockMil).toBeNull();
  });

  it('una compra suma stock, recalcula el costo promedio y queda en la cuenta corriente del proveedor', async () => {
    await pedir('POST', `/materiales/${cuero}/ajustes`, { fecha: '2026-11-01', cantidadMil: 10000, motivo: 'Stock inicial DEMO', tipo: 'inicial' });
    const r = (await pedir('POST', `/materiales/${cuero}/ingresos`, { fecha: '2026-11-02', cantidadMil: 10000, costoUnitarioCentavos: 3000000, proveedorId: prov, comprobante: 'FC-1' })).json;
    expect(r.costoNuevoCentavos).toBe(2500000); // (10 × 20.000 + 10 × 30.000) / 20
    expect(await stockMat(cuero)).toBe(20000);
    const saldo = (await pedir('GET', '/proveedores/saldos')).json;
    const s = Array.isArray(saldo) ? saldo.find((x: { proveedorId?: number; id?: number }) => (x.proveedorId ?? x.id) === prov) : saldo[prov];
    expect(JSON.stringify(s)).toContain('30000000');
    const cc = (await pedir('GET', `/proveedores/${prov}/cuenta-corriente`)).json;
    expect(cc.saldoCentavos).toBe(30000000);
    expect(cc.lineas[0].detalle).toContain('Compra de Cuero DEMO');
  });

  it('la mano de obra no tiene stock', async () => {
    expect((await pedir('POST', `/materiales/${mo}/ingresos`, { fecha: '2026-11-02', cantidadMil: 1000, costoUnitarioCentavos: 1 })).status).toBe(400);
  });

  it('anular una compra devuelve el stock y descuenta de la cuenta corriente', async () => {
    const r = (await pedir('POST', `/materiales/${forro}/ingresos`, { fecha: '2026-11-03', cantidadMil: 5000, costoUnitarioCentavos: 160000, proveedorId: prov })).json;
    expect((await pedir('GET', `/proveedores/${prov}/cuenta-corriente`)).json.saldoCentavos).toBe(30800000);
    expect((await pedir('POST', `/materiales/movimientos/${r.movimientoId}/anular`, { motivo: 'Cargado de más' })).status).toBe(200);
    expect(await stockMat(forro)).toBe(0);
    expect((await pedir('GET', `/proveedores/${prov}/cuenta-corriente`)).json.saldoCentavos).toBe(30000000);
    expect((await pedir('POST', `/materiales/movimientos/${r.movimientoId}/anular`, { motivo: 'otra vez' })).status).toBe(400);
  });
});

describe('recetas y costeo', () => {
  it('guarda la receta con agregado de cuero para el talle 7', async () => {
    const r = await pedir('PUT', `/recetas/${modelo}`, { lineas: [
      { materialId: cuero, cantidadMil: 1500 }, { materialId: forro, cantidadMil: 1000 }, { materialId: mo, cantidadMil: 1000 },
      { materialId: cuero, cantidadMil: 250, talles: ['7'] },
    ] });
    expect(r.status).toBe(200);
    expect(r.json).toHaveLength(4);
    expect((await pedir('PUT', `/recetas/${modelo}`, { lineas: [{ materialId: cuero, cantidadMil: 1 }, { materialId: cuero, cantidadMil: 2 }] })).status).toBe(400);
  });

  it('calcula el costo por talle con componentes configurables', async () => {
    const cfg = (await pedir('GET', '/config')).json;
    expect(cfg.costos).toEqual({ componentes: [] });
    const g = await pedir('PUT', '/config/costos', { componentes: [
      { id: 'packaging', nombre: 'Packaging DEMO', tipo: 'fijo', valor: 500000, categoriaId: null, activo: true },
      { id: 'merma', nombre: 'Merma DEMO', tipo: 'porcentaje_costo', valor: 500, categoriaId: cat, activo: true },
      { id: 'iibb', nombre: 'IIBB DEMO', tipo: 'porcentaje_precio', valor: 300, categoriaId: null, activo: true },
    ] });
    expect(g.status).toBe(200);
    const [m] = (await pedir('GET', `/costeo?modeloIds=${modelo}`)).json;
    const s = m.variantes.find((v: { sku: string }) => v.sku === 'CD-S');
    const t7 = m.variantes.find((v: { sku: string }) => v.sku === 'CD-7');
    // cuero 1,5 × 25.000 = 37.500; forro 1 × 1.600; mano de obra 38.000
    expect(s.materialesCentavos).toBe(3750000 + 160000);
    expect(s.manoObraCentavos).toBe(3800000);
    expect(s.adicionalCentavos).toBe(500000 + Math.round(7710000 * 0.05 / 100) * 100);
    expect(s.calculadoCentavos).toBe(7710000);
    expect(t7.materialesCentavos).toBe(s.materialesCentavos + 625000);
    expect(t7.agregados[0]).toContain('Cuero DEMO +0.25');
    expect(s.cambia).toBe(true);
  });

  it('aplica el costo solo a lo elegido y rechaza si cambió en el medio', async () => {
    const [m] = (await pedir('GET', `/costeo?modeloIds=${modelo}`)).json;
    const s = m.variantes.find((v: { sku: string }) => v.sku === 'CD-S');
    expect((await pedir('POST', '/costeo/aplicar', { varianteIds: [vS], motivo: 'Costeo DEMO', previstos: { [vS]: s.totalCalculadoCentavos + 1 } })).status).toBe(409);
    expect((await pedir('POST', '/costeo/aplicar', { varianteIds: [vS], motivo: 'Costeo DEMO', previstos: { [vS]: s.totalCalculadoCentavos } })).json.cambiadas).toBe(1);
    const det = (await pedir('GET', `/catalogo/modelos/${modelo}`)).json;
    const vs = det.variantes.find((v: { id: number }) => v.id === vS);
    const v7 = det.variantes.find((v: { id: number }) => v.id === vT7);
    expect(vs.costoCentavos).toBe(s.calculadoCentavos);
    expect(vs.costoAdicionalCentavos).toBe(s.adicionalCentavos);
    expect(v7.costoCentavos).toBeNull();
  });

  it('no aplica si falta el costo de un material', async () => {
    await pedir('PUT', `/materiales/${forro}`, { codigo: 'MAT-D2', nombre: 'Forro DEMO', unidad: 'm', tipo: 'material', costoCentavos: null, proveedorId: null, motivo: 'Precio a confirmar' });
    const r = await pedir('POST', '/costeo/aplicar', { varianteIds: [vT7], motivo: 'x' });
    expect(r.status).toBe(400);
    expect(r.json.error ?? r.json.mensaje ?? JSON.stringify(r.json)).toContain('Forro DEMO');
    await pedir('PUT', `/materiales/${forro}`, { codigo: 'MAT-D2', nombre: 'Forro DEMO', unidad: 'm', tipo: 'material', costoCentavos: 160000, proveedorId: null, motivo: 'Confirmado' });
    const hist = (await pedir('GET', `/materiales/${forro}`)).json.historial;
    expect(hist.map((h: { nuevoCentavos: number | null }) => h.nuevoCentavos)).toEqual([160000, null, 160000]);
  });
});

describe('precios sugeridos', () => {
  it('sugiere por margen descontando los % sobre el precio y no publica nada solo', async () => {
    const filas = (await pedir('POST', '/precios-sugeridos', { listaId: 1, metodo: 'margen', valorBp: 5000, modeloIds: [modelo], redondeoCentavos: 100000 })).json;
    const s = filas.find((f: { sku: string }) => f.sku === 'CD-S');
    const sinCosto = filas.find((f: { sku: string }) => f.sku === 'CD-7');
    expect(sinCosto.sugeridoCentavos).toBeNull();
    // precio = costo / (1 − 50% − 3%), redondeado a $1.000
    expect(s.sugeridoCentavos).toBe(Math.ceil(s.costo / 0.47 / 100000) * 100000);
    expect(s.actual).toBe(30000000);
    expect(s.debajoObjetivo).toBe(false); // $300.000 deja más del 50%
    const det = (await pedir('GET', `/catalogo/modelos/${modelo}`)).json;
    expect(det.variantes.find((v: { id: number }) => v.id === vS).precios['1']).toBe(30000000);
  });

  it('publica solo lo elegido, con motivo, y rechaza si el precio cambió desde la vista', async () => {
    expect((await pedir('POST', '/precios-sugeridos/aplicar', { listaId: 1, motivo: 'Ajuste DEMO', cambios: [{ varianteId: vS, precioCentavos: 32000000, actualPrevisto: 29000000 }] })).status).toBe(409);
    const r = await pedir('POST', '/precios-sugeridos/aplicar', { listaId: 1, motivo: 'Ajuste DEMO', cambios: [{ varianteId: vS, precioCentavos: 32000000, actualPrevisto: 30000000 }] });
    expect(r.json.cambiados).toBe(1);
    const det = (await pedir('GET', `/catalogo/modelos/${modelo}`)).json;
    expect(det.variantes.find((v: { id: number }) => v.id === vS).precios['1']).toBe(32000000);
  });
});

describe('producción', () => {
  it('al recibir del taller descuenta los materiales de la receta, y al anular vuelven', async () => {
    const antesCuero = await stockMat(cuero);
    const c = (await pedir('POST', '/compras', { proveedorId: prov, tipo: 'confeccion', fecha: '2026-11-05', confirmar: true, items: [
      { varianteId: vS, cantidad: 2, costoUnitarioCentavos: 3800000 }, { varianteId: vT7, cantidad: 1, costoUnitarioCentavos: 3800000 },
    ] })).json.id;
    const items = (await pedir('GET', `/compras/${c}`)).json.items;
    const rec = (await pedir('POST', `/compras/${c}/recepciones`, { fecha: '2026-11-06', items: items.map((i: { id: number; cantidad: number }) => ({ compraItemId: i.id, cantidad: i.cantidad })) })).json;
    expect(rec.produccion.materiales).toBe(2);
    expect(await stockMat(cuero)).toBe(antesCuero - (3 * 1500 + 250));
    expect(await stockMat(forro)).toBe(-3000); // puede quedar negativo: se avisa, no se frena la entrega
    await pedir('POST', `/recepciones/${rec.recepcionId}/anular`, { motivo: 'Prueba DEMO' });
    expect(await stockMat(cuero)).toBe(antesCuero);
    expect(await stockMat(forro)).toBe(0);
  });
});

describe('permisos', () => {
  it('depósito ve materiales sin costos y no puede costear ni ver precios sugeridos', async () => {
    const roles = (await pedir('GET', '/roles')).json as { id: number; nombre: string }[];
    await pedir('POST', '/usuarios', { nombre: 'Depósito DEMO', usuario: 'deposito', password: 'clave-demo-2', rolId: roles.find((r) => r.nombre === 'Depósito')!.id });
    const c = await login('deposito', 'clave-demo-2');
    const lista = (await pedir('GET', '/materiales', undefined, c)).json;
    expect(lista[0].costoCentavos).toBeUndefined();
    expect(lista[0].stockMil).toBeDefined();
    expect((await pedir('GET', `/materiales/${cuero}`, undefined, c)).json.historial).toBeUndefined();
    expect((await pedir('GET', '/costeo', undefined, c)).status).toBe(403);
    expect((await pedir('POST', '/precios-sugeridos', { listaId: 1, metodo: 'margen', valorBp: 5000 }, c)).status).toBe(403);
    expect((await pedir('POST', `/materiales/${cuero}/ingresos`, { fecha: '2026-11-07', cantidadMil: 1000, costoUnitarioCentavos: 1 }, c)).status).toBe(403);
    // Puede editar datos del material sin tocar el costo.
    await pedir('PUT', `/materiales/${cuero}`, { codigo: 'MAT-D1', nombre: 'Cuero DEMO vacuno', unidad: 'm', tipo: 'material', proveedorId: prov }, c);
    const m = (await pedir('GET', `/materiales/${cuero}`)).json;
    expect(m.nombre).toBe('Cuero DEMO vacuno');
    expect(m.costoCentavos).toBe(2500000);
  });
});
