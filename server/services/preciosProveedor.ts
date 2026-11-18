/**
 * Precios por proveedor.
 * - Cada vez que se confirma o se corrige un pedido, queda guardado el precio acordado ("compra"), con fecha y pedido.
 * - El precio habitual del proveedor ("habitual") es el que se usa para estimar los pedidos nuevos.
 *   Solo cambia cuando el usuario lo decide: nunca se actualiza solo.
 * Un precio es de un material (con su color si el material va por color) o de un producto (variante).
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { colores, compraItems, compraMateriales, compras, materiales, modelos, preciosProveedor, proveedores, talles, variantes } from '../db/schema.js';
import type { DB } from '../db/index.js';
import type { Ctx } from './stock.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { hoyLocal } from './caja.js';
import { colorDeMovimiento } from './costos.js';

export type ClavePrecio = { materialId: number; colorId?: number | null; varianteId?: undefined } | { varianteId: number; materialId?: undefined; colorId?: undefined };

function condicion(proveedorId: number, k: ClavePrecio, colorExacto = true) {
  return and(
    eq(preciosProveedor.proveedorId, proveedorId), eq(preciosProveedor.estado, 'activo'),
    k.varianteId != null ? eq(preciosProveedor.varianteId, k.varianteId) : eq(preciosProveedor.materialId, k.materialId!),
    k.varianteId == null && colorExacto ? (k.colorId != null ? eq(preciosProveedor.colorId, k.colorId) : isNull(preciosProveedor.colorId)) : undefined,
  );
}

/** Precio habitual vigente. Para un material con color, si no hay precio de ese color se usa el general del material. */
export function precioHabitual(db: DB, proveedorId: number, k: ClavePrecio) {
  const buscar = (key: ClavePrecio) => db.select().from(preciosProveedor).where(and(condicion(proveedorId, key), eq(preciosProveedor.origen, 'habitual'))).orderBy(desc(preciosProveedor.id)).limit(1).get();
  return buscar(k) ?? (k.varianteId == null && k.colorId != null ? buscar({ materialId: k.materialId!, colorId: null }) : undefined) ?? null;
}

/** Último precio conocido (de un pedido o habitual), sin contar el pedido indicado. */
export function ultimoPrecio(db: DB, proveedorId: number, k: ClavePrecio, salvoCompraId?: number) {
  return db.select().from(preciosProveedor)
    .where(and(condicion(proveedorId, k), salvoCompraId ? sql`(${preciosProveedor.compraId} is null or ${preciosProveedor.compraId} != ${salvoCompraId})` : undefined))
    .orderBy(desc(preciosProveedor.id)).limit(1).get() ?? null;
}

/** Precio para estimar un pedido nuevo: el habitual del proveedor o, si no hay, el costo cargado del material. */
export function precioParaEstimar(db: DB, proveedorId: number | null, materialId: number, colorId: number | null, costoMaterial: number | null) {
  if (!proveedorId) return costoMaterial;
  return precioHabitual(db, proveedorId, { materialId, colorId })?.precioCentavos ?? costoMaterial;
}

/** Fija el precio habitual (decisión del usuario). Queda en el historial con fecha y motivo. */
export function fijarPrecioHabitual(ctx: Ctx, d: { proveedorId: number; materialId?: number | null; colorId?: number | null; varianteId?: number | null; precioCentavos: number; fecha?: string; motivo?: string | null }) {
  if (!Number.isInteger(d.precioCentavos) || d.precioCentavos < 0) throw new ErrorNegocio('Precio inválido');
  const prov = ctx.db.select().from(proveedores).where(eq(proveedores.id, d.proveedorId)).get();
  if (!prov) throw noEncontrado('El proveedor');
  if (!!d.materialId === !!d.varianteId) throw new ErrorNegocio('Indicá un material o un producto');
  let colorId: number | null = null;
  if (d.materialId) {
    const m = ctx.db.select().from(materiales).where(eq(materiales.id, d.materialId)).get();
    if (!m) throw noEncontrado('El material');
    colorId = d.colorId == null ? null : colorDeMovimiento(ctx.db, m, d.colorId);
  } else if (!ctx.db.select({ id: variantes.id }).from(variantes).where(eq(variantes.id, d.varianteId!)).get()) throw noEncontrado('El producto');
  const k: ClavePrecio = d.materialId ? { materialId: d.materialId, colorId } : { varianteId: d.varianteId! };
  const antes = precioHabitual(ctx.db, d.proveedorId, k);
  const fila = ctx.db.insert(preciosProveedor).values({
    proveedorId: d.proveedorId, materialId: d.materialId ?? null, colorId, varianteId: d.varianteId ?? null, precioCentavos: d.precioCentavos,
    fecha: d.fecha ?? hoyLocal(), origen: 'habitual', motivo: d.motivo?.trim() || null, usuarioId: ctx.usuarioId, creadoEn: ahora(),
  }).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'precio_proveedor', entidadId: fila.id, antes: antes ? { precioCentavos: antes.precioCentavos, fecha: antes.fecha } : null,
    despues: { proveedor: prov.nombre, ...k, precioCentavos: d.precioCentavos }, detalle: d.motivo?.trim() || 'Precio habitual del proveedor' });
  return fila;
}

/** Anula un precio del historial cargado por error (no se borra: queda anulado). */
export function anularPrecio(ctx: Ctx, id: number, motivo: string) {
  if (!motivo?.trim()) throw new ErrorNegocio('Indicá el motivo');
  const p = ctx.db.select().from(preciosProveedor).where(eq(preciosProveedor.id, id)).get();
  if (!p) throw noEncontrado('El precio');
  if (p.estado === 'anulado') throw new ErrorNegocio('Ya está anulado');
  ctx.db.update(preciosProveedor).set({ estado: 'anulado' }).where(eq(preciosProveedor.id, id)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'anular', entidad: 'precio_proveedor', entidadId: id, antes: p, detalle: motivo.trim() });
  return { ok: true };
}

/** Guarda en el historial los precios acordados en un pedido (al confirmarlo o corregirlo). Solo los que cambiaron respecto del último. */
export function registrarPreciosDeCompra(ctx: Ctx, compraId: number, fecha = hoyLocal()) {
  const c = ctx.db.select().from(compras).where(eq(compras.id, compraId)).get()!;
  const lineas: { k: ClavePrecio; precio: number }[] = [
    ...ctx.db.select().from(compraItems).where(eq(compraItems.compraId, compraId)).all().filter((l) => l.cantidad > 0).map((l) => ({ k: { varianteId: l.varianteId } as ClavePrecio, precio: l.costoUnitarioCentavos })),
    ...ctx.db.select().from(compraMateriales).where(eq(compraMateriales.compraId, compraId)).all().filter((l) => l.cantidadMil > 0).map((l) => ({ k: { materialId: l.materialId, colorId: l.colorId } as ClavePrecio, precio: l.costoUnitarioCentavos })),
  ];
  for (const l of lineas) {
    const ult = ctx.db.select().from(preciosProveedor).where(and(condicion(c.proveedorId, l.k), eq(preciosProveedor.origen, 'compra'), eq(preciosProveedor.compraId, compraId))).orderBy(desc(preciosProveedor.id)).limit(1).get();
    if (ult?.precioCentavos === l.precio) continue;
    ctx.db.insert(preciosProveedor).values({
      proveedorId: c.proveedorId, materialId: l.k.materialId ?? null, colorId: l.k.colorId ?? null, varianteId: l.k.varianteId ?? null, precioCentavos: l.precio,
      fecha, origen: 'compra', compraId, usuarioId: ctx.usuarioId, creadoEn: ahora(),
    }).run();
  }
}

/**
 * Precio anterior y habitual de cada línea de un pedido, para avisar aumentos (sin bloquear nada).
 * Devuelve un mapa por "m<materialId>|<colorId>" o "v<varianteId>".
 */
export function referenciasDePrecio(db: DB, proveedorId: number, compraId: number, lineas: ClavePrecio[]) {
  const r = new Map<string, { anteriorCentavos: number | null; anteriorFecha: string | null; habitualCentavos: number | null }>();
  for (const k of lineas) {
    const ant = ultimoPrecio(db, proveedorId, k, compraId);
    const hab = precioHabitual(db, proveedorId, k);
    r.set(clavePrecio(k), { anteriorCentavos: ant?.precioCentavos ?? null, anteriorFecha: ant?.fecha ?? null, habitualCentavos: hab?.precioCentavos ?? null });
  }
  return r;
}
export const clavePrecio = (k: ClavePrecio) => (k.varianteId != null ? `v${k.varianteId}` : `m${k.materialId}|${k.colorId ?? ''}`);

/** Historial de precios de un proveedor, agrupado por material/producto: habitual vigente, último precio y todos los cambios. */
export function historialPrecios(db: DB, proveedorId: number) {
  const filas = db.select({ p: preciosProveedor, material: materiales.nombre, unidad: materiales.unidad, color: colores.nombre, sku: variantes.sku, modelo: modelos.nombre, talle: talles.nombre, compraNumero: compras.numero })
    .from(preciosProveedor)
    .leftJoin(materiales, eq(materiales.id, preciosProveedor.materialId)).leftJoin(colores, eq(colores.id, preciosProveedor.colorId))
    .leftJoin(variantes, eq(variantes.id, preciosProveedor.varianteId)).leftJoin(modelos, eq(modelos.id, variantes.modeloId)).leftJoin(talles, eq(talles.id, variantes.talleId))
    .leftJoin(compras, eq(compras.id, preciosProveedor.compraId))
    .where(and(eq(preciosProveedor.proveedorId, proveedorId), eq(preciosProveedor.estado, 'activo'))).orderBy(preciosProveedor.fecha, preciosProveedor.id).all();
  const grupos = new Map<string, { clave: string; materialId: number | null; colorId: number | null; varianteId: number | null; nombre: string; detalle: string | null; unidad: string | null; habitualCentavos: number | null; habitualFecha: string | null; ultimoCentavos: number; ultimaFecha: string; variacionBp: number | null; cambios: { id: number; fecha: string; origen: string; precioCentavos: number; compraNumero: number | null; motivo: string | null; variacionBp: number | null }[] }>();
  for (const f of filas) {
    const k: ClavePrecio = f.p.varianteId != null ? { varianteId: f.p.varianteId } : { materialId: f.p.materialId!, colorId: f.p.colorId };
    const clave = clavePrecio(k);
    const g = grupos.get(clave) ?? {
      clave, materialId: f.p.materialId, colorId: f.p.colorId, varianteId: f.p.varianteId,
      nombre: f.p.varianteId != null ? `${f.modelo ?? ''}${f.talle ? ' T' + f.talle : ''}` : f.material ?? '—', detalle: f.p.varianteId != null ? f.sku : f.color, unidad: f.unidad,
      habitualCentavos: null, habitualFecha: null, ultimoCentavos: 0, ultimaFecha: '', variacionBp: null, cambios: [],
    };
    const previo = g.cambios.at(-1)?.precioCentavos ?? null;
    const variacionBp = previo ? Math.round(((f.p.precioCentavos - previo) / previo) * 10000) : null;
    g.cambios.push({ id: f.p.id, fecha: f.p.fecha, origen: f.p.origen, precioCentavos: f.p.precioCentavos, compraNumero: f.compraNumero, motivo: f.p.motivo, variacionBp });
    if (f.p.origen === 'habitual') { g.habitualCentavos = f.p.precioCentavos; g.habitualFecha = f.p.fecha; }
    g.ultimoCentavos = f.p.precioCentavos; g.ultimaFecha = f.p.fecha; g.variacionBp = variacionBp;
    grupos.set(clave, g);
  }
  return [...grupos.values()].map((g) => ({ ...g, cambios: [...g.cambios].reverse() })).sort((a, b) => a.nombre.localeCompare(b.nombre) || (a.detalle ?? '').localeCompare(b.detalle ?? ''));
}
