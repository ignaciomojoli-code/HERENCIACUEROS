import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Base } from '../server/db/index.js';
import { sembrar } from '../server/services/semilla.js';
import { crearApp } from '../server/http/app.js';
import { comisionEstimada } from '../server/services/ventas.js';

/** Ventas, caja, gastos y pagos contra la API real, con base temporal y datos DEMO. */
let dir: string; let base: Base; let app: FastifyInstance; let cookie = '';
const pedir = async (metodo: string, url: string, cuerpo?: unknown, c = cookie) => {
  const r = await app.inject({ method: metodo as 'GET', url: '/api' + url, payload: cuerpo as object, headers: { cookie: c } });
  return { status: r.statusCode, json: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body };
};
const login = async (usuario: string, password: string) => String((await app.inject({ method: 'POST', url: '/api/login', payload: { usuario, password } })).headers['set-cookie']).split(';')[0];

type Cuenta = { id: number; nombre: string; saldoCentavos: number };
type Forma = { id: number; nombre: string; cuentaId: number; comisionBp: number };
let cuentas: Record<string, number> = {};
let formas: Record<string, Forma> = {};
let v1: number, v2: number, prov: number;
const saldo = async (nombre: string) => ((await pedir('GET', '/cuentas')).json as Cuenta[]).find((c) => c.nombre === nombre)!.saldoCentavos;
const stockDe = async (id: number) => (await pedir('GET', `/stock/variante/${id}`)).json.stock;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herencia-plata-'));
  base = new Base(path.join(dir, 'p.db'));
  base.tx((db) => sembrar(db));
  app = await crearApp({ base });
  await pedir('POST', '/setup', { nombre: 'Admin DEMO', usuario: 'admin', password: 'clave-demo-1' }, '');
  cookie = await login('admin', 'clave-demo-1');
  cuentas = Object.fromEntries(((await pedir('GET', '/cuentas')).json as Cuenta[]).map((c) => [c.nombre, c.id]));
  formas = Object.fromEntries(((await pedir('GET', '/formas-pago')).json as Forma[]).map((f) => [f.nombre, f]));
  const cat = (await pedir('POST', '/catalogo/categorias', { nombre: 'Camperas DEMO' })).json.id;
  const m = (await pedir('POST', '/catalogo/modelos', { modelo: { nombre: 'Campera DEMO', categoriaId: cat }, variantes: [
    { sku: 'CAMD-1', costoCentavos: 10000000, precios: { '1': 20000000, '2': 25000000 } },
    { sku: 'CAMD-2', precios: { '1': 5000000 } },
  ] })).json.id;
  const det = (await pedir('GET', `/catalogo/modelos/${m}`)).json;
  v1 = det.variantes.find((v: { sku: string }) => v.sku === 'CAMD-1').id;
  v2 = det.variantes.find((v: { sku: string }) => v.sku === 'CAMD-2').id;
  await pedir('POST', '/stock/ajustes', { varianteId: v1, cantidad: 5, motivo: 'Carga DEMO' });
  await pedir('POST', '/stock/ajustes', { varianteId: v2, cantidad: 2, motivo: 'Carga DEMO' });
  prov = (await pedir('POST', '/proveedores', { nombre: 'Taller DEMO' })).json.id;
});
afterAll(async () => { await app.close(); base.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('datos iniciales', () => {
  it('crea las cuentas, formas de pago y categorías de gastos de la planilla', async () => {
    expect(Object.keys(cuentas)).toEqual(['Efectivo', 'Mercado Pago', 'Cuenta DNI', 'Tarjetas a liquidar', 'Dólares', 'Inversor externo']);
    expect(Object.keys(formas)).toHaveLength(13);
    expect(formas['Crédito 1 pago · Mercado Pago'].comisionBp).toBe(900);
    const cats = (await pedir('GET', '/gastos/categorias')).json as { nombre: string; padreId: number | null }[];
    const servicios = cats.find((c) => c.nombre === 'Servicios')!;
    expect(cats.filter((c) => c.padreId === (servicios as unknown as { id: number }).id).map((c) => c.nombre)).toEqual(['Luz', 'ABL', 'AySA', 'Internet', 'Alarma']);
  });
});

describe('ventas', () => {
  let ventaEfectivo: number;
  it('venta en efectivo con descuento: baja stock, entra la plata y calcula la ganancia', async () => {
    const r = await pedir('POST', '/ventas', { fecha: '2026-11-12', listaPrecioId: 1, items: [{ varianteId: v1, cantidad: 1, precioCentavos: 18000000 }], pagos: [{ formaPagoId: formas.Efectivo.id, importeCentavos: 18000000 }] });
    expect(r.status).toBe(200);
    ventaEfectivo = r.json.id;
    expect(await stockDe(v1)).toBe(4);
    expect(await saldo('Efectivo')).toBe(18000000);
    const v = (await pedir('GET', `/ventas/${ventaEfectivo}`)).json;
    expect(v.diferenciaListaCentavos).toBe(-2000000);
    expect(v.gananciaCentavos).toBe(8000000);
  });
  it('lo cobrado tiene que coincidir con el total y no se vende sin stock', async () => {
    expect((await pedir('POST', '/ventas', { fecha: '2026-11-12', items: [{ varianteId: v1, cantidad: 1, precioCentavos: 100 }], pagos: [{ formaPagoId: formas.Efectivo.id, importeCentavos: 99 }] })).status).toBe(400);
    expect((await pedir('POST', '/ventas', { fecha: '2026-11-12', items: [{ varianteId: v2, cantidad: 3, precioCentavos: 100 }], pagos: [{ formaPagoId: formas.Efectivo.id, importeCentavos: 300 }] })).status).toBe(409);
    expect(await saldo('Efectivo')).toBe(18000000);
  });
  it('tarjeta: entra a "a liquidar" sin descontar comisión; la liquidación la registra', async () => {
    const f = formas['Crédito 1 pago · Mercado Pago'];
    const r = await pedir('POST', '/ventas', { fecha: '2026-11-12', listaPrecioId: 2, items: [{ varianteId: v1, cantidad: 1, precioCentavos: 25000000 }], pagos: [{ formaPagoId: f.id, importeCentavos: 25000000 }] });
    expect(r.status).toBe(200);
    expect(await saldo('Tarjetas a liquidar')).toBe(25000000);
    expect((await pedir('GET', `/ventas/${r.json.id}`)).json.comisionCentavos).toBe(comisionEstimada(25000000, 900));
    const liq = await pedir('POST', '/caja/liquidaciones', { fecha: '2026-11-20', origenId: cuentas['Tarjetas a liquidar'], destinoId: cuentas['Mercado Pago'], brutoCentavos: 25000000, netoCentavos: 22800000 });
    expect(liq.json.comisionCentavos).toBe(2200000);
    expect(await saldo('Tarjetas a liquidar')).toBe(0);
    expect(await saldo('Mercado Pago')).toBe(22800000);
  });
  it('QR de Mercado Pago descuenta la comisión estimada al momento, y se puede corregir con la real', async () => {
    const f = formas['Mercado Pago (dinero en cuenta / QR)'];
    const antes = await saldo('Mercado Pago');
    const r = await pedir('POST', '/ventas', { fecha: '2026-11-12', items: [{ varianteId: v2, cantidad: 1, precioCentavos: 5000000 }], pagos: [{ formaPagoId: f.id, importeCentavos: 5000000 }] });
    expect(await saldo('Mercado Pago')).toBe(antes + 5000000 - 360000);
    const pago = (await pedir('GET', `/ventas/${r.json.id}`)).json.pagos[0];
    expect((await pedir('PUT', `/ventas/pagos/${pago.id}/comision`, { comisionRealCentavos: 300000 })).status).toBe(200);
    expect(await saldo('Mercado Pago')).toBe(antes + 5000000 - 300000);
  });
  it('pago dividido y en dólares', async () => {
    const pagos = [{ formaPagoId: formas.Efectivo.id, importeCentavos: 6000000 }, { formaPagoId: formas['Dólares (efectivo)'].id, importeCentavos: 14000000 }];
    const cuerpo = { fecha: '2026-11-12', items: [{ varianteId: v1, cantidad: 1, precioCentavos: 20000000 }], pagos };
    expect((await pedir('POST', '/ventas', cuerpo)).status).toBe(400); // falta cuántos dólares
    expect((await pedir('POST', '/ventas', { ...cuerpo, pagos: [pagos[0], { ...pagos[1], importeMonedaCentavos: 10000 }] })).status).toBe(200);
    const usd = ((await pedir('GET', '/cuentas')).json as (Cuenta & { saldoArsCentavos: number })[]).find((c) => c.nombre === 'Dólares')!;
    expect(usd.saldoArsCentavos).toBe(14000000);
    expect(await saldo('Dólares')).toBe(10000);
  });
  it('anular devuelve el stock y revierte la plata', async () => {
    expect((await pedir('POST', `/ventas/${ventaEfectivo}/anular`, { motivo: '' })).status).toBe(400);
    const stock = await stockDe(v1);
    const efectivo = await saldo('Efectivo');
    expect((await pedir('POST', `/ventas/${ventaEfectivo}/anular`, { motivo: 'Devolución DEMO' })).status).toBe(200);
    expect(await stockDe(v1)).toBe(stock + 1);
    expect(await saldo('Efectivo')).toBe(efectivo - 18000000);
    expect((await pedir('POST', `/ventas/${ventaEfectivo}/anular`, { motivo: 'otra vez' })).status).toBe(400);
    const lista = (await pedir('GET', '/ventas?desde=2026-11-12&hasta=2026-11-12')).json;
    expect(lista.resumen.ventas).toBe(3);
  });
});

describe('caja', () => {
  it('pase, retiro y aporte', async () => {
    await pedir('POST', '/caja/aportes', { fecha: '2026-11-12', cuentaId: cuentas.Efectivo, importeCentavos: 1000000, aportante: 'Inversor DEMO' });
    const e = await saldo('Efectivo');
    expect((await pedir('POST', '/caja/pases', { fecha: '2026-11-12', origenId: cuentas['Mercado Pago'], destinoId: cuentas.Efectivo, importeCentavos: 500000 })).status).toBe(200);
    expect((await pedir('POST', '/caja/retiros', { fecha: '2026-11-12', cuentaId: cuentas.Efectivo, importeCentavos: 200000, concepto: 'Corte de pelo DEMO' })).status).toBe(200);
    expect(await saldo('Efectivo')).toBe(e + 500000 - 200000);
  });
  it('arqueo: la diferencia queda como ajuste no identificado y se puede anular', async () => {
    const e = await saldo('Efectivo');
    const a = await pedir('POST', '/caja/arqueos', { fecha: '2026-11-12', cuentaId: cuentas.Efectivo, saldoRealCentavos: e - 57800 * 100 });
    expect(a.json.diferenciaCentavos).toBe(-5780000);
    expect(await saldo('Efectivo')).toBe(e - 5780000);
    const movs = (await pedir('GET', `/caja/movimientos?cuentaId=${cuentas.Efectivo}&tipo=ajuste`)).json;
    expect(movs.filas[0].concepto).toMatch(/no identificada/);
    expect((await pedir('POST', `/caja/operaciones/${movs.filas[0].grupo}/anular`, { motivo: 'Apareció la plata DEMO' })).status).toBe(200);
    expect(await saldo('Efectivo')).toBe(e);
  });
  it('los movimientos de una venta no se anulan desde caja', async () => {
    const m = (await pedir('GET', '/caja/movimientos?tipo=venta')).json.filas[0];
    expect(m.grupo).toBeNull();
  });
});

describe('gastos', () => {
  it('gasto con subcategoría pagado por el inversor externo: queda el aporte y el saldo no cambia', async () => {
    const cats = (await pedir('GET', '/gastos/categorias')).json as { id: number; nombre: string; padreId: number | null }[];
    const servicios = cats.find((c) => c.nombre === 'Servicios')!;
    const luz = cats.find((c) => c.nombre === 'Luz')!;
    const otros = cats.find((c) => c.nombre === 'Otros')!;
    expect((await pedir('POST', '/gastos', { fecha: '2026-11-10', concepto: 'Luz DEMO', categoriaId: otros.id, subcategoriaId: luz.id, importeCentavos: 4500000, cuentaId: cuentas['Inversor externo'] })).status).toBe(400);
    const g = await pedir('POST', '/gastos', { fecha: '2026-11-10', concepto: 'Luz DEMO', categoriaId: servicios.id, subcategoriaId: luz.id, importeCentavos: 4500000, cuentaId: cuentas['Inversor externo'] });
    expect(g.status).toBe(200);
    expect(await saldo('Inversor externo')).toBe(0);
    const r = (await pedir('GET', '/caja/resumen?desde=2026-11-01')).json;
    expect(r.aportes.find((a: { cuenta: string }) => a.cuenta === 'Inversor externo').totalCentavos).toBe(4500000);
    const lista = (await pedir('GET', '/gastos?desde=2026-11-01')).json;
    expect(lista.totalCentavos).toBe(4500000);
    expect(lista.pagadoPorExternosCentavos).toBe(4500000);
    expect(lista.porCategoria[0].sub[0]).toEqual({ nombre: 'Luz', totalCentavos: 4500000 });
  });
  it('gasto en efectivo y anulación', async () => {
    const otros = ((await pedir('GET', '/gastos/categorias')).json as { id: number; nombre: string }[]).find((c) => c.nombre === 'Otros')!;
    const e = await saldo('Efectivo');
    const g = (await pedir('POST', '/gastos', { fecha: '2026-11-12', concepto: 'Perchas DEMO', categoriaId: otros.id, importeCentavos: 4400000, cuentaId: cuentas.Efectivo })).json;
    expect(await saldo('Efectivo')).toBe(e - 4400000);
    expect((await pedir('POST', `/gastos/${g.id}/anular`, { motivo: 'Mal cargado DEMO' })).status).toBe(200);
    expect(await saldo('Efectivo')).toBe(e);
  });
});

describe('pagos a proveedores', () => {
  it('el saldo del proveedor es lo recibido menos lo pagado', async () => {
    const c = (await pedir('POST', '/compras', { proveedorId: prov, tipo: 'confeccion', fecha: '2026-11-01', confirmar: true, items: [{ varianteId: v1, cantidad: 2, costoUnitarioCentavos: 3800000 }] })).json.id;
    const item = (await pedir('GET', `/compras/${c}`)).json.items[0];
    await pedir('POST', `/compras/${c}/recepciones`, { fecha: '2026-11-05', items: [{ compraItemId: item.id, cantidad: 2 }] });
    expect((await pedir('POST', '/pagos-proveedores', { fecha: '2026-11-06', proveedorId: prov, compraId: c, cuentaId: cuentas.Efectivo, importeCentavos: 3800000 })).status).toBe(200);
    const cc = (await pedir('GET', `/proveedores/${prov}/cuenta-corriente`)).json;
    expect(cc.saldoCentavos).toBe(3800000);
    const res = await pedir("GET", `/proveedores/${prov}/resumen`);
    expect(res.json.saldoCentavos).toBe(3800000);
  });
});

describe('permisos', () => {
  let cv = '';
  beforeAll(async () => {
    const ventas = ((await pedir('GET', '/roles')).json as { id: number; nombre: string }[]).find((r) => r.nombre === 'Ventas')!;
    await pedir('POST', '/usuarios', { usuario: 'vendedora', nombre: 'Vendedora DEMO', rolId: ventas.id, password: 'clave-demo-3' });
    cv = await login('vendedora', 'clave-demo-3');
  });
  it('quien vende registra ventas pero no ve ganancia, costos ni saldos', async () => {
    const r = await pedir('POST', '/ventas', { fecha: '2026-11-12', items: [{ varianteId: v2, cantidad: 1, precioCentavos: 5000000 }], pagos: [{ formaPagoId: formas.Efectivo.id, importeCentavos: 5000000 }] }, cv);
    expect(r.status).toBe(200);
    const txt = JSON.stringify((await pedir('GET', `/ventas/${r.json.id}`, undefined, cv)).json) + JSON.stringify((await pedir('GET', '/ventas', undefined, cv)).json);
    expect(txt).not.toMatch(/ganancia|costo/i);
    expect(JSON.stringify((await pedir('GET', '/cuentas', undefined, cv)).json)).not.toMatch(/saldo/i);
    expect((await pedir('GET', '/caja/movimientos', undefined, cv)).status).toBe(403);
    expect((await pedir('POST', `/ventas/${r.json.id}/anular`, { motivo: 'x' }, cv)).status).toBe(403);
    expect((await pedir('GET', '/gastos', undefined, cv)).status).toBe(403);
  });
});
