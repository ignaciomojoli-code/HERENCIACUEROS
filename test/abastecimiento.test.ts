import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Base } from '../server/db/index.js';
import { sembrar } from '../server/services/semilla.js';
import { crearApp } from '../server/http/app.js';

/** Abastecimiento por pedido de producción: materiales por color, reservas, entregas y sugerencias de compra. Datos DEMO. */
let dir: string; let base: Base; let app: FastifyInstance; let cookie = '';
const pedir = async (metodo: string, url: string, cuerpo?: unknown) => {
  const r = await app.inject({ method: metodo as 'GET', url: '/api' + url, payload: cuerpo as object, headers: { cookie } });
  return { status: r.statusCode, json: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body };
};
let taller = 0; let artintex = 0; let cueros = 0; let otroCuero = 0; let cuero = 0; let forro = 0; let negro = 0; let suela = 0;
let vNegro = 0; let vSuela = 0; let p1 = 0; let p2 = 0;
type Fila = { clave: string; materialId: number; colorId: number | null; color: string | null; pendienteMil: number; cubreTallerMil: number; faltaEntregarMil: number; reservadoMil: number; usarStockMil: number; disponibleParaReservarMil: number; reservadoOtrosMil: number; enCaminoMil: number; faltaComprarMil: number; sugeridoMil: number; caso: string; otrosLugares: { lugar: string; cantidadMil: number }[] };
const ab = async (id: number) => (await pedir('GET', `/abastecimiento/${id}`)).json as { materiales: Fila[]; sugerencias: { proveedorId: number; cuero: boolean; items: Fila[] }[]; reservadoEnOtros: { numero: number }[] };
const fila = (a: { materiales: Fila[] }, materialId: number, colorId: number | null = null) => a.materiales.find((f) => f.materialId === materialId && f.colorId === colorId)!;
type Det = { stockColores: { colorId: number | null; ubicacionProveedorId: number | null; cantidadMil: number }[] };
const enColor = async (materialId: number, colorId: number | null, lugar: number | null) =>
  ((await pedir('GET', `/materiales/${materialId}`)).json as Det).stockColores.find((s) => s.colorId === colorId && s.ubicacionProveedorId === lugar)?.cantidadMil ?? 0;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herencia-abas-'));
  base = new Base(path.join(dir, 'a.db'));
  base.tx((db) => sembrar(db));
  app = await crearApp({ base });
  await pedir('POST', '/setup', { nombre: 'Admin DEMO', usuario: 'admin', password: 'clave-demo-1' });
  cookie = String((await app.inject({ method: 'POST', url: '/api/login', payload: { usuario: 'admin', password: 'clave-demo-1' } })).headers['set-cookie']).split(';')[0];
  taller = (await pedir('POST', '/proveedores', { nombre: 'Taller DEMO', rol: 'taller' })).json.id;
  artintex = (await pedir('POST', '/proveedores', { nombre: 'Avíos DEMO', rol: 'materiales' })).json.id;
  cueros = (await pedir('POST', '/proveedores', { nombre: 'Curtiembre DEMO', rol: 'materiales' })).json.id;
  otroCuero = (await pedir('POST', '/proveedores', { nombre: 'Curtiembre 2 DEMO', rol: 'materiales' })).json.id;
  cuero = (await pedir('POST', '/materiales', { codigo: 'AB-1', nombre: 'Cuero DEMO', unidad: 'm', tipo: 'material', costoCentavos: 2000000, proveedorId: cueros, clasificacion: 'materia_prima', porColor: true })).json.id;
  forro = (await pedir('POST', '/materiales', { codigo: 'AB-2', nombre: 'Forro DEMO', unidad: 'm', tipo: 'material', costoCentavos: 100000, proveedorId: artintex })).json.id;
  negro = (await pedir('POST', '/catalogo/colores', { nombre: 'Negro DEMO' })).json.id;
  suela = (await pedir('POST', '/catalogo/colores', { nombre: 'Suela DEMO' })).json.id;
  const cat = (await pedir('POST', '/catalogo/categorias', { nombre: 'Camperas DEMO' })).json.id;
  const tS = (await pedir('POST', '/catalogo/talles', { nombre: 'S' })).json.id;
  const modelo = (await pedir('POST', '/catalogo/modelos', { modelo: { nombre: 'Campera DEMO', categoriaId: cat, proveedorId: taller }, variantes: [{ sku: 'AB-N', talleId: tS, colorId: negro }, { sku: 'AB-S', talleId: tS, colorId: suela }] })).json.id;
  const vs = (await pedir('GET', `/catalogo/modelos/${modelo}`)).json.variantes as { id: number; sku: string }[];
  vNegro = vs.find((v) => v.sku === 'AB-N')!.id; vSuela = vs.find((v) => v.sku === 'AB-S')!.id;
  await pedir('PUT', `/recetas/${modelo}`, { lineas: [{ materialId: cuero, cantidadMil: 2000 }, { materialId: forro, cantidadMil: 1000 }] });
  // Stock en el local: 6 m de cuero negro (caso B para 10 m), nada de suela; 3 m de forro.
  await pedir('POST', `/materiales/${cuero}/conteo`, { fecha: '2026-11-18', colorId: negro, contadoMil: 6000 });
  await pedir('POST', `/materiales/${forro}/conteo`, { fecha: '2026-11-18', contadoMil: 3000 });
});
afterAll(async () => { await app.close(); base.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('materiales por color', () => {
  it('el stock del cuero va por color y el forro no', async () => {
    expect(await enColor(cuero, negro, null)).toBe(6000);
    expect(await enColor(cuero, suela, null)).toBe(0);
    const lista = (await pedir('GET', '/materiales')).json as { id: number; stockColores: unknown[] }[];
    expect(lista.find((m) => m.id === forro)!.stockColores).toEqual([]);
  });
});

describe('abastecimiento de un pedido', () => {
  it('calcula por material y color: necesidad, stock y lo que falta comprar (casos A, B y C)', async () => {
    p1 = (await pedir('POST', '/compras', { proveedorId: taller, tipo: 'confeccion', fecha: '2026-11-18', confirmar: true, items: [{ varianteId: vNegro, cantidad: 5, costoUnitarioCentavos: 3800000 }, { varianteId: vSuela, cantidad: 1, costoUnitarioCentavos: 3800000 }] })).json.id;
    const a = await ab(p1);
    expect(fila(a, cuero, negro)).toMatchObject({ pendienteMil: 10000, faltaEntregarMil: 10000, usarStockMil: 6000, faltaComprarMil: 4000, sugeridoMil: 4000, caso: 'B' });
    expect(fila(a, cuero, suela)).toMatchObject({ pendienteMil: 2000, usarStockMil: 0, faltaComprarMil: 2000, caso: 'C' });
    expect(fila(a, forro)).toMatchObject({ pendienteMil: 6000, usarStockMil: 3000, faltaComprarMil: 3000, caso: 'B' });
    // Sugerencias agrupadas por proveedor: avíos primero, cuero después.
    expect(a.sugerencias.map((g) => [g.proveedorId, g.cuero])).toEqual([[artintex, false], [cueros, true]]);
    expect(a.sugerencias[1].items.map((i) => i.sugeridoMil)).toEqual(expect.arrayContaining([4000, 2000]));
  });
  it('dos pedidos no usan el mismo stock: el más viejo primero', async () => {
    p2 = (await pedir('POST', '/compras', { proveedorId: taller, tipo: 'confeccion', fecha: '2026-11-18', confirmar: true, items: [{ varianteId: vNegro, cantidad: 1, costoUnitarioCentavos: 3800000 }] })).json.id;
    expect(fila(await ab(p2), cuero, negro)).toMatchObject({ pendienteMil: 2000, usarStockMil: 0, faltaComprarMil: 2000 });
  });
  it('reservar aparta stock para un pedido; no se puede reservar de más', async () => {
    expect((await pedir('POST', `/abastecimiento/${p2}/reservas`, { lineas: [{ materialId: cuero, colorId: negro, cantidadMil: 3000 }] })).status).toBe(400); // falta entregar 2
    expect((await pedir('POST', `/abastecimiento/${p2}/reservas`, { lineas: [{ materialId: cuero, colorId: negro, cantidadMil: 2000 }] })).status).toBe(200);
    const a2 = await ab(p2);
    expect(fila(a2, cuero, negro)).toMatchObject({ reservadoMil: 2000, faltaComprarMil: 0, caso: 'A' });
    // El pedido 1 ve lo reservado por el 2 y ahora le alcanza menos.
    const a1 = await ab(p1);
    expect(fila(a1, cuero, negro)).toMatchObject({ reservadoOtrosMil: 2000, usarStockMil: 4000, faltaComprarMil: 6000, disponibleParaReservarMil: 4000 });
    expect(a1.reservadoEnOtros.map((p) => p.numero)).toHaveLength(1);
    expect((await pedir('POST', `/abastecimiento/${p1}/reservas`, { lineas: [{ materialId: cuero, colorId: negro, cantidadMil: 5000 }] })).status).toBe(400);
  });
  it('lo pedido a un proveedor y no recibido no se vuelve a sugerir', async () => {
    const r = await pedir('POST', `/abastecimiento/${p1}/armar-compras`, { grupos: [{ proveedorId: otroCuero, lineas: [{ materialId: cuero, colorId: suela, cantidadMil: 2000 }] }] });
    expect(r.status).toBe(200);
    const compra = (await pedir('GET', `/compras/${r.json.pedidos[0].compraId}`)).json;
    expect(compra).toMatchObject({ estado: 'borrador', proveedorId: otroCuero, tipo: 'materiales' });
    expect(compra.materiales[0]).toMatchObject({ materialId: cuero, colorId: suela, cantidadMil: 2000, color: 'Suela DEMO' });
    expect(fila(await ab(p1), cuero, suela)).toMatchObject({ enCaminoMil: 2000, faltaComprarMil: 0, sugeridoMil: 0 });
    // Al recibirlo entra al stock de ese color.
    await pedir('POST', `/compras/${compra.id}/estado`, { accion: 'confirmar' });
    await pedir('POST', `/compras/${compra.id}/recepciones`, { fecha: '2026-11-19', items: [], materiales: [{ compraMaterialId: compra.materiales[0].id, cantidadMil: 2000 }] });
    expect(await enColor(cuero, suela, null)).toBe(2000);
    expect(fila(await ab(p1), cuero, suela)).toMatchObject({ usarStockMil: 2000, enCaminoMil: 0, faltaComprarMil: 0 });
  });
  it('entregar lo reservado lo pasa a la custodia del taller sin descontarlo dos veces', async () => {
    const r = await pedir('POST', `/abastecimiento/${p2}/entregar`, { fecha: '2026-11-19' });
    expect(r.status).toBe(200);
    expect(await enColor(cuero, negro, null)).toBe(4000);
    expect(await enColor(cuero, negro, taller)).toBe(2000);
    const a2 = await ab(p2);
    expect(fila(a2, cuero, negro)).toMatchObject({ reservadoMil: 0, faltaEntregarMil: 0, caso: 'cubierto' });
    // El pedido 1 ya no ve reserva del 2 y tiene los 4 m libres.
    expect(fila(await ab(p1), cuero, negro)).toMatchObject({ reservadoOtrosMil: 0, usarStockMil: 4000, faltaComprarMil: 6000 });
  });
  it('al recibir camperas se consume el cuero del color de cada una', async () => {
    const k = (await pedir('GET', `/compras/${p2}`)).json;
    await pedir('POST', `/compras/${p2}/recepciones`, { fecha: '2026-11-20', items: [{ compraItemId: k.items[0].id, cantidad: 1 }] });
    expect(await enColor(cuero, negro, taller)).toBe(0);
    expect(await enColor(cuero, suela, null)).toBe(2000);
  });
  it('si se anula un pedido, lo reservado vuelve a estar libre', async () => {
    expect((await pedir('POST', `/abastecimiento/${p1}/reservas`, { lineas: [{ materialId: cuero, colorId: negro, cantidadMil: 4000 }] })).status).toBe(200);
    const p3 = (await pedir('POST', '/compras', { proveedorId: taller, tipo: 'confeccion', fecha: '2026-11-20', confirmar: true, items: [{ varianteId: vNegro, cantidad: 1, costoUnitarioCentavos: 3800000 }] })).json.id;
    expect(fila(await ab(p3), cuero, negro)).toMatchObject({ reservadoOtrosMil: 4000, usarStockMil: 0 });
    await pedir('POST', `/compras/${p1}/estado`, { accion: 'anular', motivo: 'Prueba DEMO' });
    expect(fila(await ab(p3), cuero, negro)).toMatchObject({ reservadoOtrosMil: 0, usarStockMil: 2000, faltaComprarMil: 0 });
    expect((await pedir('POST', `/abastecimiento/${p1}/reservas`, { lineas: [{ materialId: cuero, colorId: negro, cantidadMil: 1000 }] })).status).toBe(400);
  });
  it('muestra el material que está en otro lugar para evaluar un traslado', async () => {
    const p4 = (await pedir('POST', '/compras', { proveedorId: taller, tipo: 'confeccion', fecha: '2026-11-20', confirmar: true, items: [{ varianteId: vSuela, cantidad: 3, costoUnitarioCentavos: 3800000 }] })).json.id;
    await pedir('POST', '/traslados', { fecha: '2026-11-20', origenProveedorId: null, destinoProveedorId: otroCuero, items: [{ materialId: cuero, colorId: suela, cantidadMil: 1000 }] });
    const f = fila(await ab(p4), cuero, suela);
    expect(f.otrosLugares).toEqual([{ ubicacionProveedorId: otroCuero, lugar: 'Curtiembre 2 DEMO', cantidadMil: 1000 }]);
    expect(f).toMatchObject({ pendienteMil: 6000, usarStockMil: 1000, faltaComprarMil: 5000, sugeridoMil: 4000 });
    expect((await pedir('GET', `/abastecimiento/${p4}/excel`)).status).toBe(200);
  });
});
