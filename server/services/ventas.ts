/**
 * Ventas: descuentan stock, registran los cobros en caja y guardan una foto del costo para calcular la ganancia.
 * Una venta no se edita ni se borra: se anula (devuelve el stock y revierte la plata) y se carga de nuevo.
 *
 * Comisiones: si la plata entra a una cuenta común (ej. QR de Mercado Pago), la comisión estimada se descuenta
 * en el momento. Si entra a "tarjetas a liquidar", la comisión real aparece al cargar la liquidación.
 */
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { colores, cuentas, formasPago, listasPrecio, modelos, movimientosStock, precios, talles, variantes, ventaItems, ventaPagos, ventas } from '../db/schema.js';
import type { DB } from '../db/index.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { siguienteNumero } from './numeracion.js';
import { registrarMovimiento, type Ctx } from './stock.js';
import { cuentaOError, hoyLocal, registrarCaja, revertirMovimientos } from './caja.js';

export interface DatosVenta {
  fecha: string; cliente?: string | null; listaPrecioId?: number | null; notas?: string | null;
  items: { varianteId: number; cantidad: number; precioCentavos: number }[];
  pagos: { formaPagoId: number; importeCentavos: number; importeMonedaCentavos?: number | null; comisionRealCentavos?: number | null }[];
}

const costoTotal = sql<number | null>`case when ${variantes.costoCentavos} is null then null else ${variantes.costoCentavos} + ${variantes.costoLogisticoCentavos} + ${variantes.costoAdicionalCentavos} end`;

export const comisionEstimada = (importe: number, bp: number) => Math.round((importe * bp) / 10000);

export function crearVenta(ctx: Ctx, d: DatosVenta) {
  if (!d.items.length) throw new ErrorNegocio('Agregá al menos un producto');
  if (!d.pagos.length) throw new ErrorNegocio('Indicá cómo se cobró');
  const ids = [...new Set(d.items.map((i) => i.varianteId))];
  if (ids.length !== d.items.length) throw new ErrorNegocio('Hay un producto repetido: juntá las cantidades en una sola línea');
  for (const i of d.items) {
    if (!Number.isInteger(i.cantidad) || i.cantidad <= 0) throw new ErrorNegocio('Las cantidades tienen que ser enteros mayores a cero');
    if (!Number.isInteger(i.precioCentavos) || i.precioCentavos < 0) throw new ErrorNegocio('Precio inválido');
  }
  const vars = ctx.db.select({ id: variantes.id, sku: variantes.sku, activo: variantes.activo, costo: costoTotal }).from(variantes).where(inArray(variantes.id, ids)).all();
  if (vars.length !== ids.length) throw new ErrorNegocio('Hay productos que no existen en el catálogo');
  const listaId = d.listaPrecioId ?? null;
  if (listaId && !ctx.db.select({ id: listasPrecio.id }).from(listasPrecio).where(eq(listasPrecio.id, listaId)).get()) throw noEncontrado('La lista de precios');
  const preciosLista = listaId ? new Map(ctx.db.select().from(precios).where(and(eq(precios.listaId, listaId), inArray(precios.varianteId, ids))).all().map((p) => [p.varianteId, p.precioCentavos])) : new Map<number, number>();

  const total = d.items.reduce((s, i) => s + i.cantidad * i.precioCentavos, 0);
  const formas = ctx.db.select({ f: formasPago, c: cuentas }).from(formasPago).innerJoin(cuentas, eq(cuentas.id, formasPago.cuentaId))
    .where(inArray(formasPago.id, [...new Set(d.pagos.map((p) => p.formaPagoId))])).all();
  const pagos = d.pagos.map((p) => {
    const fc = formas.find((x) => x.f.id === p.formaPagoId);
    if (!fc) throw noEncontrado('La forma de pago');
    if (!fc.f.activo) throw new ErrorNegocio(`La forma de pago ${fc.f.nombre} está inactiva`);
    if (!Number.isInteger(p.importeCentavos) || p.importeCentavos <= 0) throw new ErrorNegocio('Los importes cobrados tienen que ser mayores a cero');
    if (fc.c.moneda !== 'ARS' && !(p.importeMonedaCentavos && p.importeMonedaCentavos > 0)) throw new ErrorNegocio(`Indicá cuántos ${fc.c.moneda} se cobraron`);
    if (p.comisionRealCentavos != null && (p.comisionRealCentavos < 0 || p.comisionRealCentavos > p.importeCentavos)) throw new ErrorNegocio('Comisión real inválida');
    return { ...p, forma: fc.f, cuenta: fc.c, comision: comisionEstimada(p.importeCentavos, fc.f.comisionBp) };
  });
  const cobrado = pagos.reduce((s, p) => s + p.importeCentavos, 0);
  if (cobrado !== total) throw new ErrorNegocio(`Lo cobrado (${(cobrado / 100).toLocaleString('es-AR')}) no coincide con el total de la venta (${(total / 100).toLocaleString('es-AR')})`);

  const t = ahora();
  const v = ctx.db.insert(ventas).values({
    numero: siguienteNumero(ctx.db, 'venta'), fecha: d.fecha, cliente: d.cliente?.trim() || null, listaPrecioId: listaId, notas: d.notas?.trim() || null,
    usuarioId: ctx.usuarioId, creadoEn: t, actualizadoEn: t,
  }).returning().get();
  for (const i of d.items) {
    const vr = vars.find((x) => x.id === i.varianteId)!;
    ctx.db.insert(ventaItems).values({ ventaId: v.id, varianteId: i.varianteId, cantidad: i.cantidad, precioListaCentavos: preciosLista.get(i.varianteId) ?? null, precioCentavos: i.precioCentavos, costoUnitarioCentavos: vr.costo === null ? null : Number(vr.costo) }).run();
    registrarMovimiento(ctx, { varianteId: i.varianteId, cantidad: -i.cantidad, tipo: 'venta', fecha: d.fecha, refTipo: 'venta', refId: v.id, costoUnitarioCentavos: vr.costo === null ? null : Number(vr.costo), motivo: `Venta V-${v.numero}` });
  }
  for (const p of pagos) {
    ctx.db.insert(ventaPagos).values({ ventaId: v.id, formaPagoId: p.forma.id, cuentaId: p.cuenta.id, importeCentavos: p.importeCentavos, importeMonedaCentavos: p.cuenta.moneda === 'ARS' ? null : p.importeMonedaCentavos!, comisionEstimadaCentavos: p.comision, comisionRealCentavos: p.comisionRealCentavos ?? null }).run();
    registrarCaja(ctx, {
      fecha: d.fecha, cuentaId: p.cuenta.id, importeCentavos: p.cuenta.moneda === 'ARS' ? p.importeCentavos : p.importeMonedaCentavos!, importeArsCentavos: p.importeCentavos,
      tipo: 'venta', concepto: `Venta V-${v.numero} · ${p.forma.nombre}`, refTipo: 'venta', refId: v.id,
    });
    const comision = p.comisionRealCentavos ?? p.comision;
    if (comision > 0 && p.cuenta.tipo !== 'a_liquidar' && p.cuenta.moneda === 'ARS') {
      registrarCaja(ctx, { fecha: d.fecha, cuentaId: p.cuenta.id, importeCentavos: -comision, tipo: 'comision', concepto: `Comisión venta V-${v.numero} · ${p.forma.nombre}`, refTipo: 'venta', refId: v.id });
    }
  }
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: 'venta', entidadId: v.id, despues: { numero: v.numero, fecha: d.fecha, totalCentavos: total, items: d.items, pagos: d.pagos } });
  return { id: v.id, numero: v.numero, totalCentavos: total };
}

/** Anula una venta: el stock vuelve (movimiento de anulación) y la plata se revierte en caja. */
export function anularVenta(ctx: Ctx, id: number, motivo: string) {
  if (!motivo?.trim()) throw new ErrorNegocio('Indicá el motivo de la anulación');
  const v = ctx.db.select().from(ventas).where(eq(ventas.id, id)).get();
  if (!v) throw noEncontrado('La venta');
  if (v.estado === 'anulada') throw new ErrorNegocio('La venta ya está anulada');
  const movs = ctx.db.select().from(movimientosStock).where(and(eq(movimientosStock.refTipo, 'venta'), eq(movimientosStock.refId, id), eq(movimientosStock.tipo, 'venta'))).all();
  const fecha = hoyLocal();
  for (const m of movs) {
    registrarMovimiento(ctx, { varianteId: m.varianteId, cantidad: -m.cantidad, tipo: 'anulacion', anulaId: m.id, refTipo: 'venta', refId: id, costoUnitarioCentavos: m.costoUnitarioCentavos, fecha, motivo: `Anula venta V-${v.numero}: ${motivo.trim()}` });
  }
  revertirMovimientos(ctx, { refTipo: 'venta', refId: id }, `venta V-${v.numero} anulada: ${motivo.trim()}`, fecha);
  ctx.db.update(ventas).set({ estado: 'anulada', motivoAnulacion: motivo.trim(), actualizadoEn: ahora() }).where(eq(ventas.id, id)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'anular', entidad: 'venta', entidadId: id, detalle: motivo });
  return { ok: true };
}

/**
 * Carga la comisión real de un cobro (ej. al ver lo que descontó Mercado Pago). Si la plata entró a una cuenta
 * común, la diferencia con lo ya descontado se registra en caja; si fue "a liquidar", solo corrige la ganancia.
 */
export function cargarComisionReal(ctx: Ctx, pagoId: number, realCentavos: number | null) {
  const p = ctx.db.select().from(ventaPagos).where(eq(ventaPagos.id, pagoId)).get();
  if (!p) throw noEncontrado('El cobro');
  const v = ctx.db.select().from(ventas).where(eq(ventas.id, p.ventaId)).get()!;
  if (v.estado === 'anulada') throw new ErrorNegocio('La venta está anulada');
  if (realCentavos !== null && (!Number.isInteger(realCentavos) || realCentavos < 0 || realCentavos > p.importeCentavos)) throw new ErrorNegocio('Comisión inválida');
  const c = cuentaOError(ctx.db, p.cuentaId, { activa: false });
  const antes = p.comisionRealCentavos ?? p.comisionEstimadaCentavos;
  const despues = realCentavos ?? p.comisionEstimadaCentavos;
  if (c.tipo !== 'a_liquidar' && c.moneda === 'ARS' && antes !== despues) {
    registrarCaja(ctx, { fecha: hoyLocal(), cuentaId: c.id, importeCentavos: antes - despues, tipo: 'comision', concepto: `Corrección de comisión venta V-${v.numero}`, refTipo: 'venta', refId: v.id });
  }
  ctx.db.update(ventaPagos).set({ comisionRealCentavos: realCentavos }).where(eq(ventaPagos.id, pagoId)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'venta', entidadId: v.id, antes: { comisionCentavos: antes }, despues: { comisionCentavos: despues }, detalle: `Comisión real del cobro ${pagoId}` });
  return { comisionCentavos: despues };
}

/** Datos de la venta con totales: lista, cobrado, descuento, costo, comisión y ganancia (null si falta algún costo). */
export function obtenerVenta(db: DB, id: number) {
  const v = db.select().from(ventas).where(eq(ventas.id, id)).get();
  if (!v) throw noEncontrado('La venta');
  const items = db.select({ i: ventaItems, sku: variantes.sku, modelo: modelos.nombre, modeloId: modelos.id, color: colores.nombre, talle: talles.nombre })
    .from(ventaItems).innerJoin(variantes, eq(variantes.id, ventaItems.varianteId)).innerJoin(modelos, eq(modelos.id, variantes.modeloId))
    .leftJoin(colores, eq(colores.id, variantes.colorId)).leftJoin(talles, eq(talles.id, variantes.talleId))
    .where(eq(ventaItems.ventaId, id)).orderBy(ventaItems.id).all()
    .map((r) => ({ ...r.i, sku: r.sku, modelo: r.modelo, modeloId: r.modeloId, color: r.color, talle: r.talle }));
  const pagos = db.select({ p: ventaPagos, forma: formasPago.nombre, cuenta: cuentas.nombre, moneda: cuentas.moneda, tipoCuenta: cuentas.tipo })
    .from(ventaPagos).innerJoin(formasPago, eq(formasPago.id, ventaPagos.formaPagoId)).innerJoin(cuentas, eq(cuentas.id, ventaPagos.cuentaId))
    .where(eq(ventaPagos.ventaId, id)).orderBy(ventaPagos.id).all()
    .map((r) => ({ ...r.p, forma: r.forma, cuenta: r.cuenta, moneda: r.moneda, tipoCuenta: r.tipoCuenta }));
  const lista = v.listaPrecioId ? db.select({ nombre: listasPrecio.nombre }).from(listasPrecio).where(eq(listasPrecio.id, v.listaPrecioId)).get()?.nombre ?? null : null;
  return { ...v, lista, items, pagos, ...totalesVenta(items, pagos) };
}

function totalesVenta(items: { cantidad: number; precioCentavos: number; precioListaCentavos: number | null; costoUnitarioCentavos: number | null }[], pagos: { comisionEstimadaCentavos: number; comisionRealCentavos: number | null }[]) {
  const totalCentavos = items.reduce((s, i) => s + i.cantidad * i.precioCentavos, 0);
  const listaCentavos = items.every((i) => i.precioListaCentavos !== null) ? items.reduce((s, i) => s + i.cantidad * i.precioListaCentavos!, 0) : null;
  const sinCosto = items.some((i) => i.costoUnitarioCentavos === null);
  const costoMercaderiaCentavos = sinCosto ? null : items.reduce((s, i) => s + i.cantidad * i.costoUnitarioCentavos!, 0);
  const comisionCentavos = pagos.reduce((s, p) => s + (p.comisionRealCentavos ?? p.comisionEstimadaCentavos), 0);
  return {
    totalCentavos, listaCentavos, diferenciaListaCentavos: listaCentavos === null ? null : totalCentavos - listaCentavos,
    costoMercaderiaCentavos, comisionCentavos, gananciaCentavos: costoMercaderiaCentavos === null ? null : totalCentavos - costoMercaderiaCentavos - comisionCentavos,
    unidades: items.reduce((s, i) => s + i.cantidad, 0),
  };
}

export interface FiltroVentas { desde?: string; hasta?: string; q?: string; formaPagoId?: number; estado?: 'confirmada' | 'anulada'; pagina?: number; porPagina?: number }

export function listarVentas(db: DB, f: FiltroVentas) {
  const conds = [];
  if (f.desde) conds.push(gte(ventas.fecha, f.desde));
  if (f.hasta) conds.push(lte(ventas.fecha, f.hasta));
  if (f.estado) conds.push(eq(ventas.estado, f.estado));
  if (f.formaPagoId) conds.push(sql`exists (select 1 from venta_pagos vp where vp.venta_id = ${ventas.id} and vp.forma_pago_id = ${f.formaPagoId})`);
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    conds.push(sql`(${ventas.cliente} like ${q} or ${ventas.notas} like ${q} or cast(${ventas.numero} as text) = ${f.q.trim().replace(/^v-?/i, '')}
      or exists (select 1 from venta_items vi join variantes va on va.id = vi.variante_id join modelos mo on mo.id = va.modelo_id where vi.venta_id = ${ventas.id} and (va.sku like ${q} or mo.nombre like ${q})))`);
  }
  const where = conds.length ? and(...conds) : undefined;
  const lista = db.select().from(ventas).where(where).orderBy(desc(ventas.fecha), desc(ventas.numero)).all();
  const ids = lista.map((v) => v.id);
  const items = ids.length ? db.select({ i: ventaItems, sku: variantes.sku, modelo: modelos.nombre }).from(ventaItems).innerJoin(variantes, eq(variantes.id, ventaItems.varianteId)).innerJoin(modelos, eq(modelos.id, variantes.modeloId)).where(inArray(ventaItems.ventaId, ids)).all() : [];
  const pagos = ids.length ? db.select({ p: ventaPagos, forma: formasPago.nombre }).from(ventaPagos).innerJoin(formasPago, eq(formasPago.id, ventaPagos.formaPagoId)).where(inArray(ventaPagos.ventaId, ids)).all() : [];
  const filas = lista.map((v) => {
    const its = items.filter((x) => x.i.ventaId === v.id);
    const pgs = pagos.filter((x) => x.p.ventaId === v.id);
    return {
      ...v, ...totalesVenta(its.map((x) => x.i), pgs.map((x) => x.p)),
      productos: its.map((x) => `${x.modelo}${x.i.cantidad > 1 ? ` ×${x.i.cantidad}` : ''}`).join(', '), skus: its.map((x) => x.sku).join(', '),
      formas: [...new Set(pgs.map((x) => x.forma))].join(' + '),
    };
  });
  const validas = filas.filter((v) => v.estado === 'confirmada');
  const resumen = {
    ventas: validas.length,
    unidades: validas.reduce((s, v) => s + v.unidades, 0),
    totalCentavos: validas.reduce((s, v) => s + v.totalCentavos, 0),
    comisionCentavos: validas.reduce((s, v) => s + v.comisionCentavos, 0),
    costoMercaderiaCentavos: validas.reduce((s, v) => s + (v.costoMercaderiaCentavos ?? 0), 0),
    gananciaCentavos: validas.reduce((s, v) => s + (v.gananciaCentavos ?? 0), 0),
    sinCosto: validas.filter((v) => v.costoMercaderiaCentavos === null).length,
    ticketPromedioCentavos: validas.length ? Math.round(validas.reduce((s, v) => s + v.totalCentavos, 0) / validas.length) : 0,
  };
  const porPagina = f.porPagina ?? 100;
  const desde = ((f.pagina ?? 1) - 1) * porPagina;
  return { total: filas.length, resumen, filas: filas.slice(desde, desde + porPagina) };
}

/** Precio de lista de cada variante en una lista (para armar la venta). */
export function preciosDeLista(db: DB, listaId: number, varianteIds: number[]) {
  if (!varianteIds.length) return {};
  return Object.fromEntries(db.select().from(precios).where(and(eq(precios.listaId, listaId), inArray(precios.varianteId, varianteIds))).all().map((p) => [p.varianteId, p.precioCentavos]));
}

