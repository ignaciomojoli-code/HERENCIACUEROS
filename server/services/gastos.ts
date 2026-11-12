/**
 * Gastos del local (con categorías y subcategorías) y pagos a proveedores.
 * Cada uno descuenta la plata de una cuenta. Si lo pagó alguien de afuera (cuenta externa, ej. el inversor),
 * queda registrado como aporte + gasto. Los gastos personales no van acá: son retiros (módulo de caja).
 */
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { categoriasGasto, compras, cuentas, gastos, movimientosCaja, pagosProveedor, proveedores } from '../db/schema.js';
import type { DB } from '../db/index.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { siguienteNumero } from './numeracion.js';
import type { Ctx } from './stock.js';
import { cuentaOError, hoyLocal, registrarSalida, revertirMovimientos } from './caja.js';
import { listarCompras } from './compras.js';

// ───────────── Categorías ─────────────

export function listarCategoriasGasto(db: DB) {
  return db.select().from(categoriasGasto).orderBy(asc(categoriasGasto.orden), asc(categoriasGasto.nombre)).all();
}

export function guardarCategoriaGasto(ctx: Ctx, id: number | null, d: { nombre: string; padreId?: number | null; orden?: number; activo?: boolean }) {
  const nombre = d.nombre?.trim();
  if (!nombre) throw new ErrorNegocio('Poné un nombre');
  const padreId = d.padreId ?? null;
  if (padreId) {
    const p = ctx.db.select().from(categoriasGasto).where(eq(categoriasGasto.id, padreId)).get();
    if (!p) throw noEncontrado('La categoría');
    if (p.padreId) throw new ErrorNegocio('Las subcategorías van debajo de una categoría, no de otra subcategoría');
    if (id !== null && padreId === id) throw new ErrorNegocio('Una categoría no puede ser subcategoría de sí misma');
  }
  const repetida = ctx.db.select().from(categoriasGasto).where(and(sql`lower(${categoriasGasto.nombre}) = lower(${nombre})`, sql`coalesce(${categoriasGasto.padreId}, 0) = ${padreId ?? 0}`)).get();
  if (repetida && repetida.id !== id) throw new ErrorNegocio('Ya existe con ese nombre');
  if (id === null) {
    const c = ctx.db.insert(categoriasGasto).values({ nombre, padreId, orden: d.orden ?? 0, activo: d.activo ?? true, creadoEn: ahora() }).returning().get();
    auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: 'categoria_gasto', entidadId: c.id, despues: c });
    return c;
  }
  const antes = ctx.db.select().from(categoriasGasto).where(eq(categoriasGasto.id, id)).get();
  if (!antes) throw noEncontrado('La categoría');
  if (padreId && ctx.db.select({ id: categoriasGasto.id }).from(categoriasGasto).where(eq(categoriasGasto.padreId, id)).limit(1).get()) {
    throw new ErrorNegocio('Esta categoría tiene subcategorías: no puede pasar a ser subcategoría');
  }
  const c = ctx.db.update(categoriasGasto).set({ nombre, padreId, orden: d.orden ?? antes.orden, activo: d.activo ?? antes.activo }).where(eq(categoriasGasto.id, id)).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'categoria_gasto', entidadId: id, antes, despues: c });
  return c;
}

function validarCategoria(db: DB, categoriaId: number, subcategoriaId?: number | null) {
  const cat = db.select().from(categoriasGasto).where(eq(categoriasGasto.id, categoriaId)).get();
  if (!cat) throw noEncontrado('La categoría');
  if (cat.padreId) throw new ErrorNegocio('Elegí una categoría principal y, si querés, una subcategoría');
  if (!cat.activo) throw new ErrorNegocio(`La categoría ${cat.nombre} está inactiva`);
  if (subcategoriaId) {
    const sub = db.select().from(categoriasGasto).where(eq(categoriasGasto.id, subcategoriaId)).get();
    if (!sub || sub.padreId !== categoriaId) throw new ErrorNegocio('La subcategoría no corresponde a esa categoría');
    if (!sub.activo) throw new ErrorNegocio(`La subcategoría ${sub.nombre} está inactiva`);
  }
}

// ───────────── Gastos ─────────────

export interface DatosGasto {
  fecha: string; concepto: string; categoriaId: number; subcategoriaId?: number | null; importeCentavos: number; cuentaId: number;
  proveedorId?: number | null; comprobante?: string | null; notas?: string | null;
}

export function crearGasto(ctx: Ctx, d: DatosGasto) {
  if (!d.concepto?.trim()) throw new ErrorNegocio('Indicá el concepto');
  if (!Number.isInteger(d.importeCentavos) || d.importeCentavos <= 0) throw new ErrorNegocio('El importe tiene que ser mayor a cero');
  validarCategoria(ctx.db, d.categoriaId, d.subcategoriaId);
  const c = cuentaOError(ctx.db, d.cuentaId);
  if (c.tipo === 'a_liquidar') throw new ErrorNegocio('No se puede pagar desde tarjetas a liquidar');
  if (c.moneda !== 'ARS') throw new ErrorNegocio('Los gastos se pagan en pesos. Si pagaste con dólares, hacé primero el cambio (pase de Dólares a Efectivo)');
  if (d.proveedorId && !ctx.db.select({ id: proveedores.id }).from(proveedores).where(eq(proveedores.id, d.proveedorId)).get()) throw noEncontrado('El proveedor');
  const t = ahora();
  const g = ctx.db.insert(gastos).values({
    numero: siguienteNumero(ctx.db, 'gasto'), fecha: d.fecha, concepto: d.concepto.trim(), categoriaId: d.categoriaId, subcategoriaId: d.subcategoriaId ?? null,
    importeCentavos: d.importeCentavos, cuentaId: d.cuentaId, proveedorId: d.proveedorId ?? null, comprobante: d.comprobante?.trim() || null, notas: d.notas?.trim() || null,
    usuarioId: ctx.usuarioId, creadoEn: t, actualizadoEn: t,
  }).returning().get();
  registrarSalida(ctx, { fecha: d.fecha, cuentaId: d.cuentaId, importeCentavos: d.importeCentavos, tipo: 'gasto', concepto: `Gasto G-${g.numero}: ${g.concepto}`, refTipo: 'gasto', refId: g.id });
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: 'gasto', entidadId: g.id, despues: g });
  return g;
}

/** Corrige datos descriptivos (concepto, categoría, comprobante, notas). Para cambiar importe, fecha o cuenta: anular y cargar de nuevo. */
export function editarGasto(ctx: Ctx, id: number, d: { concepto: string; categoriaId: number; subcategoriaId?: number | null; proveedorId?: number | null; comprobante?: string | null; notas?: string | null }) {
  const antes = ctx.db.select().from(gastos).where(eq(gastos.id, id)).get();
  if (!antes) throw noEncontrado('El gasto');
  if (antes.estado === 'anulado') throw new ErrorNegocio('El gasto está anulado');
  if (!d.concepto?.trim()) throw new ErrorNegocio('Indicá el concepto');
  validarCategoria(ctx.db, d.categoriaId, d.subcategoriaId);
  const g = ctx.db.update(gastos).set({ concepto: d.concepto.trim(), categoriaId: d.categoriaId, subcategoriaId: d.subcategoriaId ?? null, proveedorId: d.proveedorId ?? null, comprobante: d.comprobante?.trim() || null, notas: d.notas?.trim() || null, actualizadoEn: ahora() }).where(eq(gastos.id, id)).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'gasto', entidadId: id, antes, despues: g });
  return g;
}

export function anularGasto(ctx: Ctx, id: number, motivo: string) {
  if (!motivo?.trim()) throw new ErrorNegocio('Indicá el motivo de la anulación');
  const g = ctx.db.select().from(gastos).where(eq(gastos.id, id)).get();
  if (!g) throw noEncontrado('El gasto');
  if (g.estado === 'anulado') throw new ErrorNegocio('El gasto ya está anulado');
  revertirMovimientos(ctx, { refTipo: 'gasto', refId: id }, `gasto G-${g.numero} anulado: ${motivo.trim()}`, hoyLocal());
  ctx.db.update(gastos).set({ estado: 'anulado', motivoAnulacion: motivo.trim(), actualizadoEn: ahora() }).where(eq(gastos.id, id)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'anular', entidad: 'gasto', entidadId: id, detalle: motivo });
  return { ok: true };
}

export interface FiltroGastos { desde?: string; hasta?: string; categoriaId?: number; subcategoriaId?: number; cuentaId?: number; q?: string; estado?: 'activo' | 'anulado' | 'todos' }

export function listarGastos(db: DB, f: FiltroGastos) {
  const sub = alias(categoriasGasto, 'sub');
  const conds = [];
  if (f.desde) conds.push(gte(gastos.fecha, f.desde));
  if (f.hasta) conds.push(lte(gastos.fecha, f.hasta));
  if (f.categoriaId) conds.push(eq(gastos.categoriaId, f.categoriaId));
  if (f.subcategoriaId) conds.push(eq(gastos.subcategoriaId, f.subcategoriaId));
  if (f.cuentaId) conds.push(eq(gastos.cuentaId, f.cuentaId));
  if (f.estado !== 'todos') conds.push(eq(gastos.estado, f.estado ?? 'activo'));
  if (f.q?.trim()) { const q = `%${f.q.trim()}%`; conds.push(sql`(${gastos.concepto} like ${q} or ${gastos.notas} like ${q} or ${gastos.comprobante} like ${q})`); }
  const filas = db.select({ g: gastos, categoria: categoriasGasto.nombre, subcategoria: sub.nombre, cuenta: cuentas.nombre, tipoCuenta: cuentas.tipo, proveedor: proveedores.nombre })
    .from(gastos).innerJoin(categoriasGasto, eq(categoriasGasto.id, gastos.categoriaId)).leftJoin(sub, eq(sub.id, gastos.subcategoriaId))
    .innerJoin(cuentas, eq(cuentas.id, gastos.cuentaId)).leftJoin(proveedores, eq(proveedores.id, gastos.proveedorId))
    .where(conds.length ? and(...conds) : undefined).orderBy(desc(gastos.fecha), desc(gastos.numero)).all()
    .map((r) => ({ ...r.g, categoria: r.categoria, subcategoria: r.subcategoria, cuenta: r.cuenta, tipoCuenta: r.tipoCuenta, proveedor: r.proveedor }));
  const activos = filas.filter((g) => g.estado === 'activo');
  const porCategoria = new Map<string, { categoria: string; totalCentavos: number; cantidad: number; sub: Map<string, number> }>();
  for (const g of activos) {
    const e = porCategoria.get(g.categoria) ?? { categoria: g.categoria, totalCentavos: 0, cantidad: 0, sub: new Map() };
    e.totalCentavos += g.importeCentavos; e.cantidad++;
    const s = g.subcategoria ?? 'Sin subcategoría';
    e.sub.set(s, (e.sub.get(s) ?? 0) + g.importeCentavos);
    porCategoria.set(g.categoria, e);
  }
  return {
    totalCentavos: activos.reduce((s, g) => s + g.importeCentavos, 0),
    pagadoPorExternosCentavos: activos.filter((g) => g.tipoCuenta === 'externa').reduce((s, g) => s + g.importeCentavos, 0),
    porCategoria: [...porCategoria.values()].sort((a, b) => b.totalCentavos - a.totalCentavos).map((c) => ({ ...c, sub: [...c.sub].map(([nombre, totalCentavos]) => ({ nombre, totalCentavos })).sort((a, b) => b.totalCentavos - a.totalCentavos) })),
    filas,
  };
}

// ───────────── Pagos a proveedores ─────────────

export interface DatosPago { fecha: string; proveedorId: number; compraId?: number | null; cuentaId: number; importeCentavos: number; comprobante?: string | null; notas?: string | null }

export function crearPago(ctx: Ctx, d: DatosPago) {
  if (!Number.isInteger(d.importeCentavos) || d.importeCentavos <= 0) throw new ErrorNegocio('El importe tiene que ser mayor a cero');
  const p = ctx.db.select().from(proveedores).where(eq(proveedores.id, d.proveedorId)).get();
  if (!p) throw noEncontrado('El proveedor');
  if (d.compraId) {
    const c = ctx.db.select().from(compras).where(eq(compras.id, d.compraId)).get();
    if (!c || c.proveedorId !== d.proveedorId) throw new ErrorNegocio('El pedido no es de ese proveedor');
    if (c.estado === 'anulada') throw new ErrorNegocio('El pedido está anulado');
  }
  const c = cuentaOError(ctx.db, d.cuentaId);
  if (c.tipo === 'a_liquidar') throw new ErrorNegocio('No se puede pagar desde tarjetas a liquidar');
  if (c.moneda !== 'ARS') throw new ErrorNegocio('Los pagos se registran en pesos. Si pagaste con dólares, hacé primero el cambio (pase de Dólares a Efectivo)');
  const t = ahora();
  const pago = ctx.db.insert(pagosProveedor).values({
    numero: siguienteNumero(ctx.db, 'pago_proveedor'), fecha: d.fecha, proveedorId: d.proveedorId, compraId: d.compraId ?? null, cuentaId: d.cuentaId,
    importeCentavos: d.importeCentavos, comprobante: d.comprobante?.trim() || null, notas: d.notas?.trim() || null, usuarioId: ctx.usuarioId, creadoEn: t, actualizadoEn: t,
  }).returning().get();
  registrarSalida(ctx, { fecha: d.fecha, cuentaId: d.cuentaId, importeCentavos: d.importeCentavos, tipo: 'pago_proveedor', concepto: `Pago PP-${pago.numero} a ${p.nombre}${d.notas?.trim() ? ': ' + d.notas.trim() : ''}`, refTipo: 'pago_proveedor', refId: pago.id });
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: 'pago_proveedor', entidadId: pago.id, despues: pago });
  return pago;
}

export function anularPago(ctx: Ctx, id: number, motivo: string) {
  if (!motivo?.trim()) throw new ErrorNegocio('Indicá el motivo de la anulación');
  const p = ctx.db.select().from(pagosProveedor).where(eq(pagosProveedor.id, id)).get();
  if (!p) throw noEncontrado('El pago');
  if (p.estado === 'anulado') throw new ErrorNegocio('El pago ya está anulado');
  revertirMovimientos(ctx, { refTipo: 'pago_proveedor', refId: id }, `pago PP-${p.numero} anulado: ${motivo.trim()}`, hoyLocal());
  ctx.db.update(pagosProveedor).set({ estado: 'anulado', motivoAnulacion: motivo.trim(), actualizadoEn: ahora() }).where(eq(pagosProveedor.id, id)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'anular', entidad: 'pago_proveedor', entidadId: id, detalle: motivo });
  return { ok: true };
}

export function listarPagos(db: DB, f: { proveedorId?: number; desde?: string; hasta?: string; estado?: 'activo' | 'anulado' | 'todos' }) {
  const conds = [];
  if (f.proveedorId) conds.push(eq(pagosProveedor.proveedorId, f.proveedorId));
  if (f.desde) conds.push(gte(pagosProveedor.fecha, f.desde));
  if (f.hasta) conds.push(lte(pagosProveedor.fecha, f.hasta));
  if (f.estado !== 'todos') conds.push(eq(pagosProveedor.estado, f.estado ?? 'activo'));
  return db.select({ p: pagosProveedor, proveedor: proveedores.nombre, cuenta: cuentas.nombre, compraNumero: compras.numero })
    .from(pagosProveedor).innerJoin(proveedores, eq(proveedores.id, pagosProveedor.proveedorId)).innerJoin(cuentas, eq(cuentas.id, pagosProveedor.cuentaId))
    .leftJoin(compras, eq(compras.id, pagosProveedor.compraId))
    .where(conds.length ? and(...conds) : undefined).orderBy(desc(pagosProveedor.fecha), desc(pagosProveedor.numero)).all()
    .map((r) => ({ ...r.p, proveedor: r.proveedor, cuenta: r.cuenta, compraNumero: r.compraNumero }));
}

/** Cuenta corriente de proveedores: lo recibido (valorizado al costo del pedido) menos lo pagado. Positivo = se le debe. */
export function saldosProveedores(db: DB, proveedorIds?: number[]) {
  const pagado = db.select({ p: pagosProveedor.proveedorId, s: sql<number>`sum(${pagosProveedor.importeCentavos})` }).from(pagosProveedor)
    .where(and(eq(pagosProveedor.estado, 'activo'), proveedorIds ? inArray(pagosProveedor.proveedorId, proveedorIds) : undefined)).groupBy(pagosProveedor.proveedorId).all();
  const recibido = db.all<{ p: number; s: number }>(sql`
    select c.proveedor_id as p, coalesce(sum(ri.cantidad * ri.costo_unitario_centavos), 0) as s
    from recepcion_items ri join recepciones r on r.id = ri.recepcion_id join compras c on c.id = r.compra_id
    where r.estado = 'activa' and c.estado != 'anulada' group by c.proveedor_id`).filter((x) => !proveedorIds || proveedorIds.includes(x.p));
  const ids = new Set([...pagado.map((x) => x.p), ...recibido.map((x) => x.p)]);
  return new Map([...ids].map((id) => {
    const r = Number(recibido.find((x) => x.p === id)?.s ?? 0);
    const pg = Number(pagado.find((x) => x.p === id)?.s ?? 0);
    return [id, { recibidoCentavos: r, pagadoCentavos: pg, saldoCentavos: r - pg }];
  }));
}

export function cuentaCorrienteProveedor(db: DB, proveedorId: number) {
  const prov = db.select().from(proveedores).where(eq(proveedores.id, proveedorId)).get();
  if (!prov) throw noEncontrado('El proveedor');
  const recs = db.all<{ id: number; numero: number; fecha: string; compra: number; importe: number }>(sql`
    select r.id, r.numero, r.fecha, c.numero as compra, coalesce(sum(ri.cantidad * ri.costo_unitario_centavos), 0) as importe
    from recepciones r join compras c on c.id = r.compra_id join recepcion_items ri on ri.recepcion_id = r.id
    where c.proveedor_id = ${proveedorId} and r.estado = 'activa' and c.estado != 'anulada' group by r.id`);
  const pagos = listarPagos(db, { proveedorId });
  const lineas = [
    ...recs.map((r) => ({ fecha: r.fecha, orden: 0, tipo: 'recepcion' as const, refId: r.id, detalle: `Recepción R-${r.numero} · pedido P-${r.compra}`, debeCentavos: Number(r.importe), haberCentavos: 0 })),
    ...pagos.map((p) => ({ fecha: p.fecha, orden: 1, tipo: 'pago' as const, refId: p.id, detalle: `Pago PP-${p.numero} · ${p.cuenta}${p.notas ? ' · ' + p.notas : ''}`, debeCentavos: 0, haberCentavos: p.importeCentavos })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.orden - b.orden);
  let saldo = 0;
  const conSaldo = lineas.map((l) => ({ ...l, saldoCentavos: (saldo += l.debeCentavos - l.haberCentavos) }));
  const abiertas = listarCompras(db, { proveedorId }).filter((c) => c.estado === 'confirmada');
  return {
    proveedor: { id: prov.id, nombre: prov.nombre },
    saldoCentavos: saldo,
    pendienteEntregaCentavos: abiertas.reduce((s, c) => s + c.totalCentavos - c.recibidoCentavos, 0),
    lineas: conSaldo.reverse(),
  };
}

/** Lo que se pagó desde cuentas externas (aportes), agrupado por cuenta: cuánto puso cada uno. */
export function aportesPorCuenta(db: DB, desde?: string, hasta?: string) {
  return db.select({ cuentaId: movimientosCaja.cuentaId, cuenta: cuentas.nombre, totalCentavos: sql<number>`sum(${movimientosCaja.importeArsCentavos})` })
    .from(movimientosCaja).innerJoin(cuentas, eq(cuentas.id, movimientosCaja.cuentaId))
    .where(and(inArray(movimientosCaja.tipo, ['aporte']), desde ? gte(movimientosCaja.fecha, desde) : undefined, hasta ? lte(movimientosCaja.fecha, hasta) : undefined))
    .groupBy(movimientosCaja.cuentaId).all().map((r) => ({ ...r, totalCentavos: Number(r.totalCentavos) }));
}
