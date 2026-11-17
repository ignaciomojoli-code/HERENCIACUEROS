/**
 * Custodia de materiales: dónde está cada material (en el local, en poder de Laura u otro taller, en un proveedor)
 * y las entregas entre lugares. El libro de materiales sigue siendo uno solo; cada movimiento dice en qué lugar pasó.
 *
 * Producción: el pedido de confección es la orden de producción. Para cada pedido abierto se ve lo que necesita el
 * taller según la receta (unidades sin entregar), lo que se le entregó para ese pedido y lo que tiene en su poder.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { compraItems, compras, materiales, movimientosMaterial, proveedores, recepcionItems, recepciones, talles, trasladosMaterial, variantes, modelos } from '../db/schema.js';
import type { DB } from '../db/index.js';
import type { Ctx } from './stock.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { siguienteNumero } from './numeracion.js';
import { obtenerReceta, stockEn, validarUbicacion } from './costos.js';

const nombreLugar = (nombres: Map<number, string>, id: number | null) => (id === null ? 'Local' : nombres.get(id) ?? '—');
const nombresProveedores = (db: DB) => new Map(db.select({ id: proveedores.id, nombre: proveedores.nombre }).from(proveedores).all().map((p) => [p.id, p.nombre]));

/** Stock de cada material en cada lugar (solo materiales, sin mano de obra). */
export function stockPorLugar(db: DB) {
  const filas = db.select({ materialId: movimientosMaterial.materialId, lugar: movimientosMaterial.ubicacionProveedorId, n: sql<number>`sum(${movimientosMaterial.cantidadMil})` })
    .from(movimientosMaterial).groupBy(movimientosMaterial.materialId, movimientosMaterial.ubicacionProveedorId).all();
  return filas.map((f) => ({ ...f, n: Number(f.n) }));
}

export function resumenCustodia(db: DB) {
  const nombres = nombresProveedores(db);
  const stock = stockPorLugar(db);
  const mats = db.select().from(materiales).where(eq(materiales.tipo, 'material')).orderBy(materiales.codigo).all();
  const lugares = [...new Set(stock.filter((s) => s.lugar !== null && s.n !== 0).map((s) => s.lugar as number))].sort((a, b) => nombreLugar(nombres, a).localeCompare(nombreLugar(nombres, b)));
  const filas = mats.map((m) => {
    const local = stock.filter((s) => s.materialId === m.id && s.lugar === null).reduce((a, s) => a + s.n, 0);
    const otros = lugares.map((l) => ({ ubicacionProveedorId: l, ubicacion: nombreLugar(nombres, l), cantidadMil: stock.filter((s) => s.materialId === m.id && s.lugar === l).reduce((a, s) => a + s.n, 0) }));
    return { materialId: m.id, codigo: m.codigo, nombre: m.nombre, unidad: m.unidad, activo: m.activo, localMil: local, otros, totalMil: local + otros.reduce((a, o) => a + o.cantidadMil, 0) };
  }).filter((f) => f.activo || f.totalMil !== 0);
  return { lugares: lugares.map((l) => ({ ubicacionProveedorId: l, ubicacion: nombreLugar(nombres, l) })), materiales: filas };
}

export interface DatosTraslado { fecha: string; origenProveedorId: number | null; destinoProveedorId: number | null; compraId?: number | null; notas?: string | null; items: { materialId: number; cantidadMil: number }[] }

/** Entrega de materiales de un lugar a otro. Avisa (no frena) si en el origen no alcanza según el sistema. */
export function crearTraslado(ctx: Ctx, d: DatosTraslado) {
  if (d.origenProveedorId === d.destinoProveedorId) throw new ErrorNegocio('El origen y el destino son el mismo lugar');
  const origen = validarUbicacion(ctx.db, d.origenProveedorId);
  const destino = validarUbicacion(ctx.db, d.destinoProveedorId);
  if (!d.items.length) throw new ErrorNegocio('Agregá al menos un material');
  const ids = d.items.map((i) => i.materialId);
  if (new Set(ids).size !== ids.length) throw new ErrorNegocio('Hay un material repetido');
  const ms = ctx.db.select().from(materiales).where(inArray(materiales.id, ids)).all();
  if (ms.length !== ids.length) throw new ErrorNegocio('Hay materiales que no existen');
  if (ms.some((m) => m.tipo === 'mano_obra')) throw new ErrorNegocio('La mano de obra no se entrega como material');
  for (const i of d.items) if (!Number.isInteger(i.cantidadMil) || i.cantidadMil <= 0) throw new ErrorNegocio('Las cantidades tienen que ser mayores a cero');
  if (d.compraId) {
    const c = ctx.db.select().from(compras).where(eq(compras.id, d.compraId)).get();
    if (!c) throw noEncontrado('El pedido');
    if (c.tipo !== 'confeccion') throw new ErrorNegocio('Solo se atan entregas a pedidos de confección');
    if (c.estado === 'anulada') throw new ErrorNegocio('El pedido está anulado');
  }
  const t = ahora();
  const tr = ctx.db.insert(trasladosMaterial).values({
    numero: siguienteNumero(ctx.db, 'traslado_material'), fecha: d.fecha, origenProveedorId: d.origenProveedorId, destinoProveedorId: d.destinoProveedorId,
    compraId: d.compraId ?? null, notas: d.notas?.trim() || null, usuarioId: ctx.usuarioId, creadoEn: t, actualizadoEn: t,
  }).returning().get();
  const avisos: string[] = [];
  for (const i of d.items) {
    const m = ms.find((x) => x.id === i.materialId)!;
    const hay = stockEn(ctx.db, m.id, d.origenProveedorId);
    if (hay < i.cantidadMil) avisos.push(`${m.nombre}: en ${origen} el sistema tenía ${hay / 1000} ${m.unidad}`);
    const motivo = `Entrega E-${tr.numero}: ${origen} → ${destino}`;
    const base = { fecha: d.fecha, materialId: m.id, tipo: 'traslado' as const, costoUnitarioCentavos: m.costoCentavos, refTipo: 'traslado', refId: tr.id, motivo, usuarioId: ctx.usuarioId, creadoEn: t };
    ctx.db.insert(movimientosMaterial).values({ ...base, cantidadMil: -i.cantidadMil, ubicacionProveedorId: d.origenProveedorId }).run();
    ctx.db.insert(movimientosMaterial).values({ ...base, cantidadMil: i.cantidadMil, ubicacionProveedorId: d.destinoProveedorId }).run();
  }
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: 'traslado_material', entidadId: tr.id, despues: { ...tr, items: d.items, avisos } });
  return { id: tr.id, numero: tr.numero, avisos };
}

export function anularTraslado(ctx: Ctx, id: number, motivo: string) {
  if (!motivo?.trim()) throw new ErrorNegocio('Indicá el motivo');
  const tr = ctx.db.select().from(trasladosMaterial).where(eq(trasladosMaterial.id, id)).get();
  if (!tr) throw noEncontrado('La entrega');
  if (tr.estado === 'anulado') throw new ErrorNegocio('Ya está anulada');
  const movs = ctx.db.select().from(movimientosMaterial).where(and(eq(movimientosMaterial.refTipo, 'traslado'), eq(movimientosMaterial.refId, id), eq(movimientosMaterial.tipo, 'traslado'))).all();
  const t = ahora();
  for (const m of movs) {
    ctx.db.insert(movimientosMaterial).values({ fecha: m.fecha, materialId: m.materialId, cantidadMil: -m.cantidadMil, tipo: 'anulacion', costoUnitarioCentavos: m.costoUnitarioCentavos, ubicacionProveedorId: m.ubicacionProveedorId, refTipo: 'traslado', refId: id, anulaId: m.id, motivo: `Anula entrega E-${tr.numero}: ${motivo.trim()}`, usuarioId: ctx.usuarioId, creadoEn: t }).run();
  }
  ctx.db.update(trasladosMaterial).set({ estado: 'anulado', motivoAnulacion: motivo.trim(), actualizadoEn: t }).where(eq(trasladosMaterial.id, id)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'anular', entidad: 'traslado_material', entidadId: id, antes: tr, detalle: motivo.trim() });
  return { ok: true };
}

export function listarTraslados(db: DB, f: { compraId?: number; lugar?: number | null } = {}) {
  const nombres = nombresProveedores(db);
  const conds = [];
  if (f.compraId) conds.push(eq(trasladosMaterial.compraId, f.compraId));
  const trs = db.select({ t: trasladosMaterial, compraNumero: compras.numero }).from(trasladosMaterial).leftJoin(compras, eq(compras.id, trasladosMaterial.compraId))
    .where(conds.length ? and(...conds) : undefined).orderBy(desc(trasladosMaterial.fecha), desc(trasladosMaterial.id)).limit(200).all()
    .filter((r) => f.lugar === undefined || r.t.origenProveedorId === f.lugar || r.t.destinoProveedorId === f.lugar);
  if (!trs.length) return [];
  const items = db.select({ refId: movimientosMaterial.refId, materialId: movimientosMaterial.materialId, n: movimientosMaterial.cantidadMil, material: materiales.nombre, unidad: materiales.unidad })
    .from(movimientosMaterial).innerJoin(materiales, eq(materiales.id, movimientosMaterial.materialId))
    .where(and(eq(movimientosMaterial.refTipo, 'traslado'), eq(movimientosMaterial.tipo, 'traslado'), inArray(movimientosMaterial.refId, trs.map((r) => r.t.id)), sql`${movimientosMaterial.cantidadMil} > 0`)).all();
  return trs.map((r) => ({
    ...r.t, compraNumero: r.compraNumero, origen: nombreLugar(nombres, r.t.origenProveedorId), destino: nombreLugar(nombres, r.t.destinoProveedorId),
    items: items.filter((i) => i.refId === r.t.id).map((i) => ({ materialId: i.materialId, material: i.material, unidad: i.unidad, cantidadMil: i.n })),
  }));
}

/**
 * Materiales de un pedido de confección (orden de producción): lo que lleva según la receta lo pedido, lo que lleva
 * lo que falta entregar, lo entregado al taller para este pedido y lo que el taller tiene hoy en su poder.
 */
export function materialesDePedido(db: DB, compraId: number) {
  const c = db.select().from(compras).where(eq(compras.id, compraId)).get();
  if (!c) throw noEncontrado('El pedido');
  if (c.tipo !== 'confeccion') return null;
  const lineas = db.all<{ varianteId: number; modeloId: number; talle: string | null; cantidad: number; recibido: number }>(sql`
    select ci.variante_id as varianteId, v.modelo_id as modeloId, t.nombre as talle, ci.cantidad,
      coalesce((select sum(ri.cantidad) from ${recepcionItems} ri join ${recepciones} r on r.id = ri.recepcion_id where ri.compra_item_id = ci.id and r.estado = 'activa'), 0) as recibido
    from ${compraItems} ci join ${variantes} v on v.id = ci.variante_id left join ${talles} t on t.id = v.talle_id where ci.compra_id = ${compraId}`);
  const recetas = new Map<number, ReturnType<typeof obtenerReceta>>();
  const total = new Map<number, number>(); const pendiente = new Map<number, number>();
  const sinReceta = new Set<string>();
  for (const l of lineas) {
    if (!recetas.has(l.modeloId)) recetas.set(l.modeloId, obtenerReceta(db, l.modeloId));
    const rs = recetas.get(l.modeloId)!.filter((r) => r.tipoMaterial === 'material' && (!r.talles || (l.talle !== null && r.talles.includes(l.talle))));
    if (!rs.length) { sinReceta.add(String(db.select({ n: modelos.nombre }).from(modelos).where(eq(modelos.id, l.modeloId)).get()?.n ?? '')); continue; }
    for (const r of rs) {
      total.set(r.materialId, (total.get(r.materialId) ?? 0) + r.cantidadMil * Number(l.cantidad));
      const pend = c.estado === 'cerrada' || c.estado === 'anulada' ? 0 : Number(l.cantidad) - Number(l.recibido);
      pendiente.set(r.materialId, (pendiente.get(r.materialId) ?? 0) + r.cantidadMil * Math.max(0, pend));
    }
  }
  const entregado = new Map<number, number>();
  const trs = listarTraslados(db, { compraId }).filter((t) => t.estado === 'activo');
  for (const t of trs) {
    const signo = t.destinoProveedorId === c.proveedorId ? 1 : t.origenProveedorId === c.proveedorId ? -1 : 0;
    for (const i of t.items) entregado.set(i.materialId, (entregado.get(i.materialId) ?? 0) + signo * i.cantidadMil);
  }
  const ids = [...new Set([...total.keys(), ...entregado.keys()])];
  const ms = ids.length ? db.select().from(materiales).where(inArray(materiales.id, ids)).all() : [];
  return {
    tallerId: c.proveedorId,
    sinReceta: [...sinReceta].filter(Boolean),
    materiales: ms.sort((a, b) => a.codigo.localeCompare(b.codigo)).map((m) => {
      const enTaller = stockEn(db, m.id, c.proveedorId);
      const pend = pendiente.get(m.id) ?? 0;
      return { materialId: m.id, codigo: m.codigo, nombre: m.nombre, unidad: m.unidad, totalMil: total.get(m.id) ?? 0, pendienteMil: pend,
        entregadoMil: entregado.get(m.id) ?? 0, enTallerMil: enTaller, faltaEntregarMil: Math.max(0, pend - Math.max(0, enTaller)) };
    }),
    entregas: trs,
  };
}

/** Pedidos de confección abiertos (borrador o confirmados) con sus materiales: las órdenes de producción en curso. */
export function produccionEnCurso(db: DB) {
  const nombres = nombresProveedores(db);
  const cs = db.select().from(compras).where(and(eq(compras.tipo, 'confeccion'), inArray(compras.estado, ['borrador', 'confirmada']))).orderBy(desc(compras.id)).all();
  return cs.map((c) => {
    const u = db.all<{ pedidas: number; recibidas: number }>(sql`
      select coalesce(sum(ci.cantidad), 0) as pedidas,
        coalesce((select sum(ri.cantidad) from ${recepcionItems} ri join ${recepciones} r on r.id = ri.recepcion_id where r.compra_id = ${c.id} and r.estado = 'activa'), 0) as recibidas
      from ${compraItems} ci where ci.compra_id = ${c.id}`)[0];
    const m = materialesDePedido(db, c.id)!;
    return { compraId: c.id, numero: c.numero, estado: c.estado, fecha: c.fecha, fechaEsperada: c.fechaEsperada, taller: nombreLugar(nombres, c.proveedorId), tallerId: c.proveedorId,
      pedidas: Number(u?.pedidas ?? 0), recibidas: Number(u?.recibidas ?? 0), materiales: m.materiales, sinReceta: m.sinReceta,
      faltaEntregar: m.materiales.filter((x) => x.faltaEntregarMil > 0).length };
  });
}

/** Lugares posibles para entregas: el local y los proveedores activos (talleres primero). */
export function lugares(db: DB) {
  const ps = db.select({ id: proveedores.id, nombre: proveedores.nombre, rol: proveedores.rol, activo: proveedores.activo }).from(proveedores).all().filter((p) => p.activo);
  const orden = (r: string | null) => (r === 'taller' ? 0 : r === 'materiales' ? 1 : 2);
  return [{ ubicacionProveedorId: null as number | null, nombre: 'Local', rol: null as string | null },
    ...ps.sort((a, b) => orden(a.rol) - orden(b.rol) || a.nombre.localeCompare(b.nombre)).map((p) => ({ ubicacionProveedorId: p.id as number | null, nombre: p.nombre, rol: p.rol }))];
}

