import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Base } from '../server/db/index.js';
import { sembrar } from '../server/services/semilla.js';
import { crearApp } from '../server/http/app.js';

/** Comisiones por medio de pago, acreditaciones reales, caja neta y reporte de cobros. Datos DEMO. */
let dir: string; let base: Base; let app: FastifyInstance; let cookie = '';
const pedir = async (metodo: string, url: string, cuerpo?: unknown) => {
  const r = await app.inject({ method: metodo as 'GET', url: '/api' + url, payload: cuerpo as object, headers: { cookie } });
  return { status: r.statusCode, headers: r.headers, json: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body };
};
type Cuenta = { id: number; nombre: string; tipo: string; saldoCentavos: number };
const saldo = async (id: number) => ((await pedir('GET', '/cuentas')).json as Cuenta[]).find((c) => c.id === id)!.saldoCentavos;
type Cobro = { id: number; ventaId: number; forma: string; brutoCentavos: number; comisionCentavos: number; netoEsperadoCentavos: number; netoAcreditadoCentavos: number | null; estado: string; diferenciaCentavos: number | null; comisionRealCentavos: number | null };
const reporte = async (extra = '') => (await pedir('GET', `/reportes/cobros?desde=2026-11-01&hasta=2026-11-30${extra}`)).json as { ventas: { totalCentavos: number }; totales: Record<string, number>; porMedio: { forma: string; brutoCentavos: number; comisionCentavos: number }[]; cobros: Cobro[] };
const cobrosDe = async (ventaId: number) => (await reporte()).cobros.filter((c) => c.ventaId === ventaId);

const F: Record<string, number> = {};
let cEfectivo = 0; let cBanco = 0; let cBilletera = 0; let cTarjetas = 0; let v = 0;
const vender = async (total: number, pagos: [string, number][]) => {
  const r = await pedir('POST', '/ventas', { fecha: '2026-11-18', items: [{ varianteId: v, cantidad: 1, precioCentavos: total }], pagos: pagos.map(([f, imp]) => ({ formaPagoId: F[f], importeCentavos: imp })) });
  expect(r.status).toBe(200);
  return r.json.id as number;
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herencia-com-'));
  base = new Base(path.join(dir, 'c.db'));
  base.tx((db) => sembrar(db));
  app = await crearApp({ base });
  await pedir('POST', '/setup', { nombre: 'Admin DEMO', usuario: 'admin', password: 'clave-demo-1' });
  cookie = String((await app.inject({ method: 'POST', url: '/api/login', payload: { usuario: 'admin', password: 'clave-demo-1' } })).headers['set-cookie']).split(';')[0];
  const cuenta = async (nombre: string, tipo: string) => (await pedir('POST', '/cuentas', { nombre, tipo, moneda: 'ARS' })).json.id as number;
  cEfectivo = ((await pedir('GET', '/cuentas')).json as Cuenta[]).find((c) => c.nombre === 'Efectivo')!.id;
  cBanco = await cuenta('Banco DEMO', 'banco'); cBilletera = await cuenta('Billetera DEMO', 'billetera'); cTarjetas = await cuenta('Tarjetas DEMO', 'a_liquidar');
  const forma = async (k: string, nombre: string, cuentaId: number, comisionBp: number, medio: string, procesador: string | null = null, cuotas: number | null = null) => {
    const r = await pedir('POST', '/formas-pago', { nombre, cuentaId, listaPrecioId: null, comisionBp, medio, procesador, cuotas });
    expect(r.status).toBe(200); F[k] = r.json.id;
  };
  await forma('efectivo', 'Efectivo DEMO', cEfectivo, 0, 'efectivo');
  await forma('transf', 'Transferencia DEMO', cBanco, 0, 'transferencia');
  await forma('qr', 'QR DEMO', cBilletera, 720, 'billetera', 'Plataforma DEMO');
  await forma('debito', 'Débito DEMO', cTarjetas, 300, 'debito', 'Procesador DEMO');
  await forma('c1', 'Crédito 1 pago DEMO', cTarjetas, 500, 'credito', 'Procesador DEMO', 1);
  await forma('c3', 'Crédito 3 cuotas DEMO', cTarjetas, 1740, 'credito', 'Procesador DEMO', 3);
  await forma('sinconf', 'Crédito sin configurar DEMO', cTarjetas, 0, 'credito', 'Otro DEMO', 1);
  const cat = (await pedir('POST', '/catalogo/categorias', { nombre: 'Cat DEMO' })).json.id;
  const m = (await pedir('POST', '/catalogo/modelos', { modelo: { nombre: 'Producto DEMO', categoriaId: cat }, variantes: [{ sku: 'CM-1', costoCentavos: 1000000, precios: { '1': 10000000 } }] })).json.id;
  v = (await pedir('GET', `/catalogo/modelos/${m}`)).json.variantes[0].id;
  await pedir('POST', '/stock/ajustes', { varianteId: v, cantidad: 50, motivo: 'Carga DEMO' });
});
afterAll(async () => { await app.close(); base.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('comisión, neto y acreditación por medio de pago', () => {
  it('1. efectivo: sin comisión, entra todo y queda acreditado', async () => {
    const antes = await saldo(cEfectivo);
    const id = await vender(10000000, [['efectivo', 10000000]]);
    expect(await saldo(cEfectivo)).toBe(antes + 10000000);
    expect((await cobrosDe(id))[0]).toMatchObject({ comisionCentavos: 0, netoEsperadoCentavos: 10000000, netoAcreditadoCentavos: 10000000, estado: 'acreditado' });
  });
  it('2. transferencia: se acredita en el momento, al 0% configurado', async () => {
    const antes = await saldo(cBanco);
    const id = await vender(10000000, [['transf', 10000000]]);
    expect(await saldo(cBanco)).toBe(antes + 10000000);
    expect((await cobrosDe(id))[0]).toMatchObject({ estado: 'acreditado', netoAcreditadoCentavos: 10000000 });
  });
  it('3. débito: queda pendiente con su neto esperado y no suma a lo disponible', async () => {
    const antesBanco = await saldo(cBanco);
    const id = await vender(10000000, [['debito', 10000000]]);
    expect((await cobrosDe(id))[0]).toMatchObject({ brutoCentavos: 10000000, comisionCentavos: 300000, netoEsperadoCentavos: 9700000, netoAcreditadoCentavos: null, estado: 'pendiente' });
    expect(await saldo(cBanco)).toBe(antesBanco);
  });
  it('4 y 5. crédito: la comisión depende de las cuotas configuradas', async () => {
    const a = (await cobrosDe(await vender(10000000, [['c1', 10000000]])))[0];
    const b = (await cobrosDe(await vender(10000000, [['c3', 10000000]])))[0];
    expect(a).toMatchObject({ comisionCentavos: 500000, netoEsperadoCentavos: 9500000 });
    expect(b).toMatchObject({ comisionCentavos: 1740000, netoEsperadoCentavos: 8260000 });
  });
  it('6. combinado efectivo + transferencia + tarjeta: comisión de cada uno por separado', async () => {
    const id = await vender(30000000, [['efectivo', 10000000], ['transf', 10000000], ['c1', 10000000]]);
    const cs = await cobrosDe(id);
    expect(cs.reduce((s, c) => s + c.comisionCentavos, 0)).toBe(500000);
    expect(cs.reduce((s, c) => s + c.netoEsperadoCentavos, 0)).toBe(29500000);
    // Lo que ya entró hoy: efectivo y transferencia; la tarjeta queda pendiente hasta acreditarse.
    expect(cs.filter((c) => c.estado === 'acreditado').reduce((s, c) => s + (c.netoAcreditadoCentavos ?? 0), 0)).toBe(20000000);
    const tarjeta = cs.find((c) => c.forma.startsWith('Crédito'))!;
    expect((await pedir('POST', '/cobros/acreditar', { cobroIds: [tarjeta.id], fecha: '2026-11-20', destinoId: cBanco, netoCentavos: 9500000 })).status).toBe(200);
    const despues = await cobrosDe(id);
    expect(despues.reduce((s, c) => s + (c.netoAcreditadoCentavos ?? 0), 0)).toBe(29500000);
  });
  it('7. dos medios con comisiones distintas: la billetera descuenta en caja en el momento', async () => {
    const antes = await saldo(cBilletera);
    const id = await vender(20000000, [['qr', 10000000], ['debito', 10000000]]);
    const cs = await cobrosDe(id);
    expect(cs.map((c) => c.comisionCentavos).sort((a, b) => a - b)).toEqual([300000, 720000]);
    expect(await saldo(cBilletera)).toBe(antes + 10000000 - 720000);
  });
  it('8. lo pendiente de acreditación se ve aparte en caja, al neto esperado', async () => {
    const r = (await pedir('GET', '/caja/acreditaciones?desde=2026-11-01&hasta=2026-11-30')).json;
    // Pendientes: débito (9.700), crédito 1 pago (9.500), 3 cuotas (8.260) y el débito de la venta 7 (9.700).
    expect(r.pendientes).toBe(4);
    expect(r.pendienteNetoCentavos).toBe(9700000 + 9500000 + 8260000 + 9700000);
    expect(r.pendienteBrutoCentavos).toBe(40000000);
  });
  it('9. acreditación real distinta de la esperada: queda la diferencia y la comisión real', async () => {
    const pend = (await reporte('&estado=pendiente')).cobros.find((c) => c.forma === 'Crédito 1 pago DEMO')!;
    const antes = await saldo(cBanco);
    expect((await pedir('POST', '/cobros/acreditar', { cobroIds: [pend.id], fecha: '2026-11-21', destinoId: cBanco, netoCentavos: 9400000, concepto: 'Liquidación DEMO' })).status).toBe(200);
    expect(await saldo(cBanco)).toBe(antes + 9400000);
    const c = (await reporte()).cobros.find((x) => x.id === pend.id)!;
    expect(c).toMatchObject({ estado: 'acreditado', netoAcreditadoCentavos: 9400000, comisionRealCentavos: 600000, comisionCentavos: 600000, diferenciaCentavos: -100000 });
    // No se puede acreditar dos veces.
    expect((await pedir('POST', '/cobros/acreditar', { cobroIds: [pend.id], fecha: '2026-11-21', destinoId: cBanco, netoCentavos: 9400000 })).status).toBe(400);
  });
});

describe('reportes, caja y exportación', () => {
  it('10. el reporte filtra por fechas y medio de pago', async () => {
    const todo = await reporte();
    const deb = await reporte('&medio=debito');
    expect(deb.cobros.length).toBe(2);
    expect(deb.cobros.every((c) => c.forma === 'Débito DEMO')).toBe(true);
    expect((await pedir('GET', '/reportes/cobros?desde=2026-12-01&hasta=2026-12-31')).json.cobros).toHaveLength(0);
    expect(todo.totales.brutoCentavos).toBe(todo.cobros.reduce((s, c) => s + c.brutoCentavos, 0));
    expect(todo.totales.netoEsperadoCentavos).toBe(todo.totales.brutoCentavos - todo.cobros.reduce((s, c) => s + (c.brutoCentavos - c.netoEsperadoCentavos), 0));
    expect((await reporte('&cuotas=3')).cobros).toHaveLength(1);
    expect((await reporte('&conDiferencia=true')).cobros).toHaveLength(1);
  });
  it('11. se descarga en Excel respetando los filtros', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/reportes/cobros/exportar?desde=2026-11-01&hasta=2026-11-30&medio=debito&formato=xlsx', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(String(r.headers['content-type'])).toContain('spreadsheet');
    const csv = await app.inject({ method: 'GET', url: '/api/reportes/cobros/exportar?desde=2026-11-01&hasta=2026-11-30&medio=debito&formato=csv', headers: { cookie } });
    expect(csv.body.split('\n').filter((l) => l.includes('Débito DEMO'))).toHaveLength(2);
    expect(csv.body).not.toContain('Efectivo DEMO');
  });
  it('12. la caja registra netos: lo acreditado suma el neto real y la venta sigue figurando por el total', async () => {
    const r = await reporte();
    const cuentas = (await pedir('GET', '/cuentas')).json as (Cuenta & { saldoArsCentavos: number })[];
    const disponible = cuentas.filter((c) => [cEfectivo, cBanco, cBilletera].includes(c.id)).reduce((s, c) => s + c.saldoArsCentavos, 0);
    expect(disponible).toBe(r.totales.acreditadoCentavos);
    expect(r.ventas.totalCentavos).toBe(r.totales.brutoCentavos);
    expect(r.totales.acreditadoCentavos).toBeLessThan(r.ventas.totalCentavos);
  });
  it('13. las comisiones quedan separadas y no se cuentan dos veces', async () => {
    const r = await reporte();
    const movs = (await pedir('GET', '/caja/movimientos?tipo=comision')).json as { filas: { importeCentavos: number }[] };
    const enCaja = -movs.filas.reduce((s, m) => s + m.importeCentavos, 0);
    const deAcreditados = r.cobros.filter((c) => c.estado === 'acreditado').reduce((s, c) => s + c.comisionCentavos, 0);
    expect(enCaja).toBe(deAcreditados);
    // Bruto − comisión (real si la hay) = lo acreditado + lo pendiente: cada peso está en un solo lugar.
    expect(r.totales.brutoCentavos - r.totales.comisionCentavos).toBe(r.totales.acreditadoCentavos + r.totales.pendienteCentavos);
  });
  it('un medio de tarjeta con 0% queda marcado para configurar (no se inventa comisión)', async () => {
    const f = ((await pedir('GET', '/formas-pago')).json as { id: number; comisionBp: number; medio: string }[]).find((x) => x.id === F.sinconf)!;
    expect(f).toMatchObject({ comisionBp: 0, medio: 'credito' });
    const id = await vender(10000000, [['sinconf', 10000000]]);
    expect((await cobrosDe(id))[0]).toMatchObject({ comisionCentavos: 0, netoEsperadoCentavos: 10000000, estado: 'pendiente' });
  });
});
