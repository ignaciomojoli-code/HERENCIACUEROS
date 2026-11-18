/**
 * Abastecimiento de un pedido de confección (orden de producción): qué materiales hacen falta, de qué color, y de dónde
 * salen: lo que ya tiene el taller, lo reservado en el local, el stock libre del local, lo pedido a proveedores que
 * todavía no llegó, lo que hay en otro lugar (para evaluar un traslado) y lo que falta comprar.
 *
 * Reglas para no contar nada dos veces:
 * - Se miran todos los pedidos de confección abiertos, del más viejo al más nuevo. Lo que tiene el taller, el stock
 *   libre del local y lo pedido sin recibir se asignan en ese orden: lo que cubre un pedido no cubre otro.
 * - Una reserva aparta stock del local para un pedido y vale lo reservado menos lo ya entregado al taller para ese
 *   pedido. Si el pedido se cierra o se anula, la reserva vale 0 (el material vuelve a estar libre solo).
 * - Al entregar a Laura el material pasa a su custodia (traslado); se consume cuando entrega las camperas (recepción).
 *
 * Nada se compra solo: las sugerencias se editan y, si se aprueban, se arma un pedido en BORRADOR por proveedor.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { compraMateriales, compras, materiales, proveedores, recepcionMateriales, recepciones, reservasMaterial } from '../db/schema.js';
import type { DB } from '../db/index.js';
import type { Ctx } from './stock.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { claveMaterial, colorDeMovimiento, nombresColores } from './costos.js';
import { crearTraslado, materialesDePedido, stockPorLugarColor } from './custodia.js';
import { armarPedidoMateriales } from './reposicionMateriales.js';
import { hoyLocal } from './caja.js';
import { precioParaEstimar } from './preciosProveedor.js';

type Pedido = typeof compras.$inferSelect;
const abierto = (c: Pedido) => c.estado === 'borrador' || c.estado === 'confirmada';

/** Pedidos de materiales sin recibir, por material y color, del más viejo al más nuevo. */
function pendientesDeRecibir(db: DB) {
  return db.all<{ materialId: number; colorId: number | null; compraId: number; numero: number; estado: string; proveedor: string; pendiente: number }>(sql`
    select cm.material_id as materialId, cm.color_id as colorId, c.id as compraId, c.numero, c.estado, p.nombre as proveedor,
      cm.cantidad_mil - coalesce((select sum(rm.cantidad_mil) from ${recepcionMateriales} rm join ${recepciones} r on r.id = rm.recepcion_id where rm.compra_material_id = cm.id and r.estado = 'activa'), 0) as pendiente
    from ${compraMateriales} cm join ${compras} c on c.id = cm.compra_id join ${proveedores} p on p.id = c.proveedor_id
    where c.tipo = 'materiales' and c.estado in ('borrador', 'confirmada') order by c.id`).map((x) => ({ ...x, pendiente: Number(x.pendiente) })).filter((x) => x.pendiente > 0);
}

function pedidoConfeccion(db: DB, compraId: number) {
  const c = db.select().from(compras).where(eq(compras.id, compraId)).get();
  if (!c) throw noEncontrado('El pedido');
  if (c.tipo !== 'confeccion') throw new ErrorNegocio('El abastecimiento es para pedidos de confección (al taller)');
  return c;
}

export function abastecimiento(db: DB, compraId: number) {
  const c = pedidoConfeccion(db, compraId);
  const abiertos = db.select().from(compras).where(and(eq(compras.tipo, 'confeccion'), inArray(compras.estado, ['borrador', 'confirmada']))).orderBy(asc(compras.id)).all();
  const pedidos = abiertos.some((x) => x.id === c.id) ? abiertos : [...abiertos, c];
  const mats = new Map<number, ReturnType<typeof materialesDePedido>>();
  for (const p of pedidos) mats.set(p.id, materialesDePedido(db, p.id));

  // Stock por lugar y color.
  const stock = stockPorLugarColor(db);
  const enLugar = (k: string, lugar: number | null) => stock.get(k)?.get(lugar) ?? 0;

  // Reservas activas (de pedidos abiertos), vigentes = reservado − entregado para ese pedido.
  const reservas = db.select().from(reservasMaterial).where(and(eq(reservasMaterial.estado, 'activa'), inArray(reservasMaterial.compraId, pedidos.map((p) => p.id)))).all();
  const reservadoBruto = new Map<string, number>(); // `${compraId}#${clave}`
  for (const r of reservas) { const k = `${r.compraId}#${claveMaterial(r.materialId, r.colorId)}`; reservadoBruto.set(k, (reservadoBruto.get(k) ?? 0) + r.cantidadMil); }

  // Primera pasada: lo que cubre el taller y lo reservado, en orden.
  const tallerLibre = new Map<string, number>(); // `${tallerId}#${clave}`
  const localReservable = new Map<string, number>(); // por clave: lo que queda del local para reservas
  type Calc = { pend: number; cubreTaller: number; falta: number; reservado: number; usarStock: number; enCamino: number; enCaminoDe: { compraId: number; numero: number; estado: string; proveedor: string; cantidadMil: number }[]; faltaComprar: number };
  const calc = new Map<string, Calc>(); // `${compraId}#${clave}`
  // Lo que tiene el taller cubre primero el pedido para el que se le entregó; lo que sobra, a los demás en orden.
  const cubre = new Map<string, number>();
  for (const pase of ['propio', 'resto'] as const) {
    for (const p of pedidos) {
      for (const m of mats.get(p.id)!.materiales) {
        const tk = `${p.proveedorId}#${m.clave}`;
        if (!tallerLibre.has(tk)) tallerLibre.set(tk, Math.max(0, enLugar(m.clave, p.proveedorId)));
        const pend = abierto(p) ? m.pendienteMil : 0;
        const ya = cubre.get(`${p.id}#${m.clave}`) ?? 0;
        const tope = pase === 'propio' ? Math.min(pend, Math.max(0, m.entregadoMil)) : pend;
        const n = Math.max(0, Math.min(tope - ya, tallerLibre.get(tk)!));
        tallerLibre.set(tk, tallerLibre.get(tk)! - n);
        cubre.set(`${p.id}#${m.clave}`, ya + n);
      }
    }
  }
  for (const p of pedidos) {
    for (const m of mats.get(p.id)!.materiales) {
      if (!localReservable.has(m.clave)) localReservable.set(m.clave, Math.max(0, enLugar(m.clave, null)));
      const pend = abierto(p) ? m.pendienteMil : 0;
      const cubreTaller = cubre.get(`${p.id}#${m.clave}`) ?? 0;
      const falta = pend - cubreTaller;
      const vigente = abierto(p) ? Math.max(0, (reservadoBruto.get(`${p.id}#${m.clave}`) ?? 0) - Math.max(0, m.entregadoMil)) : 0;
      const reservado = Math.min(vigente, falta, localReservable.get(m.clave)!);
      localReservable.set(m.clave, localReservable.get(m.clave)! - reservado);
      calc.set(`${p.id}#${m.clave}`, { pend, cubreTaller, falta, reservado, usarStock: 0, enCamino: 0, enCaminoDe: [], faltaComprar: 0 });
    }
  }
  // Segunda pasada: stock libre del local y pedidos sin recibir, en orden.
  const libre = new Map(localReservable);
  const porRecibir = pendientesDeRecibir(db).map((x) => ({ ...x, clave: claveMaterial(x.materialId, x.colorId), queda: x.pendiente }));
  for (const p of pedidos) {
    for (const m of mats.get(p.id)!.materiales) {
      const x = calc.get(`${p.id}#${m.clave}`)!;
      let n = Math.max(0, x.falta - x.reservado);
      x.usarStock = Math.min(n, libre.get(m.clave) ?? 0);
      libre.set(m.clave, (libre.get(m.clave) ?? 0) - x.usarStock);
      n -= x.usarStock;
      for (const r of porRecibir) {
        if (n <= 0) break;
        if (r.clave !== m.clave || r.queda <= 0) continue;
        const usa = Math.min(n, r.queda);
        r.queda -= usa; n -= usa; x.enCamino += usa;
        x.enCaminoDe.push({ compraId: r.compraId, numero: r.numero, estado: r.estado, proveedor: r.proveedor, cantidadMil: usa });
      }
      x.faltaComprar = n;
    }
  }

  // Filas del pedido pedido.
  const ms = db.select({ m: materiales, proveedor: proveedores.nombre }).from(materiales).leftJoin(proveedores, eq(proveedores.id, materiales.proveedorId)).all();
  const nombresProv = new Map(db.select({ id: proveedores.id, nombre: proveedores.nombre }).from(proveedores).all().map((p) => [p.id, p.nombre]));
  const otrosPedidos = pedidos.filter((p) => p.id !== c.id);
  const filas = mats.get(c.id)!.materiales.map((m) => {
    const x = calc.get(`${c.id}#${m.clave}`)!;
    const mat = ms.find((r) => r.m.id === m.materialId)!;
    const reservadoOtros = otrosPedidos.reduce((s, p) => s + (calc.get(`${p.id}#${m.clave}`)?.reservado ?? 0), 0);
    const otrosLugares = [...(stock.get(m.clave) ?? new Map<number | null, number>()).entries()]
      .filter(([l, n]) => l !== null && l !== c.proveedorId && n > 0).map(([l, n]) => ({ ubicacionProveedorId: l as number, lugar: nombresProv.get(l as number) ?? '—', cantidadMil: n }));
    const enOtros = otrosLugares.reduce((s, o) => s + o.cantidadMil, 0);
    const caso = x.falta === 0 ? 'cubierto' : x.faltaComprar === 0 && x.enCamino === 0 ? 'A' : x.reservado + x.usarStock + x.enCamino > 0 ? 'B' : 'C';
    return {
      ...m, clasificacion: mat.m.clasificacion, esCuero: mat.m.clasificacion === 'materia_prima',
      proveedorId: mat.m.proveedorId, proveedor: mat.proveedor, costoCentavos: precioParaEstimar(db, mat.m.proveedorId, m.materialId, m.colorId, mat.m.costoCentavos),
      stockLocalMil: enLugar(m.clave, null),
      cubreTallerMil: x.cubreTaller, faltaEntregarMil: x.falta, reservadoMil: x.reservado, usarStockMil: x.usarStock,
      disponibleParaReservarMil: Math.max(0, Math.min(x.falta, enLugar(m.clave, null) - reservadoOtros)),
      reservadoOtrosMil: reservadoOtros, enCaminoMil: x.enCamino, enCaminoDe: x.enCaminoDe, faltaComprarMil: x.faltaComprar,
      otrosLugares, sugeridoMil: Math.max(0, x.faltaComprar - enOtros), caso,
    };
  });
  const otrosConReserva = otrosPedidos.map((p) => ({
    compraId: p.id, numero: p.numero,
    items: mats.get(p.id)!.materiales.map((m) => ({ clave: m.clave, nombre: m.nombre, color: m.color, unidad: m.unidad, reservadoMil: calc.get(`${p.id}#${m.clave}`)?.reservado ?? 0 })).filter((i) => i.reservadoMil > 0),
  })).filter((p) => p.items.length);
  // Sugerencias de compra agrupadas por proveedor (editables en pantalla).
  const grupos = new Map<number | null, { proveedorId: number | null; proveedor: string; cuero: boolean; items: typeof filas }>();
  for (const f of filas.filter((f) => f.sugeridoMil > 0)) {
    const g = grupos.get(f.proveedorId) ?? { proveedorId: f.proveedorId, proveedor: f.proveedor ?? 'Sin proveedor asignado', cuero: false, items: [] };
    g.items.push(f); g.cuero = g.cuero || f.esCuero; grupos.set(f.proveedorId, g);
  }
  return {
    compraId: c.id, numero: c.numero, estado: c.estado, tallerId: c.proveedorId, taller: nombresProv.get(c.proveedorId) ?? '—', abierto: abierto(c),
    sinReceta: mats.get(c.id)!.sinReceta,
    materiales: filas,
    sugerencias: [...grupos.values()].sort((a, b) => Number(a.cuero) - Number(b.cuero) || a.proveedor.localeCompare(b.proveedor)),
    reservadoEnOtros: otrosConReserva,
    proveedoresMateriales: db.select({ id: proveedores.id, nombre: proveedores.nombre, rol: proveedores.rol, activo: proveedores.activo }).from(proveedores).all()
      // Los de materiales se ofrecen aunque estén inactivos (Céfalo para el cuero); los sin rol, solo activos.
      .filter((p) => p.rol === 'materiales' || (p.rol === null && p.activo)).sort((a, b) => a.nombre.localeCompare(b.nombre)),
  };
}

export interface LineaReserva { materialId: number; colorId?: number | null; cantidadMil: number }

/**
 * Fija lo reservado de cada material (y color) para el pedido: "dejá apartados X". 0 = liberar. No mueve stock.
 * No deja reservar más de lo que falta entregar ni de lo que hay en el local sin reservar para otros pedidos.
 */
export function reservar(ctx: Ctx, compraId: number, lineas: LineaReserva[], motivo?: string | null) {
  const c = pedidoConfeccion(ctx.db, compraId);
  if (!abierto(c)) throw new ErrorNegocio('El pedido no está abierto: no se puede reservar');
  if (!lineas.length) throw new ErrorNegocio('Elegí al menos un material');
  const a = abastecimiento(ctx.db, compraId);
  const colores = nombresColores(ctx.db);
  const t = ahora();
  const hechas: { material: string; cantidadMil: number }[] = [];
  for (const l of lineas) {
    const mat = ctx.db.select().from(materiales).where(eq(materiales.id, l.materialId)).get();
    if (!mat) throw noEncontrado('El material');
    const colorId = colorDeMovimiento(ctx.db, mat, l.colorId);
    const k = claveMaterial(mat.id, colorId);
    const f = a.materiales.find((x) => x.clave === k);
    const nombre = `${mat.nombre}${mat.porColor ? ' ' + (colorId ? colores.get(colorId) : 'sin color') : ''}`;
    if (!f) throw new ErrorNegocio(`${nombre} no lo lleva este pedido`);
    if (!Number.isInteger(l.cantidadMil) || l.cantidadMil < 0) throw new ErrorNegocio('Cantidad inválida');
    if (l.cantidadMil > f.disponibleParaReservarMil) throw new ErrorNegocio(`${nombre}: se pueden reservar hasta ${f.disponibleParaReservarMil / 1000} ${f.unidad} (lo que falta entregar y hay libre en el local)`);
    ctx.db.update(reservasMaterial).set({ estado: 'anulada', actualizadoEn: t })
      .where(and(eq(reservasMaterial.compraId, compraId), eq(reservasMaterial.materialId, mat.id), colorId === null ? isNull(reservasMaterial.colorId) : eq(reservasMaterial.colorId, colorId), eq(reservasMaterial.estado, 'activa'))).run();
    // Se guarda lo reservado más lo ya entregado para el pedido: así la reserva vigente queda en lo pedido.
    if (l.cantidadMil > 0) {
      ctx.db.insert(reservasMaterial).values({ compraId, materialId: mat.id, colorId, cantidadMil: l.cantidadMil + Math.max(0, f.entregadoMil), motivo: motivo?.trim() || null, usuarioId: ctx.usuarioId, creadoEn: t, actualizadoEn: t }).run();
    }
    hechas.push({ material: nombre, cantidadMil: l.cantidadMil });
  }
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'reservar', entidad: 'compra', entidadId: compraId, despues: { reservas: hechas }, detalle: motivo ?? undefined });
  return { reservas: hechas.length };
}

/** Reserva todo lo que se puede del local para lo que falta entregar en este pedido. */
export function reservarDisponible(ctx: Ctx, compraId: number) {
  const a = abastecimiento(ctx.db, compraId);
  const lineas = a.materiales.filter((f) => f.disponibleParaReservarMil > f.reservadoMil).map((f) => ({ materialId: f.materialId, colorId: f.colorId, cantidadMil: f.disponibleParaReservarMil }));
  if (!lineas.length) throw new ErrorNegocio('No hay material libre en el local para reservar a este pedido');
  return reservar(ctx, compraId, lineas, 'Reservar lo disponible');
}

/** Libera todas las reservas del pedido (el material vuelve a estar libre). */
export function liberarReservas(ctx: Ctx, compraId: number, motivo?: string | null) {
  pedidoConfeccion(ctx.db, compraId);
  const activas = ctx.db.select().from(reservasMaterial).where(and(eq(reservasMaterial.compraId, compraId), eq(reservasMaterial.estado, 'activa'))).all();
  if (!activas.length) throw new ErrorNegocio('El pedido no tiene reservas');
  ctx.db.update(reservasMaterial).set({ estado: 'anulada', actualizadoEn: ahora() }).where(inArray(reservasMaterial.id, activas.map((r) => r.id))).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'liberar', entidad: 'compra', entidadId: compraId, antes: { reservas: activas.length }, detalle: motivo ?? undefined });
  return { liberadas: activas.length };
}

/** Entrega al taller lo reservado (traslado del local a su custodia, atado al pedido). */
export function entregarReservado(ctx: Ctx, compraId: number, d: { fecha?: string; notas?: string | null; items?: LineaReserva[] }) {
  const a = abastecimiento(ctx.db, compraId);
  if (!a.abierto) throw new ErrorNegocio('El pedido no está abierto');
  const items = d.items?.length ? d.items.filter((i) => i.cantidadMil > 0) : a.materiales.filter((f) => f.reservadoMil > 0).map((f) => ({ materialId: f.materialId, colorId: f.colorId, cantidadMil: f.reservadoMil }));
  if (!items.length) throw new ErrorNegocio('No hay nada reservado para entregar');
  return crearTraslado(ctx, { fecha: d.fecha ?? hoyLocal(), origenProveedorId: null, destinoProveedorId: a.tallerId, compraId, notas: d.notas ?? `Entrega de lo reservado para P-${a.numero}`, items });
}

/** Arma pedidos de materiales en BORRADOR (uno por proveedor) con las sugerencias aprobadas y editadas. */
export function armarCompras(ctx: Ctx, compraId: number, grupos: { proveedorId: number; lineas: { materialId: number; colorId?: number | null; cantidadMil: number; costoUnitarioCentavos?: number | null }[] }[]) {
  const c = pedidoConfeccion(ctx.db, compraId);
  const lineas = grupos.flatMap((g) => g.lineas.filter((l) => l.cantidadMil > 0).map((l) => ({ ...l, proveedorId: g.proveedorId })));
  if (!lineas.length) throw new ErrorNegocio('No hay cantidades para pedir');
  const porProv = new Map<number, typeof lineas>();
  for (const l of lineas) porProv.set(l.proveedorId, [...(porProv.get(l.proveedorId) ?? []), l]);
  const hechos: { compraId: number; numero: number; proveedorId: number }[] = [];
  for (const [proveedorId, ls] of porProv) {
    const r = armarPedidoMateriales(ctx, { proveedorId, lineas: ls, notas: `Para el pedido de confección P-${c.numero}` });
    hechos.push({ compraId: r.compraId, numero: r.numero, proveedorId });
  }
  return { pedidos: hechos };
}

const cant = (mil: number) => mil / 1000;

/** Planilla de abastecimiento para Excel: una fila por material y color, con la sección a la que pertenece. */
export function planillaAbastecimiento(db: DB, compraId: number) {
  const a = abastecimiento(db, compraId);
  const filas: Record<string, unknown>[] = [];
  const nombre = (f: { nombre: string; color: string | null }) => f.nombre + (f.color ? ` ${f.color}` : '');
  for (const f of a.materiales) {
    const base = { material: nombre(f), unidad: f.unidad, necesita: cant(f.pendienteMil), taller: cant(f.cubreTallerMil), falta: cant(f.faltaEntregarMil) };
    if (f.reservadoMil + f.usarStockMil > 0) filas.push({ seccion: '1. Retirar del stock del local', ...base, cantidad: cant(f.reservadoMil + f.usarStockMil), detalle: f.reservadoMil ? `Reservado ${cant(f.reservadoMil)}` : 'Sin reservar todavía' });
    if (f.sugeridoMil > 0) filas.push({ seccion: f.esCuero ? '3. Cuero a pedir' : '2. Materiales a pedir', ...base, cantidad: cant(f.sugeridoMil), detalle: f.proveedor ?? 'Sin proveedor asignado' });
    if (f.enCaminoMil > 0) filas.push({ seccion: '4. Pendiente de recibir', ...base, cantidad: cant(f.enCaminoMil), detalle: f.enCaminoDe.map((p) => `P-${p.numero} ${p.proveedor}`).join(', ') });
    if (f.otrosLugares.length) filas.push({ seccion: '6. En otro lugar (evaluar traslado)', ...base, cantidad: cant(f.otrosLugares.reduce((s, o) => s + o.cantidadMil, 0)), detalle: f.otrosLugares.map((o) => `${o.lugar}: ${cant(o.cantidadMil)}`).join(', ') });
  }
  for (const p of a.reservadoEnOtros) for (const i of p.items) filas.push({ seccion: '5. Reservado para otros pedidos', material: i.nombre + (i.color ? ` ${i.color}` : ''), unidad: i.unidad, cantidad: cant(i.reservadoMil), detalle: `P-${p.numero}` });
  filas.sort((x, y) => String(x.seccion).localeCompare(String(y.seccion)));
  return { a, filas };
}
