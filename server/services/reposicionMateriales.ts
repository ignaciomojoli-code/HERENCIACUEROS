/**
 * Reposición de materiales por receta.
 *
 * Por cada material (no mano de obra) se calcula, y en los que van por color (ej. el cuero) por cada color:
 *   necesidad  = lo que piden las ventas todavía no encargadas al taller (lista "Para pedir", según receta y talle)
 *              + lo comprometido en pedidos al taller sin entregar (borrador o confirmados, según receta y talle)
 *              + el stock mínimo
 *   cubierto   = stock actual + pedidos de materiales sin entregar (confirmados y borradores)
 *   faltante   = necesidad − cubierto (si es positivo)
 *   a pedir    = faltante − lo descartado (si no está pospuesto)
 *
 * Una venta cuenta una sola vez: mientras está en "Para pedir" es necesidad por venta; cuando se arma el pedido al
 * taller pasa a comprometido; cuando el taller entrega, se descuenta del stock (consumo por receta) y deja de contar.
 * No se inventa nada: si un modelo no tiene receta, no genera necesidad (se informa). Un encargo especial se agrega
 * como producto en "Para pedir" y genera su necesidad por receta como cualquier venta.
 *
 * Decisiones: posponer (hasta una fecha), descartar (lo que falta hoy no se pide; se cierra sola cuando ya no falta
 * nada) y cambiar el proveedor (vale hasta armar el pedido).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { compraItems, compraMateriales, compras, listaPedido, materiales, modelos, movimientosMaterial, necesidadesMaterial, proveedores, recepcionItems, recepcionMateriales, recepciones, talles, variantes } from '../db/schema.js';
import type { DB } from '../db/index.js';
import type { Ctx } from './stock.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { claveMaterial, colorDeMovimiento, costoDeCantidad, nombresColores, obtenerReceta } from './costos.js';
import { crearCompra } from './compras.js';
import { hoyLocal } from './caja.js';
import { precioParaEstimar } from './preciosProveedor.js';

type Receta = ReturnType<typeof obtenerReceta>;

/** Materiales (milésimas) que lleva una unidad de un modelo en un talle, según su receta. */
function porUnidad(receta: Receta, talle: string | null) {
  return receta.filter((l) => l.tipoMaterial === 'material' && (!l.talles || (talle !== null && l.talles.includes(talle))));
}

interface Origen { texto: string; unidades: number; cantidadMil: number }

/** Explota unidades de variantes (con talle y color) en materiales por receta. Clave: material + color (ver claveMaterial). */
export function explotar(db: DB, filas: { varianteId: number; unidades: number; etiqueta: string }[], sinReceta: Set<string>) {
  const recetas = new Map<number, Receta>();
  const porMaterial = new Map<string, Origen[]>();
  if (!filas.length) return porMaterial;
  const vs = db.select({ id: variantes.id, sku: variantes.sku, modeloId: variantes.modeloId, modelo: modelos.nombre, talle: talles.nombre, colorId: variantes.colorId }).from(variantes)
    .innerJoin(modelos, eq(modelos.id, variantes.modeloId)).leftJoin(talles, eq(talles.id, variantes.talleId))
    .where(inArray(variantes.id, [...new Set(filas.map((f) => f.varianteId))])).all();
  for (const f of filas) {
    if (f.unidades <= 0) continue;
    const v = vs.find((x) => x.id === f.varianteId);
    if (!v) continue;
    if (!recetas.has(v.modeloId)) recetas.set(v.modeloId, obtenerReceta(db, v.modeloId));
    const lineas = porUnidad(recetas.get(v.modeloId)!, v.talle);
    if (!lineas.length) { sinReceta.add(v.modelo); continue; }
    for (const l of lineas) {
      const k = claveMaterial(l.materialId, l.porColor ? v.colorId : null);
      const arr = porMaterial.get(k) ?? [];
      arr.push({ texto: `${f.etiqueta} · ${v.modelo}${v.talle ? ' T' + v.talle : ''}`, unidades: f.unidades, cantidadMil: l.cantidadMil * f.unidades });
      porMaterial.set(k, arr);
    }
  }
  return porMaterial;
}

const suma = (o?: { cantidadMil: number }[]) => (o ?? []).reduce((s, x) => s + x.cantidadMil, 0);

export function calcularReposicion(db: DB, hoy = hoyLocal()) {
  const sinReceta = new Set<string>();
  // Ventas que esperan ser encargadas al taller (lista "Para pedir" pendiente).
  const ventas = db.select({ varianteId: listaPedido.varianteId, unidades: sql<number>`sum(${listaPedido.cantidad})` }).from(listaPedido)
    .where(eq(listaPedido.estado, 'pendiente')).groupBy(listaPedido.varianteId).all();
  const porVentas = explotar(db, ventas.map((v) => ({ varianteId: v.varianteId, unidades: Number(v.unidades), etiqueta: 'Para pedir' })), sinReceta);

  // Pedidos al taller sin entregar: unidades pendientes de cada línea.
  const conf = db.all<{ varianteId: number; numero: number; estado: string; pendiente: number }>(sql`
    select ci.variante_id as varianteId, c.numero, c.estado,
      ci.cantidad - coalesce((select sum(ri.cantidad) from ${recepcionItems} ri join ${recepciones} r on r.id = ri.recepcion_id where ri.compra_item_id = ci.id and r.estado = 'activa'), 0) as pendiente
    from ${compraItems} ci join ${compras} c on c.id = ci.compra_id
    where c.tipo = 'confeccion' and c.estado in ('borrador', 'confirmada')`);
  const porTaller = explotar(db, conf.map((c) => ({ varianteId: c.varianteId, unidades: Number(c.pendiente), etiqueta: `P-${c.numero}${c.estado === 'borrador' ? ' (borrador)' : ''}` })), sinReceta);

  // Pedidos de materiales sin entregar.
  const enCamino = db.all<{ materialId: number; colorId: number | null; compraId: number; numero: number; estado: string; proveedor: string; pendiente: number }>(sql`
    select cm.material_id as materialId, cm.color_id as colorId, c.id as compraId, c.numero, c.estado, p.nombre as proveedor,
      cm.cantidad_mil - coalesce((select sum(rm.cantidad_mil) from ${recepcionMateriales} rm join ${recepciones} r on r.id = rm.recepcion_id where rm.compra_material_id = cm.id and r.estado = 'activa'), 0) as pendiente
    from ${compraMateriales} cm join ${compras} c on c.id = cm.compra_id join ${proveedores} p on p.id = c.proveedor_id
    where c.tipo = 'materiales' and c.estado in ('borrador', 'confirmada')`).filter((x) => Number(x.pendiente) > 0);

  const decisiones = db.select({ n: necesidadesMaterial, proveedor: proveedores.nombre }).from(necesidadesMaterial).leftJoin(proveedores, eq(proveedores.id, necesidadesMaterial.proveedorId))
    .where(eq(necesidadesMaterial.estado, 'activa')).orderBy(necesidadesMaterial.id).all().map((r) => ({ ...r.n, proveedor: r.proveedor }));

  // Stock por material y color (en todos los lugares: lo que tiene el taller también cubre).
  const stock = new Map(db.all<{ materialId: number; colorId: number | null; n: number }>(sql`
    select m.material_id as materialId, case when x.por_color = 1 then m.color_id end as colorId, sum(m.cantidad_mil) as n
    from movimientos_material m join materiales x on x.id = m.material_id group by 1, 2`).map((r) => [claveMaterial(r.materialId, r.colorId), Number(r.n)]));
  const colores = nombresColores(db);
  const conConteo = new Set(db.select({ m: movimientosMaterial.materialId }).from(movimientosMaterial).where(eq(movimientosMaterial.tipo, 'inicial')).all().map((r) => r.m));
  const mats = db.select({ m: materiales, proveedor: proveedores.nombre }).from(materiales).leftJoin(proveedores, eq(proveedores.id, materiales.proveedorId))
    .where(and(eq(materiales.tipo, 'material'), eq(materiales.activo, true))).orderBy(materiales.codigo).all();
  const provNombre = new Map(db.select({ id: proveedores.id, nombre: proveedores.nombre }).from(proveedores).all().map((p) => [p.id, p.nombre]));

  // Filas: una por material; en los que van por color, una por cada color que aparece (necesidad, stock o pedidos).
  const filasBase: { m: typeof mats[number]['m']; proveedor: string | null; colorId: number | null }[] = [];
  for (const { m, proveedor } of mats) {
    if (!m.porColor) { filasBase.push({ m, proveedor, colorId: null }); continue; }
    const ks = new Set<string>();
    for (const mapa of [porVentas, porTaller, stock]) for (const k of mapa.keys()) if (k.startsWith(`${m.id}|`)) ks.add(k);
    for (const x of enCamino) if (x.materialId === m.id) ks.add(claveMaterial(m.id, x.colorId));
    for (const d of decisiones) if (d.materialId === m.id) ks.add(claveMaterial(m.id, d.colorId));
    if (!ks.size) ks.add(claveMaterial(m.id, null));
    for (const k of ks) { const c = k.split('|')[1]; filasBase.push({ m, proveedor, colorId: c ? Number(c) : null }); }
  }
  const filas = filasBase.map(({ m, proveedor, colorId }) => {
    const k = claveMaterial(m.id, colorId);
    const dec = decisiones.filter((d) => d.materialId === m.id && (!m.porColor || (d.colorId ?? null) === colorId));
    const descartes = dec.filter((d) => d.tipo === 'descartar');
    const posp = dec.filter((d) => d.tipo === 'posponer' && d.hasta && d.hasta > hoy).at(-1) ?? null;
    const cambioProv = dec.filter((d) => d.tipo === 'proveedor').at(-1) ?? null;
    const pedidos = enCamino.filter((x) => x.materialId === m.id && (!m.porColor || (x.colorId ?? null) === colorId))
      .map((x) => ({ compraId: x.compraId, numero: x.numero, estado: x.estado, proveedor: x.proveedor, cantidadMil: Number(x.pendiente) }));
    const stockMil = stock.get(k) ?? 0;
    const ventasMil = suma(porVentas.get(k));
    const comprometidoMil = suma(porTaller.get(k));
    // El mínimo es del material entero: en los que van por color se aplica a la fila sin color.
    const minimoMil = m.porColor && colorId !== null ? 0 : m.stockMinimoMil ?? 0;
    const pedidoMil = pedidos.filter((p) => p.estado === 'confirmada').reduce((s, p) => s + p.cantidadMil, 0);
    const borradorMil = pedidos.filter((p) => p.estado === 'borrador').reduce((s, p) => s + p.cantidadMil, 0);
    const necesidadMil = ventasMil + comprometidoMil + minimoMil;
    const faltanteMil = Math.max(0, necesidadMil - stockMil - pedidoMil - borradorMil);
    const descartadoMil = suma(descartes.map((d) => ({ cantidadMil: d.cantidadMil ?? 0 })));
    const aPedirMil = Math.max(0, faltanteMil - descartadoMil);
    const descartadoVigenteMil = Math.min(descartadoMil, faltanteMil);
    const proveedorId = cambioProv?.proveedorId ?? m.proveedorId;
    // Precio para estimar: el habitual de ese proveedor (si hay) o el costo cargado del material. Es orientativo.
    const costoEstimado = precioParaEstimar(db, proveedorId, m.id, colorId, m.costoCentavos);
    return {
      clave: k, materialId: m.id, colorId, color: m.porColor ? (colorId ? colores.get(colorId) ?? '—' : 'Sin color') : null, porColor: m.porColor,
      codigo: m.codigo, nombre: m.nombre, unidad: m.unidad, clasificacion: m.clasificacion, costoCentavos: costoEstimado,
      proveedorId, proveedor: proveedorId ? provNombre.get(proveedorId) ?? '—' : null, proveedorHabitual: proveedor, proveedorCambiado: !!cambioProv,
      stockMil, sinConteo: !conConteo.has(m.id), minimoMil, ventasMil, comprometidoMil, pedidoMil, borradorMil, necesidadMil, faltanteMil, descartadoMil: descartadoVigenteMil, aPedirMil,
      pospuestoHasta: posp?.hasta ?? null,
      valorCentavos: costoEstimado != null ? costoDeCantidad(costoEstimado, aPedirMil) : null,
      detalle: { ventas: porVentas.get(k) ?? [], taller: porTaller.get(k) ?? [], pedidos, decisiones: dec },
    };
  }).filter((f) => !f.porColor || f.colorId === null || f.necesidadMil > 0 || f.stockMil !== 0 || f.detalle.pedidos.length || f.detalle.decisiones.length);
  return { hoy, materiales: filas, modelosSinReceta: [...sinReceta].sort() };
}

/**
 * Lo que hay que pedir, agrupado por proveedor (sin los pospuestos ni lo que no falta).
 * Los materiales sin conteo inicial no se sugieren: su stock sale solo de lo consumido y la cuenta daría de más.
 * Se listan aparte con lo que piden las ventas y el taller, para que se cargue el conteo.
 */
export function reposicionPorProveedor(db: DB) {
  const r = calcularReposicion(db);
  const activos = r.materiales.filter((m) => m.aPedirMil > 0 && !m.pospuestoHasta && !m.sinConteo);
  const grupos = new Map<number | null, { proveedorId: number | null; proveedor: string; items: typeof activos; valorCentavos: number }>();
  for (const m of activos) {
    const g = grupos.get(m.proveedorId) ?? { proveedorId: m.proveedorId, proveedor: m.proveedor ?? 'Sin proveedor asignado', items: [], valorCentavos: 0 };
    g.items.push(m);
    g.valorCentavos += m.valorCentavos ?? 0;
    grupos.set(m.proveedorId, g);
  }
  return {
    ...r,
    grupos: [...grupos.values()].sort((a, b) => (a.proveedorId === null ? 1 : b.proveedorId === null ? -1 : a.proveedor.localeCompare(b.proveedor))),
    pospuestos: r.materiales.filter((m) => m.pospuestoHasta && m.faltanteMil > 0 && !m.sinConteo),
    sinConteo: r.materiales.filter((m) => m.sinConteo && (m.necesidadMil > 0 || m.stockMil !== 0)),
  };
}

function materialValido(db: DB, id: number) {
  const m = db.select().from(materiales).where(eq(materiales.id, id)).get();
  if (!m) throw noEncontrado('El material');
  if (m.tipo === 'mano_obra') throw new ErrorNegocio('La mano de obra no se repone como material');
  return m;
}

function anularActivas(ctx: Ctx, materialId: number, colorId: number | null, tipo: 'posponer' | 'proveedor') {
  ctx.db.update(necesidadesMaterial).set({ estado: 'anulada', actualizadoEn: ahora() })
    .where(and(eq(necesidadesMaterial.materialId, materialId), colorId === null ? isNull(necesidadesMaterial.colorId) : eq(necesidadesMaterial.colorId, colorId), eq(necesidadesMaterial.tipo, tipo), eq(necesidadesMaterial.estado, 'activa'))).run();
}

function registrar(ctx: Ctx, v: Omit<typeof necesidadesMaterial.$inferInsert, 'usuarioId' | 'creadoEn' | 'actualizadoEn'>) {
  const t = ahora();
  const n = ctx.db.insert(necesidadesMaterial).values({ ...v, usuarioId: ctx.usuarioId, creadoEn: t, actualizadoEn: t }).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: 'necesidad_material', entidadId: n.id, despues: n, detalle: v.motivo ?? undefined });
  return n;
}

/** No pedir este material hasta una fecha (vuelve a aparecer solo). */
export function posponer(ctx: Ctx, d: { materialId: number; colorId?: number | null; hasta: string; motivo?: string | null }) {
  const m = materialValido(ctx.db, d.materialId);
  const colorId = colorDeMovimiento(ctx.db, m, d.colorId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.hasta) || d.hasta <= hoyLocal()) throw new ErrorNegocio('Elegí una fecha posterior a hoy');
  anularActivas(ctx, d.materialId, colorId, 'posponer');
  return registrar(ctx, { materialId: d.materialId, colorId, tipo: 'posponer', hasta: d.hasta, motivo: d.motivo?.trim() || null });
}

/** Descarta lo que falta hoy de un material: no se pide. Si después aparece más necesidad, figura solo lo nuevo. */
export function descartar(ctx: Ctx, d: { materialId: number; colorId?: number | null; cantidadMil?: number; motivo: string }) {
  const m = materialValido(ctx.db, d.materialId);
  const colorId = colorDeMovimiento(ctx.db, m, d.colorId);
  if (!d.motivo?.trim()) throw new ErrorNegocio('Indicá por qué se descarta');
  const fila = calcularReposicion(ctx.db).materiales.find((x) => x.clave === claveMaterial(d.materialId, colorId));
  const cant = d.cantidadMil ?? fila?.aPedirMil ?? 0;
  if (!Number.isInteger(cant) || cant <= 0) throw new ErrorNegocio('No hay nada para descartar de ese material');
  return registrar(ctx, { materialId: d.materialId, colorId, tipo: 'descartar', cantidadMil: cant, motivo: d.motivo.trim() });
}

/** Pedir este material a otro proveedor (solo para la reposición; el habitual se cambia en la ficha del material). */
export function cambiarProveedor(ctx: Ctx, d: { materialId: number; colorId?: number | null; proveedorId: number; motivo?: string | null }) {
  const m = materialValido(ctx.db, d.materialId);
  const colorId = colorDeMovimiento(ctx.db, m, d.colorId);
  if (!ctx.db.select({ id: proveedores.id }).from(proveedores).where(eq(proveedores.id, d.proveedorId)).get()) throw noEncontrado('El proveedor');
  anularActivas(ctx, d.materialId, colorId, 'proveedor');
  if (d.proveedorId === m.proveedorId) return null; // volver al habitual
  return registrar(ctx, { materialId: d.materialId, colorId, tipo: 'proveedor', proveedorId: d.proveedorId, motivo: d.motivo?.trim() || null });
}

/** Deshace una decisión (queda anulada, no se borra). */
export function anularDecision(ctx: Ctx, id: number) {
  const n = ctx.db.select().from(necesidadesMaterial).where(eq(necesidadesMaterial.id, id)).get();
  if (!n) throw noEncontrado('La decisión');
  if (n.estado !== 'activa') throw new ErrorNegocio('Ya no está activa');
  ctx.db.update(necesidadesMaterial).set({ estado: 'anulada', actualizadoEn: ahora() }).where(eq(necesidadesMaterial.id, id)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'anular', entidad: 'necesidad_material', entidadId: id, antes: n });
  return { ok: true };
}

/**
 * Cierra las decisiones que ya no aplican: posposiciones vencidas y descartes de materiales a los que ya no les falta
 * nada (si mañana vuelve a faltar, se calcula de cero). Se corre antes de mostrar la reposición.
 */
export function cerrarDecisionesVencidas(ctx: Ctx, hoy = hoyLocal()) {
  const activas = ctx.db.select().from(necesidadesMaterial).where(and(eq(necesidadesMaterial.estado, 'activa'), inArray(necesidadesMaterial.tipo, ['posponer', 'descartar']))).all();
  if (!activas.length) return 0;
  const filas = calcularReposicion(ctx.db, hoy).materiales;
  const cerrar = activas.filter((d) => (d.tipo === 'posponer' ? !d.hasta || d.hasta <= hoy : (filas.find((f) => f.materialId === d.materialId && (!f.porColor || f.colorId === (d.colorId ?? null)))?.faltanteMil ?? 0) <= 0));
  if (!cerrar.length) return 0;
  ctx.db.update(necesidadesMaterial).set({ estado: 'usada', actualizadoEn: ahora() }).where(inArray(necesidadesMaterial.id, cerrar.map((d) => d.id))).run();
  return cerrar.length;
}

/**
 * Arma un pedido de materiales en BORRADOR para un proveedor con las cantidades elegidas (se revisa y confirma en Compras).
 * El cambio de proveedor y la posposición de esos materiales quedan "usados" por el pedido (si se anula, vuelven).
 * Los descartes siguen: lo descartado no se pide aunque se arme un pedido por el resto.
 */
export function armarPedidoMateriales(ctx: Ctx, d: { proveedorId: number; lineas: { materialId: number; colorId?: number | null; cantidadMil: number; costoUnitarioCentavos?: number | null }[]; notas?: string | null }) {
  if (!d.lineas.length) throw new ErrorNegocio('Elegí al menos un material');
  const ms = d.lineas.map((l) => {
    const m = materialValido(ctx.db, l.materialId);
    const costo = l.costoUnitarioCentavos ?? precioParaEstimar(ctx.db, d.proveedorId, m.id, l.colorId ?? null, m.costoCentavos);
    if (costo == null) throw new ErrorNegocio(`Falta el costo de ${m.nombre}: indicalo en el pedido o cargalo en Materiales`);
    return { materialId: m.id, colorId: colorDeMovimiento(ctx.db, m, l.colorId), cantidadMil: l.cantidadMil, costoUnitarioCentavos: costo };
  });
  if (new Set(ms.map((l) => claveMaterial(l.materialId, l.colorId))).size !== ms.length) throw new ErrorNegocio('Hay un material repetido');
  const c = crearCompra(ctx, { proveedorId: d.proveedorId, tipo: 'materiales', fecha: hoyLocal(), notas: d.notas?.trim() || 'Armado desde la reposición de materiales', items: [], materiales: ms });
  const claves = new Set(ms.map((l) => claveMaterial(l.materialId, l.colorId)));
  const usadas = ctx.db.select().from(necesidadesMaterial).where(and(eq(necesidadesMaterial.estado, 'activa'), inArray(necesidadesMaterial.tipo, ['proveedor', 'posponer']), inArray(necesidadesMaterial.materialId, ms.map((m) => m.materialId)))).all()
    .filter((n) => claves.has(claveMaterial(n.materialId, n.colorId)));
  if (usadas.length) ctx.db.update(necesidadesMaterial).set({ estado: 'usada', compraId: c.id, actualizadoEn: ahora() }).where(inArray(necesidadesMaterial.id, usadas.map((n) => n.id))).run();
  return { compraId: c.id, numero: c.numero, materiales: ms.length };
}

const fmtCant = (mil: number, unidad: string) => `${(mil / 1000).toLocaleString('es-AR', { maximumFractionDigits: 3 })} ${unidad}`;

/** Texto para mandar por WhatsApp o mail con lo que hay que pedirle a un proveedor. */
export function textoPedidoMateriales(db: DB, proveedorId: number | null) {
  const g = reposicionPorProveedor(db).grupos.find((x) => x.proveedorId === proveedorId);
  if (!g) throw new ErrorNegocio('No hay nada para pedir a ese proveedor');
  return `Pedido Herencia Cuero — ${g.proveedor}\n${g.items.map((i) => `• ${fmtCant(i.aPedirMil, i.unidad)} de ${i.nombre}${i.color ? ' ' + i.color : ''}`).join('\n')}`;
}
