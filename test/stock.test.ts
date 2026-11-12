import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Base } from '../server/db/index.js';
import { sembrar } from '../server/services/semilla.js';
import { crearApp } from '../server/http/app.js';
import { costoPromedio } from '../server/services/compras.js';

/** Stock y compras contra la API real, con base temporal y datos DEMO. */
let dir: string; let base: Base; let app: FastifyInstance; let cookie = '';
const pedir = async (metodo: string, url: string, cuerpo?: unknown, c = cookie) => {
  const r = await app.inject({ method: metodo as 'GET', url: '/api' + url, payload: cuerpo as object, headers: { cookie: c } });
  return { status: r.statusCode, json: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body };
};
const login = async (usuario: string, password: string) => String((await app.inject({ method: 'POST', url: '/api/login', payload: { usuario, password } })).headers['set-cookie']).split(';')[0];
let v1: number, v2: number, provReventa: number, taller: number;
const stockDe = async (id: number) => (await pedir('GET', `/stock/variante/${id}`)).json.stock;
const costoDe = async (id: number) => (await pedir('GET', '/catalogo/modelos/' + (await pedir('GET', `/stock/variante/${id}`)).json.modeloId)).json;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herencia-stock-'));
  base = new Base(path.join(dir, 'p.db'));
  base.tx((db) => sembrar(db));
  app = await crearApp({ base });
  await pedir('POST', '/setup', { nombre: 'Admin DEMO', usuario: 'admin', password: 'clave-demo-1' }, '');
  cookie = await login('admin', 'clave-demo-1');
  const cat = (await pedir('POST', '/catalogo/categorias', { nombre: 'Cinturones DEMO' })).json.id;
  const m = (await pedir('POST', '/catalogo/modelos', { modelo: { nombre: 'Cinturón DEMO', categoriaId: cat }, variantes: [{ sku: 'CD-1', costoCentavos: 1000000 }, { sku: 'CD-2' }] })).json.id;
  const det = (await pedir('GET', `/catalogo/modelos/${m}`)).json;
  v1 = det.variantes.find((v: { sku: string }) => v.sku === 'CD-1').id;
  v2 = det.variantes.find((v: { sku: string }) => v.sku === 'CD-2').id;
  provReventa = (await pedir('POST', '/proveedores', { nombre: 'Proveedor DEMO' })).json.id;
  taller = (await pedir('POST', '/proveedores', { nombre: 'Taller DEMO' })).json.id;
});
afterAll(async () => { await app.close(); base.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('costo promedio ponderado', () => {
  it('pondera por cantidades', () => {
    expect(costoPromedio(10, 1000, 10, 2000)).toBe(1500);
    expect(costoPromedio(3, 1000, 1, 2000)).toBe(1250);
    expect(costoPromedio(0, 1000, 5, 2000)).toBe(2000);
    expect(costoPromedio(-2, 1000, 5, 2000)).toBe(2000);
    expect(costoPromedio(5, null, 5, 2000)).toBe(2000);
  });
});

describe('stock', () => {
  it('ajuste con motivo; no deja stock negativo', async () => {
    expect((await pedir('POST', '/stock/ajustes', { varianteId: v1, cantidad: 3, motivo: '' })).status).toBe(400);
    expect((await pedir('POST', '/stock/ajustes', { varianteId: v1, cantidad: 3, motivo: 'Carga DEMO' })).json.stock).toBe(3);
    expect((await pedir('POST', '/stock/ajustes', { varianteId: v1, cantidad: -5, motivo: 'Rotura DEMO' })).status).toBe(409);
    expect(await stockDe(v1)).toBe(3);
  });
  it('lista con filtros y buscador', async () => {
    const r = (await pedir('GET', '/stock?filtro=con_stock')).json;
    expect(r.filas.map((f: { sku: string }) => f.sku)).toEqual(['CD-1']);
    expect(r.totales.valorCostoCentavos).toBe(3000000);
    const b = (await pedir('GET', '/stock/buscar?q=cd-2')).json;
    expect(b[0].sku).toBe('CD-2');
    expect(b[0].exacto).toBe(true);
  });
});

describe('compras', () => {
  let compra: number;
  it('pedido de reventa: recepción parcial, costo promedio y cierre automático', async () => {
    const r = await pedir('POST', '/compras', { proveedorId: provReventa, tipo: 'reventa', fecha: '2026-11-12', confirmar: true, items: [{ varianteId: v1, cantidad: 6, costoUnitarioCentavos: 2000000 }] });
    expect(r.status).toBe(200);
    compra = r.json.id;
    const item = (await pedir('GET', `/compras/${compra}`)).json.items[0];
    expect((await pedir('POST', `/compras/${compra}/recepciones`, { fecha: '2026-11-12', items: [{ compraItemId: item.id, cantidad: 7 }] })).status).toBe(400);
    const rec1 = await pedir('POST', `/compras/${compra}/recepciones`, { fecha: '2026-11-12', comprobante: 'R-DEMO-1', items: [{ compraItemId: item.id, cantidad: 3 }] });
    expect(rec1.json.pedidoCerrado).toBe(false);
    expect(await stockDe(v1)).toBe(6);
    // 3 a $10.000 + 3 a $20.000 → $15.000
    expect((await costoDe(v1)).variantes.find((v: { id: number }) => v.id === v1).costoCentavos).toBe(1500000);
    const rec2 = await pedir('POST', `/compras/${compra}/recepciones`, { fecha: '2026-11-13', items: [{ compraItemId: item.id, cantidad: 3 }] });
    expect(rec2.json.pedidoCerrado).toBe(true);
    expect((await pedir('GET', `/compras/${compra}`)).json.estado).toBe('cerrada');
  });
  it('anular una recepción devuelve stock, costo y reabre el pedido; no se puede anular dos veces', async () => {
    const c = (await pedir('GET', `/compras/${compra}`)).json;
    const ultima = c.recepciones[0];
    const costoAntes = (await costoDe(v1)).variantes.find((v: { id: number }) => v.id === v1).costoCentavos;
    const r = await pedir('POST', `/recepciones/${ultima.id}/anular`, { motivo: 'Error DEMO' });
    expect(r.status).toBe(200);
    expect(r.json.costosARevisar).toEqual([]);
    expect(await stockDe(v1)).toBe(6);
    const costoDespues = (await costoDe(v1)).variantes.find((v: { id: number }) => v.id === v1).costoCentavos;
    expect(costoDespues).toBe(1500000);
    expect(costoDespues).not.toBe(costoAntes);
    expect((await pedir('GET', `/compras/${compra}`)).json.estado).toBe('confirmada');
    expect((await pedir('POST', `/recepciones/${ultima.id}/anular`, { motivo: 'otra vez' })).status).toBe(400);
    const k = (await pedir('GET', `/stock/variante/${v1}`)).json;
    expect(k.movimientos.some((m: { tipo: string; cantidad: number }) => m.tipo === 'anulacion' && m.cantidad === -3)).toBe(true);
  });
  it('un pedido con recepciones no se anula; se cierra con motivo', async () => {
    expect((await pedir('POST', `/compras/${compra}/estado`, { accion: 'anular', motivo: 'x' })).status).toBe(400);
    expect((await pedir('POST', `/compras/${compra}/estado`, { accion: 'cerrar' })).status).toBe(400);
    expect((await pedir('POST', `/compras/${compra}/estado`, { accion: 'cerrar', motivo: 'No mandan el resto' })).json.estado).toBe('cerrada');
  });
  it('confección (taller): suma stock pero no pisa el costo', async () => {
    const r = await pedir('POST', '/compras', { proveedorId: taller, tipo: 'confeccion', fecha: '2026-11-12', confirmar: true, items: [{ varianteId: v2, cantidad: 2, costoUnitarioCentavos: 3800000 }] });
    const item = (await pedir('GET', `/compras/${r.json.id}`)).json.items[0];
    await pedir('POST', `/compras/${r.json.id}/recepciones`, { fecha: '2026-11-12', items: [{ compraItemId: item.id, cantidad: 2 }] });
    expect(await stockDe(v2)).toBe(2);
    expect((await costoDe(v2)).variantes.find((v: { id: number }) => v.id === v2).costoCentavos).toBeNull();
    const res = (await pedir('GET', `/proveedores/${taller}/resumen`)).json;
    expect(res.recibidoCentavos).toBe(7600000);
  });
  it('un borrador se edita; uno confirmado no', async () => {
    const r = await pedir('POST', '/compras', { proveedorId: provReventa, tipo: 'reventa', fecha: '2026-11-12', items: [{ varianteId: v2, cantidad: 1, costoUnitarioCentavos: 100 }] });
    expect((await pedir('PUT', `/compras/${r.json.id}`, { proveedorId: provReventa, tipo: 'reventa', fecha: '2026-11-12', items: [{ varianteId: v2, cantidad: 4, costoUnitarioCentavos: 100 }] })).status).toBe(200);
    expect((await pedir('GET', `/compras/${r.json.id}`)).json.items[0].cantidad).toBe(4);
    await pedir('POST', `/compras/${r.json.id}/estado`, { accion: 'confirmar' });
    expect((await pedir('PUT', `/compras/${r.json.id}`, { proveedorId: provReventa, tipo: 'reventa', fecha: '2026-11-12', items: [{ varianteId: v2, cantidad: 1, costoUnitarioCentavos: 100 }] })).status).toBe(400);
    expect((await pedir('POST', `/compras/${r.json.id}/estado`, { accion: 'anular', motivo: 'Ya no DEMO' })).json.estado).toBe('anulada');
  });
});

describe('conteo físico', () => {
  it('ajusta solo lo contado y deja documentada la diferencia', async () => {
    const c = (await pedir('POST', '/conteos', {})).json;
    expect((await pedir('PUT', `/conteos/${c.id}/items`, { items: [{ varianteId: v1, contado: 4 }] })).status).toBe(200);
    const vista = (await pedir('GET', `/conteos/${c.id}`)).json;
    expect(vista.items[0]).toMatchObject({ sistema: 6, contado: 4, diferencia: -2 });
    expect(vista.sinContar.map((s: { sku: string }) => s.sku)).toContain('CD-2');
    const r = (await pedir('POST', `/conteos/${c.id}/aplicar`)).json;
    expect(r).toMatchObject({ contados: 1, ajustes: 1, faltante: 2 });
    expect(await stockDe(v1)).toBe(4);
    expect(await stockDe(v2)).toBe(2);
    expect((await pedir('PUT', `/conteos/${c.id}/items`, { items: [{ varianteId: v1, contado: 1 }] })).status).toBe(400);
  });
});

describe('stock inicial desde planilla', () => {
  it('carga solo variantes sin movimientos', async () => {
    const cat = (await pedir('GET', '/catalogo/aux')).json.categorias[0].id;
    await pedir('POST', '/catalogo/modelos', { modelo: { nombre: 'Billetera DEMO', categoriaId: cat }, variantes: [{ sku: 'BD-1' }, { sku: 'BD-2' }] });
    const csv = 'Código;Producto;STOCK ACTUAL\nBD-1;Billetera;5\nBD-2;Billetera;0\nCD-1;Cinturón;9\nXX-9;No existe;1\nZZ-0;Vacia;\nbd-1;Repetida;2\n';
    const lim = '----x';
    const cuerpo = `--${lim}\r\nContent-Disposition: form-data; name="archivo"; filename="s.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${lim}--\r\n`;
    const a = (await app.inject({ method: 'POST', url: '/api/stock/inicial/analizar', payload: cuerpo, headers: { cookie, 'content-type': `multipart/form-data; boundary=${lim}` } })).json();
    const h = a.hojas[0];
    expect(h.sugerida).toEqual({ sku: 0, cantidad: 2 });
    const paso = { id: a.id, hoja: h.nombre, filaEncabezado: h.filaEncabezado, colSku: 0, colCantidad: 2 };
    const v = (await pedir('POST', '/stock/inicial/validar', paso)).json;
    expect(v.resumen).toMatchObject({ ok: 1, unidades: 5, cero: 2, noExiste: 1, yaTiene: 1, duplicadas: 1 });
    const r = (await pedir('POST', '/stock/inicial/confirmar', { ...paso, fecha: '2026-10-16' })).json;
    expect(r).toEqual({ variantes: 1, unidades: 5 });
    expect(await stockDe(v1)).toBe(4);
  });
});

describe('permisos', () => {
  it('ventas ve stock sin costos y no puede ajustar ni ver compras', async () => {
    const roles = (await pedir('GET', '/roles')).json;
    await pedir('POST', '/usuarios', { usuario: 'vende', nombre: 'Vendedor DEMO', rolId: roles.find((r: { nombre: string }) => r.nombre === 'Ventas').id, password: 'clave-demo-9' });
    const c = await login('vende', 'clave-demo-9');
    const s = await pedir('GET', '/stock', undefined, c);
    expect(s.status).toBe(200);
    expect(JSON.stringify(s.json)).not.toMatch(/costo/i);
    expect((await pedir('POST', '/stock/ajustes', { varianteId: v1, cantidad: 1, motivo: 'x' }, c)).status).toBe(403);
    expect((await pedir('GET', '/compras', undefined, c)).status).toBe(403);
  });
});
