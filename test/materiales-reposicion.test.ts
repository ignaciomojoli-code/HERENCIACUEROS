import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Base } from '../server/db/index.js';
import { sembrar } from '../server/services/semilla.js';
import { crearApp } from '../server/http/app.js';

/** Etapa 4: pedidos de materiales (recepción, costo, deuda) y reposición de materiales por receta. Datos DEMO. */
let dir: string; let base: Base; let app: FastifyInstance; let cookie = '';
const pedir = async (metodo: string, url: string, cuerpo?: unknown) => {
  const r = await app.inject({ method: metodo as 'GET', url: '/api' + url, payload: cuerpo as object, headers: { cookie } });
  return { status: r.statusCode, json: r.headers['content-type']?.toString().includes('json') ? r.json() : r.body };
};
let efectivo = 0; let curtiembre = 0; let avios = 0; let taller = 0; let cuero = 0; let forro = 0; let mo = 0; let modelo = 0; let vS = 0; let vT7 = 0;
type Fila = { materialId: number; stockMil: number; ventasMil: number; comprometidoMil: number; pedidoMil: number; borradorMil: number; faltanteMil: number; descartadoMil: number; aPedirMil: number; proveedorId: number | null; pospuestoHasta: string | null; sinConteo: boolean };
type Repo = { materiales: Fila[]; grupos: { proveedorId: number | null; items: Fila[] }[]; pospuestos: Fila[]; sinConteo: Fila[]; modelosSinReceta: string[] };
const repo = async () => (await pedir('GET', '/reposicion-materiales')).json as Repo;
const fila = async (id: number) => (await repo()).materiales.find((m) => m.materialId === id)!;
const stockMat = async (id: number) => (await pedir('GET', `/materiales/${id}`)).json.stockMil as number;
const material = async (id: number) => (await pedir('GET', `/materiales/${id}`)).json as { costoCentavos: number; stockMil: number };
const saldo = async (id: number) => ((await pedir('GET', '/proveedores/saldos')).json as Record<string, { saldoCentavos: number }>)[id]?.saldoCentavos ?? 0;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herencia-mat-'));
  base = new Base(path.join(dir, 'm.db'));
  base.tx((db) => sembrar(db));
  app = await crearApp({ base });
  await pedir('POST', '/setup', { nombre: 'Admin DEMO', usuario: 'admin', password: 'clave-demo-1' });
  cookie = String((await app.inject({ method: 'POST', url: '/api/login', payload: { usuario: 'admin', password: 'clave-demo-1' } })).headers['set-cookie']).split(';')[0];
  efectivo = ((await pedir('GET', '/formas-pago')).json as { id: number; nombre: string }[]).find((f) => f.nombre === 'Efectivo')!.id;
  curtiembre = (await pedir('POST', '/proveedores', { nombre: 'Curtiembre DEMO', rol: 'materiales', condicionPago: 'a_plazo', plazoPagoDias: 30 })).json.id;
  avios = (await pedir('POST', '/proveedores', { nombre: 'Avíos DEMO', rol: 'materiales', condicionPago: 'al_pedir' })).json.id;
  taller = (await pedir('POST', '/proveedores', { nombre: 'Taller DEMO', rol: 'taller' })).json.id;
  cuero = (await pedir('POST', '/materiales', { codigo: 'MD-1', nombre: 'Cuero DEMO', unidad: 'm', tipo: 'material', costoCentavos: 2000000, proveedorId: curtiembre })).json.id;
  forro = (await pedir('POST', '/materiales', { codigo: 'MD-2', nombre: 'Forro DEMO', unidad: 'm', tipo: 'material', costoCentavos: 100000, proveedorId: avios })).json.id;
  mo = (await pedir('POST', '/materiales', { codigo: 'MD-3', nombre: 'Confección DEMO', unidad: 'u', tipo: 'mano_obra', costoCentavos: 3800000, proveedorId: taller })).json.id;
  const cat = (await pedir('POST', '/catalogo/categorias', { nombre: 'Camperas DEMO' })).json.id;
  const tS = (await pedir('POST', '/catalogo/talles', { nombre: 'S' })).json.id;
  const t7 = (await pedir('POST', '/catalogo/talles', { nombre: '7' })).json.id;
  modelo = (await pedir('POST', '/catalogo/modelos', { modelo: { nombre: 'Campera DEMO', categoriaId: cat, proveedorId: taller }, variantes: [
    { sku: 'CD-S', talleId: tS, precios: { '1': 30000000 } }, { sku: 'CD-7', talleId: t7, precios: { '1': 30000000 } },
  ] })).json.id;
  const det = (await pedir('GET', `/catalogo/modelos/${modelo}`)).json;
  vS = det.variantes.find((v: { sku: string }) => v.sku === 'CD-S').id;
  vT7 = det.variantes.find((v: { sku: string }) => v.sku === 'CD-7').id;
  await pedir('PUT', `/recetas/${modelo}`, { lineas: [
    { materialId: cuero, cantidadMil: 1500 }, { materialId: forro, cantidadMil: 1000 }, { materialId: mo, cantidadMil: 1000 }, { materialId: cuero, cantidadMil: 350, talles: ['7'] },
  ] });
  for (const v of [vS, vT7]) await pedir('POST', '/stock/ajustes', { varianteId: v, cantidad: 5, motivo: 'Carga DEMO' });
  await pedir('POST', `/materiales/${cuero}/ajustes`, { fecha: '2026-11-01', cantidadMil: 2000, motivo: 'Conteo DEMO', tipo: 'inicial' });
});
afterAll(async () => { await app.close(); base.cerrar(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('pedido de materiales', () => {
  let pedido = 0;
  it('se arma con materiales (no productos) y valida las líneas', async () => {
    expect((await pedir('POST', '/compras', { proveedorId: curtiembre, tipo: 'materiales', fecha: '2026-11-17', items: [] })).status).toBe(400);
    expect((await pedir('POST', '/compras', { proveedorId: curtiembre, tipo: 'materiales', fecha: '2026-11-17', materiales: [{ materialId: mo, cantidadMil: 1000, costoUnitarioCentavos: 1 }] })).status).toBe(400);
    expect((await pedir('POST', '/compras', { proveedorId: curtiembre, tipo: 'reventa', fecha: '2026-11-17', items: [{ varianteId: vS, cantidad: 1, costoUnitarioCentavos: 1 }], materiales: [{ materialId: cuero, cantidadMil: 1000, costoUnitarioCentavos: 1 }] })).status).toBe(400);
    const r = await pedir('POST', '/compras', { proveedorId: curtiembre, tipo: 'materiales', fecha: '2026-11-17', confirmar: true, materiales: [{ materialId: cuero, cantidadMil: 10000, costoUnitarioCentavos: 2500000 }] });
    expect(r.status).toBe(200);
    pedido = r.json.id;
    const c = (await pedir('GET', `/compras/${pedido}`)).json;
    expect(c.tipo).toBe('materiales');
    expect(c.condicionPago).toBe('a_plazo'); // la habitual del proveedor
    expect(c.materiales).toMatchObject([{ materialId: cuero, cantidadMil: 10000, pendienteMil: 10000 }]);
    expect(c.totalCentavos).toBe(25000000);
    expect(c.estadoPedido).toBe('solicitado');
    expect((await fila(cuero)).pedidoMil).toBe(10000);
  });
  it('la entrega parcial suma al stock de materiales, recalcula el costo y genera la deuda una sola vez', async () => {
    const c = (await pedir('GET', `/compras/${pedido}`)).json;
    const saldoAntes = await saldo(curtiembre);
    const r = await pedir('POST', `/compras/${pedido}/recepciones`, { fecha: '2026-11-18', comprobante: 'R-DEMO-1', materiales: [{ compraMaterialId: c.materiales[0].id, cantidadMil: 4000 }] });
    expect(r.status).toBe(200);
    expect(r.json.pedidoCerrado).toBe(false);
    expect(await stockMat(cuero)).toBe(6000);
    // promedio: (2 m × 20.000 + 4 m × 25.000) / 6 m = 23.333,33
    expect((await material(cuero)).costoCentavos).toBe(2333333);
    const k = (await pedir('GET', `/compras/${pedido}`)).json;
    expect(k.estadoPedido).toBe('entrega_parcial');
    expect(k.recibidoCentavos).toBe(10000000);
    expect(k.aPagarCentavos).toBe(10000000);
    expect(k.vencimientoEfectivo).toBe('2026-12-18');
    expect(await saldo(curtiembre)).toBe(saldoAntes + 10000000); // no se cuenta dos veces (movimiento sin proveedor)
    const cc = (await pedir('GET', `/proveedores/${curtiembre}/cuenta-corriente`)).json;
    expect(cc.lineas.filter((l: { tipo: string }) => l.tipo === 'recepcion')).toHaveLength(1);
    expect(cc.lineas.filter((l: { tipo: string }) => l.tipo === 'material')).toHaveLength(0);
    // no se puede recibir más de lo pendiente
    expect((await pedir('POST', `/compras/${pedido}/recepciones`, { fecha: '2026-11-18', materiales: [{ compraMaterialId: c.materiales[0].id, cantidadMil: 7000 }] })).status).toBe(400);
    // el movimiento no se anula desde Materiales sino desde la recepción
    const mov = (await pedir('GET', `/materiales/${cuero}`)).json.movimientos.find((m: { refTipo: string | null }) => m.refTipo === 'recepcion');
    expect((await pedir('POST', `/materiales/movimientos/${mov.id}/anular`, { motivo: 'x' })).status).toBe(400);
  });
  it('anular la recepción devuelve stock, costo y deuda', async () => {
    const k = (await pedir('GET', `/compras/${pedido}`)).json;
    const saldoAntes = await saldo(curtiembre);
    const r = await pedir('POST', `/recepciones/${k.recepciones[0].id}/anular`, { motivo: 'Prueba DEMO' });
    expect(r.status).toBe(200);
    expect(r.json.costosARevisar).toEqual([]);
    expect(await stockMat(cuero)).toBe(2000);
    expect((await material(cuero)).costoCentavos).toBe(2000000);
    expect(await saldo(curtiembre)).toBe(saldoAntes - 10000000);
    expect((await pedir('GET', `/compras/${pedido}`)).json.estadoPedido).toBe('solicitado');
  });
  it('al recibir todo se cierra; se puede pagar e imputar como cualquier pedido', async () => {
    const c = (await pedir('GET', `/compras/${pedido}`)).json;
    const r = await pedir('POST', `/compras/${pedido}/recepciones`, { fecha: '2026-11-19', materiales: [{ compraMaterialId: c.materiales[0].id, cantidadMil: 10000 }] });
    expect(r.json.pedidoCerrado).toBe(true);
    await pedir('POST', '/caja/aportes', { fecha: '2026-11-01', cuentaId: ((await pedir('GET', '/cuentas')).json as { id: number; nombre: string }[]).find((x) => x.nombre === 'Efectivo')!.id, importeCentavos: 100000000, aportante: 'DEMO' });
    const cuenta = ((await pedir('GET', '/cuentas')).json as { id: number; nombre: string }[]).find((x) => x.nombre === 'Efectivo')!.id;
    const p = await pedir('POST', '/pagos-proveedores', { proveedorId: curtiembre, fecha: '2026-11-20', cuentaId: cuenta, importeCentavos: 25000000, imputaciones: [{ compraId: pedido, importeCentavos: 25000000 }] });
    expect(p.status).toBe(200);
    const k = (await pedir('GET', `/compras/${pedido}`)).json;
    expect(k.estadoPedido).toBe('entregado');
    expect(k.saldoCentavos).toBe(0);
    const lista = (await pedir('GET', `/compras?proveedorId=${curtiembre}&estadoPedido=entregado`)).json;
    expect(lista[0]).toMatchObject({ tipo: 'materiales', recibidoCentavos: 25000000, saldoCentavos: 0 });
  });
});

describe('reposición por receta', () => {
  it('una venta pide materiales según receta y talle (sin mano de obra)', async () => {
    const antes = await fila(cuero);
    await pedir('POST', '/ventas', { fecha: '2026-11-17', items: [{ varianteId: vS, cantidad: 1, precioCentavos: 30000000 }, { varianteId: vT7, cantidad: 1, precioCentavos: 30000000 }], pagos: [{ formaPagoId: efectivo, importeCentavos: 60000000 }] });
    const c = await fila(cuero);
    expect(c.ventasMil - antes.ventasMil).toBe(1500 + 1850);
    expect((await fila(forro)).ventasMil).toBe(2000);
    expect((await repo()).materiales.find((m) => m.materialId === mo)).toBeUndefined();
  });
  it('al encargar al taller pasa a comprometido (no se cuenta dos veces) y al entregar se descuenta del stock', async () => {
    const antes = await fila(cuero);
    const armado = (await pedir('POST', '/para-pedir/armar', { proveedorId: taller, tipo: 'confeccion' })).json;
    let c = await fila(cuero);
    expect(c.ventasMil).toBe(0);
    expect(c.comprometidoMil).toBe(antes.ventasMil);
    expect(c.faltanteMil).toBe(antes.faltanteMil);
    await pedir('POST', `/compras/${armado.compraId}/estado`, { accion: 'confirmar' });
    const k = (await pedir('GET', `/compras/${armado.compraId}`)).json;
    await pedir('POST', `/compras/${armado.compraId}/recepciones`, { fecha: '2026-11-20', items: k.items.map((i: { id: number; cantidad: number }) => ({ compraItemId: i.id, cantidad: i.cantidad })) });
    c = await fila(cuero);
    expect(c.comprometidoMil).toBe(0);
    expect(c.stockMil).toBe(antes.stockMil - antes.ventasMil);
    expect(c.faltanteMil).toBe(antes.faltanteMil);
  });
  it('sin conteo inicial no se sugiere nada (se lista aparte); con conteo se agrupa por proveedor', async () => {
    const f = await fila(forro);
    expect(f.sinConteo).toBe(true);
    expect(f.stockMil).toBe(-2000);
    let r = await repo();
    expect(r.grupos.some((g) => g.proveedorId === avios)).toBe(false);
    expect(r.sinConteo.map((m) => m.materialId)).toEqual([forro]);
    // conteo "hoy hay 0": agrega la diferencia contra el libro (+2 m) y queda como stock inicial
    const ct = await pedir('POST', `/materiales/${forro}/conteo`, { fecha: '2026-11-20', contadoMil: 0 });
    expect(ct.json).toMatchObject({ anteriorMil: -2000, contadoMil: 0, diferenciaMil: 2000 });
    expect(await stockMat(forro)).toBe(0);
    expect((await pedir('POST', `/materiales/${forro}/conteo`, { fecha: '2026-11-20', contadoMil: -1 })).status).toBe(400);
    r = await repo();
    expect(r.sinConteo).toEqual([]);
    expect(r.grupos.some((g) => g.proveedorId === avios)).toBe(false); // stock 0, no hace falta nada
  });
  it('mínimo, descartar, posponer y cambiar proveedor', async () => {
    await pedir('PUT', `/materiales/${forro}`, { codigo: 'MD-2', nombre: 'Forro DEMO', unidad: 'm', tipo: 'material', costoCentavos: 100000, proveedorId: avios, stockMinimoMil: 3500, motivo: 'Mínimo DEMO' });
    expect((await fila(forro)).faltanteMil).toBe(3500);
    expect((await repo()).grupos.find((g) => g.proveedorId === avios)!.items.map((i) => i.materialId)).toEqual([forro]);
    expect((await pedir('POST', '/reposicion-materiales/descartar', { materialId: forro, cantidadMil: 1500, motivo: '' })).status).toBe(400);
    await pedir('POST', '/reposicion-materiales/descartar', { materialId: forro, cantidadMil: 1500, motivo: 'Uso retazos' });
    expect((await fila(forro)).aPedirMil).toBe(2000);
    expect((await pedir('POST', '/reposicion-materiales/posponer', { materialId: forro, hasta: '2020-01-01' })).status).toBe(400);
    await pedir('POST', '/reposicion-materiales/posponer', { materialId: forro, hasta: '2099-01-01', motivo: 'Espero precio' });
    let r = await repo();
    expect(r.grupos.flatMap((g) => g.items).some((i) => i.materialId === forro)).toBe(false);
    expect(r.pospuestos.map((p) => p.materialId)).toEqual([forro]);
    const posp = (await fila(forro)) as Fila & { detalle?: unknown };
    expect(posp.pospuestoHasta).toBe('2099-01-01');
    const dec = ((await repo()).materiales.find((m) => m.materialId === forro) as unknown as { detalle: { decisiones: { id: number; tipo: string }[] } }).detalle.decisiones;
    await pedir('POST', `/reposicion-materiales/decisiones/${dec.find((d) => d.tipo === 'posponer')!.id}/anular`);
    await pedir('POST', '/reposicion-materiales/proveedor', { materialId: forro, proveedorId: curtiembre });
    r = await repo();
    expect(r.grupos.find((g) => g.proveedorId === curtiembre)!.items.map((i) => i.materialId)).toContain(forro);
  });
  it('armar el pedido crea un borrador de materiales, cubre la necesidad y al anularlo vuelve', async () => {
    const antes = await fila(forro);
    const a = await pedir('POST', '/reposicion-materiales/armar', { proveedorId: curtiembre, lineas: [{ materialId: forro, cantidadMil: antes.aPedirMil }] });
    expect(a.status).toBe(200);
    const c = (await pedir('GET', `/compras/${a.json.compraId}`)).json;
    expect(c).toMatchObject({ tipo: 'materiales', estado: 'borrador', proveedorId: curtiembre });
    expect(c.materiales[0]).toMatchObject({ materialId: forro, cantidadMil: 2000, costoUnitarioCentavos: 100000 });
    const f = await fila(forro);
    expect(f.borradorMil).toBe(2000);
    expect(f.aPedirMil).toBe(0);
    expect(f.descartadoMil).toBe(1500); // el descarte sigue: no se pide aunque se haya pedido el resto
    expect(f.proveedorId).toBe(avios); // el cambio de proveedor quedó usado por el pedido: vuelve al habitual
    await pedir('POST', `/compras/${a.json.compraId}/estado`, { accion: 'anular', motivo: 'Prueba DEMO' });
    const g = await fila(forro);
    expect(g.borradorMil).toBe(0);
    expect(g.aPedirMil).toBe(antes.aPedirMil);
    expect(g.proveedorId).toBe(curtiembre);
  });
  it('el texto para WhatsApp lista lo que hay que pedir', async () => {
    const r = await pedir('GET', `/reposicion-materiales/texto?proveedorId=${curtiembre}`);
    expect(r.status).toBe(200);
    const t = r.json.texto as string;
    expect(t).toContain('Curtiembre DEMO');
    expect(t).toContain('2 m de Forro DEMO');
  });
  it('el descarte se cierra solo cuando ya no falta nada', async () => {
    await pedir('POST', `/materiales/${forro}/ajustes`, { fecha: '2026-11-21', cantidadMil: 10000, motivo: 'Conteo DEMO', tipo: 'inicial' });
    const f = await fila(forro);
    expect(f.faltanteMil).toBe(0);
    expect(f.sinConteo).toBe(false);
    await pedir('POST', `/materiales/${forro}/ajustes`, { fecha: '2026-11-22', cantidadMil: -10000, motivo: 'Se usó DEMO' });
    expect((await fila(forro)).descartadoMil).toBe(0);
    expect((await fila(forro)).aPedirMil).toBe(3500);
  });
});
