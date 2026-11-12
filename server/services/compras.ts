/**
 * Compras a proveedores y talleres: pedido → recepciones (totales o parciales) → stock.
 * Las recepciones de reventa actualizan el costo por promedio ponderado; las de confección (taller) no,
 * porque ahí se paga la mano de obra y el costo del producto se arma con materiales + confección.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { colores, compraItems, compras, historialCostos, modelos, movimientosStock, proveedores, recepciones, recepcionItems, talles, variantes } from '../db/schema.js';
import type { DB } from '../db/index.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { siguienteNumero } from './numeracion.js';
import { registrarMovimiento, stockDeUna, type Ctx } from './stock.js';

export interface ItemCompra { varianteId: number; cantidad: number; costoUnitarioCentavos: number; notas?: string | null }
export interface DatosCompra { proveedorId: number; tipo: 'reventa' | 'confeccion'; fecha: string; fechaEsperada?: string | null; notas?: string | null; items: ItemCompra[] }

function validarItems(db: DB, items: ItemCompra[]) {
  if (!items.length) throw new ErrorNegocio('Agregá al menos un producto');
  const ids = [...new Set(items.map((i) => i.varianteId))];
  if (ids.length !== items.length) throw new ErrorNegocio('Hay un producto repetido en el pedido: juntá las cantidades en una sola línea');
  const existentes = db.select({ id: variantes.id }).from(variantes).where(inArray(variantes.id, ids)).all();
  if (existentes.length !== ids.length) throw new ErrorNegocio('Hay productos que no existen en el catálogo');
  for (const i of items) {
    if (!Number.isInteger(i.cantidad) || i.cantidad <= 0) throw new ErrorNegocio('Las cantidades tienen que ser enteros mayores a cero');
    if (!Number.isInteger(i.costoUnitarioCentavos) || i.costoUnitarioCentavos < 0) throw new ErrorNegocio('Costo unitario inválido');
  }
}

function validarProveedor(db: DB, id: number) {
  const p = db.select().from(proveedores).where(eq(proveedores.id, id)).get();
  if (!p) throw noEncontrado('El proveedor');
  if (!p.activo) throw new ErrorNegocio(`${p.nombre} está inactivo`);
  return p;
}

export function crearCompra(ctx: Ctx, d: DatosCompra, confirmar = false) {
  validarProveedor(ctx.db, d.proveedorId);
  validarItems(ctx.db, d.items);
  const t = ahora();
  const c = ctx.db.insert(compras).values({
    numero: siguienteNumero(ctx.db, 'compra'), proveedorId: d.proveedorId, tipo: d.tipo, fecha: d.fecha, fechaEsperada: d.fechaEsperada ?? null,
    notas: d.notas ?? null, estado: confirmar ? 'confirmada' : 'borrador', usuarioId: ctx.usuarioId, creadoEn: t, actualizadoEn: t,
  }).returning().get();
  ctx.db.insert(compraItems).values(d.items.map((i) => ({ compraId: c.id, varianteId: i.varianteId, cantidad: i.cantidad, costoUnitarioCentavos: i.costoUnitarioCentavos, notas: i.notas ?? null }))).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: 'compra', entidadId: c.id, despues: { ...c, items: d.items } });
  return c;
}

function compraOError(db: DB, id: number) {
  const c = db.select().from(compras).where(eq(compras.id, id)).get();
  if (!c) throw noEncontrado('El pedido');
  return c;
}

/** Solo un borrador se puede editar; una vez confirmado, los cambios se hacen con recepciones o cerrándolo. */
export function actualizarCompra(ctx: Ctx, id: number, d: DatosCompra) {
  const antes = compraOError(ctx.db, id);
  if (antes.estado !== 'borrador') throw new ErrorNegocio('Solo se puede editar un pedido en borrador');
  validarProveedor(ctx.db, d.proveedorId);
  validarItems(ctx.db, d.items);
  const itemsAntes = ctx.db.select().from(compraItems).where(eq(compraItems.compraId, id)).all();
  ctx.db.delete(compraItems).where(eq(compraItems.compraId, id)).run(); // borrador: todavía no es una operación registrada
  ctx.db.insert(compraItems).values(d.items.map((i) => ({ compraId: id, varianteId: i.varianteId, cantidad: i.cantidad, costoUnitarioCentavos: i.costoUnitarioCentavos, notas: i.notas ?? null }))).run();
  const despues = ctx.db.update(compras).set({ proveedorId: d.proveedorId, tipo: d.tipo, fecha: d.fecha, fechaEsperada: d.fechaEsperada ?? null, notas: d.notas ?? null, actualizadoEn: ahora() }).where(eq(compras.id, id)).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'compra', entidadId: id, antes: { ...antes, items: itemsAntes }, despues: { ...despues, items: d.items } });
  return despues;
}

export function cambiarEstadoCompra(ctx: Ctx, id: number, accion: 'confirmar' | 'cerrar' | 'anular', motivo?: string) {
  const c = compraOError(ctx.db, id);
  const activas = ctx.db.select({ id: recepciones.id }).from(recepciones).where(and(eq(recepciones.compraId, id), eq(recepciones.estado, 'activa'))).all();
  let estado: typeof c.estado;
  if (accion === 'confirmar') {
    if (c.estado !== 'borrador') throw new ErrorNegocio('Solo se confirma un borrador');
    estado = 'confirmada';
  } else if (accion === 'cerrar') {
    if (c.estado !== 'confirmada') throw new ErrorNegocio('Solo se puede cerrar un pedido confirmado');
    if (!motivo?.trim()) throw new ErrorNegocio('Indicá por qué se cierra con unidades pendientes');
    estado = 'cerrada';
  } else {
    if (c.estado === 'anulada') throw new ErrorNegocio('El pedido ya está anulado');
    if (activas.length) throw new ErrorNegocio('El pedido tiene recepciones: anulá primero las recepciones o cerralo');
    if (!motivo?.trim()) throw new ErrorNegocio('Indicá el motivo de la anulación');
    estado = 'anulada';
  }
  const despues = ctx.db.update(compras).set({ estado, actualizadoEn: ahora() }).where(eq(compras.id, id)).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: accion === 'anular' ? 'anular' : 'modificar', entidad: 'compra', entidadId: id, antes: { estado: c.estado }, despues: { estado }, detalle: motivo });
  return despues;
}

/** Unidades recibidas (en recepciones activas) por ítem del pedido. */
function recibidoPorItem(db: DB, compraId: number) {
  const filas = db.select({ item: recepcionItems.compraItemId, n: sql<number>`sum(${recepcionItems.cantidad})` })
    .from(recepcionItems).innerJoin(recepciones, eq(recepciones.id, recepcionItems.recepcionId))
    .where(and(eq(recepciones.compraId, compraId), eq(recepciones.estado, 'activa'))).groupBy(recepcionItems.compraItemId).all();
  return new Map(filas.map((f) => [f.item, Number(f.n)]));
}

export interface DatosRecepcion { fecha: string; comprobante?: string | null; notas?: string | null; items: { compraItemId: number; cantidad: number; costoUnitarioCentavos?: number }[] }

export function recibir(ctx: Ctx, compraId: number, d: DatosRecepcion) {
  const c = compraOError(ctx.db, compraId);
  if (c.estado !== 'confirmada') throw new ErrorNegocio(c.estado === 'borrador' ? 'Confirmá el pedido antes de recibir' : `El pedido está ${c.estado}: no se puede recibir`);
  const items = ctx.db.select().from(compraItems).where(eq(compraItems.compraId, compraId)).all();
  const recibido = recibidoPorItem(ctx.db, compraId);
  const lineas = d.items.filter((i) => i.cantidad > 0);
  if (!lineas.length) throw new ErrorNegocio('No hay cantidades para recibir');
  const t = ahora();
  const rec = ctx.db.insert(recepciones).values({
    numero: siguienteNumero(ctx.db, 'recepcion'), compraId, fecha: d.fecha, comprobante: d.comprobante ?? null, notas: d.notas ?? null,
    usuarioId: ctx.usuarioId, creadoEn: t, actualizadoEn: t,
  }).returning().get();
  const cambiosCosto: { sku: string; antes: number | null; despues: number }[] = [];
  for (const l of lineas) {
    const it = items.find((i) => i.id === l.compraItemId);
    if (!it) throw new ErrorNegocio('Hay una línea que no pertenece a este pedido');
    if (!Number.isInteger(l.cantidad) || l.cantidad < 0) throw new ErrorNegocio('Cantidad inválida');
    const pendiente = it.cantidad - (recibido.get(it.id) ?? 0);
    if (l.cantidad > pendiente) throw new ErrorNegocio(`Se quieren recibir ${l.cantidad} y quedan ${pendiente} pendientes de esa línea. Si vino de más, agregalo al pedido como otra línea.`);
    const costo = l.costoUnitarioCentavos ?? it.costoUnitarioCentavos;
    if (!Number.isInteger(costo) || costo < 0) throw new ErrorNegocio('Costo unitario inválido');
    ctx.db.insert(recepcionItems).values({ recepcionId: rec.id, compraItemId: it.id, varianteId: it.varianteId, cantidad: l.cantidad, costoUnitarioCentavos: costo }).run();
    if (c.tipo === 'reventa') {
      const cambio = actualizarCostoPromedio(ctx, it.varianteId, l.cantidad, costo, rec.id, rec.numero);
      if (cambio) cambiosCosto.push(cambio);
    }
    registrarMovimiento(ctx, {
      varianteId: it.varianteId, cantidad: l.cantidad, tipo: 'compra', fecha: d.fecha, refTipo: 'recepcion', refId: rec.id,
      costoUnitarioCentavos: c.tipo === 'reventa' ? costo : undefined, motivo: `Recepción R-${rec.numero} · pedido P-${c.numero}`,
    });
  }
  const quedan = items.reduce((s, i) => s + i.cantidad - (recibido.get(i.id) ?? 0), 0) - lineas.reduce((s, l) => s + l.cantidad, 0);
  if (quedan === 0) ctx.db.update(compras).set({ estado: 'cerrada', actualizadoEn: t }).where(eq(compras.id, compraId)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'recibir', entidad: 'compra', entidadId: compraId, despues: { recepcion: rec.numero, items: lineas, cambiosCosto }, detalle: d.comprobante ? `Comprobante ${d.comprobante}` : undefined });
  return { recepcionId: rec.id, numero: rec.numero, pedidoCerrado: quedan === 0, cambiosCosto };
}

/** Costo promedio ponderado: (stock × costo actual + recibido × costo nuevo) / (stock + recibido). */
export function costoPromedio(stockPrevio: number, costoPrevio: number | null, cantidad: number, costo: number) {
  if (costoPrevio === null || stockPrevio <= 0) return costo;
  return Math.round((stockPrevio * costoPrevio + cantidad * costo) / (stockPrevio + cantidad));
}

function actualizarCostoPromedio(ctx: Ctx, varianteId: number, cantidad: number, costo: number, recepcionId: number, numero: number) {
  const v = ctx.db.select().from(variantes).where(eq(variantes.id, varianteId)).get()!;
  const nuevo = costoPromedio(stockDeUna(ctx.db, varianteId), v.costoCentavos, cantidad, costo);
  if (nuevo === v.costoCentavos) return null;
  const t = ahora();
  ctx.db.update(variantes).set({ costoCentavos: nuevo, actualizadoEn: t }).where(eq(variantes.id, varianteId)).run();
  ctx.db.insert(historialCostos).values({ varianteId, anteriorCentavos: v.costoCentavos, nuevoCentavos: nuevo, fecha: t, usuarioId: ctx.usuarioId, origen: 'compra', motivo: `Promedio ponderado, recepción R-${numero}`, refTipo: 'recepcion', refId: recepcionId }).run();
  return { sku: v.sku, antes: v.costoCentavos, despues: nuevo };
}

/**
 * Anula una recepción: agrega los movimientos contrarios (no borra nada). Si el costo de una variante
 * todavía es el que dejó esta recepción, vuelve al anterior; si después hubo otros cambios, lo informa
 * para que se revise a mano.
 */
export function anularRecepcion(ctx: Ctx, recepcionId: number, motivo: string) {
  if (!motivo?.trim()) throw new ErrorNegocio('Indicá el motivo de la anulación');
  const rec = ctx.db.select().from(recepciones).where(eq(recepciones.id, recepcionId)).get();
  if (!rec) throw noEncontrado('La recepción');
  if (rec.estado === 'anulada') throw new ErrorNegocio('La recepción ya está anulada');
  const c = compraOError(ctx.db, rec.compraId);
  const movs = ctx.db.select().from(movimientosStock).where(and(eq(movimientosStock.refTipo, 'recepcion'), eq(movimientosStock.refId, recepcionId), eq(movimientosStock.tipo, 'compra'))).all();
  for (const m of movs) {
    registrarMovimiento(ctx, { varianteId: m.varianteId, cantidad: -m.cantidad, tipo: 'anulacion', anulaId: m.id, refTipo: 'recepcion', refId: recepcionId, costoUnitarioCentavos: m.costoUnitarioCentavos, motivo: `Anula recepción R-${rec.numero}: ${motivo.trim()}` });
  }
  const revisar: string[] = [];
  const t = ahora();
  const cambios = ctx.db.select().from(historialCostos).where(and(eq(historialCostos.refTipo, 'recepcion'), eq(historialCostos.refId, recepcionId))).all();
  for (const h of cambios) {
    const ultimo = ctx.db.select().from(historialCostos).where(eq(historialCostos.varianteId, h.varianteId)).orderBy(desc(historialCostos.id)).limit(1).get()!;
    const v = ctx.db.select().from(variantes).where(eq(variantes.id, h.varianteId)).get()!;
    if (ultimo.id === h.id && v.costoCentavos === h.nuevoCentavos) {
      ctx.db.update(variantes).set({ costoCentavos: h.anteriorCentavos, actualizadoEn: t }).where(eq(variantes.id, v.id)).run();
      ctx.db.insert(historialCostos).values({ varianteId: v.id, anteriorCentavos: v.costoCentavos, nuevoCentavos: h.anteriorCentavos, fecha: t, usuarioId: ctx.usuarioId, origen: 'anulacion', motivo: `Anulación recepción R-${rec.numero}`, refTipo: 'anulacion_recepcion', refId: recepcionId }).run();
    } else revisar.push(v.sku);
  }
  ctx.db.update(recepciones).set({ estado: 'anulada', motivoAnulacion: motivo.trim(), actualizadoEn: t }).where(eq(recepciones.id, recepcionId)).run();
  if (c.estado === 'cerrada') ctx.db.update(compras).set({ estado: 'confirmada', actualizadoEn: t }).where(eq(compras.id, c.id)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'anular', entidad: 'recepcion', entidadId: recepcionId, detalle: motivo, despues: { costosARevisar: revisar } });
  return { costosARevisar: revisar };
}

export function obtenerCompra(db: DB, id: number) {
  const c = compraOError(db, id);
  const prov = db.select({ id: proveedores.id, nombre: proveedores.nombre }).from(proveedores).where(eq(proveedores.id, c.proveedorId)).get();
  const recibido = recibidoPorItem(db, id);
  const items = db.select({ i: compraItems, sku: variantes.sku, modelo: modelos.nombre, modeloId: modelos.id, color: colores.nombre, talle: talles.nombre })
    .from(compraItems).innerJoin(variantes, eq(variantes.id, compraItems.varianteId)).innerJoin(modelos, eq(modelos.id, variantes.modeloId))
    .leftJoin(colores, eq(colores.id, variantes.colorId)).leftJoin(talles, eq(talles.id, variantes.talleId))
    .where(eq(compraItems.compraId, id)).orderBy(compraItems.id).all()
    .map((r) => ({ ...r.i, sku: r.sku, modelo: r.modelo, modeloId: r.modeloId, color: r.color, talle: r.talle, recibido: recibido.get(r.i.id) ?? 0, pendiente: r.i.cantidad - (recibido.get(r.i.id) ?? 0) }));
  const recs = db.select().from(recepciones).where(eq(recepciones.compraId, id)).orderBy(desc(recepciones.id)).all();
  const recItems = recs.length ? db.select({ r: recepcionItems, sku: variantes.sku }).from(recepcionItems).innerJoin(variantes, eq(variantes.id, recepcionItems.varianteId)).where(inArray(recepcionItems.recepcionId, recs.map((r) => r.id))).all() : [];
  return {
    ...c, proveedor: prov?.nombre ?? '—',
    items,
    totalCentavos: items.reduce((s, i) => s + i.cantidad * i.costoUnitarioCentavos, 0),
    recibidoCentavos: recItems.filter((x) => recs.find((r) => r.id === x.r.recepcionId)?.estado === 'activa').reduce((s, x) => s + x.r.cantidad * x.r.costoUnitarioCentavos, 0),
    recepciones: recs.map((r) => ({ ...r, items: recItems.filter((x) => x.r.recepcionId === r.id).map((x) => ({ ...x.r, sku: x.sku })) })),
  };
}

export function listarCompras(db: DB, f: { proveedorId?: number; estado?: string; pendientes?: boolean }) {
  const conds = [];
  if (f.proveedorId) conds.push(eq(compras.proveedorId, f.proveedorId));
  if (f.estado) conds.push(eq(compras.estado, f.estado as 'borrador'));
  if (f.pendientes) conds.push(inArray(compras.estado, ['borrador', 'confirmada']));
  const pedidas = sql<number>`(select coalesce(sum(ci.cantidad), 0) from compra_items ci where ci.compra_id = ${compras.id})`;
  const total = sql<number>`(select coalesce(sum(ci.cantidad * ci.costo_unitario_centavos), 0) from compra_items ci where ci.compra_id = ${compras.id})`;
  const recibidas = sql<number>`(select coalesce(sum(ri.cantidad), 0) from recepcion_items ri join recepciones r on r.id = ri.recepcion_id where r.compra_id = ${compras.id} and r.estado = 'activa')`;
  const recibidoImporte = sql<number>`(select coalesce(sum(ri.cantidad * ri.costo_unitario_centavos), 0) from recepcion_items ri join recepciones r on r.id = ri.recepcion_id where r.compra_id = ${compras.id} and r.estado = 'activa')`;
  return db.select({ c: compras, proveedor: proveedores.nombre, pedidas, recibidas, totalCentavos: total, recibidoCentavos: recibidoImporte })
    .from(compras).innerJoin(proveedores, eq(proveedores.id, compras.proveedorId))
    .where(conds.length ? and(...conds) : undefined).orderBy(desc(compras.fecha), desc(compras.id)).all()
    .map((r) => ({ ...r.c, proveedor: r.proveedor, pedidas: Number(r.pedidas), recibidas: Number(r.recibidas), totalCentavos: Number(r.totalCentavos), recibidoCentavos: Number(r.recibidoCentavos) }));
}

/** Resumen por proveedor: lo recibido valorizado y lo que falta entregar. Los pagos llegan con el módulo de caja. */
export function resumenProveedor(db: DB, proveedorId: number) {
  const lista = listarCompras(db, { proveedorId });
  const abiertas = lista.filter((c) => c.estado === 'confirmada');
  return {
    compras: lista.length,
    recibidoCentavos: lista.filter((c) => c.estado !== 'anulada').reduce((s, c) => s + c.recibidoCentavos, 0),
    unidadesPendientes: abiertas.reduce((s, c) => s + c.pedidas - c.recibidas, 0),
    pendienteCentavos: abiertas.reduce((s, c) => s + c.totalCentavos - c.recibidoCentavos, 0),
  };
}
