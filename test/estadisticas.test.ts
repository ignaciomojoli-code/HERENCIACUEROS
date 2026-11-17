import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Base } from '../server/db/index.js';
import { sembrar } from '../server/services/semilla.js';
import { crearApp } from '../server/http/app.js';

/** Etapa 7: facturado vs cobrado vs disponible, situación de hoy y filtros de auditoría. Datos DEMO. */
let dir: string; let base: Base; let app: FastifyInstance; let cookie = '';
const pedir = async (metodo: string, url: string, cuerpo?: unknown, c = cookie) => {
  const r = await app.inject({ method: metodo as 'GET', url: '/api' + url, payload: cuerpo as object, headers: { cookie: c } });
  return { status: r.statusCode, json: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body };
};
type Cuenta = { id: number; nombre: string }; type Forma = { id: number; nombre: string };
let cuentas: Record<string, number> = {}; let formas: Record<string, number> = {};
let v1 = 0; let prov = 0; let cli = 0;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herencia-est-'));
  base = new Base(path.join(dir, 'e.db'));
  base.tx((db) => sembrar(db));
  app = await crearApp({ base });
  await pedir('POST', '/setup', { nombre: 'Admin DEMO', usuario: 'admin', password: 'clave-demo-1' }, '');
  cookie = String((await app.inject({ method: 'POST', url: '/api/login', payload: { usuario: 'admin', password: 'clave-demo-1' } })).headers['set-cookie']).split(';')[0];
  cuentas = Object.fromEntries(((await pedir('GET', '/cuentas')).json as Cuenta[]).map((c) => [c.nombre, c.id]));
  formas = Object.fromEntries(((await pedir('GET', '/formas-pago')).json as Forma[]).map((f) => [f.nombre, f.id]));
  const cat = (await pedir('POST', '/catalogo/categorias', { nombre: 'Camperas DEMO' })).json.id;
  const m = (await pedir('POST', '/catalogo/modelos', { modelo: { nombre: 'Campera DEMO', categoriaId: cat }, variantes: [{ sku: 'ES-1', costoCentavos: 10000000 }] })).json.id;
  v1 = (await pedir('GET', `/catalogo/modelos/${m}`)).json.variantes[0].id;
  await pedir('POST', '/stock/ajustes', { varianteId: v1, cantidad: 5, motivo: 'Carga DEMO' });
  prov = (await pedir('POST', '/proveedores', { nombre: 'Proveedor DEMO' })).json.id;
  cli = (await pedir('POST', '/clientes', { nombre: 'Cliente DEMO' })).json.id;
  // Efectivo 200.000, tarjeta 250.000 (a liquidar), y una venta de 200.000 con 50.000 cobrados (queda debiendo).
  await pedir('POST', '/ventas', { fecha: '2026-11-10', items: [{ varianteId: v1, cantidad: 1, precioCentavos: 20000000 }], pagos: [{ formaPagoId: formas.Efectivo, importeCentavos: 20000000 }] });
  await pedir('POST', '/ventas', { fecha: '2026-11-11', items: [{ varianteId: v1, cantidad: 1, precioCentavos: 25000000 }], pagos: [{ formaPagoId: formas['Crédito 1 pago · Mercado Pago'], importeCentavos: 25000000 }] });
  await pedir('POST', '/ventas', { fecha: '2026-11-12', clienteId: cli, items: [{ varianteId: v1, cantidad: 1, precioCentavos: 20000000 }], pagos: [{ formaPagoId: formas.Efectivo, importeCentavos: 5000000 }] });
  const alq = ((await pedir('GET', '/gastos/categorias')).json as { id: number; nombre: string }[]).find((c) => c.nombre === 'Alquiler')!.id;
  await pedir('POST', '/gastos', { fecha: '2026-11-13', concepto: 'Alquiler DEMO', categoriaId: alq, importeCentavos: 3000000, cuentaId: cuentas.Efectivo });
});
afterAll(async () => { await app.close(); base.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('facturado y plata', () => {
  it('separa lo vendido, lo cobrado, lo que está a liquidar y lo que falta cobrar', async () => {
    const r = await pedir('GET', '/estadisticas/plata?desde=2026-11-01&hasta=2026-11-30');
    expect(r.status).toBe(200);
    const d = r.json;
    expect(d.facturado).toMatchObject({ ventas: 3, totalCentavos: 65000000 });
    expect(d.cobro).toMatchObject({ cobradoCentavos: 50000000, aLiquidarCentavos: 25000000, pendienteCentavos: 15000000 });
    expect(d.disponible.totalCentavos).toBe(20000000 + 5000000 - 3000000);
    expect(d.disponible.aLiquidarCentavos).toBe(25000000);
    expect(d.flujo.entradas).toEqual([{ tipo: 'venta', importeCentavos: 50000000 }]);
    expect(d.flujo.salidas).toEqual([{ tipo: 'gasto', importeCentavos: 3000000 }]);
    expect(d.flujo.netoCentavos).toBe(47000000);
  });
});

describe('situación de hoy', () => {
  it('stock valorizado y deudas', async () => {
    const s = (await pedir('GET', '/estadisticas/situacion')).json;
    expect(s.productos).toMatchObject({ unidades: 2, valorCostoCentavos: 20000000, unidadesSinCosto: 0 });
    expect(s.deudas).toMatchObject({ clientesCentavos: 15000000, clientes: [{ cliente: 'Cliente DEMO', saldoCentavos: 15000000 }] });
    expect(s.compras.pedidosPorRecibir).toBe(0);
  });
  it('sin permiso de costos no viaja ningún valor a costo; sin caja, tampoco las deudas', async () => {
    const rol = (await pedir('POST', '/roles', { nombre: 'Panel DEMO', permisos: { panel: ['ver'] } })).json.id;
    await pedir('POST', '/usuarios', { nombre: 'Vendedor DEMO', usuario: 'panel', password: 'clave-demo-2', rolId: rol });
    const c = String((await app.inject({ method: 'POST', url: '/api/login', payload: { usuario: 'panel', password: 'clave-demo-2' } })).headers['set-cookie']).split(';')[0];
    const s = (await pedir('GET', '/estadisticas/situacion', undefined, c)).json;
    expect(JSON.stringify(s)).not.toMatch(/valor|costo/i);
    expect(s.deudas).toBeNull();
    expect((await pedir('GET', '/estadisticas/plata', undefined, c)).status).toBe(403);
  });
});

describe('auditoría', () => {
  it('filtra por módulo, usuario y acción', async () => {
    const op = (await pedir('GET', '/auditoria/opciones')).json;
    expect(op.modulos.map((m: { clave: string }) => m.clave)).toEqual(expect.arrayContaining(['ventas', 'gastos', 'catalogo']));
    expect(op.acciones).toContain('crear');
    const ventas = (await pedir('GET', '/auditoria?modulo=ventas&accion=crear')).json;
    expect(ventas.filas.every((f: { entidad: string }) => ['venta', 'cobro', 'cliente'].includes(f.entidad))).toBe(true);
    expect(ventas.filas.filter((f: { entidad: string }) => f.entidad === 'venta')).toHaveLength(3);
    expect(ventas.filas[0].entidadTexto).toBeTruthy();
    const admin = op.usuarios.find((u: { nombre: string }) => u.nombre === 'Admin DEMO').id;
    const otro = op.usuarios.find((u: { nombre: string }) => u.nombre === 'Vendedor DEMO').id;
    expect((await pedir('GET', `/auditoria?usuarioId=${admin}&modulo=gastos`)).json.total).toBe(1);
    expect((await pedir('GET', `/auditoria?usuarioId=${otro}&modulo=gastos`)).json.total).toBe(0);
  });
});
