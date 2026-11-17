import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Base } from '../server/db/index.js';
import { sembrar } from '../server/services/semilla.js';
import { crearApp } from '../server/http/app.js';
import { parsearCantidad, parsearFecha } from '../server/services/importar-compras.js';

/** Etapa 6: importar compras desde Excel/CSV con revisión editable, duplicados y lote anulable. Datos DEMO. */
let dir: string; let base: Base; let app: FastifyInstance; let cookie = '';
const pedir = async (metodo: string, url: string, cuerpo?: unknown) => {
  const r = await app.inject({ method: metodo as 'GET', url: '/api' + url, payload: cuerpo as object, headers: { cookie } });
  return { status: r.statusCode, json: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body };
};
const subir = async (nombre: string, contenido: string) => {
  const lim = '----demo' + Math.random().toString(16).slice(2);
  const cuerpo = `--${lim}\r\nContent-Disposition: form-data; name="archivo"; filename="${nombre}"\r\nContent-Type: text/csv\r\n\r\n${contenido}\r\n--${lim}--\r\n`;
  const r = await app.inject({ method: 'POST', url: '/api/importar-compras/analizar', payload: cuerpo, headers: { cookie, 'content-type': `multipart/form-data; boundary=${lim}` } });
  return r.json();
};
let prov = 0; let vS = 0; let cuero = 0;
type Linea = { fila: number; incluir: boolean; proveedorId: number | null; codigo: string; cantidad: string; errores: string[]; duplicado: string | null; [k: string]: unknown };
const limpiar = (ls: Linea[]) => ls.map(({ fila, incluir, fecha, proveedor, proveedorId, comprobante, codigo, descripcion, cantidad, costoUnitarioCentavos, notas }) => ({ fila, incluir, fecha, proveedor, proveedorId, comprobante, codigo, descripcion, cantidad, costoUnitarioCentavos, notas }));

const CSV = [
  'Fecha;Proveedor;Factura;Código;Descripción;Cantidad;Costo unitario',
  '10/11/2026;Cueros DEMO;A-0001;IC-S;;2;$ 100.000',
  '10/11/2026;Cueros DEMO;A-0001;;Cuero DEMO;3,5;27.360',
  '10/11/2026;Cueros DEMO;A-0001;IC-S;;1;100000',
  '11/11/2026;Proveedor Fantasma;B-1;IC-S;;1;1000',
  '12/11/2026;Cueros DEMO;;NOEXISTE;;1;1000',
].join('\n');

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herencia-ic-'));
  base = new Base(path.join(dir, 'i.db'));
  base.tx((db) => sembrar(db));
  app = await crearApp({ base });
  await pedir('POST', '/setup', { nombre: 'Admin DEMO', usuario: 'admin', password: 'clave-demo-1' });
  cookie = String((await app.inject({ method: 'POST', url: '/api/login', payload: { usuario: 'admin', password: 'clave-demo-1' } })).headers['set-cookie']).split(';')[0];
  prov = (await pedir('POST', '/proveedores', { nombre: 'Cueros DEMO' })).json.id;
  cuero = (await pedir('POST', '/materiales', { codigo: 'IC-CU', nombre: 'Cuero DEMO', unidad: 'm', tipo: 'material', costoCentavos: 2000000, proveedorId: null })).json.id;
  const cat = (await pedir('POST', '/catalogo/categorias', { nombre: 'Camperas DEMO' })).json.id;
  const modelo = (await pedir('POST', '/catalogo/modelos', { modelo: { nombre: 'Campera DEMO', categoriaId: cat }, variantes: [{ sku: 'IC-S' }] })).json.id;
  vS = (await pedir('GET', `/catalogo/modelos/${modelo}`)).json.variantes[0].id;
});
afterAll(async () => { await app.close(); base.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('lectura', () => {
  it('fechas y cantidades', () => {
    expect(parsearFecha('7/11/26')).toBe('2026-11-07');
    expect(parsearFecha('2026-11-07')).toBe('2026-11-07');
    expect(parsearFecha('31/02/2026')).toBeNull();
    expect(parsearFecha('46333')).toBe('2026-11-07');
    expect(parsearCantidad('1,25')).toBe(1.25);
    expect(parsearCantidad('0.125')).toBe(0.125);
    expect(parsearCantidad('1.500,5')).toBeNull();
  });
});

describe('importar compras', () => {
  let id = ''; let lineas: Linea[] = [];
  it('reconoce columnas, proveedor, producto y material; marca errores y repetidos', async () => {
    const a = await subir('compras DEMO.csv', CSV);
    id = a.id;
    const h = a.hojas[0];
    expect(h.sugerida).toMatchObject({ fecha: 0, proveedor: 1, comprobante: 2, codigo: 3, descripcion: 4, cantidad: 5, costo: 6 });
    const r = (await pedir('POST', '/importar-compras/leer', { id, hoja: h.nombre, filaEncabezado: h.filaEncabezado, asociacion: h.sugerida })).json;
    lineas = r.lineas;
    expect(lineas).toHaveLength(5);
    expect(lineas[0]).toMatchObject({ fecha: '2026-11-10', proveedorId: prov, costoUnitarioCentavos: 10000000, errores: [] });
    expect(lineas[1]).toMatchObject({ item: { tipo: 'material', id: cuero }, costoUnitarioCentavos: 2736000, errores: [] });
    expect(lineas[2].errores[0]).toMatch(/Repetido en el archivo \(fila 2\)/);
    expect(lineas[3].errores[0]).toMatch(/No encuentro el proveedor "Proveedor Fantasma"/);
    expect(lineas[4].errores[0]).toMatch(/No existe el código "NOEXISTE"/);
    // un producto y un material del mismo comprobante van en pedidos separados
    expect(r.pedidos).toHaveLength(2);
    expect(r.resumen).toMatchObject({ total: 5, conError: 3, pedidos: 2 });
  });
  it('no deja confirmar con líneas tildadas con error', async () => {
    const r = await pedir('POST', '/importar-compras/confirmar', { id, modo: 'pedido', lineas: limpiar(lineas) });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/3 líneas tildadas con errores/);
  });
  it('se corrige en pantalla: elegir proveedor, cambiar código, destildar', async () => {
    const ed = limpiar(lineas);
    ed[2].incluir = false;
    ed[3].proveedorId = prov; // el "fantasma" era Cueros DEMO
    ed[4].incluir = false;
    const r = (await pedir('POST', '/importar-compras/revisar', { lineas: ed })).json;
    expect(r.resumen).toMatchObject({ incluidas: 3, conError: 0, pedidos: 3 });
    const c = (await pedir('POST', '/importar-compras/confirmar', { id, modo: 'recibido', lineas: ed })).json;
    expect(c.pedidos).toHaveLength(3);
    // recibido: entró el stock y el material, y quedó la deuda
    expect((await pedir('GET', `/stock/variante/${vS}`)).json.stock).toBe(3);
    expect((await pedir('GET', `/materiales/${cuero}`)).json.stockMil).toBe(3500);
    const saldo = (await pedir('GET', `/proveedores/${prov}/resumen`)).json;
    expect(JSON.stringify(saldo)).toContain(`"saldoCentavos":${2 * 10000000 + 100000 + Math.round(3.5 * 2736000)}`);
    // el archivo ya se usó
    expect((await pedir('POST', '/importar-compras/confirmar', { id, modo: 'pedido', lineas: ed })).status).toBe(410);
  });
  it('al volver a subir lo mismo avisa duplicados y los deja sin tildar', async () => {
    const a = await subir('compras DEMO.csv', CSV);
    const h = a.hojas[0];
    const r = (await pedir('POST', '/importar-compras/leer', { id: a.id, hoja: h.nombre, filaEncabezado: h.filaEncabezado, asociacion: h.sugerida })).json;
    expect(r.lineas[0].duplicado).toMatch(/comprobante A-0001/);
    expect(r.lineas[0].incluir).toBe(false);
    expect(r.lineas[1].incluir).toBe(false);
  });
  it('el lote se anula entero: vuelve el stock y los pedidos quedan anulados', async () => {
    const lotes = (await pedir('GET', '/importar-compras/lotes')).json;
    expect(lotes).toHaveLength(1);
    expect(lotes[0].compras).toHaveLength(3);
    expect((await pedir('POST', `/importar-compras/lotes/${lotes[0].id}/anular`, { motivo: 'Prueba DEMO' })).status).toBe(200);
    expect((await pedir('GET', `/stock/variante/${vS}`)).json.stock).toBe(0);
    expect((await pedir('GET', `/materiales/${cuero}`)).json.stockMil).toBe(0);
    expect((await pedir('GET', '/importar-compras/lotes')).json[0].compras.every((c: { estado: string }) => c.estado === 'anulada')).toBe(true);
    expect((await pedir('POST', `/importar-compras/lotes/${lotes[0].id}/anular`, { motivo: 'otra' })).status).toBe(400);
  });
});
