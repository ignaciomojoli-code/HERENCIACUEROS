/**
 * Comprobantes de compra y cuenta corriente por comprobante: factura, descuento, impuestos, condición de pago,
 * vencimiento, pagos imputados a cada pedido y adjuntos.
 *
 * Lo que se le debe a un proveedor por un pedido = lo recibido (valorizado al costo del pedido) − descuento + impuestos.
 * Los pagos se imputan a uno o varios pedidos; lo no imputado queda "a cuenta" (baja el saldo total pero no el de un pedido).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { adjuntos, compras, gastos, imputacionesPago, pagosProveedor, proveedores, recepciones } from '../db/schema.js';
import type { DB } from '../db/index.js';
import type { Ctx } from './stock.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { listarCompras } from './compras.js';
import { hoyLocal } from './caja.js';

export type CondicionPago = 'al_pedir' | 'al_recibir' | 'a_plazo' | 'cuenta_corriente';
export const ESTADOS_PEDIDO = {
  pendiente_solicitar: 'Pendiente de solicitar', solicitado: 'Solicitado', pendiente_entrega: 'Pendiente de entrega',
  entrega_parcial: 'Entrega parcial', entregado: 'Entregado', cerrado_incompleto: 'Cerrado incompleto', cancelado: 'Cancelado',
} as const;
export type EstadoPedido = keyof typeof ESTADOS_PEDIDO;

/**
 * Estado que ve el usuario, derivado del estado guardado y de lo recibido (los pedidos viejos no necesitan migrarse):
 * borrador → pendiente de solicitar; confirmado sin nada recibido → solicitado (o pendiente de entrega si ya pasó la
 * fecha esperada); con parte recibida → entrega parcial; cerrado → entregado (o cerrado incompleto); anulado → cancelado.
 */
export function estadoPedido(c: { estado: string; fechaEsperada: string | null }, pedidas: number, recibidas: number, hoy = hoyLocal()): EstadoPedido {
  if (c.estado === 'anulada') return 'cancelado';
  if (c.estado === 'borrador') return 'pendiente_solicitar';
  if (c.estado === 'cerrada') return recibidas >= pedidas ? 'entregado' : 'cerrado_incompleto';
  if (recibidas > 0) return 'entrega_parcial';
  return c.fechaEsperada && c.fechaEsperada <= hoy ? 'pendiente_entrega' : 'solicitado';
}

const sumarDias = (f: string, dias: number) => {
  const d = new Date(f.slice(0, 10) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

/** Vencimiento según lo arreglado; el fijado a mano manda. null = sin fecha (cuenta corriente o falta el dato). */
export function vencimientoDe(c: { fecha: string; vencimiento: string | null; condicionPago: CondicionPago | null; plazoPagoDias: number | null; fechaComprobante: string | null }, ultimaRecepcion: string | null) {
  if (c.vencimiento) return c.vencimiento;
  switch (c.condicionPago) {
    case 'al_pedir': return c.fecha;
    case 'al_recibir': return ultimaRecepcion;
    case 'a_plazo': {
      const base = c.fechaComprobante ?? ultimaRecepcion;
      return base && c.plazoPagoDias != null ? sumarDias(base, c.plazoPagoDias) : null;
    }
    default: return null;
  }
}

export interface DatosComprobante {
  comprobante?: string | null; fechaComprobante?: string | null; descuentoCentavos?: number; impuestosCentavos?: number;
  condicionPago?: CondicionPago | null; plazoPagoDias?: number | null; vencimiento?: string | null;
}

export function validarComprobante(d: DatosComprobante) {
  if (d.descuentoCentavos != null && (!Number.isInteger(d.descuentoCentavos) || d.descuentoCentavos < 0)) throw new ErrorNegocio('Descuento inválido');
  if (d.impuestosCentavos != null && (!Number.isInteger(d.impuestosCentavos) || d.impuestosCentavos < 0)) throw new ErrorNegocio('Impuestos inválidos');
  if (d.condicionPago === 'a_plazo' && !(d.plazoPagoDias != null && d.plazoPagoDias > 0) && !d.vencimiento) throw new ErrorNegocio('A plazo: indicá los días o la fecha de vencimiento');
  if (d.plazoPagoDias != null && (!Number.isInteger(d.plazoPagoDias) || d.plazoPagoDias < 0)) throw new ErrorNegocio('Plazo inválido');
}

export const valoresComprobante = (d: DatosComprobante) => ({
  comprobante: d.comprobante?.trim() || null, fechaComprobante: d.fechaComprobante || null,
  descuentoCentavos: d.descuentoCentavos ?? 0, impuestosCentavos: d.impuestosCentavos ?? 0,
  condicionPago: d.condicionPago ?? null, plazoPagoDias: d.condicionPago === 'a_plazo' ? d.plazoPagoDias ?? null : null, vencimiento: d.vencimiento || null,
});

/** Corrige los datos del comprobante de un pedido (en cualquier estado salvo anulado). Pide motivo si ya está confirmado. */
export function guardarComprobante(ctx: Ctx, compraId: number, d: DatosComprobante, motivo?: string) {
  const c = ctx.db.select().from(compras).where(eq(compras.id, compraId)).get();
  if (!c) throw noEncontrado('El pedido');
  if (c.estado === 'anulada') throw new ErrorNegocio('El pedido está anulado');
  if (c.estado !== 'borrador' && !motivo?.trim()) throw new ErrorNegocio('Indicá el motivo del cambio');
  validarComprobante(d);
  const v = valoresComprobante(d);
  const despues = ctx.db.update(compras).set({ ...v, actualizadoEn: ahora() }).where(eq(compras.id, compraId)).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'compra', entidadId: compraId, antes: c, despues, detalle: motivo?.trim() || 'Datos del comprobante' });
  return despues;
}

/** Ajuste del comprobante a la deuda (impuestos − descuento), solo para pedidos vigentes (confirmados o cerrados). */
export const ajusteComprobanteSql = sql<number>`case when ${compras.estado} in ('confirmada', 'cerrada') then ${compras.impuestosCentavos} - ${compras.descuentoCentavos} else 0 end`;

/** Lo imputado a cada pedido por pagos vigentes. */
export function imputadoPorCompra(db: DB, compraIds?: number[]) {
  if (compraIds && !compraIds.length) return new Map<number, number>();
  const filas = db.select({ c: imputacionesPago.compraId, s: sql<number>`sum(${imputacionesPago.importeCentavos})` })
    .from(imputacionesPago).innerJoin(pagosProveedor, eq(pagosProveedor.id, imputacionesPago.pagoId))
    .where(and(eq(imputacionesPago.estado, 'activa'), eq(pagosProveedor.estado, 'activo'), compraIds ? inArray(imputacionesPago.compraId, compraIds) : undefined))
    .groupBy(imputacionesPago.compraId).all();
  return new Map(filas.map((f) => [f.c, Number(f.s)]));
}

/** Imputaciones vigentes de cada pago. */
export function imputacionesDePagos(db: DB, pagoIds: number[]) {
  if (!pagoIds.length) return [];
  return db.select({ i: imputacionesPago, numero: compras.numero }).from(imputacionesPago).innerJoin(compras, eq(compras.id, imputacionesPago.compraId))
    .where(and(inArray(imputacionesPago.pagoId, pagoIds), eq(imputacionesPago.estado, 'activa'))).all()
    .map((r) => ({ ...r.i, compraNumero: r.numero }));
}

export function validarImputaciones(db: DB, proveedorId: number, importePago: number, imps: { compraId: number; importeCentavos: number }[]) {
  const ids = imps.map((i) => i.compraId);
  if (new Set(ids).size !== ids.length) throw new ErrorNegocio('Hay un pedido repetido en la imputación');
  for (const i of imps) if (!Number.isInteger(i.importeCentavos) || i.importeCentavos <= 0) throw new ErrorNegocio('Los importes imputados tienen que ser mayores a cero');
  if (imps.reduce((s, i) => s + i.importeCentavos, 0) > importePago) throw new ErrorNegocio('Lo imputado supera el importe del pago');
  if (!ids.length) return;
  const cs = db.select().from(compras).where(inArray(compras.id, ids)).all();
  if (cs.length !== ids.length || cs.some((c) => c.proveedorId !== proveedorId)) throw new ErrorNegocio('Hay pedidos que no son de ese proveedor');
  if (cs.some((c) => c.estado === 'anulada')) throw new ErrorNegocio('No se puede imputar a un pedido anulado');
}

export function grabarImputaciones(ctx: Ctx, pagoId: number, imps: { compraId: number; importeCentavos: number }[]) {
  const t = ahora();
  for (const i of imps) ctx.db.insert(imputacionesPago).values({ pagoId, compraId: i.compraId, importeCentavos: i.importeCentavos, usuarioId: ctx.usuarioId, creadoEn: t }).run();
}

/** Cambia a qué pedidos se aplica un pago ya hecho. No mueve plata: las imputaciones anteriores quedan anuladas. */
export function imputarPago(ctx: Ctx, pagoId: number, imps: { compraId: number; importeCentavos: number }[], motivo?: string) {
  const p = ctx.db.select().from(pagosProveedor).where(eq(pagosProveedor.id, pagoId)).get();
  if (!p) throw noEncontrado('El pago');
  if (p.estado === 'anulado') throw new ErrorNegocio('El pago está anulado');
  validarImputaciones(ctx.db, p.proveedorId, p.importeCentavos, imps);
  const antes = imputacionesDePagos(ctx.db, [pagoId]);
  ctx.db.update(imputacionesPago).set({ estado: 'anulada' }).where(and(eq(imputacionesPago.pagoId, pagoId), eq(imputacionesPago.estado, 'activa'))).run();
  grabarImputaciones(ctx, pagoId, imps);
  // El campo viejo (un solo pedido) queda en el primero, para los listados que lo muestran.
  ctx.db.update(pagosProveedor).set({ compraId: imps.length === 1 ? imps[0].compraId : null, actualizadoEn: ahora() }).where(eq(pagosProveedor.id, pagoId)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'pago_proveedor', entidadId: pagoId, detalle: motivo?.trim() || 'Imputación del pago',
    antes: { imputaciones: antes.map((a) => ({ pedido: a.compraNumero, importeCentavos: a.importeCentavos })) }, despues: { imputaciones: imps } });
  return { ok: true };
}

/**
 * Comprobantes (pedidos) de un proveedor con lo que se debe de cada uno, lo pagado, el saldo y el vencimiento,
 * más los pagos con la parte que quedó sin imputar.
 */
export function comprobantesProveedor(db: DB, proveedorId: number, hoy = hoyLocal()) {
  const lista = listarCompras(db, { proveedorId }).filter((c) => c.estado !== 'anulada' && c.estado !== 'borrador');
  const imputado = imputadoPorCompra(db, lista.map((c) => c.id));
  const comprobantes = lista.map((c) => {
    const aPagarCentavos = c.recibidoCentavos - c.descuentoCentavos + c.impuestosCentavos;
    const pagadoCentavos = imputado.get(c.id) ?? 0;
    const saldoCentavos = aPagarCentavos - pagadoCentavos;
    return { ...c, aPagarCentavos, pagadoCentavos, saldoCentavos, vencido: saldoCentavos > 0 && !!c.vencimientoEfectivo && c.vencimientoEfectivo < hoy };
  });
  const pagos = db.select().from(pagosProveedor).where(and(eq(pagosProveedor.proveedorId, proveedorId), eq(pagosProveedor.estado, 'activo'))).all();
  const imps = imputacionesDePagos(db, pagos.map((p) => p.id));
  const sinImputarCentavos = pagos.reduce((s, p) => s + p.importeCentavos - imps.filter((i) => i.pagoId === p.id).reduce((a, i) => a + i.importeCentavos, 0), 0);
  return { comprobantes, sinImputarCentavos };
}

/**
 * Vista general de cuentas corrientes: por proveedor, el saldo total, lo vencido y el próximo vencimiento.
 * El saldo total incluye ajustes, compras de materiales y pagos a cuenta (es el mismo de la cuenta corriente).
 */
export function vencimientosProveedores(db: DB, saldos: Map<number, { saldoCentavos: number }>, hoy = hoyLocal()) {
  const provs = db.select({ id: proveedores.id, nombre: proveedores.nombre }).from(proveedores).all();
  return provs.map((p) => {
    const { comprobantes } = comprobantesProveedor(db, p.id, hoy);
    const abiertos = comprobantes.filter((c) => c.saldoCentavos > 0);
    const proximos = abiertos.filter((c) => c.vencimientoEfectivo && c.vencimientoEfectivo >= hoy).map((c) => c.vencimientoEfectivo!).sort();
    return {
      proveedorId: p.id, proveedor: p.nombre, saldoCentavos: saldos.get(p.id)?.saldoCentavos ?? 0,
      vencidoCentavos: abiertos.filter((c) => c.vencido).reduce((s, c) => s + c.saldoCentavos, 0),
      sinFechaCentavos: abiertos.filter((c) => !c.vencimientoEfectivo).reduce((s, c) => s + c.saldoCentavos, 0),
      proximoVencimiento: proximos[0] ?? null,
      proximoCentavos: abiertos.filter((c) => c.vencimientoEfectivo === proximos[0]).reduce((s, c) => s + c.saldoCentavos, 0),
    };
  }).filter((x) => x.saldoCentavos !== 0 || x.vencidoCentavos);
}

// ───────────── Adjuntos ─────────────

export const ENTIDADES_ADJUNTO = ['compra', 'recepcion', 'pago_proveedor', 'gasto'] as const;
export type EntidadAdjunto = (typeof ENTIDADES_ADJUNTO)[number];
const TIPOS_ADJUNTO = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
export const MAX_ADJUNTO = 10 * 1024 * 1024;

function entidadExiste(db: DB, entidad: EntidadAdjunto, id: number) {
  const t = { compra: compras, recepcion: recepciones, pago_proveedor: pagosProveedor, gasto: gastos }[entidad];
  return !!db.select({ id: t.id }).from(t).where(eq(t.id, id)).get();
}

export function subirAdjunto(ctx: Ctx, d: { entidad: EntidadAdjunto; entidadId: number; nombre: string; tipo: string; datos: Buffer }) {
  if (!ENTIDADES_ADJUNTO.includes(d.entidad)) throw new ErrorNegocio('No se pueden adjuntar archivos ahí');
  if (!entidadExiste(ctx.db, d.entidad, d.entidadId)) throw noEncontrado('El documento');
  if (!TIPOS_ADJUNTO.test(d.tipo)) throw new ErrorNegocio('Solo se pueden adjuntar fotos (JPG, PNG, WEBP, HEIC) o PDF');
  if (!d.datos.length) throw new ErrorNegocio('El archivo está vacío');
  if (d.datos.length > MAX_ADJUNTO) throw new ErrorNegocio('El archivo pesa más de 10 MB');
  const a = ctx.db.insert(adjuntos).values({ entidad: d.entidad, entidadId: d.entidadId, nombre: d.nombre.slice(0, 200) || 'archivo', tipo: d.tipo, tamano: d.datos.length, datos: d.datos, usuarioId: ctx.usuarioId, creadoEn: ahora() })
    .returning({ id: adjuntos.id }).get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'adjuntar', entidad: d.entidad, entidadId: d.entidadId, despues: { adjunto: a.id, nombre: d.nombre, tamano: d.datos.length } });
  return a;
}

export function listarAdjuntos(db: DB, entidad: string, entidadId: number) {
  return db.select({ id: adjuntos.id, nombre: adjuntos.nombre, tipo: adjuntos.tipo, tamano: adjuntos.tamano, creadoEn: adjuntos.creadoEn })
    .from(adjuntos).where(and(eq(adjuntos.entidad, entidad), eq(adjuntos.entidadId, entidadId), eq(adjuntos.estado, 'activo'))).all();
}

export function obtenerAdjunto(db: DB, id: number) {
  const a = db.select().from(adjuntos).where(eq(adjuntos.id, id)).get();
  if (!a) throw noEncontrado('El adjunto');
  return a;
}

/** Quita un adjunto de la vista. El archivo queda guardado (y en auditoría), no se borra. */
export function quitarAdjunto(ctx: Ctx, id: number, motivo: string) {
  if (!motivo?.trim()) throw new ErrorNegocio('Indicá por qué se quita');
  const a = obtenerAdjunto(ctx.db, id);
  if (a.estado === 'quitado') throw new ErrorNegocio('Ya estaba quitado');
  ctx.db.update(adjuntos).set({ estado: 'quitado', motivo: motivo.trim() }).where(eq(adjuntos.id, id)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'quitar_adjunto', entidad: a.entidad, entidadId: a.entidadId, detalle: motivo.trim(), antes: { adjunto: id, nombre: a.nombre } });
  return { ok: true };
}
