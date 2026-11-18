/**
 * Compras a proveedores y talleres: pedido → recepciones (totales o parciales) → stock.
 * Las recepciones de reventa actualizan el costo por promedio ponderado; las de confección (taller) no,
 * porque ahí se paga la mano de obra y el costo del producto se arma con materiales + confección.
 */
import { devolverDePedido } from './reposicion.js';
import { claveMaterial, colorDeMovimiento, consumirPorProduccion, costoDeCantidad, entradaMaterial, revertirEntradaMaterial, revertirProduccion } from './costos.js';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { colores, compraItems, compraMateriales, compras, historialCostos, materiales, modelos, movimientosStock, necesidadesMaterial, proveedores, recepciones, recepcionItems, recepcionMateriales, talles, variantes } from '../db/schema.js';
import type { DB } from '../db/index.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { siguienteNumero } from './numeracion.js';
import { registrarMovimiento, stockDeUna, type Ctx } from './stock.js';
import { deudaDeCompra, estadoPedido, imputacionesDePagos, imputadoPorCompra, listarAdjuntos, validarComprobante, valoresComprobante, vencimientoDe, type DatosComprobante } from './comprobantes.js';
import { pagosProveedor } from '../db/schema.js';
import { clavePrecio, referenciasDePrecio, registrarPreciosDeCompra } from './preciosProveedor.js';

/** Cantidad y costo = lo confirmado. Lo solicitado y el precio estimado se guardan aparte (si no vienen, se toman de lo confirmado). */
export interface ItemCompra { varianteId: number; cantidad: number; costoUnitarioCentavos: number; cantidadSolicitada?: number | null; costoEstimadoCentavos?: number | null; cantidadFacturada?: number | null; notas?: string | null }
export interface ItemMaterial { materialId: number; colorId?: number | null; cantidadMil: number; costoUnitarioCentavos: number; cantidadSolicitadaMil?: number | null; costoEstimadoCentavos?: number | null; cantidadFacturadaMil?: number | null; notas?: string | null }
export type TipoCompra = 'reventa' | 'confeccion' | 'materiales';
export interface DatosCompra extends DatosComprobante { proveedorId: number; tipo: TipoCompra; fecha: string; fechaEsperada?: string | null; notas?: string | null; items: ItemCompra[]; materiales?: ItemMaterial[] }

/** Un pedido es de productos (reventa o confección) o de materiales, nunca de las dos cosas. */
function validarLineas(db: DB, d: DatosCompra) {
  if (d.tipo !== 'materiales') {
    if (d.materiales?.length) throw new ErrorNegocio('Los materiales se piden en un pedido de tipo "Materiales"');
    return validarItems(db, d.items);
  }
  if (d.items.length) throw new ErrorNegocio('Un pedido de materiales no lleva productos del catálogo');
  const ms = d.materiales ?? [];
  if (!ms.length) throw new ErrorNegocio('Agregá al menos un material');
  const ids = [...new Set(ms.map((i) => i.materialId))];
  const existentes = db.select().from(materiales).where(inArray(materiales.id, ids)).all();
  if (existentes.length !== ids.length) throw new ErrorNegocio('Hay materiales que no existen');
  // Los materiales que van por color llevan el color en cada línea; los demás, nunca.
  for (const i of ms) i.colorId = colorDeMovimiento(db, existentes.find((m) => m.id === i.materialId)!, i.colorId);
  const claves = ms.map((i) => claveMaterial(i.materialId, i.colorId ?? null));
  if (new Set(claves).size !== claves.length) throw new ErrorNegocio('Hay un material repetido en el pedido (mismo color): juntá las cantidades en una sola línea');
  if (existentes.some((m) => m.tipo === 'mano_obra')) throw new ErrorNegocio('La mano de obra no se pide como material: va en el pedido de confección al taller');
  for (const i of ms) {
    if (!Number.isInteger(i.cantidadMil) || i.cantidadMil <= 0) throw new ErrorNegocio('Las cantidades tienen que ser mayores a cero');
    if (!Number.isInteger(i.costoUnitarioCentavos) || i.costoUnitarioCentavos < 0) throw new ErrorNegocio('Costo unitario inválido');
  }
}

/**
 * Graba las líneas. Lo solicitado y el precio estimado quedan como estaban la primera vez que se cargó la línea
 * (así, si en el borrador se corrige el precio que pasó el proveedor, se sigue viendo lo que se había estimado).
 */
function insertarLineas(ctx: Ctx, compraId: number, d: DatosCompra, previos: { items?: (typeof compraItems.$inferSelect)[]; materiales?: (typeof compraMateriales.$inferSelect)[] } = {}) {
  if (d.items.length) ctx.db.insert(compraItems).values(d.items.map((i) => {
    const p = previos.items?.find((x) => x.varianteId === i.varianteId);
    return { compraId, varianteId: i.varianteId, cantidad: i.cantidad, costoUnitarioCentavos: i.costoUnitarioCentavos,
      cantidadSolicitada: i.cantidadSolicitada ?? p?.cantidadSolicitada ?? p?.cantidad ?? i.cantidad, costoEstimadoCentavos: i.costoEstimadoCentavos ?? p?.costoEstimadoCentavos ?? p?.costoUnitarioCentavos ?? i.costoUnitarioCentavos,
      cantidadFacturada: i.cantidadFacturada ?? null, notas: i.notas ?? null };
  })).run();
  if (d.materiales?.length) ctx.db.insert(compraMateriales).values(d.materiales.map((i) => {
    const p = previos.materiales?.find((x) => x.materialId === i.materialId && (x.colorId ?? null) === (i.colorId ?? null));
    return { compraId, materialId: i.materialId, colorId: i.colorId ?? null, cantidadMil: i.cantidadMil, costoUnitarioCentavos: i.costoUnitarioCentavos,
      cantidadSolicitadaMil: i.cantidadSolicitadaMil ?? p?.cantidadSolicitadaMil ?? p?.cantidadMil ?? i.cantidadMil, costoEstimadoCentavos: i.costoEstimadoCentavos ?? p?.costoEstimadoCentavos ?? p?.costoUnitarioCentavos ?? i.costoUnitarioCentavos,
      cantidadFacturadaMil: i.cantidadFacturadaMil ?? null, notas: i.notas ?? null };
  })).run();
}

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
  // Un proveedor de materiales inactivo (ej. Céfalo para el cuero) se puede seguir eligiendo para pedirle.
  if (!p.activo && p.rol !== 'materiales') throw new ErrorNegocio(`${p.nombre} está inactivo`);
  return p;
}

export function crearCompra(ctx: Ctx, d: DatosCompra, confirmar = false) {
  const prov = validarProveedor(ctx.db, d.proveedorId);
  validarLineas(ctx.db, d);
  // Si no se indica la condición de pago de esta operación, se propone la habitual del proveedor.
  const cond = d.condicionPago !== undefined ? d : { ...d, condicionPago: prov.condicionPago, plazoPagoDias: d.plazoPagoDias ?? prov.plazoPagoDias };
  validarComprobante(cond);
  const t = ahora();
  const c = ctx.db.insert(compras).values({
    ...valoresComprobante(cond),
    numero: siguienteNumero(ctx.db, 'compra'), proveedorId: d.proveedorId, tipo: d.tipo, fecha: d.fecha, fechaEsperada: d.fechaEsperada ?? null,
    notas: d.notas ?? null, estado: confirmar ? 'confirmada' : 'borrador', usuarioId: ctx.usuarioId, creadoEn: t, actualizadoEn: t,
  }).returning().get();
  insertarLineas(ctx, c.id, d);
  if (confirmar) registrarPreciosDeCompra(ctx, c.id, d.fecha);
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: 'compra', entidadId: c.id, despues: { ...c, items: d.items, materiales: d.materiales ?? [] } });
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
  if ((antes.tipo === 'materiales') !== (d.tipo === 'materiales')) throw new ErrorNegocio('Un pedido de materiales no se puede pasar a pedido de productos (ni al revés): armá uno nuevo y anulá este');
  validarLineas(ctx.db, d);
  validarComprobante(d);
  const itemsAntes = ctx.db.select().from(compraItems).where(eq(compraItems.compraId, id)).all();
  const materialesAntes = ctx.db.select().from(compraMateriales).where(eq(compraMateriales.compraId, id)).all();
  // Borrador: todavía no es una operación registrada (el antes queda en auditoría).
  ctx.db.delete(compraItems).where(eq(compraItems.compraId, id)).run();
  ctx.db.delete(compraMateriales).where(eq(compraMateriales.compraId, id)).run();
  insertarLineas(ctx, id, d, { items: itemsAntes, materiales: materialesAntes });
  const despues = ctx.db.update(compras).set({ ...valoresComprobante(d), proveedorId: d.proveedorId, tipo: d.tipo, fecha: d.fecha, fechaEsperada: d.fechaEsperada ?? null, notas: d.notas ?? null, actualizadoEn: ahora() }).where(eq(compras.id, id)).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'compra', entidadId: id, antes: { ...antes, items: itemsAntes, materiales: materialesAntes }, despues: { ...despues, items: d.items, materiales: d.materiales ?? [] } });
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
  if (estado === 'confirmada') registrarPreciosDeCompra(ctx, id);
  if (estado === 'anulada') { devolverDePedido(ctx, id); devolverNecesidades(ctx, id); }
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: accion === 'anular' ? 'anular' : 'modificar', entidad: 'compra', entidadId: id, antes: { estado: c.estado }, despues: { estado }, detalle: motivo });
  return despues;
}

export interface DatosCorreccion extends DatosComprobante {
  motivo: string; fecha?: string; fechaEsperada?: string | null; notas?: string | null;
  /** Líneas a corregir (con id) o a agregar (sin id). Las que no vienen quedan como están. */
  items?: { id?: number; varianteId?: number; cantidad: number; costoUnitarioCentavos: number; cantidadFacturada?: number | null }[];
  materiales?: { id?: number; materialId?: number; colorId?: number | null; cantidadMil: number; costoUnitarioCentavos: number; cantidadFacturadaMil?: number | null }[];
  /** true (por defecto): el precio nuevo vale también para lo ya recibido, así la deuda queda al precio real. */
  precioALoRecibido?: boolean;
}

/**
 * Corrige un pedido ya confirmado (o cerrado) con lo que realmente se acordó con el proveedor: cantidades, precios,
 * lo facturado, descuento, impuestos, diferencia de precio, fechas, condición de pago y notas. Nunca bloquea porque
 * el precio real no coincida con el estimado. Queda todo en auditoría (antes, después, usuario y motivo).
 *
 * Lo ya recibido no se puede bajar desde acá (eso se hace anulando la recepción). Si cambia el precio de una línea
 * con unidades recibidas, por defecto se corrige también el precio de lo recibido: así la deuda queda al precio real.
 * El costo del stock no se toca (para eso está el precio en Materiales o Catálogo, cuando el usuario lo decide).
 */
export function corregirCompra(ctx: Ctx, id: number, d: DatosCorreccion) {
  if (!d.motivo?.trim()) throw new ErrorNegocio('Indicá el motivo de la corrección');
  const c = compraOError(ctx.db, id);
  if (c.estado === 'borrador') throw new ErrorNegocio('El pedido está en borrador: editalo directamente');
  if (c.estado === 'anulada') throw new ErrorNegocio('El pedido está anulado');
  validarComprobante(d);
  const antes = obtenerCompra(ctx.db, id);
  const t = ahora();
  const aRecibido = d.precioALoRecibido !== false;
  const recItems = recibidoPorItem(ctx.db, id);
  const recMat = recibidoPorMaterial(ctx.db, id);
  const lineasRecepcion = (tabla: 'items' | 'materiales', lineaId: number) => tabla === 'items'
    ? ctx.db.select({ id: recepcionItems.id }).from(recepcionItems).innerJoin(recepciones, eq(recepciones.id, recepcionItems.recepcionId)).where(and(eq(recepcionItems.compraItemId, lineaId), eq(recepciones.estado, 'activa'))).all()
    : ctx.db.select({ id: recepcionMateriales.id }).from(recepcionMateriales).innerJoin(recepciones, eq(recepciones.id, recepcionMateriales.recepcionId)).where(and(eq(recepcionMateriales.compraMaterialId, lineaId), eq(recepciones.estado, 'activa'))).all();

  if (c.tipo === 'materiales' && d.items?.length) throw new ErrorNegocio('Este pedido es de materiales');
  if (c.tipo !== 'materiales' && d.materiales?.length) throw new ErrorNegocio('Este pedido es de productos');
  for (const l of d.items ?? []) {
    if (!Number.isInteger(l.cantidad) || l.cantidad < 0) throw new ErrorNegocio('Las cantidades no pueden ser negativas');
    if (!Number.isInteger(l.costoUnitarioCentavos) || l.costoUnitarioCentavos < 0) throw new ErrorNegocio('Precio inválido');
    if (l.cantidadFacturada != null && (!Number.isInteger(l.cantidadFacturada) || l.cantidadFacturada < 0)) throw new ErrorNegocio('Cantidad facturada inválida');
    if (l.id) {
      const it = ctx.db.select().from(compraItems).where(and(eq(compraItems.id, l.id), eq(compraItems.compraId, id))).get();
      if (!it) throw new ErrorNegocio('Hay una línea que no pertenece a este pedido');
      const rec = recItems.get(it.id) ?? 0;
      if (l.cantidad < rec) throw new ErrorNegocio(`Ya se recibieron ${rec} de esa línea: no se puede confirmar menos. Si vino menos, anulá la recepción y cargala de nuevo`);
      ctx.db.update(compraItems).set({ cantidad: l.cantidad, costoUnitarioCentavos: l.costoUnitarioCentavos, ...(l.cantidadFacturada !== undefined ? { cantidadFacturada: l.cantidadFacturada } : {}) }).where(eq(compraItems.id, it.id)).run();
      if (aRecibido && l.costoUnitarioCentavos !== it.costoUnitarioCentavos) {
        const ids = lineasRecepcion('items', it.id).map((r) => r.id);
        if (ids.length) ctx.db.update(recepcionItems).set({ costoUnitarioCentavos: l.costoUnitarioCentavos }).where(inArray(recepcionItems.id, ids)).run();
      }
    } else {
      if (!l.varianteId) throw new ErrorNegocio('Falta el producto de la línea nueva');
      validarItems(ctx.db, [{ varianteId: l.varianteId, cantidad: Math.max(1, l.cantidad), costoUnitarioCentavos: l.costoUnitarioCentavos }]);
      if (ctx.db.select({ id: compraItems.id }).from(compraItems).where(and(eq(compraItems.compraId, id), eq(compraItems.varianteId, l.varianteId))).get()) throw new ErrorNegocio('Ese producto ya está en el pedido: corregí su línea');
      ctx.db.insert(compraItems).values({ compraId: id, varianteId: l.varianteId, cantidad: l.cantidad, costoUnitarioCentavos: l.costoUnitarioCentavos, cantidadSolicitada: 0, costoEstimadoCentavos: null, cantidadFacturada: l.cantidadFacturada ?? null }).run();
    }
  }
  for (const l of d.materiales ?? []) {
    if (!Number.isInteger(l.cantidadMil) || l.cantidadMil < 0) throw new ErrorNegocio('Las cantidades no pueden ser negativas');
    if (!Number.isInteger(l.costoUnitarioCentavos) || l.costoUnitarioCentavos < 0) throw new ErrorNegocio('Precio inválido');
    if (l.cantidadFacturadaMil != null && (!Number.isInteger(l.cantidadFacturadaMil) || l.cantidadFacturadaMil < 0)) throw new ErrorNegocio('Cantidad facturada inválida');
    if (l.id) {
      const lp = ctx.db.select().from(compraMateriales).where(and(eq(compraMateriales.id, l.id), eq(compraMateriales.compraId, id))).get();
      if (!lp) throw new ErrorNegocio('Hay una línea que no pertenece a este pedido');
      const rec = recMat.get(lp.id) ?? 0;
      if (l.cantidadMil < rec) throw new ErrorNegocio(`Ya se recibieron ${rec / 1000} de esa línea: no se puede confirmar menos. Si vino menos, anulá la recepción y cargala de nuevo`);
      ctx.db.update(compraMateriales).set({ cantidadMil: l.cantidadMil, costoUnitarioCentavos: l.costoUnitarioCentavos, ...(l.cantidadFacturadaMil !== undefined ? { cantidadFacturadaMil: l.cantidadFacturadaMil } : {}) }).where(eq(compraMateriales.id, lp.id)).run();
      if (aRecibido && l.costoUnitarioCentavos !== lp.costoUnitarioCentavos) {
        const ids = lineasRecepcion('materiales', lp.id).map((r) => r.id);
        if (ids.length) ctx.db.update(recepcionMateriales).set({ costoUnitarioCentavos: l.costoUnitarioCentavos }).where(inArray(recepcionMateriales.id, ids)).run();
      }
    } else {
      if (!l.materialId) throw new ErrorNegocio('Falta el material de la línea nueva');
      const m = ctx.db.select().from(materiales).where(eq(materiales.id, l.materialId)).get();
      if (!m) throw noEncontrado('El material');
      if (m.tipo === 'mano_obra') throw new ErrorNegocio('La mano de obra no se pide como material');
      const colorId = colorDeMovimiento(ctx.db, m, l.colorId);
      const ya = ctx.db.select().from(compraMateriales).where(eq(compraMateriales.compraId, id)).all().some((x) => x.materialId === m.id && (x.colorId ?? null) === colorId);
      if (ya) throw new ErrorNegocio(`${m.nombre} ya está en el pedido: corregí su línea`);
      ctx.db.insert(compraMateriales).values({ compraId: id, materialId: m.id, colorId, cantidadMil: l.cantidadMil, costoUnitarioCentavos: l.costoUnitarioCentavos, cantidadSolicitadaMil: 0, costoEstimadoCentavos: null, cantidadFacturadaMil: l.cantidadFacturadaMil ?? null }).run();
    }
  }
  // Si quedó todo recibido se cierra; si se confirmó más de lo recibido, vuelve a quedar abierto.
  const pedido = obtenerCompra(ctx.db, id);
  const pendiente = c.tipo === 'materiales' ? pedido.materiales.reduce((s, l) => s + l.pendienteMil, 0) : pedido.items.reduce((s, l) => s + l.pendiente, 0);
  const estado = c.estado === 'cerrada' && pendiente > 0 && antes.estadoPedido === 'entregado' ? 'confirmada' : c.estado === 'confirmada' && pendiente === 0 ? 'cerrada' : c.estado;
  ctx.db.update(compras).set({
    ...valoresComprobante({ ...camposComprobante(c), ...quitarIndefinidos(d) }),
    ...(d.fecha ? { fecha: d.fecha } : {}), ...(d.fechaEsperada !== undefined ? { fechaEsperada: d.fechaEsperada } : {}), ...(d.notas !== undefined ? { notas: d.notas?.trim() || null } : {}),
    estado, actualizadoEn: t,
  }).where(eq(compras.id, id)).run();
  registrarPreciosDeCompra(ctx, id);
  const despues = obtenerCompra(ctx.db, id);
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'compra', entidadId: id, detalle: d.motivo.trim(), antes: resumenCompra(antes), despues: resumenCompra(despues) });
  return despues;
}

const camposComprobante = (c: typeof compras.$inferSelect): DatosComprobante => ({
  comprobante: c.comprobante, fechaComprobante: c.fechaComprobante, descuentoCentavos: c.descuentoCentavos, impuestosCentavos: c.impuestosCentavos,
  condicionPago: c.condicionPago, plazoPagoDias: c.plazoPagoDias, vencimiento: c.vencimiento, importeFacturadoCentavos: c.importeFacturadoCentavos, ajustePrecioCentavos: c.ajustePrecioCentavos,
});
const CAMPOS_COMPROBANTE = ['comprobante', 'fechaComprobante', 'descuentoCentavos', 'impuestosCentavos', 'condicionPago', 'plazoPagoDias', 'vencimiento', 'importeFacturadoCentavos', 'ajustePrecioCentavos'] as const;
const quitarIndefinidos = (d: DatosComprobante) => Object.fromEntries(CAMPOS_COMPROBANTE.filter((k) => d[k] !== undefined).map((k) => [k, d[k]])) as DatosComprobante;
const resumenCompra = (c: ReturnType<typeof obtenerCompra>) => ({
  estado: c.estado, fecha: c.fecha, fechaEsperada: c.fechaEsperada, notas: c.notas, comprobante: c.comprobante, descuentoCentavos: c.descuentoCentavos, impuestosCentavos: c.impuestosCentavos,
  ajustePrecioCentavos: c.ajustePrecioCentavos, importeFacturadoCentavos: c.importeFacturadoCentavos, condicionPago: c.condicionPago, vencimiento: c.vencimiento,
  totalConfirmadoCentavos: c.totalConfirmadoCentavos, aPagarCentavos: c.aPagarCentavos,
  items: c.items.map((i) => ({ sku: i.sku, cantidad: i.cantidad, costoUnitarioCentavos: i.costoUnitarioCentavos, cantidadFacturada: i.cantidadFacturada })),
  materiales: c.materiales.map((m) => ({ material: m.material, color: m.color, cantidadMil: m.cantidadMil, costoUnitarioCentavos: m.costoUnitarioCentavos, cantidadFacturadaMil: m.cantidadFacturadaMil })),
});

/** Unidades recibidas (en recepciones activas) por ítem del pedido. */
function recibidoPorItem(db: DB, compraId: number) {
  const filas = db.select({ item: recepcionItems.compraItemId, n: sql<number>`sum(${recepcionItems.cantidad})` })
    .from(recepcionItems).innerJoin(recepciones, eq(recepciones.id, recepcionItems.recepcionId))
    .where(and(eq(recepciones.compraId, compraId), eq(recepciones.estado, 'activa'))).groupBy(recepcionItems.compraItemId).all();
  return new Map(filas.map((f) => [f.item, Number(f.n)]));
}

export interface DatosRecepcion { fecha: string; comprobante?: string | null; notas?: string | null; items: { compraItemId: number; cantidad: number; costoUnitarioCentavos?: number }[]; materiales?: { compraMaterialId: number; cantidadMil: number; costoUnitarioCentavos?: number }[] }

/** Milésimas recibidas (en recepciones activas) por línea de un pedido de materiales. */
function recibidoPorMaterial(db: DB, compraId: number) {
  const filas = db.select({ l: recepcionMateriales.compraMaterialId, n: sql<number>`sum(${recepcionMateriales.cantidadMil})` })
    .from(recepcionMateriales).innerJoin(recepciones, eq(recepciones.id, recepcionMateriales.recepcionId))
    .where(and(eq(recepciones.compraId, compraId), eq(recepciones.estado, 'activa'))).groupBy(recepcionMateriales.compraMaterialId).all();
  return new Map(filas.map((f) => [f.l, Number(f.n)]));
}

/** Al anular un pedido de materiales armado desde la reposición, sus decisiones (manuales, proveedor) vuelven a estar activas. */
function devolverNecesidades(ctx: Ctx, compraId: number) {
  ctx.db.update(necesidadesMaterial).set({ estado: 'activa', compraId: null, actualizadoEn: ahora() })
    .where(and(eq(necesidadesMaterial.compraId, compraId), eq(necesidadesMaterial.estado, 'usada'))).run();
}

/** Recepción de un pedido de materiales: entra al stock de materiales y actualiza su costo (promedio ponderado). */
function recibirMateriales(ctx: Ctx, c: typeof compras.$inferSelect, d: DatosRecepcion) {
  const lineasPedido = ctx.db.select().from(compraMateriales).where(eq(compraMateriales.compraId, c.id)).all();
  const recibido = recibidoPorMaterial(ctx.db, c.id);
  if (d.items.some((i) => i.cantidad > 0)) throw new ErrorNegocio('Este pedido es de materiales');
  const lineas = (d.materiales ?? []).filter((i) => i.cantidadMil > 0);
  if (!lineas.length) throw new ErrorNegocio('No hay cantidades para recibir');
  const t = ahora();
  const rec = ctx.db.insert(recepciones).values({
    numero: siguienteNumero(ctx.db, 'recepcion'), compraId: c.id, fecha: d.fecha, comprobante: d.comprobante ?? null, notas: d.notas ?? null,
    usuarioId: ctx.usuarioId, creadoEn: t, actualizadoEn: t,
  }).returning().get();
  const prov = ctx.db.select({ nombre: proveedores.nombre }).from(proveedores).where(eq(proveedores.id, c.proveedorId)).get();
  const cambiosCosto: { material: string; antes: number | null; despues: number }[] = [];
  for (const l of lineas) {
    const lp = lineasPedido.find((x) => x.id === l.compraMaterialId);
    if (!lp) throw new ErrorNegocio('Hay una línea que no pertenece a este pedido');
    if (!Number.isInteger(l.cantidadMil) || l.cantidadMil < 0) throw new ErrorNegocio('Cantidad inválida');
    const pendiente = lp.cantidadMil - (recibido.get(lp.id) ?? 0);
    if (l.cantidadMil > pendiente) throw new ErrorNegocio(`Se quieren recibir ${l.cantidadMil / 1000} y quedan ${pendiente / 1000} pendientes de esa línea. Si vino de más, agregalo como otro pedido o con un ingreso en Materiales.`);
    const costo = l.costoUnitarioCentavos ?? lp.costoUnitarioCentavos;
    const e = entradaMaterial(ctx, { materialId: lp.materialId, colorId: lp.colorId, fecha: d.fecha, cantidadMil: l.cantidadMil, costoUnitarioCentavos: costo, comprobante: d.comprobante ?? null,
      motivo: `Recepción R-${rec.numero} · pedido P-${c.numero}${prov ? ' · ' + prov.nombre : ''}`, refTipo: 'recepcion', refId: rec.id });
    ctx.db.insert(recepcionMateriales).values({ recepcionId: rec.id, compraMaterialId: lp.id, materialId: lp.materialId, colorId: lp.colorId, cantidadMil: l.cantidadMil, costoUnitarioCentavos: costo, movimientoId: e.movimientoId }).run();
    if (e.costoNuevoCentavos !== e.costoAnteriorCentavos) cambiosCosto.push({ material: e.material, antes: e.costoAnteriorCentavos, despues: e.costoNuevoCentavos });
  }
  const quedan = lineasPedido.reduce((s, x) => s + x.cantidadMil - (recibido.get(x.id) ?? 0), 0) - lineas.reduce((s, l) => s + l.cantidadMil, 0);
  if (quedan === 0) ctx.db.update(compras).set({ estado: 'cerrada', actualizadoEn: t }).where(eq(compras.id, c.id)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'recibir', entidad: 'compra', entidadId: c.id, despues: { recepcion: rec.numero, materiales: lineas, cambiosCosto }, detalle: d.comprobante ? `Comprobante ${d.comprobante}` : undefined });
  return { recepcionId: rec.id, numero: rec.numero, pedidoCerrado: quedan === 0, cambiosCosto, produccion: null };
}

export function recibir(ctx: Ctx, compraId: number, d: DatosRecepcion) {
  const c = compraOError(ctx.db, compraId);
  if (c.estado !== 'confirmada') throw new ErrorNegocio(c.estado === 'borrador' ? 'Confirmá el pedido antes de recibir' : `El pedido está ${c.estado}: no se puede recibir`);
  if (c.tipo === 'materiales') return recibirMateriales(ctx, c, d);
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
  const produccion = c.tipo === 'confeccion'
    ? consumirPorProduccion(ctx, rec.id, rec.numero, d.fecha, lineas.map((l) => ({ varianteId: items.find((i) => i.id === l.compraItemId)!.varianteId, cantidad: l.cantidad })))
    : null;
  const quedan = items.reduce((s, i) => s + i.cantidad - (recibido.get(i.id) ?? 0), 0) - lineas.reduce((s, l) => s + l.cantidad, 0);
  if (quedan === 0) ctx.db.update(compras).set({ estado: 'cerrada', actualizadoEn: t }).where(eq(compras.id, compraId)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'recibir', entidad: 'compra', entidadId: compraId, despues: { recepcion: rec.numero, items: lineas, cambiosCosto }, detalle: d.comprobante ? `Comprobante ${d.comprobante}` : undefined });
  return { recepcionId: rec.id, numero: rec.numero, pedidoCerrado: quedan === 0, cambiosCosto, produccion };
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
  if (c.tipo === 'confeccion') revertirProduccion(ctx, recepcionId, motivo.trim());
  if (c.tipo === 'materiales') {
    for (const rm of ctx.db.select().from(recepcionMateriales).where(eq(recepcionMateriales.recepcionId, recepcionId)).all()) {
      if (!rm.movimientoId) continue;
      const aRevisar = revertirEntradaMaterial(ctx, rm.movimientoId, `Anula recepción R-${rec.numero}: ${motivo.trim()}`);
      if (aRevisar) revisar.push(aRevisar);
    }
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
  const recibidoMat = recibidoPorMaterial(db, id);
  const lineasMat = db.select({ l: compraMateriales, codigo: materiales.codigo, material: materiales.nombre, unidad: materiales.unidad, color: colores.nombre }).from(compraMateriales)
    .innerJoin(materiales, eq(materiales.id, compraMateriales.materialId)).leftJoin(colores, eq(colores.id, compraMateriales.colorId)).where(eq(compraMateriales.compraId, id)).orderBy(compraMateriales.id).all()
    .map((r) => ({ ...r.l, codigo: r.codigo, material: r.material, color: r.color, unidad: r.unidad, recibidoMil: recibidoMat.get(r.l.id) ?? 0, pendienteMil: r.l.cantidadMil - (recibidoMat.get(r.l.id) ?? 0) }));
  const refs = referenciasDePrecio(db, c.proveedorId, id, [...items.map((i) => ({ varianteId: i.varianteId })), ...lineasMat.map((l) => ({ materialId: l.materialId, colorId: l.colorId }))]);
  const conRef = <T extends object>(x: T, k: string) => ({ ...x, ...(refs.get(k) ?? { anteriorCentavos: null, anteriorFecha: null, habitualCentavos: null }) });
  const recs = db.select().from(recepciones).where(eq(recepciones.compraId, id)).orderBy(desc(recepciones.id)).all();
  const recItems = recs.length ? db.select({ r: recepcionItems, sku: variantes.sku }).from(recepcionItems).innerJoin(variantes, eq(variantes.id, recepcionItems.varianteId)).where(inArray(recepcionItems.recepcionId, recs.map((r) => r.id))).all() : [];
  const recMats = recs.length ? db.select({ r: recepcionMateriales, material: materiales.nombre, unidad: materiales.unidad, color: colores.nombre }).from(recepcionMateriales).innerJoin(materiales, eq(materiales.id, recepcionMateriales.materialId)).leftJoin(colores, eq(colores.id, recepcionMateriales.colorId)).where(inArray(recepcionMateriales.recepcionId, recs.map((r) => r.id))).all() : [];
  const activa = (recId: number) => recs.find((r) => r.id === recId)?.estado === 'activa';
  const recibidoCentavos = recItems.filter((x) => activa(x.r.recepcionId)).reduce((s, x) => s + x.r.cantidad * x.r.costoUnitarioCentavos, 0)
    + recMats.filter((x) => activa(x.r.recepcionId)).reduce((s, x) => s + costoDeCantidad(x.r.costoUnitarioCentavos, x.r.cantidadMil), 0);
  const ultimaRecepcion = recs.filter((r) => r.estado === 'activa').map((r) => r.fecha).sort().pop() ?? null;
  const pagos = db.select().from(pagosProveedor).where(and(eq(pagosProveedor.proveedorId, c.proveedorId), eq(pagosProveedor.estado, 'activo'))).all();
  const imps = imputacionesDePagos(db, pagos.map((p) => p.id)).filter((i) => i.compraId === id);
  const pagadoCentavos = imps.reduce((s, i) => s + i.importeCentavos, 0);
  const aPagarCentavos = deudaDeCompra(c, recibidoCentavos);
  return {
    ...c, proveedor: prov?.nombre ?? '—',
    estadoPedido: c.tipo === 'materiales'
      ? estadoPedido(c, lineasMat.reduce((s, i) => s + i.cantidadMil, 0), lineasMat.reduce((s, i) => s + i.recibidoMil, 0))
      : estadoPedido(c, items.reduce((s, i) => s + i.cantidad, 0), items.reduce((s, i) => s + i.recibido, 0)),
    vencimientoEfectivo: vencimientoDe(c, ultimaRecepcion),
    items: items.map((i) => conRef(i, clavePrecio({ varianteId: i.varianteId }))), materiales: lineasMat.map((l) => conRef(l, clavePrecio({ materialId: l.materialId, colorId: l.colorId }))),
    totalCentavos: items.reduce((s, i) => s + i.cantidad * i.costoUnitarioCentavos, 0) + lineasMat.reduce((s, i) => s + costoDeCantidad(i.costoUnitarioCentavos, i.cantidadMil), 0),
    // Lo estimado al pedir y lo confirmado con el proveedor (con descuento, impuestos y diferencia de precio).
    totalEstimadoCentavos: items.reduce((s, i) => s + (i.cantidadSolicitada ?? i.cantidad) * (i.costoEstimadoCentavos ?? i.costoUnitarioCentavos), 0)
      + lineasMat.reduce((s, i) => s + costoDeCantidad(i.costoEstimadoCentavos ?? i.costoUnitarioCentavos, i.cantidadSolicitadaMil ?? i.cantidadMil), 0),
    totalConfirmadoCentavos: items.reduce((s, i) => s + i.cantidad * i.costoUnitarioCentavos, 0) + lineasMat.reduce((s, i) => s + costoDeCantidad(i.costoUnitarioCentavos, i.cantidadMil), 0)
      - c.descuentoCentavos + c.impuestosCentavos + c.ajustePrecioCentavos,
    recibidoCentavos, aPagarCentavos, pagadoCentavos, saldoCentavos: aPagarCentavos - pagadoCentavos,
    pagos: imps.map((i) => { const p = pagos.find((x) => x.id === i.pagoId)!; return { pagoId: p.id, numero: p.numero, fecha: p.fecha, importeCentavos: i.importeCentavos, totalPagoCentavos: p.importeCentavos }; }),
    adjuntos: listarAdjuntos(db, 'compra', id),
    recepciones: recs.map((r) => ({
      ...r, adjuntos: listarAdjuntos(db, 'recepcion', r.id), items: recItems.filter((x) => x.r.recepcionId === r.id).map((x) => ({ ...x.r, sku: x.sku })),
      materiales: recMats.filter((x) => x.r.recepcionId === r.id).map((x) => ({ ...x.r, material: x.material, color: x.color, unidad: x.unidad, importeCentavos: costoDeCantidad(x.r.costoUnitarioCentavos, x.r.cantidadMil) })),
    })),
  };
}

export function listarCompras(db: DB, f: { proveedorId?: number; estado?: string; pendientes?: boolean; estadoPedido?: string }) {
  const conds = [];
  if (f.proveedorId) conds.push(eq(compras.proveedorId, f.proveedorId));
  if (f.estado) conds.push(eq(compras.estado, f.estado as 'borrador'));
  if (f.pendientes) conds.push(inArray(compras.estado, ['borrador', 'confirmada']));
  // En los pedidos de materiales, "pedidas" y "recibidas" van en milésimas (sirven para el estado y el % entregado).
  const pedidas = sql<number>`(select coalesce(sum(ci.cantidad), 0) from compra_items ci where ci.compra_id = ${compras.id}) + (select coalesce(sum(cm.cantidad_mil), 0) from compra_materiales cm where cm.compra_id = ${compras.id})`;
  const total = sql<number>`(select coalesce(sum(ci.cantidad * ci.costo_unitario_centavos), 0) from compra_items ci where ci.compra_id = ${compras.id}) + (select coalesce(sum(round(cm.cantidad_mil * cm.costo_unitario_centavos / 1000.0)), 0) from compra_materiales cm where cm.compra_id = ${compras.id})`;
  const recibidas = sql<number>`(select coalesce(sum(ri.cantidad), 0) from recepcion_items ri join recepciones r on r.id = ri.recepcion_id where r.compra_id = ${compras.id} and r.estado = 'activa') + (select coalesce(sum(rm.cantidad_mil), 0) from recepcion_materiales rm join recepciones r on r.id = rm.recepcion_id where r.compra_id = ${compras.id} and r.estado = 'activa')`;
  const recibidoImporte = sql<number>`(select coalesce(sum(ri.cantidad * ri.costo_unitario_centavos), 0) from recepcion_items ri join recepciones r on r.id = ri.recepcion_id where r.compra_id = ${compras.id} and r.estado = 'activa') + (select coalesce(sum(round(rm.cantidad_mil * rm.costo_unitario_centavos / 1000.0)), 0) from recepcion_materiales rm join recepciones r on r.id = rm.recepcion_id where r.compra_id = ${compras.id} and r.estado = 'activa')`;
  const ultima = sql<string | null>`(select max(r.fecha) from recepciones r where r.compra_id = ${compras.id} and r.estado = 'activa')`;
  const filas = db.select({ c: compras, proveedor: proveedores.nombre, pedidas, recibidas, totalCentavos: total, recibidoCentavos: recibidoImporte, ultima })
    .from(compras).innerJoin(proveedores, eq(proveedores.id, compras.proveedorId))
    .where(conds.length ? and(...conds) : undefined).orderBy(desc(compras.fecha), desc(compras.id)).all();
  const imputado = imputadoPorCompra(db, filas.map((r) => r.c.id));
  return filas.map((r) => {
    const recibidoCentavos = Number(r.recibidoCentavos);
    const aPagarCentavos = deudaDeCompra(r.c, recibidoCentavos);
    const pagadoCentavos = imputado.get(r.c.id) ?? 0;
    return {
      ...r.c, proveedor: r.proveedor, pedidas: Number(r.pedidas), recibidas: Number(r.recibidas), totalCentavos: Number(r.totalCentavos), recibidoCentavos,
      estadoPedido: estadoPedido(r.c, Number(r.pedidas), Number(r.recibidas)), ultimaRecepcion: r.ultima ?? null, vencimientoEfectivo: vencimientoDe(r.c, r.ultima ?? null),
      aPagarCentavos, pagadoCentavos, saldoCentavos: aPagarCentavos - pagadoCentavos,
    };
  }).filter((c) => !f.estadoPedido || c.estadoPedido === f.estadoPedido);
}

/** Resumen por proveedor: lo recibido valorizado y lo que falta entregar. Los pagos llegan con el módulo de caja. */
export function resumenProveedor(db: DB, proveedorId: number) {
  const lista = listarCompras(db, { proveedorId });
  const abiertas = lista.filter((c) => c.estado === 'confirmada');
  const abiertasProductos = abiertas.filter((c) => c.tipo !== 'materiales');
  return {
    compras: lista.length,
    recibidoCentavos: lista.filter((c) => c.estado !== 'anulada').reduce((s, c) => s + c.recibidoCentavos, 0),
    unidadesPendientes: abiertasProductos.reduce((s, c) => s + c.pedidas - c.recibidas, 0),
    pendienteCentavos: abiertas.reduce((s, c) => s + c.totalCentavos - c.recibidoCentavos, 0),
  };
}
