import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Base } from '../server/db/index.js';
import { sembrar } from '../server/services/semilla.js';
import { crearApp } from '../server/http/app.js';
import { estadoPedido, vencimientoDe } from '../server/services/comprobantes.js';

/** Etapa 3: estados del pedido, comprobante, vencimientos, pagos imputados y adjuntos. Datos DEMO. */
let dir: string; let base: Base; let app: FastifyInstance; let cookie = '';
const pedir = async (metodo: string, url: string, cuerpo?: unknown) => {
  const r = await app.inject({ method: metodo as 'GET', url: '/api' + url, payload: cuerpo as object, headers: { cookie } });
  return { status: r.statusCode, json: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body, r };
};
let prov = 0; let otro = 0; let v1 = 0; let v2 = 0; let efectivo = 0;
type Compra = { id: number; numero: number; estadoPedido: string; vencimientoEfectivo: string | null; aPagarCentavos: number; pagadoCentavos: number; saldoCentavos: number; items: { id: number }[] };
const compra = async (id: number) => (await pedir('GET', `/compras/${id}`)).json as Compra;
const saldo = async (id: number) => ((await pedir('GET', '/proveedores/saldos')).json as Record<string, { saldoCentavos: number }>)[id]?.saldoCentavos ?? 0;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herencia-cc-'));
  base = new Base(path.join(dir, 'b.db'));
  base.tx((db) => sembrar(db));
  app = await crearApp({ base });
  await pedir('POST', '/setup', { nombre: 'Admin DEMO', usuario: 'admin', password: 'clave-demo-1' });
  cookie = String((await app.inject({ method: 'POST', url: '/api/login', payload: { usuario: 'admin', password: 'clave-demo-1' } })).headers['set-cookie']).split(';')[0];
  const cat = (await pedir('POST', '/catalogo/categorias', { nombre: 'Bolsos DEMO' })).json.id;
  prov = (await pedir('POST', '/proveedores', { nombre: 'Mayorista DEMO', rol: 'producto_terminado', condicionPago: 'a_plazo', plazoPagoDias: 30 })).json.id;
  otro = (await pedir('POST', '/proveedores', { nombre: 'Otro DEMO' })).json.id;
  const m = (await pedir('POST', '/catalogo/modelos', { modelo: { nombre: 'Bolso DEMO', categoriaId: cat, proveedorId: prov }, variantes: [{ sku: 'BOL-1', costoCentavos: 1000000 }, { sku: 'BOL-2', costoCentavos: 1000000 }] })).json.id;
  const vs = (await pedir('GET', `/catalogo/modelos/${m}`)).json.variantes as { id: number }[];
  [v1, v2] = vs.map((v) => v.id);
  efectivo = ((await pedir('GET', '/cuentas')).json as { id: number; nombre: string }[]).find((c) => c.nombre === 'Efectivo')!.id;
  await pedir('POST', '/caja/aportes', { fecha: '2026-11-01', cuentaId: efectivo, importeCentavos: 100000000, aportante: 'DEMO' });
});
afterAll(async () => { await app.close(); base.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('estado del pedido', () => {
  it('se deriva del estado guardado y de lo recibido', () => {
    expect(estadoPedido({ estado: 'borrador', fechaEsperada: null }, 5, 0)).toBe('pendiente_solicitar');
    expect(estadoPedido({ estado: 'confirmada', fechaEsperada: '2026-12-01' }, 5, 0, '2026-11-16')).toBe('solicitado');
    expect(estadoPedido({ estado: 'confirmada', fechaEsperada: '2026-11-10' }, 5, 0, '2026-11-16')).toBe('pendiente_entrega');
    expect(estadoPedido({ estado: 'confirmada', fechaEsperada: null }, 5, 2)).toBe('entrega_parcial');
    expect(estadoPedido({ estado: 'cerrada', fechaEsperada: null }, 5, 5)).toBe('entregado');
    expect(estadoPedido({ estado: 'cerrada', fechaEsperada: null }, 5, 3)).toBe('cerrado_incompleto');
    expect(estadoPedido({ estado: 'anulada', fechaEsperada: null }, 5, 0)).toBe('cancelado');
  });
  it('vencimiento según la condición', () => {
    const c = { fecha: '2026-11-01', vencimiento: null, fechaComprobante: null, plazoPagoDias: null };
    expect(vencimientoDe({ ...c, condicionPago: 'al_pedir' }, null)).toBe('2026-11-01');
    expect(vencimientoDe({ ...c, condicionPago: 'al_recibir' }, '2026-11-05')).toBe('2026-11-05');
    expect(vencimientoDe({ ...c, condicionPago: 'a_plazo', plazoPagoDias: 30 }, '2026-11-05')).toBe('2026-12-05');
    expect(vencimientoDe({ ...c, condicionPago: 'a_plazo', plazoPagoDias: 15, fechaComprobante: '2026-11-20' }, '2026-11-05')).toBe('2026-12-05');
    expect(vencimientoDe({ ...c, condicionPago: 'cuenta_corriente' }, '2026-11-05')).toBeNull();
    expect(vencimientoDe({ ...c, condicionPago: 'a_plazo', plazoPagoDias: 30, vencimiento: '2026-11-25' }, '2026-11-05')).toBe('2026-11-25');
  });
});

describe('comprobante y cuenta corriente', () => {
  let a = 0; let b = 0;
  it('el pedido toma la condición habitual del proveedor si no se indica', async () => {
    a = (await pedir('POST', '/compras', { proveedorId: prov, tipo: 'reventa', fecha: '2026-11-01', confirmar: true, items: [{ varianteId: v1, cantidad: 2, costoUnitarioCentavos: 1000000 }] })).json.id;
    const c = await compra(a);
    expect(c).toMatchObject({ condicionPago: 'a_plazo', plazoPagoDias: 30, estadoPedido: 'solicitado', aPagarCentavos: 0, vencimientoEfectivo: null });
  });
  it('al recibir se debe lo recibido y vence a los 30 días', async () => {
    const c = await compra(a);
    expect((await pedir('POST', `/compras/${a}/recepciones`, { fecha: '2026-11-05', items: [{ compraItemId: c.items[0].id, cantidad: 1 }] })).status).toBe(200);
    expect(await compra(a)).toMatchObject({ estadoPedido: 'entrega_parcial', aPagarCentavos: 1000000, vencimientoEfectivo: '2026-12-05' });
    expect(await saldo(prov)).toBe(1000000);
  });
  it('factura con descuento e impuestos: cambia lo que se debe y pide motivo', async () => {
    const datos = { comprobante: 'FC A 0001-123 DEMO', fechaComprobante: '2026-11-06', descuentoCentavos: 50000, impuestosCentavos: 210000, condicionPago: 'a_plazo', plazoPagoDias: 15 };
    expect((await pedir('PUT', `/compras/${a}/comprobante`, datos)).status).toBe(400);
    expect((await pedir('PUT', `/compras/${a}/comprobante`, { ...datos, motivo: 'Llegó la factura' })).status).toBe(200);
    expect(await compra(a)).toMatchObject({ aPagarCentavos: 1160000, vencimientoEfectivo: '2026-11-21' });
    expect(await saldo(prov)).toBe(1160000);
    const cc = (await pedir('GET', `/proveedores/${prov}/cuenta-corriente`)).json as { saldoCentavos: number; lineas: { tipo: string; debeCentavos: number }[] };
    expect(cc.saldoCentavos).toBe(1160000);
    expect(cc.lineas.find((l) => l.tipo === 'comprobante')?.debeCentavos).toBe(160000);
  });
  it('pago repartido entre dos pedidos y una parte a cuenta', async () => {
    b = (await pedir('POST', '/compras', { proveedorId: prov, tipo: 'reventa', fecha: '2026-11-02', confirmar: true, condicionPago: 'al_recibir', items: [{ varianteId: v2, cantidad: 1, costoUnitarioCentavos: 500000 }] })).json.id;
    await pedir('POST', `/compras/${b}/recepciones`, { fecha: '2026-11-03', items: [{ compraItemId: (await compra(b)).items[0].id, cantidad: 1 }] });
    expect((await pedir('POST', '/pagos-proveedores', { fecha: '2026-11-10', proveedorId: prov, cuentaId: efectivo, importeCentavos: 1000000, imputaciones: [{ compraId: a, importeCentavos: 400000 }, { compraId: b, importeCentavos: 500000 }] })).status).toBe(200);
    expect(await compra(a)).toMatchObject({ pagadoCentavos: 400000, saldoCentavos: 760000 });
    expect(await compra(b)).toMatchObject({ estadoPedido: 'entregado', pagadoCentavos: 500000, saldoCentavos: 0 });
    const r = (await pedir('GET', `/proveedores/${prov}/comprobantes`)).json as { sinImputarCentavos: number; comprobantes: { id: number; vencido: boolean }[] };
    expect(r.sinImputarCentavos).toBe(100000);
    expect(await saldo(prov)).toBe(1160000 + 500000 - 1000000);
  });
  it('no se imputa más que el pago ni a pedidos de otro proveedor', async () => {
    expect((await pedir('POST', '/pagos-proveedores', { fecha: '2026-11-10', proveedorId: prov, cuentaId: efectivo, importeCentavos: 100, imputaciones: [{ compraId: a, importeCentavos: 200 }] })).status).toBe(400);
    expect((await pedir('POST', '/pagos-proveedores', { fecha: '2026-11-10', proveedorId: otro, cuentaId: efectivo, importeCentavos: 100, imputaciones: [{ compraId: a, importeCentavos: 100 }] })).status).toBe(400);
  });
  it('se puede reimputar un pago y anularlo libera lo imputado', async () => {
    const pagos = (await pedir('GET', `/pagos-proveedores?proveedorId=${prov}`)).json as { id: number; importeCentavos: number; sinImputarCentavos: number }[];
    const p = pagos.find((x) => x.importeCentavos === 1000000)!;
    expect(p.sinImputarCentavos).toBe(100000);
    expect((await pedir('PUT', `/pagos-proveedores/${p.id}/imputaciones`, { imputaciones: [{ compraId: a, importeCentavos: 1000000 }], motivo: 'Era todo para P-a' })).status).toBe(200);
    expect(await compra(a)).toMatchObject({ pagadoCentavos: 1000000, saldoCentavos: 160000 });
    expect(await compra(b)).toMatchObject({ pagadoCentavos: 0, saldoCentavos: 500000 });
    expect((await pedir('POST', `/pagos-proveedores/${p.id}/anular`, { motivo: 'prueba' })).status).toBe(200);
    expect((await compra(a)).pagadoCentavos).toBe(0);
  });
  it('vista general con vencido y próximo vencimiento', async () => {
    const r = (await pedir('GET', '/cuentas-corrientes')).json as { proveedores: { proveedorId: number; saldoCentavos: number; vencidoCentavos: number; proximoVencimiento: string | null }[] };
    const x = r.proveedores.find((p) => p.proveedorId === prov)!;
    expect(x.saldoCentavos).toBe(1660000);
    // P-a vence el 21/11 y P-b venció al recibir (03/11): según la fecha de hoy, lo vencido incluye al menos P-b.
    expect(x.vencidoCentavos).toBeGreaterThanOrEqual(500000);
  });
});

describe('adjuntos', () => {
  it('se sube una foto, se ve y se quita sin borrarla', async () => {
    const lim = '----demo';
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const cuerpo = Buffer.concat([Buffer.from(`--${lim}\r\nContent-Disposition: form-data; name="archivo"; filename="factura.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${lim}--\r\n`)]);
    const compras = (await pedir('GET', `/compras?proveedorId=${prov}`)).json as { id: number }[];
    const r = await app.inject({ method: 'POST', url: `/api/adjuntos/compra/${compras[0].id}`, payload: cuerpo, headers: { cookie, 'content-type': `multipart/form-data; boundary=${lim}` } });
    expect(r.statusCode).toBe(200);
    const id = r.json().id;
    const g = await app.inject({ method: 'GET', url: `/api/adjuntos/${id}`, headers: { cookie } });
    expect(g.headers['content-type']).toBe('image/png');
    expect(g.rawPayload.equals(png)).toBe(true);
    expect(((await compra(compras[0].id)) as unknown as { adjuntos: unknown[] }).adjuntos).toHaveLength(1);
    expect((await pedir('POST', `/adjuntos/${id}/quitar`, { motivo: 'era otra' })).status).toBe(200);
    expect(((await compra(compras[0].id)) as unknown as { adjuntos: unknown[] }).adjuntos).toHaveLength(0);
    // sigue guardado
    expect((await app.inject({ method: 'GET', url: `/api/adjuntos/${id}`, headers: { cookie } })).statusCode).toBe(200);
  });
  it('rechaza tipos que no son foto o PDF', async () => {
    const lim = '----demo';
    const cuerpo = `--${lim}\r\nContent-Disposition: form-data; name="archivo"; filename="x.exe"\r\nContent-Type: application/octet-stream\r\n\r\nMZ\r\n--${lim}--\r\n`;
    const compras = (await pedir('GET', `/compras?proveedorId=${prov}`)).json as { id: number }[];
    const r = await app.inject({ method: 'POST', url: `/api/adjuntos/compra/${compras[0].id}`, payload: cuerpo, headers: { cookie, 'content-type': `multipart/form-data; boundary=${lim}` } });
    expect(r.statusCode).toBe(400);
  });
});
