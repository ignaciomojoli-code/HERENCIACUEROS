import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Base } from '../server/db/index.js';
import { sembrar } from '../server/services/semilla.js';
import { crearApp } from '../server/http/app.js';
import { repartirComision } from '../server/services/caja.js';

/** Etapa 2: clientes y cobros pendientes, descuento con motivo, edición de ventas, comisión real por liquidación. Datos DEMO. */
let dir: string; let base: Base; let app: FastifyInstance; let cookie = '';
const pedir = async (metodo: string, url: string, cuerpo?: unknown) => {
  const r = await app.inject({ method: metodo as 'GET', url: '/api' + url, payload: cuerpo as object, headers: { cookie } });
  return { status: r.statusCode, json: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body };
};
type Cuenta = { id: number; nombre: string; saldoCentavos: number };
let efectivo = 0; let qr = 0; let debito = 0; let cEfectivo = 0; let cMp = 0; let cTarjetas = 0; let vA = 0; let vB = 0; let cliente = 0;
const saldo = async (id: number) => ((await pedir('GET', '/cuentas')).json as Cuenta[]).find((c) => c.id === id)!.saldoCentavos;
const stock = async (v: number) => ((await pedir('GET', `/stock?q=`)).json as { filas: { varianteId: number; stock: number }[] }).filas.find((f) => f.varianteId === v)!.stock;
const venta = async (id: number) => (await pedir('GET', `/ventas/${id}`)).json;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herencia-pos-'));
  base = new Base(path.join(dir, 'p.db'));
  base.tx((db) => sembrar(db));
  app = await crearApp({ base });
  await pedir('POST', '/setup', { nombre: 'Admin DEMO', usuario: 'admin', password: 'clave-demo-1' });
  cookie = String((await app.inject({ method: 'POST', url: '/api/login', payload: { usuario: 'admin', password: 'clave-demo-1' } })).headers['set-cookie']).split(';')[0];
  const formas = (await pedir('GET', '/formas-pago')).json as { id: number; nombre: string }[];
  efectivo = formas.find((f) => f.nombre === 'Efectivo')!.id;
  qr = formas.find((f) => f.nombre.startsWith('Mercado Pago (dinero'))!.id;
  debito = formas.find((f) => f.nombre === 'Débito · Mercado Pago')!.id;
  const cuentas = (await pedir('GET', '/cuentas')).json as Cuenta[];
  cEfectivo = cuentas.find((c) => c.nombre === 'Efectivo')!.id; cMp = cuentas.find((c) => c.nombre === 'Mercado Pago')!.id; cTarjetas = cuentas.find((c) => c.nombre === 'Tarjetas a liquidar')!.id;
  const cat = (await pedir('POST', '/catalogo/categorias', { nombre: 'Camperas DEMO' })).json.id;
  const m = (await pedir('POST', '/catalogo/modelos', { modelo: { nombre: 'Campera DEMO', categoriaId: cat }, variantes: [{ sku: 'DEMO-A', costoCentavos: 5000000, precios: { '1': 10000000 } }, { sku: 'DEMO-B', costoCentavos: 5000000, precios: { '1': 10000000 } }] })).json.id;
  const vs = (await pedir('GET', `/catalogo/modelos/${m}`)).json.variantes;
  vA = vs.find((v: { sku: string }) => v.sku === 'DEMO-A').id; vB = vs.find((v: { sku: string }) => v.sku === 'DEMO-B').id;
  for (const v of [vA, vB]) await pedir('POST', '/stock/ajustes', { varianteId: v, cantidad: 10, motivo: 'Carga DEMO' });
  cliente = (await pedir('POST', '/clientes', { nombre: 'Clienta DEMO', telefono: '1100000000' })).json.id;
});
afterAll(async () => { await app.close(); base.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('clientes y cobros pendientes', () => {
  let id = 0;
  it('sin cliente no puede quedar debiendo; con cliente sí', async () => {
    const sin = await pedir('POST', '/ventas', { fecha: '2026-11-16', items: [{ varianteId: vA, cantidad: 1, precioCentavos: 10000000 }], pagos: [{ formaPagoId: efectivo, importeCentavos: 4000000 }] });
    expect(sin.status).toBe(400);
    const con = await pedir('POST', '/ventas', { fecha: '2026-11-16', clienteId: cliente, items: [{ varianteId: vA, cantidad: 1, precioCentavos: 10000000 }], pagos: [{ formaPagoId: efectivo, importeCentavos: 4000000 }] });
    expect(con.status).toBe(200);
    expect(con.json.saldoCentavos).toBe(6000000);
    id = con.json.id;
    expect(await saldo(cEfectivo)).toBe(4000000);
    const v = await venta(id);
    expect(v).toMatchObject({ cliente: 'Clienta DEMO', totalCentavos: 10000000, cobradoCentavos: 4000000, saldoCentavos: 6000000 });
    expect(((await pedir('GET', '/clientes')).json as { id: number; saldoCentavos: number }[]).find((c) => c.id === cliente)!.saldoCentavos).toBe(6000000);
    expect((await pedir('GET', '/ventas?conSaldo=true')).json.filas.map((f: { id: number }) => f.id)).toEqual([id]);
  });
  it('se cobra el saldo después, sin pasarse', async () => {
    expect((await pedir('POST', `/ventas/${id}/cobros`, { fecha: '2026-11-20', formaPagoId: efectivo, importeCentavos: 7000000 })).status).toBe(400);
    const c = await pedir('POST', `/ventas/${id}/cobros`, { fecha: '2026-11-20', formaPagoId: qr, importeCentavos: 2500000 });
    expect(c.json.saldoCentavos).toBe(3500000);
    // QR: entra 25.000 y sale la comisión estimada (7,2%)
    expect(await saldo(cMp)).toBe(2500000 - 180000);
    const v = await venta(id);
    expect(v.saldoCentavos).toBe(3500000);
    expect(v.pagos.find((p: { id: number }) => p.id === c.json.cobroId).fecha).toBe('2026-11-20');
  });
  it('anular un cobro devuelve la plata y vuelve a deber', async () => {
    const v = await venta(id);
    const cobro = v.pagos.find((p: { fecha: string | null }) => p.fecha);
    expect((await pedir('POST', `/ventas/cobros/${cobro.id}/anular`, { motivo: '' })).status).toBe(400);
    expect((await pedir('POST', `/ventas/cobros/${cobro.id}/anular`, { motivo: 'Se cargó por error' })).status).toBe(200);
    expect(await saldo(cMp)).toBe(0);
    expect((await venta(id)).saldoCentavos).toBe(6000000);
  });
  it('anular la venta revierte también los cobros posteriores', async () => {
    await pedir('POST', `/ventas/${id}/cobros`, { fecha: '2026-11-21', formaPagoId: efectivo, importeCentavos: 1000000 });
    expect(await saldo(cEfectivo)).toBe(5000000);
    expect((await pedir('POST', `/ventas/${id}/anular`, { motivo: 'Devolución' })).status).toBe(200);
    expect(await saldo(cEfectivo)).toBe(0);
    expect(await stock(vA)).toBe(10);
    expect(((await pedir('GET', '/clientes')).json as { id: number; saldoCentavos: number }[]).find((c) => c.id === cliente)!.saldoCentavos).toBe(0);
  });
});

describe('descuento sobre el total', () => {
  it('pide motivo y la caja recibe el total con descuento', async () => {
    const base0 = await saldo(cEfectivo);
    const cuerpo = { fecha: '2026-11-16', items: [{ varianteId: vB, cantidad: 2, precioCentavos: 10000000 }], descuentoCentavos: 2000000, pagos: [{ formaPagoId: efectivo, importeCentavos: 18000000 }] };
    expect((await pedir('POST', '/ventas', cuerpo)).status).toBe(400);
    const r = await pedir('POST', '/ventas', { ...cuerpo, motivoDescuento: 'Cliente frecuente' });
    expect(r.status).toBe(200);
    expect(r.json.totalCentavos).toBe(18000000);
    expect(await saldo(cEfectivo)).toBe(base0 + 18000000);
    const v = await venta(r.json.id);
    expect(v).toMatchObject({ subtotalCentavos: 20000000, descuentoCentavos: 2000000, totalCentavos: 18000000, motivoDescuento: 'Cliente frecuente' });
    expect(v.gananciaCentavos).toBe(18000000 - 10000000);
    const p = (await pedir('GET', '/panel?desde=2026-11-16&hasta=2026-11-16')).json;
    expect(p.actual.totalCentavos).toBe(18000000);
  });
});

describe('editar una venta', () => {
  it('corrige productos, stock y caja, conserva el número y guarda la versión anterior', async () => {
    const c0 = await saldo(cEfectivo); const sA = await stock(vA); const sB = await stock(vB);
    const r = (await pedir('POST', '/ventas', { fecha: '2026-11-16', items: [{ varianteId: vA, cantidad: 1, precioCentavos: 10000000 }], pagos: [{ formaPagoId: efectivo, importeCentavos: 10000000 }] })).json;
    const nueva = { fecha: '2026-11-16', items: [{ varianteId: vB, cantidad: 2, precioCentavos: 9000000 }], pagos: [{ formaPagoId: efectivo, importeCentavos: 18000000 }] };
    expect((await pedir('PUT', `/ventas/${r.id}`, nueva)).status).toBe(400); // falta motivo
    const e = await pedir('PUT', `/ventas/${r.id}`, { ...nueva, motivo: 'Se llevó otro modelo' });
    expect(e.status).toBe(200);
    expect(e.json).toMatchObject({ numero: r.numero, version: 2, totalCentavos: 18000000 });
    expect(await stock(vA)).toBe(sA);
    expect(await stock(vB)).toBe(sB - 2);
    expect(await saldo(cEfectivo)).toBe(c0 + 18000000);
    const v = await venta(r.id);
    expect(v.versiones).toMatchObject([{ version: 1, motivo: 'Se llevó otro modelo' }]);
    const ant = (await pedir('GET', `/ventas/${r.id}/versiones/1`)).json;
    expect(ant.datos.items[0].sku).toBe('DEMO-A');
    // y se puede anular después de editada: todo vuelve
    await pedir('POST', `/ventas/${r.id}/anular`, { motivo: 'prueba' });
    expect(await stock(vB)).toBe(sB);
    expect(await saldo(cEfectivo)).toBe(c0);
  });
  it('no deja que lo cobrado después supere el total nuevo', async () => {
    const r = (await pedir('POST', '/ventas', { fecha: '2026-11-16', clienteId: cliente, items: [{ varianteId: vA, cantidad: 1, precioCentavos: 10000000 }], pagos: [] })).json;
    await pedir('POST', `/ventas/${r.id}/cobros`, { fecha: '2026-11-17', formaPagoId: efectivo, importeCentavos: 8000000 });
    const e = await pedir('PUT', `/ventas/${r.id}`, { fecha: '2026-11-16', clienteId: cliente, items: [{ varianteId: vA, cantidad: 1, precioCentavos: 5000000 }], pagos: [], motivo: 'Precio mal cargado' });
    expect(e.status).toBe(400);
  });
});

describe('comisión real de la liquidación, por venta', () => {
  it('se reparte entre las ventas elegidas y se deshace al anular la liquidación', async () => {
    const v1 = (await pedir('POST', '/ventas', { fecha: '2026-11-16', items: [{ varianteId: vA, cantidad: 1, precioCentavos: 10000000 }], pagos: [{ formaPagoId: debito, importeCentavos: 10000000 }] })).json;
    const v2 = (await pedir('POST', '/ventas', { fecha: '2026-11-16', items: [{ varianteId: vA, cantidad: 3, precioCentavos: 10000000 }], pagos: [{ formaPagoId: debito, importeCentavos: 30000000 }] })).json;
    const pend = (await pedir('GET', `/caja/cobros-a-liquidar?cuentaId=${cTarjetas}`)).json as { id: number; ventaId: number }[];
    const ids = pend.filter((p) => [v1.id, v2.id].includes(p.ventaId)).map((p) => p.id);
    expect(ids).toHaveLength(2);
    const mal = await pedir('POST', '/caja/liquidaciones', { fecha: '2026-11-18', origenId: cTarjetas, destinoId: cMp, brutoCentavos: 30000000, netoCentavos: 29000000, cobroIds: ids });
    expect(mal.status).toBe(400);
    const liq = await pedir('POST', '/caja/liquidaciones', { fecha: '2026-11-18', origenId: cTarjetas, destinoId: cMp, brutoCentavos: 40000000, netoCentavos: 39000001, cobroIds: ids });
    expect(liq.status).toBe(200);
    const c1 = (await venta(v1.id)).comisionCentavos, c2 = (await venta(v2.id)).comisionCentavos;
    expect(c1 + c2).toBe(999999);
    expect(c2).toBe(749999 + 1); // la más grande se lleva el resto del redondeo
    expect((await pedir('GET', `/caja/cobros-a-liquidar?cuentaId=${cTarjetas}`)).json.some((p: { id: number }) => ids.includes(p.id))).toBe(false);
    expect((await pedir('POST', `/caja/operaciones/${encodeURIComponent(liq.json.grupo)}/anular`, { motivo: 'prueba' })).status).toBe(200);
    expect((await venta(v1.id)).comisionCentavos).toBe(240000); // vuelve a la estimada (2,4%)
    expect((await pedir('GET', `/caja/cobros-a-liquidar?cuentaId=${cTarjetas}`)).json.filter((p: { id: number }) => ids.includes(p.id))).toHaveLength(2);
  });
  it('el reparto suma exacto', () => {
    expect(repartirComision(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(repartirComision(0, [5, 5])).toEqual([0, 0]);
  });
});
