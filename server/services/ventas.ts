/**
 * Ventas: descuentan stock, registran los cobros en caja y guardan una foto del costo para calcular la ganancia.
 * Una venta se puede editar (queda la versión anterior y el motivo) o anular. Nunca se borra: el stock y la caja
 * se corrigen con movimientos contrarios.
 *
 * Una venta puede quedar debiendo si tiene cliente: lo que falta se cobra después (cobros posteriores).
 *
 * Comisiones: si la plata entra a una cuenta común (ej. QR de Mercado Pago), la comisión estimada se descuenta
 * en el momento. Si entra a "tarjetas a liquidar", la comisión real aparece al cargar la liquidación.
 */
import { quitarVenta, sumarVenta } from './reposicion.js';
import { and, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { clientes, colores, cuentas, formasPago, listasPrecio, modelos, movimientosStock, precios, talles, variantes, ventaItems, ventaPagos, ventaVersiones, ventas } from '../db/schema.js';
import type { DB } from '../db/index.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { siguienteNumero } from './numeracion.js';
import { registrarMovimiento, type Ctx } from './stock.js';
import { cuentaOError, hoyLocal, registrarCaja, revertirMovimientos } from './caja.js';

export interface DatosCobro { formaPagoId: number; importeCentavos: number; importeMonedaCentavos?: number | null; comisionRealCentavos?: number | null }
export interface DatosVenta {
  fecha: string; cliente?: string | null; clienteId?: number | null; listaPrecioId?: number | null; notas?: string | null;
  descuentoCentavos?: number; motivoDescuento?: string | null;
  items: { varianteId: number; cantidad: number; precioCentavos: number }[];
  pagos: DatosCobro[];
}

const costoTotal = sql<number | null>`case when ${variantes.costoCentavos} is null then null else ${variantes.costoCentavos} + ${variantes.costoLogisticoCentavos} + ${variantes.costoAdicionalCentavos} end`;

export const comisionEstimada = (importe: number, bp: number) => Math.round((importe * bp) / 10000);

/** Valida formas de pago e importes y calcula la comisión estimada de cada cobro. */
function prepararCobros(db: DB, pagos: DatosCobro[]) {
  if (!pagos.length) return [];
  const formas = db.select({ f: formasPago, c: cuentas }).from(formasPago).innerJoin(cuentas, eq(cuentas.id, formasPago.cuentaId))
    .where(inArray(formasPago.id, [...new Set(pagos.map((p) => p.formaPagoId))])).all();
  return pagos.map((p) => {
    const fc = formas.find((x) => x.f.id === p.formaPagoId);
    if (!fc) throw noEncontrado('La forma de pago');
    if (!fc.f.activo) throw new ErrorNegocio(`La forma de pago ${fc.f.nombre} está inactiva`);
    if (!Number.isInteger(p.importeCentavos) || p.importeCentavos <= 0) throw new ErrorNegocio('Los importes cobrados tienen que ser mayores a cero');
    if (fc.c.moneda !== 'ARS' && !(p.importeMonedaCentavos && p.importeMonedaCentavos > 0)) throw new ErrorNegocio(`Indicá cuántos ${fc.c.moneda} se cobraron`);
    if (p.comisionRealCentavos != null && (p.comisionRealCentavos < 0 || p.comisionRealCentavos > p.importeCentavos)) throw new ErrorNegocio('Comisión real inválida');
    return { ...p, forma: fc.f, cuenta: fc.c, comision: comisionEstimada(p.importeCentavos, fc.f.comisionBp) };
  });
}

/** Registra un cobro: la fila del cobro y la plata en caja (con la comisión si corresponde). */
function registrarCobro(ctx: Ctx, v: { id: number; numero: number }, p: ReturnType<typeof prepararCobros>[number], fecha: string, posterior: boolean) {
  const fila = ctx.db.insert(ventaPagos).values({
    ventaId: v.id, formaPagoId: p.forma.id, cuentaId: p.cuenta.id, importeCentavos: p.importeCentavos, importeMonedaCentavos: p.cuenta.moneda === 'ARS' ? null : p.importeMonedaCentavos!,
    comisionEstimadaCentavos: p.comision, comisionRealCentavos: p.comisionRealCentavos ?? null, fecha: posterior ? fecha : null,
  }).returning().get();
  // Lo cobrado al vender queda atado a la venta; un cobro posterior, a su propio cobro (se anula por separado).
  const ref = posterior ? { refTipo: 'cobro', refId: fila.id } : { refTipo: 'venta', refId: v.id };
  const que = posterior ? `Cobro de saldo V-${v.numero}` : `Venta V-${v.numero}`;
  registrarCaja(ctx, {
    fecha, cuentaId: p.cuenta.id, importeCentavos: p.cuenta.moneda === 'ARS' ? p.importeCentavos : p.importeMonedaCentavos!, importeArsCentavos: p.importeCentavos,
    tipo: 'venta', concepto: `${que} · ${p.forma.nombre}`, ...ref,
  });
  const comision = p.comisionRealCentavos ?? p.comision;
  if (comision > 0 && p.cuenta.tipo !== 'a_liquidar' && p.cuenta.moneda === 'ARS') {
    registrarCaja(ctx, { fecha, cuentaId: p.cuenta.id, importeCentavos: -comision, tipo: 'comision', concepto: `Comisión ${que} · ${p.forma.nombre}`, ...ref });
  }
  return fila;
}

function validarVenta(ctx: Ctx, d: DatosVenta) {
  if (!d.items.length) throw new ErrorNegocio('Agregá al menos un producto');
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
  const subtotal = d.items.reduce((s, i) => s + i.cantidad * i.precioCentavos, 0);
  const descuento = d.descuentoCentavos ?? 0;
  if (!Number.isInteger(descuento) || descuento < 0 || descuento > subtotal) throw new ErrorNegocio('El descuento no puede ser mayor que el total');
  if (descuento > 0 && !d.motivoDescuento?.trim()) throw new ErrorNegocio('Indicá el motivo del descuento');
  const cliente = d.clienteId ? ctx.db.select().from(clientes).where(eq(clientes.id, d.clienteId)).get() : null;
  if (d.clienteId && !cliente) throw noEncontrado('El cliente');
  return { vars, listaId, preciosLista, total: subtotal - descuento, descuento, cliente };
}

/** Graba los productos (y su salida de stock) de una venta. */
function grabarItems(ctx: Ctx, v: { id: number; numero: number }, d: DatosVenta, val: ReturnType<typeof validarVenta>) {
  for (const i of d.items) {
    const vr = val.vars.find((x) => x.id === i.varianteId)!;
    const costo = vr.costo === null ? null : Number(vr.costo);
    ctx.db.insert(ventaItems).values({ ventaId: v.id, varianteId: i.varianteId, cantidad: i.cantidad, precioListaCentavos: val.preciosLista.get(i.varianteId) ?? null, precioCentavos: i.precioCentavos, costoUnitarioCentavos: costo }).run();
    registrarMovimiento(ctx, { varianteId: i.varianteId, cantidad: -i.cantidad, tipo: 'venta', fecha: d.fecha, refTipo: 'venta', refId: v.id, costoUnitarioCentavos: costo, motivo: `Venta V-${v.numero}` });
  }
}

const textoPesos = (c: number) => (c / 100).toLocaleString('es-AR');

export function crearVenta(ctx: Ctx, d: DatosVenta) {
  const val = validarVenta(ctx, d);
  const pagos = prepararCobros(ctx.db, d.pagos);
  const cobrado = pagos.reduce((s, p) => s + p.importeCentavos, 0);
  if (cobrado > val.total) throw new ErrorNegocio(`Lo cobrado (${textoPesos(cobrado)}) supera el total de la venta (${textoPesos(val.total)})`);
  if (cobrado < val.total && !val.cliente) throw new ErrorNegocio(`Lo cobrado (${textoPesos(cobrado)}) no llega al total (${textoPesos(val.total)}). Si queda debiendo, elegí el cliente`);

  const t = ahora();
  const v = ctx.db.insert(ventas).values({
    numero: siguienteNumero(ctx.db, 'venta'), fecha: d.fecha, cliente: val.cliente?.nombre ?? (d.cliente?.trim() || null), clienteId: val.cliente?.id ?? null,
    listaPrecioId: val.listaId, notas: d.notas?.trim() || null, descuentoCentavos: val.descuento, motivoDescuento: val.descuento ? d.motivoDescuento!.trim() : null,
    usuarioId: ctx.usuarioId, creadoEn: t, actualizadoEn: t,
  }).returning().get();
  grabarItems(ctx, v, d, val);
  for (const p of pagos) registrarCobro(ctx, v, p, d.fecha, false);
  sumarVenta(ctx, v.id, d.items);
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: 'venta', entidadId: v.id, despues: { numero: v.numero, fecha: d.fecha, totalCentavos: val.total, descuentoCentavos: val.descuento, clienteId: v.clienteId, items: d.items, pagos: d.pagos } });
  return { id: v.id, numero: v.numero, totalCentavos: val.total, saldoCentavos: val.total - cobrado };
}

/** Salidas de stock de la venta que todavía no fueron devueltas. */
function salidasVigentes(db: DB, ventaId: number) {
  const movs = db.select().from(movimientosStock).where(and(eq(movimientosStock.refTipo, 'venta'), eq(movimientosStock.refId, ventaId))).all();
  const devueltos = new Set(movs.filter((m) => m.anulaId).map((m) => m.anulaId));
  return movs.filter((m) => m.tipo === 'venta' && !devueltos.has(m.id));
}

function ventaOError(db: DB, id: number) {
  const v = db.select().from(ventas).where(eq(ventas.id, id)).get();
  if (!v) throw noEncontrado('La venta');
  return v;
}

const cobrosPosteriores = (db: DB, ventaId: number) =>
  db.select().from(ventaPagos).where(and(eq(ventaPagos.ventaId, ventaId), sql`${ventaPagos.fecha} is not null`, eq(ventaPagos.estado, 'activo'))).all();

/**
 * Edita una venta: guarda la versión anterior, devuelve el stock y revierte la plata de lo cobrado al vender,
 * y vuelve a registrar todo con los datos nuevos (mismo número de venta). Los cobros posteriores no se tocan.
 */
export function editarVenta(ctx: Ctx, id: number, d: DatosVenta, motivo: string) {
  if (!motivo?.trim()) throw new ErrorNegocio('Indicá el motivo de la corrección');
  const v = ventaOError(ctx.db, id);
  if (v.estado === 'anulada') throw new ErrorNegocio('La venta está anulada: no se puede editar');
  const val = validarVenta(ctx, d);
  const pagos = prepararCobros(ctx.db, d.pagos);
  const posteriores = cobrosPosteriores(ctx.db, id).reduce((s, p) => s + p.importeCentavos, 0);
  const cobrado = pagos.reduce((s, p) => s + p.importeCentavos, 0) + posteriores;
  if (cobrado > val.total) throw new ErrorNegocio(`Lo cobrado (${textoPesos(cobrado)}, incluye cobros posteriores) supera el total nuevo (${textoPesos(val.total)}). Anulá antes el cobro que sobra`);
  if (cobrado < val.total && !val.cliente) throw new ErrorNegocio(`Lo cobrado (${textoPesos(cobrado)}) no llega al total (${textoPesos(val.total)}). Si queda debiendo, elegí el cliente`);

  const anterior = obtenerVenta(ctx.db, id);
  ctx.db.insert(ventaVersiones).values({ ventaId: id, version: v.version, datos: anterior, motivo: motivo.trim(), usuarioId: ctx.usuarioId, fecha: ahora() }).run();
  const fecha = hoyLocal();
  const nota = `Corrige venta V-${v.numero}: ${motivo.trim()}`;
  for (const m of salidasVigentes(ctx.db, id)) {
    registrarMovimiento(ctx, { varianteId: m.varianteId, cantidad: -m.cantidad, tipo: 'anulacion', anulaId: m.id, refTipo: 'venta', refId: id, costoUnitarioCentavos: m.costoUnitarioCentavos, fecha, motivo: nota });
  }
  revertirMovimientos(ctx, { refTipo: 'venta', refId: id }, `venta V-${v.numero} corregida: ${motivo.trim()}`, fecha);
  // El detalle (productos y cobros al vender) se reemplaza: la versión anterior queda guardada en venta_versiones.
  ctx.db.delete(ventaItems).where(eq(ventaItems.ventaId, id)).run();
  ctx.db.delete(ventaPagos).where(and(eq(ventaPagos.ventaId, id), isNull(ventaPagos.fecha))).run();
  const nueva = ctx.db.update(ventas).set({
    fecha: d.fecha, cliente: val.cliente?.nombre ?? (d.cliente?.trim() || null), clienteId: val.cliente?.id ?? null, listaPrecioId: val.listaId, notas: d.notas?.trim() || null,
    descuentoCentavos: val.descuento, motivoDescuento: val.descuento ? d.motivoDescuento!.trim() : null, version: v.version + 1, actualizadoEn: ahora(),
  }).where(eq(ventas.id, id)).returning().get();
  grabarItems(ctx, nueva, d, val);
  for (const p of pagos) registrarCobro(ctx, nueva, p, d.fecha, false);
  quitarVenta(ctx, id, v.numero);
  sumarVenta(ctx, id, d.items);
  const despues = obtenerVenta(ctx.db, id);
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'venta', entidadId: id, detalle: motivo.trim(),
    antes: resumenVenta(anterior), despues: resumenVenta(despues) });
  return { id, numero: v.numero, version: nueva.version, totalCentavos: despues.totalCentavos, saldoCentavos: despues.saldoCentavos };
}

const resumenVenta = (v: ReturnType<typeof obtenerVenta>) => ({
  fecha: v.fecha, cliente: v.cliente, totalCentavos: v.totalCentavos, descuentoCentavos: v.descuentoCentavos,
  items: v.items.map((i) => ({ sku: i.sku, cantidad: i.cantidad, precioCentavos: i.precioCentavos })),
  cobros: v.pagos.filter((p) => p.estado === 'activo').map((p) => ({ forma: p.forma, importeCentavos: p.importeCentavos, fecha: p.fecha })),
});

/** Cobro posterior de una venta que quedó debiendo. */
export function cobrarSaldo(ctx: Ctx, ventaId: number, d: DatosCobro & { fecha: string }) {
  const v = ventaOError(ctx.db, ventaId);
  if (v.estado === 'anulada') throw new ErrorNegocio('La venta está anulada');
  const saldo = obtenerVenta(ctx.db, ventaId).saldoCentavos;
  if (saldo <= 0) throw new ErrorNegocio('La venta no tiene saldo pendiente');
  const [p] = prepararCobros(ctx.db, [d]);
  if (p.importeCentavos > saldo) throw new ErrorNegocio(`El cobro supera lo que falta cobrar (${textoPesos(saldo)})`);
  const fila = registrarCobro(ctx, v, p, d.fecha, true);
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'cobro', entidad: 'venta', entidadId: ventaId, despues: { cobroId: fila.id, fecha: d.fecha, importeCentavos: d.importeCentavos, forma: p.forma.nombre } });
  return { cobroId: fila.id, saldoCentavos: saldo - p.importeCentavos };
}

/** Anula un cobro posterior: la plata vuelve a salir de la cuenta y la venta vuelve a deber ese importe. */
export function anularCobro(ctx: Ctx, cobroId: number, motivo: string) {
  if (!motivo?.trim()) throw new ErrorNegocio('Indicá el motivo de la anulación');
  const p = ctx.db.select().from(ventaPagos).where(eq(ventaPagos.id, cobroId)).get();
  if (!p) throw noEncontrado('El cobro');
  if (!p.fecha) throw new ErrorNegocio('Ese cobro se hizo al vender: para cambiarlo, editá la venta');
  if (p.estado === 'anulado') throw new ErrorNegocio('El cobro ya está anulado');
  const v = ventaOError(ctx.db, p.ventaId);
  revertirMovimientos(ctx, { refTipo: 'cobro', refId: cobroId }, `cobro de V-${v.numero} anulado: ${motivo.trim()}`);
  ctx.db.update(ventaPagos).set({ estado: 'anulado', motivoAnulacion: motivo.trim() }).where(eq(ventaPagos.id, cobroId)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'anular', entidad: 'cobro', entidadId: cobroId, detalle: motivo.trim(), antes: p });
  return { ok: true };
}

/** Anula una venta: el stock vuelve (movimiento de anulación) y la plata (también la de cobros posteriores) se revierte en caja. */
export function anularVenta(ctx: Ctx, id: number, motivo: string) {
  if (!motivo?.trim()) throw new ErrorNegocio('Indicá el motivo de la anulación');
  const v = ventaOError(ctx.db, id);
  if (v.estado === 'anulada') throw new ErrorNegocio('La venta ya está anulada');
  const fecha = hoyLocal();
  for (const m of salidasVigentes(ctx.db, id)) {
    registrarMovimiento(ctx, { varianteId: m.varianteId, cantidad: -m.cantidad, tipo: 'anulacion', anulaId: m.id, refTipo: 'venta', refId: id, costoUnitarioCentavos: m.costoUnitarioCentavos, fecha, motivo: `Anula venta V-${v.numero}: ${motivo.trim()}` });
  }
  revertirMovimientos(ctx, { refTipo: 'venta', refId: id }, `venta V-${v.numero} anulada: ${motivo.trim()}`, fecha);
  for (const c of cobrosPosteriores(ctx.db, id)) {
    revertirMovimientos(ctx, { refTipo: 'cobro', refId: c.id }, `venta V-${v.numero} anulada: ${motivo.trim()}`, fecha);
    ctx.db.update(ventaPagos).set({ estado: 'anulado', motivoAnulacion: `Venta anulada: ${motivo.trim()}` }).where(eq(ventaPagos.id, c.id)).run();
  }
  ctx.db.update(ventas).set({ estado: 'anulada', motivoAnulacion: motivo.trim(), actualizadoEn: ahora() }).where(eq(ventas.id, id)).run();
  quitarVenta(ctx, id, v.numero);
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
  if (p.estado === 'anulado') throw new ErrorNegocio('El cobro está anulado');
  if (realCentavos !== null && (!Number.isInteger(realCentavos) || realCentavos < 0 || realCentavos > p.importeCentavos)) throw new ErrorNegocio('Comisión inválida');
  const c = cuentaOError(ctx.db, p.cuentaId, { activa: false });
  const antes = p.comisionRealCentavos ?? p.comisionEstimadaCentavos;
  const despues = realCentavos ?? p.comisionEstimadaCentavos;
  if (c.tipo !== 'a_liquidar' && c.moneda === 'ARS' && antes !== despues) {
    registrarCaja(ctx, { fecha: hoyLocal(), cuentaId: c.id, importeCentavos: antes - despues, tipo: 'comision', concepto: `Corrección de comisión venta V-${v.numero}`, ...(p.fecha ? { refTipo: 'cobro', refId: p.id } : { refTipo: 'venta', refId: v.id }) });
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
  const versiones = db.select().from(ventaVersiones).where(eq(ventaVersiones.ventaId, id)).orderBy(desc(ventaVersiones.version)).all()
    .map((x) => ({ id: x.id, version: x.version, motivo: x.motivo, fecha: x.fecha, usuarioId: x.usuarioId }));
  return { ...v, lista, items, pagos, versiones, ...totalesVenta(items, pagos, v.descuentoCentavos) };
}

/** Una versión anterior completa de una venta editada. */
export function versionVenta(db: DB, ventaId: number, version: number) {
  const x = db.select().from(ventaVersiones).where(and(eq(ventaVersiones.ventaId, ventaId), eq(ventaVersiones.version, version))).get();
  if (!x) throw noEncontrado('Esa versión');
  return x;
}

type PagoT = { importeCentavos: number; comisionEstimadaCentavos: number; comisionRealCentavos: number | null; estado: 'activo' | 'anulado' };
function totalesVenta(items: { cantidad: number; precioCentavos: number; precioListaCentavos: number | null; costoUnitarioCentavos: number | null }[], todos: PagoT[], descuentoCentavos: number) {
  const pagos = todos.filter((p) => p.estado === 'activo');
  const subtotalCentavos = items.reduce((s, i) => s + i.cantidad * i.precioCentavos, 0);
  const totalCentavos = subtotalCentavos - descuentoCentavos;
  const cobradoCentavos = pagos.reduce((s, p) => s + p.importeCentavos, 0);
  const listaCentavos = items.every((i) => i.precioListaCentavos !== null) ? items.reduce((s, i) => s + i.cantidad * i.precioListaCentavos!, 0) : null;
  const sinCosto = items.some((i) => i.costoUnitarioCentavos === null);
  const costoMercaderiaCentavos = sinCosto ? null : items.reduce((s, i) => s + i.cantidad * i.costoUnitarioCentavos!, 0);
  const comisionCentavos = pagos.reduce((s, p) => s + (p.comisionRealCentavos ?? p.comisionEstimadaCentavos), 0);
  return {
    subtotalCentavos, totalCentavos, cobradoCentavos, saldoCentavos: totalCentavos - cobradoCentavos, listaCentavos, diferenciaListaCentavos: listaCentavos === null ? null : totalCentavos - listaCentavos,
    costoMercaderiaCentavos, comisionCentavos, gananciaCentavos: costoMercaderiaCentavos === null ? null : totalCentavos - costoMercaderiaCentavos - comisionCentavos,
    unidades: items.reduce((s, i) => s + i.cantidad, 0),
  };
}

export interface FiltroVentas { desde?: string; hasta?: string; q?: string; formaPagoId?: number; estado?: 'confirmada' | 'anulada'; clienteId?: number; conSaldo?: boolean; pagina?: number; porPagina?: number }

/** Lo que falta cobrar de una venta (total − descuento − cobros vigentes), en SQL. */
export const saldoSql = sql<number>`((select coalesce(sum(vi.cantidad * vi.precio_centavos), 0) from venta_items vi where vi.venta_id = ${ventas.id}) - ${ventas.descuentoCentavos}
  - (select coalesce(sum(vp.importe_centavos), 0) from venta_pagos vp where vp.venta_id = ${ventas.id} and vp.estado = 'activo'))`;

export function listarVentas(db: DB, f: FiltroVentas) {
  const conds = [];
  if (f.desde) conds.push(gte(ventas.fecha, f.desde));
  if (f.hasta) conds.push(lte(ventas.fecha, f.hasta));
  if (f.estado) conds.push(eq(ventas.estado, f.estado));
  if (f.clienteId) conds.push(eq(ventas.clienteId, f.clienteId));
  if (f.conSaldo) conds.push(and(eq(ventas.estado, 'confirmada'), sql`${saldoSql} > 0`));
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
      ...v, ...totalesVenta(its.map((x) => x.i), pgs.map((x) => x.p), v.descuentoCentavos),
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
    saldoCentavos: validas.reduce((s, v) => s + v.saldoCentavos, 0),
    descuentoCentavos: validas.reduce((s, v) => s + v.descuentoCentavos, 0),
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

