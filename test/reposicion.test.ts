import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Base } from '../server/db/index.js';
import { sembrar } from '../server/services/semilla.js';
import { crearApp } from '../server/http/app.js';

/** Lista "para pedir": lo vendido se suma a la lista de su proveedor; desde ahí se arma el pedido. Datos DEMO. */
let dir: string; let base: Base; let app: FastifyInstance; let cookie = '';
const pedir = async (metodo: string, url: string, cuerpo?: unknown) => {
  const r = await app.inject({ method: metodo as 'GET', url: '/api' + url, payload: cuerpo as object, headers: { cookie } });
  return { status: r.statusCode, json: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body };
};
type Grupo = { proveedorId: number | null; proveedor: string; unidades: number; items: { varianteId: number; sku: string; cantidad: number; costoCentavos?: number }[] };
let efectivo = 0; let provA = 0; let provB = 0; let vA = 0; let vA2 = 0; let vB = 0;
const lista = async () => (await pedir('GET', '/para-pedir')).json as Grupo[];
const vender = async (items: { varianteId: number; cantidad: number; precioCentavos: number }[]) =>
  (await pedir('POST', '/ventas', { fecha: '2026-11-16', items, pagos: [{ formaPagoId: efectivo, importeCentavos: items.reduce((s, i) => s + i.cantidad * i.precioCentavos, 0) }] })).json;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herencia-repo-'));
  base = new Base(path.join(dir, 'r.db'));
  base.tx((db) => sembrar(db));
  app = await crearApp({ base });
  await pedir('POST', '/setup', { nombre: 'Admin DEMO', usuario: 'admin', password: 'clave-demo-1' });
  cookie = String((await app.inject({ method: 'POST', url: '/api/login', payload: { usuario: 'admin', password: 'clave-demo-1' } })).headers['set-cookie']).split(';')[0];
  efectivo = ((await pedir('GET', '/formas-pago')).json as { id: number; nombre: string }[]).find((f) => f.nombre === 'Efectivo')!.id;
  provA = (await pedir('POST', '/proveedores', { nombre: 'Cinturones DEMO' })).json.id;
  provB = (await pedir('POST', '/proveedores', { nombre: 'Billeteras DEMO' })).json.id;
  const cat = (await pedir('POST', '/catalogo/categorias', { nombre: 'Accesorios DEMO' })).json.id;
  const mA = (await pedir('POST', '/catalogo/modelos', { modelo: { nombre: 'Cinturón DEMO', categoriaId: cat, proveedorId: provA }, variantes: [{ sku: 'CIN-90', costoCentavos: 1500000, precios: { '1': 3400000 } }, { sku: 'CIN-95', costoCentavos: 1500000, precios: { '1': 3400000 } }] })).json.id;
  const mB = (await pedir('POST', '/catalogo/modelos', { modelo: { nombre: 'Billetera DEMO', categoriaId: cat, proveedorId: provB }, variantes: [{ sku: 'BIL-N', costoCentavos: 2000000, precios: { '1': 4800000 } }] })).json.id;
  const da = (await pedir('GET', `/catalogo/modelos/${mA}`)).json.variantes; const dbb = (await pedir('GET', `/catalogo/modelos/${mB}`)).json.variantes;
  vA = da.find((v: { sku: string }) => v.sku === 'CIN-90').id; vA2 = da.find((v: { sku: string }) => v.sku === 'CIN-95').id; vB = dbb[0].id;
  for (const v of [vA, vA2, vB]) await pedir('POST', '/stock/ajustes', { varianteId: v, cantidad: 5, motivo: 'Carga DEMO' });
});
afterAll(async () => { await app.close(); base.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('lista para pedir', () => {
  it('cada venta suma lo vendido a la lista de su proveedor, separada por proveedor', async () => {
    await vender([{ varianteId: vA, cantidad: 2, precioCentavos: 3400000 }, { varianteId: vB, cantidad: 1, precioCentavos: 4800000 }]);
    await vender([{ varianteId: vA, cantidad: 1, precioCentavos: 3400000 }]);
    const l = await lista();
    expect(l.map((g) => g.proveedor)).toEqual(['Billeteras DEMO', 'Cinturones DEMO']);
    expect(l.find((g) => g.proveedorId === provA)!.items).toMatchObject([{ sku: 'CIN-90', cantidad: 3 }]);
    expect(l.find((g) => g.proveedorId === provB)!.unidades).toBe(1);
  });

  it('al anular una venta, lo que no se pidió sale de la lista', async () => {
    const v = await vender([{ varianteId: vA2, cantidad: 1, precioCentavos: 3400000 }]);
    expect((await lista()).find((g) => g.proveedorId === provA)!.unidades).toBe(4);
    await pedir('POST', `/ventas/${v.id}/anular`, { motivo: 'prueba' });
    expect((await lista()).find((g) => g.proveedorId === provA)!.unidades).toBe(3);
  });

  it('se agrega a mano, se corrige la cantidad y se saca', async () => {
    expect((await pedir('POST', '/para-pedir', { varianteId: vA2, cantidad: 2 })).status).toBe(200);
    expect((await pedir('POST', '/para-pedir', { varianteId: vA2, cantidad: 0 })).status).toBe(400);
    await pedir('PUT', `/para-pedir/${vA}`, { cantidad: 5 });
    let a = (await lista()).find((g) => g.proveedorId === provA)!;
    expect(a.items.map((i) => [i.sku, i.cantidad])).toEqual([['CIN-90', 5], ['CIN-95', 2]]);
    await pedir('PUT', `/para-pedir/${vA2}`, { cantidad: 0 });
    a = (await lista()).find((g) => g.proveedorId === provA)!;
    expect(a.items.map((i) => i.sku)).toEqual(['CIN-90']);
    expect((await pedir('GET', `/para-pedir/texto?proveedorId=${provA}`)).json.texto).toContain('5 × Cinturón DEMO');
  });

  it('armar el pedido crea un borrador con costos y saca lo pedido; si el pedido se anula, vuelve a la lista', async () => {
    const r = (await pedir('POST', '/para-pedir/armar', { proveedorId: provA })).json;
    expect(r).toMatchObject({ tipo: 'reventa', unidades: 5 });
    const c = (await pedir('GET', `/compras/${r.compraId}`)).json;
    expect(c.estado).toBe('borrador');
    expect(c.items).toMatchObject([{ varianteId: vA, cantidad: 5, costoUnitarioCentavos: 1500000 }]);
    expect((await lista()).find((g) => g.proveedorId === provA)).toBeUndefined();
    expect((await lista()).find((g) => g.proveedorId === provB)!.unidades).toBe(1);
    await pedir('POST', `/compras/${r.compraId}/estado`, { accion: 'anular', motivo: 'prueba' });
    expect((await lista()).find((g) => g.proveedorId === provA)!.unidades).toBe(5);
  });

  it('se puede apagar desde Configuración', async () => {
    const cfg = (await pedir('GET', '/config')).json;
    await pedir('PUT', '/config/reposicion', { ...cfg.reposicion, automatica: false });
    await vender([{ varianteId: vB, cantidad: 1, precioCentavos: 4800000 }]);
    expect((await lista()).find((g) => g.proveedorId === provB)!.unidades).toBe(1);
  });
});
