/**
 * Lista "para pedir": a medida que se vende, lo vendido se suma a la lista de su proveedor (el del modelo).
 * También se agregan productos a mano. Desde la lista se arma un pedido en borrador para cada proveedor.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { colores, compraItems, compras, listaPedido, modelos, movimientosStock, proveedores, talles, variantes } from '../db/schema.js';
import type { DB } from '../db/index.js';
import type { Ctx } from './stock.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { leerConfig } from './configuracion.js';
import { obtenerReceta } from './costos.js';
import { crearCompra } from './compras.js';
import { hoyLocal } from './caja.js';

/** Al confirmar una venta: suma lo vendido a la lista (si está activado en Configuración). */
export function sumarVenta(ctx: Ctx, ventaId: number, items: { varianteId: number; cantidad: number }[]) {
  if (!leerConfig(ctx.db, 'reposicion').automatica) return;
  const t = ahora();
  for (const i of items) {
    if (i.cantidad <= 0) continue;
    ctx.db.insert(listaPedido).values({ varianteId: i.varianteId, cantidad: i.cantidad, origen: 'venta', ventaId, usuarioId: ctx.usuarioId, creadoEn: t, actualizadoEn: t }).run();
  }
}

/** Al anular una venta: lo que todavía no se pidió sale de la lista. */
export function quitarVenta(ctx: Ctx, ventaId: number, numero: number) {
  ctx.db.update(listaPedido).set({ estado: 'descartado', motivo: `Venta V-${numero} anulada`, actualizadoEn: ahora() })
    .where(and(eq(listaPedido.ventaId, ventaId), eq(listaPedido.estado, 'pendiente'))).run();
}

/** Al anular un pedido armado desde la lista: sus productos vuelven a la lista. */
export function devolverDePedido(ctx: Ctx, compraId: number) {
  ctx.db.update(listaPedido).set({ estado: 'pendiente', compraId: null, actualizadoEn: ahora() })
    .where(and(eq(listaPedido.compraId, compraId), eq(listaPedido.estado, 'pedido'))).run();
}

export function agregarManual(ctx: Ctx, d: { varianteId: number; cantidad: number; motivo?: string | null }) {
  if (!Number.isInteger(d.cantidad) || d.cantidad <= 0) throw new ErrorNegocio('La cantidad tiene que ser un entero mayor a cero');
  if (!ctx.db.select({ id: variantes.id }).from(variantes).where(eq(variantes.id, d.varianteId)).get()) throw noEncontrado('El producto');
  const t = ahora();
  const l = ctx.db.insert(listaPedido).values({ varianteId: d.varianteId, cantidad: d.cantidad, origen: 'manual', motivo: d.motivo?.trim() || null, usuarioId: ctx.usuarioId, creadoEn: t, actualizadoEn: t }).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: 'lista_pedido', entidadId: l.id, despues: l });
  return l;
}

/** Fija cuántas unidades de un producto hay que pedir (0 = sacarlo de la lista). Queda el historial. */
export function fijarCantidad(ctx: Ctx, varianteId: number, cantidad: number) {
  if (!Number.isInteger(cantidad) || cantidad < 0) throw new ErrorNegocio('Cantidad inválida');
  const antes = pendientesDe(ctx.db, varianteId);
  const total = antes.reduce((s, l) => s + l.cantidad, 0);
  if (total === cantidad) return { cantidad };
  const t = ahora();
  if (antes.length) {
    ctx.db.update(listaPedido).set({ estado: 'descartado', motivo: cantidad === 0 ? 'Sacado de la lista' : `Cantidad corregida a ${cantidad}`, actualizadoEn: t })
      .where(inArray(listaPedido.id, antes.map((l) => l.id))).run();
  }
  if (cantidad > 0) ctx.db.insert(listaPedido).values({ varianteId, cantidad, origen: 'manual', motivo: `Cantidad corregida (antes ${total})`, usuarioId: ctx.usuarioId, creadoEn: t, actualizadoEn: t }).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'lista_pedido', entidadId: varianteId, antes: { cantidad: total }, despues: { cantidad } });
  return { cantidad };
}

function pendientesDe(db: DB, varianteId: number) {
  return db.select().from(listaPedido).where(and(eq(listaPedido.varianteId, varianteId), eq(listaPedido.estado, 'pendiente'))).all();
}

/** La lista agrupada por proveedor y, dentro de cada uno, por producto. */
export function listarParaPedir(db: DB) {
  // Proveedor: el del último pedido de ese producto (un mismo modelo puede venir de dos proveedores); si nunca se pidió, el del modelo.
  const provSql = sql<number | null>`coalesce((select c.proveedor_id from ${compraItems} ci join ${compras} c on c.id = ci.compra_id where ci.variante_id = ${variantes.id} and c.estado != 'anulada' order by c.id desc limit 1), ${modelos.proveedorId})`;
  const stock = sql<number>`coalesce((select sum(m.cantidad) from ${movimientosStock} m where m.variante_id = ${variantes.id}), 0)`;
  const filas = db.select({
    varianteId: variantes.id, sku: variantes.sku, modeloId: modelos.id, modelo: modelos.nombre, color: colores.nombre, talle: talles.nombre, talleOrden: talles.orden,
    proveedorId: provSql, proveedor: sql<string | null>`(select p.nombre from ${proveedores} p where p.id = ${provSql})`, costoCentavos: variantes.costoCentavos, stock,
    cantidad: sql<number>`sum(${listaPedido.cantidad})`, ventas: sql<number>`sum(case when ${listaPedido.origen} = 'venta' then ${listaPedido.cantidad} else 0 end)`,
    desde: sql<string>`min(${listaPedido.creadoEn})`,
  }).from(listaPedido)
    .innerJoin(variantes, eq(variantes.id, listaPedido.varianteId)).innerJoin(modelos, eq(modelos.id, variantes.modeloId))
    .leftJoin(colores, eq(colores.id, variantes.colorId)).leftJoin(talles, eq(talles.id, variantes.talleId))
    .where(eq(listaPedido.estado, 'pendiente'))
    .groupBy(variantes.id).orderBy(asc(modelos.nombre), asc(colores.nombre), asc(talles.orden), asc(variantes.sku)).all();
  const grupos = new Map<number | null, { proveedorId: number | null; proveedor: string; unidades: number; items: typeof filas }>();
  for (const f of filas) {
    const g = grupos.get(f.proveedorId) ?? { proveedorId: f.proveedorId, proveedor: f.proveedor ?? 'Sin proveedor asignado', unidades: 0, items: [] };
    g.items.push({ ...f, cantidad: Number(f.cantidad), ventas: Number(f.ventas), stock: Number(f.stock) });
    g.unidades += Number(f.cantidad);
    grupos.set(f.proveedorId, g);
  }
  return [...grupos.values()].sort((a, b) => (a.proveedorId === null ? 1 : b.proveedorId === null ? -1 : a.proveedor.localeCompare(b.proveedor)));
}

/** Tipo de pedido sugerido: el del último pedido a ese proveedor (taller → confección). */
function tipoSugerido(db: DB, proveedorId: number): 'reventa' | 'confeccion' {
  const ult = db.select({ tipo: compras.tipo }).from(compras).where(and(eq(compras.proveedorId, proveedorId), sql`${compras.estado} != 'anulada'`)).orderBy(sql`${compras.id} desc`).limit(1).get();
  return ult?.tipo ?? 'reventa';
}

/** Costo sugerido: reventa = costo actual del producto; confección = mano de obra de la receta del modelo. */
function costoSugerido(db: DB, tipo: 'reventa' | 'confeccion', v: { modeloId: number; talle: string | null; costoCentavos: number | null }) {
  if (tipo === 'reventa') return v.costoCentavos ?? 0;
  const mo = obtenerReceta(db, v.modeloId).filter((l) => l.tipoMaterial === 'mano_obra' && (!l.talles || (v.talle !== null && l.talles.includes(v.talle))));
  return mo.reduce((s, l) => s + Math.round((l.cantidadMil * (l.costoUnidadCentavos ?? 0)) / 1000), 0);
}

/** Arma un pedido en BORRADOR con lo pendiente de un proveedor (o los productos elegidos). Se revisa y confirma en Pedidos. */
export function armarPedido(ctx: Ctx, d: { proveedorId: number; tipo?: 'reventa' | 'confeccion'; varianteIds?: number[] }) {
  const grupo = listarParaPedir(ctx.db).find((g) => g.proveedorId === d.proveedorId);
  if (!grupo) throw new ErrorNegocio('No hay nada pendiente para ese proveedor');
  const items = d.varianteIds?.length ? grupo.items.filter((i) => d.varianteIds!.includes(i.varianteId)) : grupo.items;
  if (!items.length) throw new ErrorNegocio('Elegí al menos un producto');
  const tipo = d.tipo ?? tipoSugerido(ctx.db, d.proveedorId);
  const c = crearCompra(ctx, {
    proveedorId: d.proveedorId, tipo, fecha: hoyLocal(), notas: 'Armado desde la lista para pedir',
    items: items.map((i) => ({ varianteId: i.varianteId, cantidad: i.cantidad, costoUnitarioCentavos: costoSugerido(ctx.db, tipo, i) })),
  });
  ctx.db.update(listaPedido).set({ estado: 'pedido', compraId: c.id, actualizadoEn: ahora() })
    .where(and(eq(listaPedido.estado, 'pendiente'), inArray(listaPedido.varianteId, items.map((i) => i.varianteId)))).run();
  return { compraId: c.id, numero: c.numero, tipo, items: items.length, unidades: items.reduce((s, i) => s + i.cantidad, 0) };
}

/** Texto para mandar por WhatsApp. */
export function textoPedido(db: DB, proveedorId: number | null) {
  const g = listarParaPedir(db).find((x) => x.proveedorId === proveedorId);
  if (!g) throw new ErrorNegocio('No hay nada pendiente para ese proveedor');
  const lineas = g.items.map((i) => `• ${i.cantidad} × ${i.modelo}${i.color ? ' ' + i.color : ''}${i.talle ? ' T' + i.talle : ''} (${i.sku})`);
  return `Pedido Herencia Cuero — ${g.proveedor}\n${lineas.join('\n')}\nTotal: ${g.unidades} unidades`;
}
