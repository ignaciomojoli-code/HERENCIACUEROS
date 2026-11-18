import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Base } from '../server/db/index.js';
import { sembrar } from '../server/services/semilla.js';
import { crearApp } from '../server/http/app.js';

/** Reposición General de productos: detección, edición, descartes, proveedor y armado de pedidos. Datos DEMO. */
let dir: string; let base: Base; let app: FastifyInstance; let cookie = '';
const pedir = async (metodo: string, url: string, cuerpo?: unknown) => {
  const r = await app.inject({ method: metodo as 'GET', url: '/api' + url, payload: cuerpo as object, headers: { cookie } });
  return { status: r.statusCode, json: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body };
};
type Linea = { varianteId: number; cantidad: number; sugerida: number; proveedorId: number | null; proveedor: string; circuito: string; motivo: string; enPedido: number };
type Rep = { grupos: { categoria: string; circuito: string; proveedores: { proveedorId: number | null; items: Linea[] }[] }[]; descartados: (Linea & { decisionId: number })[]; resumen: { yaPedidos: number } };
const rep = async () => (await pedir('GET', '/reposicion')).json as Rep;
const linea = async (v: number) => (await rep()).grupos.flatMap((g) => g.proveedores.flatMap((p) => p.items)).find((i) => i.varianteId === v);
const stock = (varianteId: number, cantidad: number) => pedir('POST', '/stock/ajustes', { varianteId, cantidad, motivo: 'Carga DEMO' });

let efectivo = 0; let provA = 0; let provB = 0; let taller = 0; let catB = 0; let catC = 0;
let vCero = 0; let vBajo = 0; let vOk = 0; let vVendida = 0; let vCampera = 0; let vPedida = 0;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herencia-rep-'));
  base = new Base(path.join(dir, 'r.db'));
  base.tx((db) => sembrar(db));
  app = await crearApp({ base });
  await pedir('POST', '/setup', { nombre: 'Admin DEMO', usuario: 'admin', password: 'clave-demo-1' });
  cookie = String((await app.inject({ method: 'POST', url: '/api/login', payload: { usuario: 'admin', password: 'clave-demo-1' } })).headers['set-cookie']).split(';')[0];
  efectivo = ((await pedir('GET', '/formas-pago')).json as { id: number; nombre: string }[]).find((f) => f.nombre === 'Efectivo')!.id;
  provA = (await pedir('POST', '/proveedores', { nombre: 'Marroquinería DEMO', rol: 'producto_terminado' })).json.id;
  provB = (await pedir('POST', '/proveedores', { nombre: 'Otra marroquinería DEMO', rol: 'producto_terminado' })).json.id;
  taller = (await pedir('POST', '/proveedores', { nombre: 'Taller DEMO', rol: 'taller' })).json.id;
  catB = (await pedir('POST', '/catalogo/categorias', { nombre: 'Billeteras DEMO' })).json.id;
  catC = (await pedir('POST', '/catalogo/categorias', { nombre: 'Camperas DEMO' })).json.id;
  const modelo = async (nombre: string, categoriaId: number, proveedorId: number, clasificacion: string, variantes: { sku: string; stockMinimo?: number }[]) => {
    const id = (await pedir('POST', '/catalogo/modelos', { modelo: { nombre, categoriaId, proveedorId, clasificacion }, variantes: variantes.map((v) => ({ ...v, costoCentavos: 1000000, precios: { '1': 2000000 } })) })).json.id;
    return ((await pedir('GET', `/catalogo/modelos/${id}`)).json.variantes as { id: number; sku: string }[]);
  };
  const b = await modelo('Billetera DEMO', catB, provA, 'producto_comprado', [{ sku: 'RG-CERO' }, { sku: 'RG-BAJO', stockMinimo: 3 }, { sku: 'RG-OK', stockMinimo: 2 }, { sku: 'RG-VEND' }, { sku: 'RG-PED' }]);
  [vCero, vBajo, vOk, vVendida, vPedida] = ['RG-CERO', 'RG-BAJO', 'RG-OK', 'RG-VEND', 'RG-PED'].map((s) => b.find((x) => x.sku === s)!.id);
  vCampera = (await modelo('Campera DEMO', catC, taller, 'fabricacion_propia', [{ sku: 'RG-CAMP' }]))[0].id;
  await stock(vBajo, 1); await stock(vOk, 3); await stock(vVendida, 5); await stock(vPedida, 0);
});
afterAll(async () => { await app.close(); base.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('detección', () => {
  it('stock en cero entra con 1 sugerido; bajo el mínimo, lo que falta; con stock suficiente no entra', async () => {
    expect(await linea(vCero)).toMatchObject({ cantidad: 1, sugerida: 1, motivo: 'Stock en cero', proveedorId: provA, circuito: 'comprar' });
    expect(await linea(vBajo)).toMatchObject({ cantidad: 2, sugerida: 2 });
    expect(await linea(vOk)).toBeUndefined();
  });
  it('lo vendido pendiente de pedir entra con lo vendido aunque quede stock', async () => {
    expect((await pedir('POST', '/ventas', { fecha: '2026-11-18', items: [{ varianteId: vVendida, cantidad: 2, precioCentavos: 2000000 }], pagos: [{ formaPagoId: efectivo, importeCentavos: 4000000 }] })).status).toBe(200);
    expect(await linea(vVendida)).toMatchObject({ cantidad: 2, motivo: 'Vendido 2' });
  });
  it('agrupa por categoría y separa la fabricación propia (camperas)', async () => {
    const r = await rep();
    expect(r.grupos.find((g) => g.categoria === 'Billeteras DEMO')?.circuito).toBe('comprar');
    expect(r.grupos.find((g) => g.categoria === 'Camperas DEMO')?.circuito).toBe('fabricar');
    expect(await linea(vCampera)).toMatchObject({ circuito: 'fabricar', proveedorId: taller });
  });
  it('lo que ya está en un pedido abierto no se repite', async () => {
    expect(await linea(vPedida)).toBeDefined();
    const c = (await pedir('POST', '/compras', { proveedorId: provA, tipo: 'reventa', fecha: '2026-11-18', items: [{ varianteId: vPedida, cantidad: 1, costoUnitarioCentavos: 1000000 }] })).json.id;
    expect(await linea(vPedida)).toBeUndefined();
    // Si el pedido se anula, vuelve a aparecer.
    expect((await pedir('POST', `/compras/${c}/estado`, { accion: 'anular', motivo: 'Prueba DEMO' })).status).toBe(200);
    expect(await linea(vPedida)).toBeDefined();
  });
});

describe('edición (el sistema propone, el usuario decide)', () => {
  it('la cantidad se puede corregir y queda guardada', async () => {
    expect((await pedir('PUT', `/reposicion/${vCero}/cantidad`, { cantidad: 4 })).status).toBe(200);
    expect(await linea(vCero)).toMatchObject({ cantidad: 4, sugerida: 1 });
    expect((await pedir('PUT', `/reposicion/${vCero}/cantidad`, { cantidad: 0 })).status).toBe(400);
  });
  it('descartar saca el producto (sin borrar) y reincluir lo devuelve con su cantidad', async () => {
    expect((await pedir('POST', `/reposicion/${vCero}/descartar`, { motivo: 'No se trabaja más DEMO' })).status).toBe(200);
    expect(await linea(vCero)).toBeUndefined();
    expect((await rep()).descartados.some((d) => d.varianteId === vCero)).toBe(true);
    expect((await pedir('POST', `/reposicion/${vCero}/reincluir`, {})).status).toBe(200);
    expect(await linea(vCero)).toMatchObject({ cantidad: 4 });
  });
  it('un descarte vence solo cuando entra stock', async () => {
    expect((await pedir('POST', `/reposicion/${vBajo}/descartar`, {})).status).toBe(200);
    expect((await rep()).descartados.some((d) => d.varianteId === vBajo)).toBe(true);
    await stock(vBajo, 5);
    const r = await rep();
    expect(r.descartados.some((d) => d.varianteId === vBajo)).toBe(false);
    await stock(vBajo, -5);
    expect(await linea(vBajo)).toMatchObject({ cantidad: 2 });
  });
  it('se puede cambiar el proveedor de una línea y queda en auditoría', async () => {
    expect((await pedir('POST', `/reposicion/${vBajo}/proveedor`, { proveedorId: provB, motivo: 'Más barato DEMO' })).status).toBe(200);
    expect(await linea(vBajo)).toMatchObject({ proveedorId: provB, proveedor: 'Otra marroquinería DEMO' });
    const a = (await pedir('GET', '/auditoria?entidad=reposicion')).json;
    const filas = (a.filas ?? a) as { detalle: string | null }[];
    expect(filas.some((f) => f.detalle === 'Más barato DEMO')).toBe(true);
  });
});

describe('armar pedidos', () => {
  it('arma un borrador con las cantidades editadas: sin deuda ni stock', async () => {
    const saldoAntes = ((await pedir('GET', '/proveedores/saldos')).json as Record<string, { saldoCentavos: number }>)[provA]?.saldoCentavos ?? 0;
    const r = await pedir('POST', '/reposicion/armar', { proveedorId: provA, lineas: [{ varianteId: vCero, cantidad: 4 }, { varianteId: vVendida, cantidad: 3 }] });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ tipo: 'reventa', items: 2, unidades: 7 });
    const c = (await pedir('GET', `/compras/${r.json.compraId}`)).json;
    expect(c.estado).toBe('borrador');
    expect(c.items.map((i: { cantidad: number }) => i.cantidad).sort()).toEqual([3, 4]);
    expect(((await pedir('GET', '/proveedores/saldos')).json as Record<string, { saldoCentavos: number }>)[provA]?.saldoCentavos ?? 0).toBe(saldoAntes);
    expect(await linea(vCero)).toBeUndefined();
    expect(await linea(vVendida)).toBeUndefined();
  });
  it('las camperas propias arman un pedido de confección al taller', async () => {
    const r = await pedir('POST', '/reposicion/armar', { proveedorId: taller, lineas: [{ varianteId: vCampera, cantidad: 2 }] });
    expect(r.status).toBe(200);
    expect(r.json.tipo).toBe('confeccion');
  });
  it('un proveedor de materiales inactivo se puede seguir eligiendo para pedirle', async () => {
    const cefalo = (await pedir('POST', '/proveedores', { nombre: 'Curtiembre inactiva DEMO', rol: 'materiales', activo: false })).json.id;
    const mat = (await pedir('POST', '/materiales', { codigo: 'RG-M1', nombre: 'Cuero RG DEMO', unidad: 'm', tipo: 'material', costoCentavos: 100000, proveedorId: cefalo })).json.id;
    const rc = await pedir('POST', '/compras', { proveedorId: cefalo, tipo: 'materiales', fecha: '2026-11-18', materiales: [{ materialId: mat, cantidadMil: 1000, costoUnitarioCentavos: 100000 }] });
    expect(rc.status).toBe(200);
    // Un proveedor de producto terminado inactivo, no.
    expect((await pedir('PUT', `/proveedores/${provB}`, { nombre: 'Otra marroquinería DEMO', rol: 'producto_terminado', activo: false })).status).toBe(200);
    expect((await pedir('POST', '/compras', { proveedorId: provB, tipo: 'reventa', fecha: '2026-11-18', items: [{ varianteId: vBajo, cantidad: 1, costoUnitarioCentavos: 1000000 }] })).status).toBe(400);
  });
});
