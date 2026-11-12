import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Base } from '../server/db/index.js';
import { sembrar } from '../server/services/semilla.js';
import { crearApp } from '../server/http/app.js';

/** Pruebas contra la API real, con una base temporal y datos DEMO. */
let dir: string;
let base: Base;
let app: FastifyInstance;
let cookieAdmin = '';

async function pedir(metodo: string, url: string, cuerpo?: unknown, cookie = cookieAdmin, headers: Record<string, string> = {}) {
  const r = await app.inject({ method: metodo as 'GET', url: '/api' + url, payload: cuerpo as object, headers: { cookie, ...headers } });
  return { status: r.statusCode, json: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body, headers: r.headers };
}
async function login(usuario: string, password: string) {
  const r = await app.inject({ method: 'POST', url: '/api/login', payload: { usuario, password } });
  expect(r.statusCode).toBe(200);
  return String(r.headers['set-cookie']).split(';')[0];
}
function multipart(nombre: string, contenido: string) {
  const limite = '----prueba' + Date.now();
  const cuerpo = `--${limite}\r\nContent-Disposition: form-data; name="archivo"; filename="${nombre}"\r\nContent-Type: text/csv\r\n\r\n${contenido}\r\n--${limite}--\r\n`;
  return { cuerpo, tipo: `multipart/form-data; boundary=${limite}` };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herencia-test-'));
  base = new Base(path.join(dir, 'prueba.db'));
  base.tx((db) => sembrar(db));
  app = await crearApp({ base });
  expect((await pedir('POST', '/setup', { nombre: 'Admin DEMO', usuario: 'admin', password: 'clave-demo-1' }, '')).status).toBe(200);
  cookieAdmin = await login('admin', 'clave-demo-1');
});
afterAll(async () => { await app.close(); base.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('acceso', () => {
  it('no deja configurar dos veces ni entrar sin sesión', async () => {
    expect((await pedir('POST', '/setup', { nombre: 'Otro', usuario: 'otro', password: 'clave-demo-2' }, '')).status).toBeGreaterThanOrEqual(400);
    expect((await pedir('GET', '/catalogo/modelos', undefined, '')).status).toBe(401);
  });
  it('registra el ingreso fallido', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/login', payload: { usuario: 'admin', password: 'mala-clave' } });
    expect(r.statusCode).toBe(401);
    const a = await pedir('GET', '/auditoria?entidad=sesion');
    expect(a.json.filas.some((f: { accion: string }) => f.accion === 'login_fallido')).toBe(true);
  });
});

describe('catálogo', () => {
  let categoriaId: number;
  it('crea un producto DEMO con variantes y precios', async () => {
    categoriaId = (await pedir('POST', '/catalogo/categorias', { nombre: 'Camperas DEMO' })).json.id;
    const r = await pedir('POST', '/catalogo/modelos', { modelo: { nombre: 'Campera DEMO', categoriaId }, variantes: [
      { sku: 'DEMO-1', costoCentavos: 10000000, precios: { 1: 20000000, 2: 24000000 } },
      { sku: 'DEMO-2', costoCentavos: 10000000, precios: { 1: 20000000 } },
    ] });
    expect(r.status).toBe(200);
  });
  it('rechaza un SKU repetido (sin importar mayúsculas) y no deja nada a medias', async () => {
    const antes = (await pedir('GET', '/catalogo/modelos')).json.length;
    const r = await pedir('POST', '/catalogo/modelos', { modelo: { nombre: 'Otra DEMO', categoriaId }, variantes: [{ sku: 'NUEVO-1' }, { sku: 'demo-1' }] });
    expect(r.status).toBe(409);
    expect((await pedir('GET', '/catalogo/modelos')).json.length).toBe(antes);
    expect((await pedir('GET', '/catalogo/modelos?q=NUEVO-1')).json.length).toBe(0);
  });
  it('la misma petición con la misma clave de idempotencia se registra una sola vez', async () => {
    const h = { 'idempotency-key': 'prueba-idem-1' };
    const c = { modelo: { nombre: 'Cinturón DEMO', categoriaId }, variantes: [{ sku: 'DEMO-C1' }] };
    const r1 = await pedir('POST', '/catalogo/modelos', c, cookieAdmin, h);
    const r2 = await pedir('POST', '/catalogo/modelos', c, cookieAdmin, h);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.json.id).toBe(r1.json.id);
    expect(r2.headers['idempotent-replay']).toBe('true');
  });
  it('desactivar no borra: el producto sigue en "todos"', async () => {
    const m = (await pedir('GET', '/catalogo/modelos?q=Cintur')).json[0];
    expect((await pedir('POST', `/catalogo/modelos/${m.id}/estado`, { activo: false })).status).toBe(200);
    expect((await pedir('GET', '/catalogo/modelos?q=Cintur')).json.length).toBe(0);
    expect((await pedir('GET', '/catalogo/modelos?q=Cintur&estado=todos')).json[0].activo).toBe(false);
  });
});

describe('cambio masivo de precios', () => {
  const pedido = { listaId: 1, tipo: 'porcentaje', valor: 1000, redondeoCentavos: 50000 };
  it('la vista previa no cambia nada', async () => {
    const v = await pedir('POST', '/catalogo/precios/previsualizar', pedido);
    expect(v.json.find((f: { sku: string }) => f.sku === 'DEMO-1').nuevo).toBe(22000000);
    const m = (await pedir('GET', '/catalogo/modelos?q=DEMO-1')).json[0];
    expect(m.precios.find((p: { listaId: number }) => p.listaId === 1).min).toBe(20000000);
  });
  it('exige motivo y rechaza si los precios cambiaron desde la vista previa', async () => {
    const v = (await pedir('POST', '/catalogo/precios/previsualizar', pedido)).json;
    const previstos = Object.fromEntries(v.map((f: { varianteId: number; nuevo: number }) => [f.varianteId, f.nuevo]));
    expect((await pedir('POST', '/catalogo/precios/aplicar', { ...pedido, previstos })).status).toBe(400);
    const otros = { ...previstos, [v[0].varianteId]: 1 };
    expect((await pedir('POST', '/catalogo/precios/aplicar', { ...pedido, motivo: 'test', previstos: otros })).status).toBe(409);
    const ok = await pedir('POST', '/catalogo/precios/aplicar', { ...pedido, motivo: 'Aumento DEMO', previstos });
    expect(ok.status).toBe(200);
    expect(ok.json.cambiados).toBeGreaterThan(0);
  });
  it('deja historial con el motivo', async () => {
    const m = (await pedir('GET', '/catalogo/modelos?q=DEMO-1')).json[0];
    const d = (await pedir('GET', `/catalogo/modelos/${m.id}`)).json;
    expect(d.historialPrecios.some((h: { motivo: string; nuevoCentavos: number }) => h.motivo === 'Aumento DEMO' && h.nuevoCentavos === 22000000)).toBe(true);
  });
});

describe('roles', () => {
  let cookieVentas = '';
  beforeAll(async () => {
    const roles = (await pedir('GET', '/roles')).json;
    const ventas = roles.find((r: { nombre: string }) => r.nombre === 'Ventas');
    expect((await pedir('POST', '/usuarios', { usuario: 'vendedor', nombre: 'Vendedor DEMO', rolId: ventas.id, password: 'clave-demo-3' })).status).toBe(200);
    cookieVentas = await login('vendedor', 'clave-demo-3');
  });
  it('ventas no recibe costos en ninguna respuesta', async () => {
    const lista = await pedir('GET', '/catalogo/modelos', undefined, cookieVentas);
    expect(lista.status).toBe(200);
    expect(JSON.stringify(lista.json)).not.toMatch(/costo/i);
    const d = await pedir('GET', `/catalogo/modelos/${lista.json[0].id}`, undefined, cookieVentas);
    expect(JSON.stringify(d.json)).not.toMatch(/costo/i);
    const csv = await pedir('GET', '/catalogo/exportar?formato=csv', undefined, cookieVentas);
    if (csv.status === 200) expect(String(csv.json)).not.toMatch(/Costo/);
  });
  it('ventas no puede aplicar cambios de precio ni ver auditoría', async () => {
    expect((await pedir('POST', '/catalogo/precios/aplicar', { listaId: 1, tipo: 'porcentaje', valor: 500, motivo: 'x' }, cookieVentas)).status).toBe(403);
    expect((await pedir('GET', '/auditoria', undefined, cookieVentas)).status).toBe(403);
  });
  it('el rol Administrador no se puede modificar', async () => {
    const admin = (await pedir('GET', '/roles')).json.find((r: { esSistema: boolean }) => r.esSistema);
    expect((await pedir('PUT', `/roles/${admin.id}`, { nombre: 'X', descripcion: '', permisos: {} })).status).toBeGreaterThanOrEqual(400);
  });
});

describe('importación', () => {
  const csv = [
    'Planilla DEMO',
    '',
    'Código;Categoría;Producto;Género / tipo;Color;Talle;Proveedor;Costo ($);Precio efectivo / transf.;Precio tarjeta',
    'IMP-1;Camperas DEMO;Campera Importada DEMO;Mujer;Negro;1;Taller DEMO;$100.000;$200.000;$240.000',
    'IMP-2;Camperas DEMO;campera importada demo;Mujer;Negro;2;Taller DEMO;$100.000;$200.000;$240.000',
    'IMP-2;Camperas DEMO;Campera Importada DEMO;Mujer;Negro;3;Taller DEMO;$100.000;$200.000;$240.000',
    'IMP-3;Accesorios DEMO;Bandolera DEMO;Bandolera;Suela;;;;$50.000;',
    'IMP-4;;;;;;;;;',
    'DEMO-1;Camperas DEMO;Campera DEMO;;;;;$90.000;$220.000;$240.000',
  ].join('\n');
  let paso: Record<string, unknown>;

  it('detecta encabezado, columnas, duplicados, vacías y existentes', async () => {
    const m = multipart('demo.csv', csv);
    const r = await app.inject({ method: 'POST', url: '/api/importar/analizar', payload: m.cuerpo, headers: { cookie: cookieAdmin, 'content-type': m.tipo } });
    expect(r.statusCode).toBe(200);
    const a = r.json();
    const h = a.hojas[0];
    expect(h.filaEncabezado).toBe(2);
    expect(h.sugerida).toMatchObject({ sku: 0, categoria: 1, modelo: 2, generoTipo: 3, costo: 7 });
    paso = { id: a.id, hoja: h.nombre, filaEncabezado: h.filaEncabezado, asociacion: h.sugerida };
    const v = (await pedir('POST', '/importar/validar', paso)).json;
    const estado = (sku: string) => v.filas.filter((f: { sku: string }) => f.sku === sku).map((f: { estado: string }) => f.estado);
    expect(estado('IMP-1')).toEqual(['nuevo']);
    expect(estado('IMP-2')).toContain('duplicada');
    expect(estado('IMP-3')).toEqual(['nuevo']);
    expect(estado('IMP-4')).toEqual(['vacia']);
    expect(estado('DEMO-1')).toEqual(['actualiza']);
  });
  it('sin el permiso explícito no toca lo existente', async () => {
    const r = await pedir('POST', '/importar/confirmar', paso);
    expect(r.status).toBe(200);
    expect(r.json.actualizadas).toBe(0);
    const m = (await pedir('GET', '/catalogo/modelos?q=DEMO-1')).json[0];
    expect(m.costoMin).toBe(10000000);
    const imp = (await pedir('GET', '/catalogo/modelos?q=Importada')).json;
    expect(imp.length).toBe(1);
    expect(imp[0].genero).toBe('Mujer');
  });
});

describe('copias de seguridad', () => {
  it('crea una copia y la puede restaurar con confirmación', async () => {
    const b = await pedir('POST', '/backups');
    expect(b.status).toBe(200);
    await pedir('POST', '/catalogo/categorias', { nombre: 'Después del backup DEMO' });
    expect((await pedir('POST', '/backups/restaurar', { nombre: b.json.nombre, confirmacion: 'no' })).status).toBe(400);
    expect((await pedir('POST', '/backups/restaurar', { nombre: b.json.nombre, confirmacion: 'RESTAURAR' })).status).toBe(200);
    const aux = (await pedir('GET', '/catalogo/aux')).json;
    expect(aux.categorias.some((c: { nombre: string }) => c.nombre.includes('Después'))).toBe(false);
    const lista = (await pedir('GET', '/backups')).json.backups;
    expect(lista.some((x: { tipo: string }) => x.tipo === 'previo-restauracion')).toBe(true);
  });
});
