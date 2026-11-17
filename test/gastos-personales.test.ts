import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Base } from '../server/db/index.js';
import { sembrar } from '../server/services/semilla.js';
import { crearApp } from '../server/http/app.js';

/** Etapa 6: gastos personales separados de los del local (salen como retiro). Datos DEMO. */
let dir: string; let base: Base; let app: FastifyInstance; let cookie = '';
const pedir = async (metodo: string, url: string, cuerpo?: unknown) => {
  const r = await app.inject({ method: metodo as 'GET', url: '/api' + url, payload: cuerpo as object, headers: { cookie } });
  return { status: r.statusCode, json: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body };
};
type Cuenta = { id: number; nombre: string; saldoCentavos: number };
let cuentas: Record<string, number> = {};
const saldo = async (n: string) => ((await pedir('GET', '/cuentas')).json as Cuenta[]).find((c) => c.nombre === n)!.saldoCentavos;
let auto = 0; let lavado = 0; let alquiler = 0;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herencia-gp-'));
  base = new Base(path.join(dir, 'g.db'));
  base.tx((db) => sembrar(db));
  app = await crearApp({ base });
  await pedir('POST', '/setup', { nombre: 'Admin DEMO', usuario: 'admin', password: 'clave-demo-1' });
  cookie = String((await app.inject({ method: 'POST', url: '/api/login', payload: { usuario: 'admin', password: 'clave-demo-1' } })).headers['set-cookie']).split(';')[0];
  cuentas = Object.fromEntries(((await pedir('GET', '/cuentas')).json as Cuenta[]).map((c) => [c.nombre, c.id]));
  await pedir('POST', '/caja/saldo-inicial', { cuentaId: cuentas.Efectivo, fecha: '2026-11-01', importeCentavos: 10000000 });
  alquiler = ((await pedir('GET', '/gastos/categorias')).json as { id: number; nombre: string }[]).find((c) => c.nombre === 'Alquiler')!.id;
});
afterAll(async () => { await app.close(); base.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('gastos personales', () => {
  it('categorías personales aparte; las subcategorías heredan el tipo', async () => {
    auto = (await pedir('POST', '/gastos/categorias', { nombre: 'Auto DEMO', ambito: 'personal' })).json.id;
    lavado = (await pedir('POST', '/gastos/categorias', { nombre: 'Lavado DEMO', padreId: auto })).json.id;
    const cats = (await pedir('GET', '/gastos/categorias')).json as { id: number; ambito: string }[];
    expect(cats.find((c) => c.id === lavado)!.ambito).toBe('personal');
    expect(cats.find((c) => c.id === alquiler)!.ambito).toBe('negocio');
  });
  it('no se mezclan: un gasto del local no acepta categoría personal (ni al revés)', async () => {
    const g = await pedir('POST', '/gastos', { fecha: '2026-11-10', concepto: 'X', categoriaId: auto, importeCentavos: 1000, cuentaId: cuentas.Efectivo });
    expect(g.status).toBe(400);
    const p = await pedir('POST', '/gastos-personales', { fecha: '2026-11-10', descripcion: 'X', categoriaId: alquiler, importeCentavos: 1000, cuentaId: cuentas.Efectivo });
    expect(p.status).toBe(400);
  });
  it('pagado con plata del local: sale de la caja como retiro y no es gasto del local', async () => {
    const r = await pedir('POST', '/gastos-personales', { fecha: '2026-11-10', descripcion: 'Lavado de auto DEMO', categoriaId: auto, subcategoriaId: lavado, importeCentavos: 2400000, cuentaId: cuentas.Efectivo, notas: 'obs' });
    expect(r.status).toBe(200);
    expect(await saldo('Efectivo')).toBe(7600000);
    const caja = (await pedir('GET', '/caja/movimientos?tipo=retiro')).json;
    expect(caja.filas[0]).toMatchObject({ tipo: 'retiro', importeCentavos: -2400000, refTipo: 'gasto_personal' });
    expect((await pedir('GET', '/gastos?desde=2026-11-01')).json.totalCentavos).toBe(0);
    const res = (await pedir('GET', '/reportes/resultados?desde=2026-11&hasta=2026-11')).json.filas[0];
    expect(res).toMatchObject({ gastosCentavos: 0, retirosCentavos: 2400000 });
  });
  it('pagado por fuera: queda registrado sin mover la caja', async () => {
    await pedir('POST', '/gastos-personales', { fecha: '2026-11-11', descripcion: 'Seguro DEMO', categoriaId: auto, importeCentavos: 500000, cuentaId: null });
    expect(await saldo('Efectivo')).toBe(7600000);
    const l = (await pedir('GET', '/gastos-personales?desde=2026-11-01')).json;
    expect(l.totales).toMatchObject({ gastosCentavos: 2900000, conPlataDelLocalCentavos: 2400000, porFueraCentavos: 500000 });
    expect(l.filas).toHaveLength(2);
  });
  it('corregir el importe compensa el movimiento y registra el nuevo; anular devuelve la plata', async () => {
    const l = (await pedir('GET', '/gastos-personales?desde=2026-11-01')).json;
    const g = l.filas.find((x: { descripcion: string }) => x.descripcion === 'Lavado de auto DEMO');
    expect((await pedir('PUT', `/gastos-personales/${g.id}`, { ...g, importeCentavos: 2000000 })).status).toBe(400); // sin motivo
    expect((await pedir('PUT', `/gastos-personales/${g.id}`, { ...g, importeCentavos: 2000000, motivo: 'Era menos' })).status).toBe(200);
    expect(await saldo('Efectivo')).toBe(8000000);
    const res = (await pedir('GET', '/reportes/resultados?desde=2026-11&hasta=2026-11')).json.filas[0];
    expect(res.retirosCentavos).toBe(2000000);
    expect((await pedir('POST', `/gastos-personales/${g.id}/anular`, { motivo: 'Prueba DEMO' })).status).toBe(200);
    expect(await saldo('Efectivo')).toBe(10000000);
    expect((await pedir('GET', '/gastos-personales?desde=2026-11-01')).json.totales.gastosCentavos).toBe(500000);
    expect((await pedir('GET', '/gastos-personales?estado=anulado')).json.filas).toHaveLength(1);
  });
  it('los retiros sueltos de Caja se ven en la consulta', async () => {
    await pedir('POST', '/caja/retiros', { fecha: '2026-11-12', cuentaId: cuentas.Efectivo, importeCentavos: 100000, concepto: 'Corte de pelo DEMO' });
    const l = (await pedir('GET', '/gastos-personales?desde=2026-11-01')).json;
    expect(l.retiros).toEqual([expect.objectContaining({ concepto: 'Corte de pelo DEMO', importeCentavos: 100000 })]);
  });
  it('una categoría con gastos no cambia de tipo', async () => {
    expect((await pedir('PUT', `/gastos/categorias/${auto}`, { nombre: 'Auto DEMO', ambito: 'negocio' })).status).toBe(400);
  });
});
