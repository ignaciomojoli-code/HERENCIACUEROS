/**
 * Reposición General de productos: una sola planilla con todo lo que hay que reponer, por categoría y proveedor.
 * Entra un producto si:
 *  - tiene ventas (o agregados a mano) pendientes de pedir en la lista "para pedir" (se respeta esa cantidad), o
 *  - su stock está en cero o por debajo del mínimo cargado (sugerida = lo que falta para el mínimo, al menos 1),
 *    descontando lo que ya está pedido y sin recibir en pedidos abiertos (borrador o confirmados).
 * Todo es editable: la cantidad (queda en la lista como corrección manual), descartar / reincluir y el proveedor.
 * Circuitos: productos terminados → pedido al proveedor; fabricación propia (camperas) → pedido de confección al taller.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { categorias, colores, compraItems, compras, decisionesReposicion, listaPedido, modelos, movimientosStock, proveedores, recepcionItems, recepciones, talles, variantes } from '../db/schema.js';
import type { DB } from '../db/index.js';
import type { Ctx } from './stock.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { crearCompra } from './compras.js';
import { hoyLocal } from './caja.js';
import { agregarManual, costoSugerido, fijarCantidad, tipoSugerido } from './reposicion.js';

export type Circuito = 'comprar' | 'fabricar';

function decisiones(db: DB) {
  return db.select().from(decisionesReposicion).where(eq(decisionesReposicion.estado, 'activa')).orderBy(decisionesReposicion.id).all();
}

/** Todas las variantes activas con lo necesario para decidir (stock, mínimo, lista, pedidos abiertos, proveedor). */
function relevar(db: DB) {
  const stock = sql<number>`coalesce((select sum(m.cantidad) from ${movimientosStock} m where m.variante_id = ${variantes.id}), 0)`;
  const enLista = sql<number>`coalesce((select sum(l.cantidad) from ${listaPedido} l where l.variante_id = ${variantes.id} and l.estado = 'pendiente'), 0)`;
  const vendido = sql<number>`coalesce((select sum(l.cantidad) from ${listaPedido} l where l.variante_id = ${variantes.id} and l.estado = 'pendiente' and l.origen = 'venta'), 0)`;
  const pedido = sql<number>`coalesce((select sum(ci.cantidad) from ${compraItems} ci join ${compras} c on c.id = ci.compra_id where ci.variante_id = ${variantes.id} and c.estado in ('borrador','confirmada')), 0)`;
  const recibido = sql<number>`coalesce((select sum(ri.cantidad) from ${recepcionItems} ri join ${recepciones} r on r.id = ri.recepcion_id join ${compras} c on c.id = r.compra_id where ri.variante_id = ${variantes.id} and r.estado = 'activa' and c.estado in ('borrador','confirmada')), 0)`;
  const provUltimo = sql<number | null>`(select c.proveedor_id from ${compraItems} ci join ${compras} c on c.id = ci.compra_id where ci.variante_id = ${variantes.id} and c.estado != 'anulada' order by c.id desc limit 1)`;
  return db.select({
    varianteId: variantes.id, sku: variantes.sku, modeloId: modelos.id, modelo: modelos.nombre, color: colores.nombre, talle: talles.nombre, talleOrden: talles.orden,
    categoriaId: categorias.id, categoria: categorias.nombre, clasificacion: modelos.clasificacion, proveedorModeloId: modelos.proveedorId,
    proveedorUltimoId: provUltimo, costoCentavos: variantes.costoCentavos, minimo: variantes.stockMinimo,
    stock, enLista, vendido, pedido, recibido,
  }).from(variantes).innerJoin(modelos, eq(modelos.id, variantes.modeloId)).innerJoin(categorias, eq(categorias.id, modelos.categoriaId))
    .leftJoin(colores, eq(colores.id, variantes.colorId)).leftJoin(talles, eq(talles.id, variantes.talleId))
    .where(and(eq(variantes.activo, true), eq(modelos.activo, true))).all()
    .map((f) => ({ ...f, stock: Number(f.stock), enLista: Number(f.enLista), vendido: Number(f.vendido), enPedido: Math.max(0, Number(f.pedido) - Number(f.recibido)) }));
}

export interface LineaReposicion {
  varianteId: number; sku: string; modeloId: number; modelo: string; color: string | null; talle: string | null; talleOrden: number | null;
  categoriaId: number; categoria: string; circuito: Circuito; stock: number; minimo: number | null; enPedido: number; vendido: number; enLista: number;
  sugerida: number; cantidad: number; motivo: string; proveedorId: number | null; proveedor: string; proveedorSugeridoId: number | null; proveedorCambiado: boolean;
  costoCentavos: number | null;
}
type Linea = LineaReposicion;

export function calcularReposicion(db: DB) {
  const dec = decisiones(db);
  const descarte = new Map<number, (typeof dec)[number]>();
  const cambioProv = new Map<number, (typeof dec)[number]>();
  for (const d of dec) (d.tipo === 'descartar' ? descarte : cambioProv).set(d.varianteId, d);
  const nombresProv = new Map(db.select({ id: proveedores.id, nombre: proveedores.nombre }).from(proveedores).all().map((p) => [p.id, p.nombre]));

  const lineas: Linea[] = [];
  const descartados: (Linea & { decisionId: number; motivoDescarte: string | null; descartadoEn: string })[] = [];
  let yaPedidos = 0;
  for (const f of relevar(db)) {
    const bajo = f.stock <= 0 || (f.minimo != null && f.stock < f.minimo);
    const sugerida = bajo ? Math.max(1, (f.minimo ?? 1) - f.stock) : 0;
    const porStock = Math.max(0, sugerida - f.enPedido);
    if (bajo && porStock === 0 && f.enLista === 0) yaPedidos++;
    const cantidad = f.enLista > 0 ? f.enLista : porStock;
    if (cantidad <= 0) continue;
    const sugeridoId = f.proveedorUltimoId ?? f.proveedorModeloId ?? null;
    const cambio = cambioProv.get(f.varianteId);
    const proveedorId = cambio?.proveedorId ?? sugeridoId;
    const motivo = f.enLista > 0
      ? (f.vendido > 0 ? (f.vendido === f.enLista ? `Vendido ${f.vendido}` : `Vendido ${f.vendido}, corregido a ${f.enLista}`) : 'Agregado / corregido a mano')
      : f.stock <= 0 ? 'Stock en cero' : `Bajo el mínimo (${f.minimo})`;
    const linea: Linea = {
      varianteId: f.varianteId, sku: f.sku, modeloId: f.modeloId, modelo: f.modelo, color: f.color, talle: f.talle, talleOrden: f.talleOrden,
      categoriaId: f.categoriaId, categoria: f.categoria, circuito: (f.clasificacion === 'fabricacion_propia' ? 'fabricar' : 'comprar') as Circuito,
      stock: f.stock, minimo: f.minimo, enPedido: f.enPedido, vendido: f.vendido, enLista: f.enLista, sugerida, cantidad, motivo,
      proveedorId, proveedor: proveedorId ? nombresProv.get(proveedorId) ?? '—' : 'Sin proveedor asignado',
      proveedorSugeridoId: sugeridoId, proveedorCambiado: !!cambio && cambio.proveedorId !== sugeridoId,
      costoCentavos: f.costoCentavos,
    };
    const d = descarte.get(f.varianteId);
    if (d && f.stock <= (d.stockAlDescartar ?? 0) && f.enLista === 0) descartados.push({ ...linea, decisionId: d.id, motivoDescarte: d.motivo, descartadoEn: d.creadoEn });
    else lineas.push(linea);
  }
  const orden = (a: (typeof lineas)[number], b: (typeof lineas)[number]) => a.modelo.localeCompare(b.modelo) || (a.color ?? '').localeCompare(b.color ?? '') || (a.talleOrden ?? 0) - (b.talleOrden ?? 0) || a.sku.localeCompare(b.sku);
  // Agrupado: circuito → categoría → proveedor.
  type G = { categoriaId: number; categoria: string; circuito: Circuito; unidades: number; proveedores: { proveedorId: number | null; proveedor: string; unidades: number; valorCentavos: number; items: typeof lineas }[] };
  const grupos = new Map<string, G>();
  for (const l of lineas.sort(orden)) {
    const k = `${l.circuito}|${l.categoriaId}`;
    const g = grupos.get(k) ?? { categoriaId: l.categoriaId, categoria: l.categoria, circuito: l.circuito, unidades: 0, proveedores: [] };
    let p = g.proveedores.find((x) => x.proveedorId === l.proveedorId);
    if (!p) g.proveedores.push((p = { proveedorId: l.proveedorId, proveedor: l.proveedor, unidades: 0, valorCentavos: 0, items: [] }));
    p.items.push(l); p.unidades += l.cantidad; p.valorCentavos += l.cantidad * (l.costoCentavos ?? 0); g.unidades += l.cantidad;
    grupos.set(k, g);
  }
  const lista = [...grupos.values()].sort((a, b) => (a.circuito === b.circuito ? a.categoria.localeCompare(b.categoria) : a.circuito === 'comprar' ? -1 : 1));
  for (const g of lista) g.proveedores.sort((a, b) => (a.proveedorId === null ? 1 : b.proveedorId === null ? -1 : a.proveedor.localeCompare(b.proveedor)));
  return {
    grupos: lista,
    descartados: descartados.sort(orden),
    resumen: { productos: lineas.length, unidades: lineas.reduce((s, l) => s + l.cantidad, 0), yaPedidos, descartados: descartados.length },
  };
}

/** Vencen solos los descartes de productos que se repusieron (el stock superó el que tenían al descartarlos). */
export function cerrarDescartesRepuestos(ctx: Ctx) {
  const ds = ctx.db.select().from(decisionesReposicion).where(and(eq(decisionesReposicion.estado, 'activa'), eq(decisionesReposicion.tipo, 'descartar'))).all();
  for (const d of ds) {
    const s = Number(ctx.db.select({ s: sql<number>`coalesce(sum(${movimientosStock.cantidad}), 0)` }).from(movimientosStock).where(eq(movimientosStock.varianteId, d.varianteId)).get()!.s);
    if (s > (d.stockAlDescartar ?? 0)) ctx.db.update(decisionesReposicion).set({ estado: 'anulada', motivo: `${d.motivo ?? ''} · vence: se repuso stock`.trim(), actualizadoEn: ahora() }).where(eq(decisionesReposicion.id, d.id)).run();
  }
}

function lineaDe(db: DB, varianteId: number) {
  const l = calcularReposicion(db);
  return l.grupos.flatMap((g) => g.proveedores.flatMap((p) => p.items)).find((i) => i.varianteId === varianteId) ?? null;
}
function existeVariante(db: DB, varianteId: number) {
  if (!db.select({ id: variantes.id }).from(variantes).where(eq(variantes.id, varianteId)).get()) throw noEncontrado('El producto');
}

/** Cambia la cantidad a pedir de un producto. Queda en la lista como corrección manual (con historial). */
export function fijarCantidadReposicion(ctx: Ctx, varianteId: number, cantidad: number) {
  existeVariante(ctx.db, varianteId);
  if (!Number.isInteger(cantidad) || cantidad <= 0) throw new ErrorNegocio('La cantidad tiene que ser un entero mayor a cero (para sacarlo, usá Descartar)');
  return fijarCantidad(ctx, varianteId, cantidad);
}

/** Descarta un producto de la planilla. Lo pendiente en la lista queda descartado (no se borra) y se guarda para poder reincluirlo. */
export function descartar(ctx: Ctx, varianteId: number, motivo?: string | null) {
  existeVariante(ctx.db, varianteId);
  const l = lineaDe(ctx.db, varianteId);
  if (!l) throw new ErrorNegocio('Ese producto no está en la reposición');
  if (l.enLista > 0) fijarCantidad(ctx, varianteId, 0);
  const t = ahora();
  const d = ctx.db.insert(decisionesReposicion).values({ varianteId, tipo: 'descartar', stockAlDescartar: l.stock, cantidad: l.enLista || null, motivo: motivo?.trim() || null, usuarioId: ctx.usuarioId, creadoEn: t, actualizadoEn: t }).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'reposicion', entidadId: varianteId, antes: { cantidad: l.cantidad }, despues: { descartado: true }, detalle: motivo?.trim() || `Descartado de la reposición (${l.sku})` });
  return d;
}

/** Vuelve a incluir un producto descartado (con la cantidad que tenía en la lista, si tenía). */
export function reincluir(ctx: Ctx, varianteId: number) {
  const d = ctx.db.select().from(decisionesReposicion).where(and(eq(decisionesReposicion.varianteId, varianteId), eq(decisionesReposicion.tipo, 'descartar'), eq(decisionesReposicion.estado, 'activa'))).all();
  if (!d.length) throw new ErrorNegocio('Ese producto no está descartado');
  ctx.db.update(decisionesReposicion).set({ estado: 'anulada', actualizadoEn: ahora() }).where(inArray(decisionesReposicion.id, d.map((x) => x.id))).run();
  const cantidad = d.at(-1)!.cantidad;
  if (cantidad && cantidad > 0) agregarManual(ctx, { varianteId, cantidad, motivo: 'Reincluido en la reposición' });
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'reposicion', entidadId: varianteId, antes: { descartado: true }, despues: { descartado: false, cantidad }, detalle: 'Reincluido en la reposición' });
  return { ok: true };
}

/** Cambia el proveedor de un producto en la reposición (queda para los próximos pedidos hasta que se cambie de nuevo). */
export function cambiarProveedor(ctx: Ctx, varianteId: number, proveedorId: number, motivo?: string | null) {
  existeVariante(ctx.db, varianteId);
  const p = ctx.db.select().from(proveedores).where(eq(proveedores.id, proveedorId)).get();
  if (!p) throw noEncontrado('El proveedor');
  const previos = ctx.db.select().from(decisionesReposicion).where(and(eq(decisionesReposicion.varianteId, varianteId), eq(decisionesReposicion.tipo, 'proveedor'), eq(decisionesReposicion.estado, 'activa'))).all();
  const antes = lineaDe(ctx.db, varianteId);
  const t = ahora();
  if (previos.length) ctx.db.update(decisionesReposicion).set({ estado: 'anulada', actualizadoEn: t }).where(inArray(decisionesReposicion.id, previos.map((x) => x.id))).run();
  const d = ctx.db.insert(decisionesReposicion).values({ varianteId, tipo: 'proveedor', proveedorId, motivo: motivo?.trim() || null, usuarioId: ctx.usuarioId, creadoEn: t, actualizadoEn: t }).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'reposicion', entidadId: varianteId, antes: { proveedor: antes?.proveedor ?? null }, despues: { proveedor: p.nombre }, detalle: motivo?.trim() || 'Cambio de proveedor en la reposición' });
  return d;
}

/**
 * Arma un pedido en BORRADOR para un proveedor con las líneas elegidas de la planilla (cantidades tal como se editaron).
 * Lo pendiente de esos productos en la lista queda "pedido". Se revisa y confirma en Pedidos.
 */
export function armarPedidoReposicion(ctx: Ctx, d: { proveedorId: number; tipo?: 'reventa' | 'confeccion'; lineas: { varianteId: number; cantidad: number }[]; notas?: string | null }) {
  if (!d.lineas.length) throw new ErrorNegocio('Elegí al menos un producto');
  const planilla = calcularReposicion(ctx.db).grupos.flatMap((g) => g.proveedores.flatMap((p) => p.items));
  const items = d.lineas.map((l) => {
    if (!Number.isInteger(l.cantidad) || l.cantidad <= 0) throw new ErrorNegocio('Las cantidades tienen que ser enteros mayores a cero');
    const p = planilla.find((x) => x.varianteId === l.varianteId);
    if (!p) throw new ErrorNegocio('Hay un producto que ya no está en la reposición: actualizá la planilla');
    return { ...p, cantidad: l.cantidad };
  });
  const tipo = d.tipo ?? (items.every((i) => i.circuito === 'fabricar') ? 'confeccion' : tipoSugerido(ctx.db, d.proveedorId));
  const c = crearCompra(ctx, {
    proveedorId: d.proveedorId, tipo, fecha: hoyLocal(), notas: d.notas?.trim() || 'Armado desde la Reposición General',
    items: items.map((i) => ({ varianteId: i.varianteId, cantidad: i.cantidad, costoUnitarioCentavos: costoSugerido(ctx.db, tipo, i) })),
  });
  ctx.db.update(listaPedido).set({ estado: 'pedido', compraId: c.id, actualizadoEn: ahora() })
    .where(and(eq(listaPedido.estado, 'pendiente'), inArray(listaPedido.varianteId, items.map((i) => i.varianteId)))).run();
  return { compraId: c.id, numero: c.numero, tipo, items: items.length, unidades: items.reduce((s, i) => s + i.cantidad, 0) };
}

/** Texto para WhatsApp de las líneas de un proveedor. */
export function textoReposicion(db: DB, proveedorId: number | null) {
  const items = calcularReposicion(db).grupos.flatMap((g) => g.proveedores).filter((p) => p.proveedorId === proveedorId).flatMap((p) => p.items);
  if (!items.length) throw new ErrorNegocio('No hay nada para ese proveedor');
  const nombre = items[0].proveedor;
  const lineas = items.map((i) => `• ${i.cantidad} × ${i.modelo}${i.color ? ' ' + i.color : ''}${i.talle ? ' T' + i.talle : ''} (${i.sku})`);
  return `Pedido Herencia Cuero — ${nombre}\n${lineas.join('\n')}\nTotal: ${items.reduce((s, i) => s + i.cantidad, 0)} unidades`;
}
