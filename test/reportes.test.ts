import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Base } from '../server/db/index.js';
import { sembrar } from '../server/services/semilla.js';
import { crearApp } from '../server/http/app.js';
import { diasEntre, sumarDias } from '../server/services/reportes.js';

/** Panel, estado de resultados, ranking y alertas contra la API real, con datos DEMO. */
let dir: string; let base: Base; let app: FastifyInstance; let cookie = '';
const pedir = async (metodo: string, url: string, cuerpo?: unknown, c = cookie) => {
  const r = await app.inject({ method: metodo as 'GET', url: '/api' + url, payload: cuerpo as object, headers: { cookie: c } });
  return { status: r.statusCode, json: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body, headers: r.headers };
};
const login = async (usuario: string, password: string) => String((await app.inject({ method: 'POST', url: '/api/login', payload: { usuario, password } })).headers['set-cookie']).split(';')[0];
let formas: Record<string, { id: number; comisionBp: number }> = {};
let cuentas: Record<string, number> = {};
let vA: number, vB: number, vSinCosto: number;
const venta = (fecha: string, items: { varianteId: number; cantidad: number; precioCentavos: number }[], forma = 'Efectivo') => {
  const total = items.reduce((s, i) => s + i.cantidad * i.precioCentavos, 0);
  return pedir('POST', '/ventas', { fecha, listaPrecioId: 1, items, pagos: [{ formaPagoId: formas[forma].id, importeCentavos: total }] });
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herencia-reportes-'));
  base = new Base(path.join(dir, 'r.db'));
  base.tx((db) => sembrar(db));
  app = await crearApp({ base });
  await pedir('POST', '/setup', { nombre: 'Admin DEMO', usuario: 'admin', password: 'clave-demo-1' }, '');
  cookie = await login('admin', 'clave-demo-1');
  formas = Object.fromEntries(((await pedir('GET', '/formas-pago')).json as { nombre: string; id: number; comisionBp: number }[]).map((f) => [f.nombre, f]));
  cuentas = Object.fromEntries(((await pedir('GET', '/cuentas')).json as { nombre: string; id: number }[]).map((c) => [c.nombre, c.id]));
  const cat = (await pedir('POST', '/catalogo/categorias', { nombre: 'Camperas DEMO' })).json.id;
  const cat2 = (await pedir('POST', '/catalogo/categorias', { nombre: 'Billeteras DEMO' })).json.id;
  const m1 = (await pedir('POST', '/catalogo/modelos', { modelo: { nombre: 'Campera DEMO', categoriaId: cat }, variantes: [{ sku: 'RD-A', costoCentavos: 10000000, precios: { '1': 20000000 } }] })).json.id;
  const m2 = (await pedir('POST', '/catalogo/modelos', { modelo: { nombre: 'Billetera DEMO', categoriaId: cat2 }, variantes: [{ sku: 'RD-B', costoCentavos: 1000000, precios: { '1': 3000000 } }, { sku: 'RD-C', precios: { '1': 2000000 } }] })).json.id;
  vA = (await pedir('GET', `/catalogo/modelos/${m1}`)).json.variantes[0].id;
  const d2 = (await pedir('GET', `/catalogo/modelos/${m2}`)).json.variantes;
  vB = d2.find((v: { sku: string }) => v.sku === 'RD-B').id;
  vSinCosto = d2.find((v: { sku: string }) => v.sku === 'RD-C').id;
  for (const v of [vA, vB, vSinCosto]) await pedir('POST', '/stock/ajustes', { varianteId: v, cantidad: 10, motivo: 'Carga DEMO' });
  // Octubre: 1 campera. Noviembre: 2 camperas (una con QR), 3 billeteras, 1 sin costo.
  await venta('2026-10-20', [{ varianteId: vA, cantidad: 1, precioCentavos: 20000000 }]);
  await venta('2026-11-02', [{ varianteId: vA, cantidad: 1, precioCentavos: 20000000 }, { varianteId: vB, cantidad: 3, precioCentavos: 3000000 }]);
  await venta('2026-11-05', [{ varianteId: vA, cantidad: 1, precioCentavos: 18000000 }], 'Mercado Pago (dinero en cuenta / QR)');
  await venta('2026-11-05', [{ varianteId: vSinCosto, cantidad: 1, precioCentavos: 2000000 }]);
  const anular = (await venta('2026-11-06', [{ varianteId: vB, cantidad: 1, precioCentavos: 3000000 }])).json.id;
  await pedir('POST', `/ventas/${anular}/anular`, { motivo: 'Prueba DEMO' });
  const cats = (await pedir('GET', '/gastos/categorias')).json as { id: number; nombre: string; padreId: number | null }[];
  await pedir('POST', '/gastos', { fecha: '2026-11-03', concepto: 'Alquiler DEMO', categoriaId: cats.find((c) => c.nombre === 'Alquiler')!.id, importeCentavos: 5000000, cuentaId: cuentas.Efectivo });
});
afterAll(async () => { await app.close(); base.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('fechas', () => {
  it('suma días y cuenta días entre fechas, cruzando meses', () => {
    expect(sumarDias('2026-10-30', 3)).toBe('2026-11-02');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(diasEntre('2026-10-30', '2026-11-02')).toBe(3);
  });
});

describe('panel', () => {
  it('suma solo ventas confirmadas, separa lo que no tiene costo y descuenta comisiones y gastos', async () => {
    const r = await pedir('GET', '/panel?desde=2026-11-01&hasta=2026-11-30');
    expect(r.status).toBe(200);
    const a = r.json.actual;
    const qr = formas['Mercado Pago (dinero en cuenta / QR)'];
    const comision = Math.round((18000000 * qr.comisionBp) / 10000);
    expect(a.ventas).toBe(3);
    expect(a.unidades).toBe(6);
    expect(a.totalCentavos).toBe(20000000 + 9000000 + 18000000 + 2000000);
    expect(a.costoCentavos).toBe(10000000 * 2 + 1000000 * 3);
    expect(a.comisionCentavos).toBe(comision);
    expect(a.unidadesSinCosto).toBe(1);
    expect(a.gananciaCentavos).toBe(20000000 + 9000000 + 18000000 - 23000000 - comision);
    expect(a.gastosCentavos).toBe(5000000);
    expect(a.resultadoCentavos).toBe(a.gananciaCentavos - 5000000);
    expect(r.json.anterior).toEqual({ desde: '2026-10-02', hasta: '2026-10-31' });
    expect(r.json.previo.totalCentavos).toBe(20000000);
    expect(r.json.porDia).toHaveLength(30);
    expect(r.json.porDia.find((d: { fecha: string }) => d.fecha === '2026-11-05').totalCentavos).toBe(20000000);
    expect(r.json.porCategoria.map((c: { categoria: string }) => c.categoria)).toEqual(['Camperas DEMO', 'Billeteras DEMO']);
    expect(r.json.topProductos[0]).toMatchObject({ modelo: 'Campera DEMO', unidades: 2, stock: 7 });
    expect(r.json.topProductos[1].sinCosto).toBe(true);
  });

  it('rechaza rangos al revés', async () => {
    expect((await pedir('GET', '/panel?desde=2026-11-10&hasta=2026-11-01')).status).toBe(400);
  });
});

describe('estado de resultados', () => {
  it('arma un mes por columna y exporta a Excel', async () => {
    const r = (await pedir('GET', '/reportes/resultados?desde=2026-10&hasta=2026-11')).json;
    expect(r.meses).toEqual(['2026-10', '2026-11']);
    expect(r.filas[0]).toMatchObject({ mes: '2026-10', ventasCentavos: 20000000, gananciaBrutaCentavos: 10000000, gastosCentavos: 0 });
    expect(r.filas[1].gastos).toEqual({ Alquiler: 5000000 });
    const x = await pedir('GET', '/reportes/resultados/exportar?desde=2026-10&hasta=2026-11');
    expect(x.status).toBe(200);
    expect(String(x.headers['content-type'])).toContain('spreadsheet');
    const csv = await pedir('GET', '/reportes/resultados/exportar?desde=2026-10&hasta=2026-11&formato=csv');
    expect(String(csv.json)).toContain('Gastos: Alquiler');
  });
});

describe('productos sin movimiento', () => {
  it('lista los modelos con stock que no se venden hace tiempo', async () => {
    // Las ventas DEMO son de principios de noviembre: a 7 días ya figuran como quietos; a 10 años, no.
    const r = (await pedir('GET', '/reportes/sin-movimiento?dias=7')).json;
    expect(r.map((x: { modelo: string }) => x.modelo).sort()).toEqual(['Billetera DEMO', 'Campera DEMO']);
    expect(r.find((x: { modelo: string }) => x.modelo === 'Campera DEMO').valorCostoCentavos).toBe(7 * 10000000);
    expect((await pedir('GET', '/reportes/sin-movimiento?dias=3650')).json).toEqual([]);
  });
});

describe('alertas', () => {
  it('avisa lo que falta y respeta los permisos', async () => {
    const r = (await pedir('GET', '/alertas')).json as { id: string; nivel: string }[];
    const ids = r.map((a) => a.id);
    expect(ids).toContain('sin-costo');
    expect(ids).toContain('cotizacion');
    expect(ids).toContain('backup'); // la base de prueba no tiene copias
    expect(r[0].nivel).toBe('critico');
    const roles = (await pedir('GET', '/roles')).json as { id: number; nombre: string }[];
    await pedir('POST', '/usuarios', { nombre: 'Vendedor DEMO', usuario: 'vende', password: 'clave-demo-4', rolId: roles.find((x) => x.nombre === 'Ventas')!.id });
    const c = await login('vende', 'clave-demo-4');
    const suyas = (await pedir('GET', '/alertas', undefined, c)).json as { modulo: string }[];
    expect(suyas.every((a) => ['stock', 'precios'].includes(a.modulo))).toBe(true);
    expect((await pedir('GET', '/panel', undefined, c)).status).toBe(403);
  });

  it('sin permiso de costos el panel no muestra costo ni ganancia', async () => {
    const roles = (await pedir('GET', '/roles')).json as { id: number; nombre: string }[];
    const rol = (await pedir('POST', '/roles', { nombre: 'Encargada DEMO', descripcion: 'Ve ventas sin costos', permisos: { panel: ['ver'], ventas: ['ver'] } })).json;
    await pedir('POST', '/usuarios', { nombre: 'Encargada DEMO', usuario: 'encargada', password: 'clave-demo-5', rolId: rol.id ?? roles[0].id });
    const c = await login('encargada', 'clave-demo-5');
    const r = await pedir('GET', '/panel?desde=2026-11-01&hasta=2026-11-30', undefined, c);
    expect(r.status).toBe(200);
    expect(r.json.actual.totalCentavos).toBe(49000000);
    expect(r.json.actual.costoCentavos).toBeUndefined();
    expect(r.json.actual.gananciaCentavos).toBeUndefined();
    expect(r.json.actual.gastosCentavos).toBeUndefined();
    expect(r.json.topProductos[0].gananciaBrutaCentavos).toBeUndefined();
    expect((await pedir('GET', '/reportes/resultados', undefined, c)).status).toBe(403);
  });
});
