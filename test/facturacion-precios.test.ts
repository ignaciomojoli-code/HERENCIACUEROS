import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Base } from '../server/db/index.js';
import { sembrar } from '../server/services/semilla.js';
import { crearApp } from '../server/http/app.js';

/** Facturación directa (efectivo recibido y vuelto) y precios reales de proveedores. Datos DEMO. */
let dir: string; let base: Base; let app: FastifyInstance; let cookie = '';
const pedir = async (metodo: string, url: string, cuerpo?: unknown) => {
  const r = await app.inject({ method: metodo as 'GET', url: '/api' + url, payload: cuerpo as object, headers: { cookie } });
  return { status: r.statusCode, json: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body };
};
type Cuenta = { id: number; nombre: string; saldoCentavos: number };
const saldo = async (id: number) => ((await pedir('GET', '/cuentas')).json as Cuenta[]).find((c) => c.id === id)!.saldoCentavos;
const deuda = async (prov: number) => ((await pedir('GET', '/proveedores/saldos')).json as Record<string, { saldoCentavos: number }>)[prov]?.saldoCentavos ?? 0;
let efectivo = 0; let transferencia = 0; let cEfectivo = 0; let vA = 0; let artintex = 0; let forro = 0; let cuero = 0; let negro = 0; let cueros = 0;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herencia-fact-'));
  base = new Base(path.join(dir, 'f.db'));
  base.tx((db) => sembrar(db));
  app = await crearApp({ base });
  await pedir('POST', '/setup', { nombre: 'Admin DEMO', usuario: 'admin', password: 'clave-demo-1' });
  cookie = String((await app.inject({ method: 'POST', url: '/api/login', payload: { usuario: 'admin', password: 'clave-demo-1' } })).headers['set-cookie']).split(';')[0];
  const formas = (await pedir('GET', '/formas-pago')).json as { id: number; nombre: string; cuenta: string }[];
  efectivo = formas.find((f) => f.nombre === 'Efectivo')!.id;
  transferencia = formas.find((f) => f.nombre !== 'Efectivo' && !/tarjeta|crédito|débito|dólar/i.test(f.nombre))!.id;
  cEfectivo = ((await pedir('GET', '/cuentas')).json as Cuenta[]).find((c) => c.nombre === 'Efectivo')!.id;
  const cat = (await pedir('POST', '/catalogo/categorias', { nombre: 'Camperas DEMO' })).json.id;
  const m = (await pedir('POST', '/catalogo/modelos', { modelo: { nombre: 'Campera DEMO', categoriaId: cat }, variantes: [{ sku: 'FD-A', costoCentavos: 5000000, precios: { '1': 8500000 } }] })).json.id;
  vA = (await pedir('GET', `/catalogo/modelos/${m}`)).json.variantes[0].id;
  await pedir('POST', '/stock/ajustes', { varianteId: vA, cantidad: 10, motivo: 'Carga DEMO' });
  artintex = (await pedir('POST', '/proveedores', { nombre: 'Avíos DEMO', rol: 'materiales' })).json.id;
  cueros = (await pedir('POST', '/proveedores', { nombre: 'Curtiembre DEMO', rol: 'materiales' })).json.id;
  forro = (await pedir('POST', '/materiales', { codigo: 'FD-1', nombre: 'Forro DEMO', unidad: 'm', tipo: 'material', costoCentavos: 200000, proveedorId: artintex })).json.id;
  cuero = (await pedir('POST', '/materiales', { codigo: 'FD-2', nombre: 'Cuero DEMO', unidad: 'm', tipo: 'material', costoCentavos: 2000000, proveedorId: cueros, clasificacion: 'materia_prima', porColor: true })).json.id;
  negro = (await pedir('POST', '/catalogo/colores', { nombre: 'Negro DEMO' })).json.id;
});
afterAll(async () => { await app.close(); base.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('facturación directa: efectivo recibido y vuelto', () => {
  it('a caja entra lo aplicado a la venta, no el billete entregado; el vuelto se informa', async () => {
    const antes = await saldo(cEfectivo);
    const r = await pedir('POST', '/ventas', { fecha: '2026-11-18', items: [{ varianteId: vA, cantidad: 1, precioCentavos: 8500000 }], pagos: [{ formaPagoId: efectivo, importeCentavos: 8500000 }], efectivoRecibidoCentavos: 10000000 });
    expect(r.status).toBe(200);
    expect(r.json.vueltoCentavos).toBe(1500000);
    expect(await saldo(cEfectivo)).toBe(antes + 8500000);
    expect((await pedir('GET', `/ventas/${r.json.id}`)).json.efectivoRecibidoCentavos).toBe(10000000);
  });
  it('pago combinado: el vuelto sale solo de la parte en efectivo', async () => {
    const r = await pedir('POST', '/ventas', { fecha: '2026-11-18', items: [{ varianteId: vA, cantidad: 1, precioCentavos: 8500000 }], pagos: [{ formaPagoId: transferencia, importeCentavos: 5000000 }, { formaPagoId: efectivo, importeCentavos: 3500000 }], efectivoRecibidoCentavos: 4000000 });
    expect(r.status).toBe(200);
    expect(r.json.vueltoCentavos).toBe(500000);
  });
  it('si el efectivo entregado no alcanza, no se confirma', async () => {
    const r = await pedir('POST', '/ventas', { fecha: '2026-11-18', items: [{ varianteId: vA, cantidad: 1, precioCentavos: 8500000 }], pagos: [{ formaPagoId: efectivo, importeCentavos: 8500000 }], efectivoRecibidoCentavos: 8000000 });
    expect(r.status).toBe(400);
  });
  it('no se puede confirmar como cobrada si lo pagado no llega al total (sin cliente)', async () => {
    const r = await pedir('POST', '/ventas', { fecha: '2026-11-18', items: [{ varianteId: vA, cantidad: 1, precioCentavos: 8500000 }], pagos: [{ formaPagoId: efectivo, importeCentavos: 8000000 }] });
    expect(r.status).toBe(400);
  });
});

describe('pedidos: solicitado, confirmado, facturado, recibido y pagado', () => {
  let p = 0;
  it('lo estimado queda guardado aunque en el borrador se cargue el precio real', async () => {
    p = (await pedir('POST', '/compras', { proveedorId: artintex, tipo: 'materiales', fecha: '2026-11-18', materiales: [{ materialId: forro, cantidadMil: 100000, costoUnitarioCentavos: 200000 }] })).json.id;
    // Artintex avisa aumento: se corrige el borrador a $2.500 y confirma 90 m.
    expect((await pedir('PUT', `/compras/${p}`, { proveedorId: artintex, tipo: 'materiales', fecha: '2026-11-18', materiales: [{ materialId: forro, cantidadMil: 90000, costoUnitarioCentavos: 250000 }] })).status).toBe(200);
    expect((await pedir('POST', `/compras/${p}/estado`, { accion: 'confirmar' })).status).toBe(200);
    const c = (await pedir('GET', `/compras/${p}`)).json;
    expect(c.materiales[0]).toMatchObject({ cantidadSolicitadaMil: 100000, costoEstimadoCentavos: 200000, cantidadMil: 90000, costoUnitarioCentavos: 250000, anteriorCentavos: null });
    expect(c.totalEstimadoCentavos).toBe(20000000);
    expect(c.totalConfirmadoCentavos).toBe(22500000);
  });
  it('se reciben 85: la deuda sigue lo recibido al precio confirmado', async () => {
    const c = (await pedir('GET', `/compras/${p}`)).json;
    expect((await pedir('POST', `/compras/${p}/recepciones`, { fecha: '2026-11-19', materiales: [{ compraMaterialId: c.materiales[0].id, cantidadMil: 85000 }] })).status).toBe(200);
    expect(await deuda(artintex)).toBe(21250000);
  });
  it('corregir el precio confirmado con lo ya recibido corrige la deuda (sin tocar lo pagado)', async () => {
    expect((await pedir('POST', '/pagos-proveedores', { fecha: '2026-11-19', proveedorId: artintex, cuentaId: cEfectivo, importeCentavos: 5000000, imputaciones: [{ compraId: p, importeCentavos: 5000000 }] })).status).toBe(200);
    const c = (await pedir('GET', `/compras/${p}`)).json;
    const r = await pedir('PUT', `/compras/${p}/corregir`, { motivo: 'Precio final de Artintex', materiales: [{ id: c.materiales[0].id, cantidadMil: 90000, costoUnitarioCentavos: 260000, cantidadFacturadaMil: 90000 }] });
    expect(r.status).toBe(200);
    expect(r.json.aPagarCentavos).toBe(22100000); // 85 m × 2.600
    expect(r.json.pagadoCentavos).toBe(5000000);
    expect(r.json.saldoCentavos).toBe(17100000);
    expect(r.json.materiales[0]).toMatchObject({ cantidadFacturadaMil: 90000, recibidoMil: 85000 });
    expect(await deuda(artintex)).toBe(17100000);
  });
  it('no se puede confirmar menos de lo que ya llegó', async () => {
    const c = (await pedir('GET', `/compras/${p}`)).json;
    expect((await pedir('PUT', `/compras/${p}/corregir`, { motivo: 'x', materiales: [{ id: c.materiales[0].id, cantidadMil: 80000, costoUnitarioCentavos: 260000 }] })).status).toBe(400);
  });
  it('con la factura cargada, la deuda es lo facturado', async () => {
    const r = await pedir('PUT', `/compras/${p}/corregir`, { motivo: 'Llegó la factura', comprobante: 'FC A 0001-00000001', importeFacturadoCentavos: 23400000 });
    expect(r.status).toBe(200);
    expect(r.json.aPagarCentavos).toBe(23400000);
    expect(await deuda(artintex)).toBe(18400000);
    const cc = (await pedir('GET', `/proveedores/${artintex}/cuenta-corriente`)).json;
    expect(cc.saldoCentavos).toBe(18400000);
    expect(cc.lineas.some((l: { detalle: string }) => l.detalle.includes('factura por'))).toBe(true);
  });
  it('queda todo en auditoría con antes, después y motivo', async () => {
    const a = (await pedir('GET', '/auditoria?entidad=compra')).json;
    const filas = (a.filas ?? a) as { detalle: string | null }[];
    expect(filas.some((f) => f.detalle === 'Llegó la factura')).toBe(true);
  });
});

describe('historial y precio habitual por proveedor', () => {
  it('guarda los precios acordados en cada pedido, con la variación', async () => {
    const h = (await pedir('GET', `/proveedores/${artintex}/precios`)).json as { materialId: number; ultimoCentavos: number; habitualCentavos: number | null; cambios: { precioCentavos: number; origen: string }[] }[];
    const f = h.find((x) => x.materialId === forro)!;
    expect(f.ultimoCentavos).toBe(260000);
    expect(f.habitualCentavos).toBeNull();
    expect(f.cambios.map((c) => c.precioCentavos)).toEqual([260000, 250000]);
  });
  it('el precio habitual cambia solo cuando el usuario lo decide y se usa para estimar', async () => {
    expect((await pedir('POST', `/proveedores/${cueros}/precios`, { materialId: cuero, colorId: negro, precioCentavos: 2700000, motivo: 'Lista nueva' })).status).toBe(200);
    expect(((await pedir('GET', `/materiales/${cuero}`)).json).costoCentavos).toBe(2000000);
    const r = await pedir('POST', '/reposicion-materiales/armar', { proveedorId: cueros, lineas: [{ materialId: cuero, colorId: negro, cantidadMil: 10000 }] });
    expect(r.status).toBe(200);
    const c = (await pedir('GET', `/compras/${r.json.compraId}`)).json;
    expect(c.materiales[0]).toMatchObject({ costoUnitarioCentavos: 2700000, habitualCentavos: 2700000 });
  });
});
