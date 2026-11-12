/**
 * Costos y producción: materiales (con stock en milésimas y costo con historial), recetas por modelo,
 * costeo de cada variante (materiales + mano de obra + componentes configurables) y precios sugeridos.
 *
 * Nada cambia costos ni precios publicados sin una acción explícita: el costeo y los precios sugeridos
 * se muestran primero y se aplican solo lo que el usuario elige (con motivo y permiso).
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { categorias, historialCostosMaterial, materiales, modelos, movimientosMaterial, precios, proveedores, recetaItems, talles, variantes } from '../db/schema.js';
import type { DB } from '../db/index.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { leerConfig } from './configuracion.js';
import { actualizarVariante, fijarPrecio } from './catalogo.js';
import type { Ctx } from './stock.js';
import { analizarPrecio, calcularPrecio, type MetodoPrecio } from '../domain/precios.js';
import { redondearPrecio } from '../domain/dinero.js';

export type Material = typeof materiales.$inferSelect;
/** Costo de una cantidad en milésimas: costo por unidad × cantidad / 1000, redondeado. */
export const costoDeCantidad = (costoUnidad: number, cantidadMil: number) => Math.round((costoUnidad * cantidadMil) / 1000);

// ───────────── Materiales ─────────────

export function stockMateriales(db: DB, ids?: number[]) {
  const filas = db.select({ m: movimientosMaterial.materialId, n: sql<number>`sum(${movimientosMaterial.cantidadMil})` }).from(movimientosMaterial)
    .where(ids ? (ids.length ? inArray(movimientosMaterial.materialId, ids) : sql`0`) : undefined).groupBy(movimientosMaterial.materialId).all();
  return new Map(filas.map((f) => [f.m, Number(f.n)]));
}

export function listarMateriales(db: DB) {
  const stock = stockMateriales(db);
  const usos = new Map(db.select({ m: recetaItems.materialId, n: sql<number>`count(distinct ${recetaItems.modeloId})` }).from(recetaItems).groupBy(recetaItems.materialId).all().map((u) => [u.m, Number(u.n)]));
  return db.select({ m: materiales, proveedor: proveedores.nombre }).from(materiales).leftJoin(proveedores, eq(proveedores.id, materiales.proveedorId))
    .orderBy(asc(materiales.codigo)).all()
    .map((r) => ({ ...r.m, proveedor: r.proveedor, stockMil: r.m.tipo === 'mano_obra' ? null : stock.get(r.m.id) ?? 0, modelosQueLoUsan: usos.get(r.m.id) ?? 0 }));
}

export function materialOError(db: DB, id: number) {
  const m = db.select().from(materiales).where(eq(materiales.id, id)).get();
  if (!m) throw noEncontrado('El material');
  return m;
}

export interface DatosMaterial { codigo: string; nombre: string; unidad: Material['unidad']; tipo: Material['tipo']; costoCentavos: number | null; proveedorId: number | null; stockMinimoMil?: number | null; notas?: string | null; activo?: boolean }

export function guardarMaterial(ctx: Ctx, id: number | null, d: DatosMaterial, motivo?: string) {
  const codigo = d.codigo?.trim().toUpperCase();
  if (!codigo || !d.nombre?.trim()) throw new ErrorNegocio('Código y nombre son obligatorios');
  if (d.costoCentavos !== null && (!Number.isInteger(d.costoCentavos) || d.costoCentavos < 0)) throw new ErrorNegocio('Costo inválido');
  const rep = ctx.db.select().from(materiales).where(sql`upper(${materiales.codigo}) = ${codigo}`).get();
  if (rep && rep.id !== id) throw new ErrorNegocio(`Ya existe el material ${codigo}`);
  const t = ahora();
  const valores = { codigo, nombre: d.nombre.trim(), unidad: d.unidad, tipo: d.tipo, costoCentavos: d.costoCentavos, proveedorId: d.proveedorId, stockMinimoMil: d.stockMinimoMil ?? null, notas: d.notas?.trim() || null, actualizadoEn: t };
  if (id === null) {
    const m = ctx.db.insert(materiales).values({ ...valores, activo: d.activo ?? true, creadoEn: t }).returning().get();
    if (m.costoCentavos !== null) ctx.db.insert(historialCostosMaterial).values({ materialId: m.id, anteriorCentavos: null, nuevoCentavos: m.costoCentavos, fecha: t, usuarioId: ctx.usuarioId, origen: 'alta' }).run();
    auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: 'material', entidadId: m.id, despues: m });
    return m;
  }
  const antes = materialOError(ctx.db, id);
  if (antes.tipo !== d.tipo && stockMateriales(ctx.db, [id]).get(id)) throw new ErrorNegocio('El material tiene stock: no se le puede cambiar el tipo');
  const m = ctx.db.update(materiales).set({ ...valores, activo: d.activo ?? antes.activo }).where(eq(materiales.id, id)).returning().get();
  if (m.costoCentavos !== antes.costoCentavos) {
    ctx.db.insert(historialCostosMaterial).values({ materialId: id, anteriorCentavos: antes.costoCentavos, nuevoCentavos: m.costoCentavos, fecha: t, usuarioId: ctx.usuarioId, origen: 'edicion', motivo: motivo ?? null }).run();
  }
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'material', entidadId: id, antes, despues: m, detalle: motivo });
  return m;
}

const aMil = (n: number) => Math.round(n * 1000);
export { aMil };

/**
 * Compra de material: entra stock y el costo se actualiza por promedio ponderado. Si se indica el proveedor,
 * el importe suma a su cuenta corriente (se paga desde Pagos a proveedores).
 */
export function ingresarMaterial(ctx: Ctx, d: { materialId: number; fecha: string; cantidadMil: number; costoUnitarioCentavos: number; proveedorId?: number | null; comprobante?: string | null; notas?: string | null }) {
  const m = materialOError(ctx.db, d.materialId);
  if (m.tipo === 'mano_obra') throw new ErrorNegocio('La mano de obra no tiene stock: se paga con el pedido al taller');
  if (!Number.isInteger(d.cantidadMil) || d.cantidadMil <= 0) throw new ErrorNegocio('La cantidad tiene que ser mayor a cero');
  if (!Number.isInteger(d.costoUnitarioCentavos) || d.costoUnitarioCentavos < 0) throw new ErrorNegocio('Costo inválido');
  if (d.proveedorId && !ctx.db.select({ id: proveedores.id }).from(proveedores).where(eq(proveedores.id, d.proveedorId)).get()) throw noEncontrado('El proveedor');
  const stock = Math.max(0, stockMateriales(ctx.db, [m.id]).get(m.id) ?? 0);
  const t = ahora();
  const mov = ctx.db.insert(movimientosMaterial).values({
    fecha: d.fecha, materialId: m.id, cantidadMil: d.cantidadMil, tipo: 'compra', costoUnitarioCentavos: d.costoUnitarioCentavos, proveedorId: d.proveedorId ?? null,
    comprobante: d.comprobante?.trim() || null, motivo: d.notas?.trim() || null, usuarioId: ctx.usuarioId, creadoEn: t,
  }).returning().get();
  const nuevo = m.costoCentavos === null || stock <= 0 ? d.costoUnitarioCentavos : Math.round((stock * m.costoCentavos + d.cantidadMil * d.costoUnitarioCentavos) / (stock + d.cantidadMil));
  if (nuevo !== m.costoCentavos) {
    ctx.db.update(materiales).set({ costoCentavos: nuevo, actualizadoEn: t }).where(eq(materiales.id, m.id)).run();
    ctx.db.insert(historialCostosMaterial).values({ materialId: m.id, anteriorCentavos: m.costoCentavos, nuevoCentavos: nuevo, fecha: t, usuarioId: ctx.usuarioId, origen: 'compra', motivo: 'Promedio ponderado', refTipo: 'mov_material', refId: mov.id }).run();
  }
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'ingreso_material', entidad: 'material', entidadId: m.id, despues: { ...d, costoNuevo: nuevo } });
  return { movimientoId: mov.id, costoAnteriorCentavos: m.costoCentavos, costoNuevoCentavos: nuevo };
}

export function ajustarMaterial(ctx: Ctx, d: { materialId: number; fecha: string; cantidadMil: number; motivo: string; tipo?: 'ajuste' | 'inicial' }) {
  const m = materialOError(ctx.db, d.materialId);
  if (m.tipo === 'mano_obra') throw new ErrorNegocio('La mano de obra no tiene stock');
  if (!d.motivo?.trim()) throw new ErrorNegocio('Indicá el motivo');
  if (!Number.isInteger(d.cantidadMil) || d.cantidadMil === 0) throw new ErrorNegocio('La cantidad tiene que ser distinta de cero');
  const mov = ctx.db.insert(movimientosMaterial).values({ fecha: d.fecha, materialId: m.id, cantidadMil: d.cantidadMil, tipo: d.tipo ?? 'ajuste', costoUnitarioCentavos: m.costoCentavos, motivo: d.motivo.trim(), usuarioId: ctx.usuarioId, creadoEn: ahora() }).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'ajuste_material', entidad: 'material', entidadId: m.id, despues: d });
  return mov;
}

/** Anula un movimiento de material cargado a mano (compra, ajuste o inicial) agregando el contrario. */
export function anularMovimientoMaterial(ctx: Ctx, movId: number, motivo: string) {
  if (!motivo?.trim()) throw new ErrorNegocio('Indicá el motivo');
  const m = ctx.db.select().from(movimientosMaterial).where(eq(movimientosMaterial.id, movId)).get();
  if (!m) throw noEncontrado('El movimiento');
  if (!['compra', 'ajuste', 'inicial'].includes(m.tipo)) throw new ErrorNegocio('Este movimiento se anula desde su documento (recepción del taller)');
  if (ctx.db.select({ id: movimientosMaterial.id }).from(movimientosMaterial).where(eq(movimientosMaterial.anulaId, movId)).get()) throw new ErrorNegocio('Ya está anulado');
  ctx.db.insert(movimientosMaterial).values({ fecha: m.fecha, materialId: m.materialId, cantidadMil: -m.cantidadMil, tipo: 'anulacion', costoUnitarioCentavos: m.costoUnitarioCentavos, proveedorId: m.proveedorId, anulaId: m.id, motivo: `Anula: ${motivo.trim()}`, usuarioId: ctx.usuarioId, creadoEn: ahora() }).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'anular', entidad: 'mov_material', entidadId: movId, detalle: motivo });
  return { ok: true, avisoCosto: m.tipo === 'compra' ? 'El costo promedio no se recalcula solo: revisalo en la ficha del material' : null };
}

export function detalleMaterial(db: DB, id: number) {
  const m = materialOError(db, id);
  const movs = db.select({ mv: movimientosMaterial, proveedor: proveedores.nombre }).from(movimientosMaterial).leftJoin(proveedores, eq(proveedores.id, movimientosMaterial.proveedorId))
    .where(eq(movimientosMaterial.materialId, id)).orderBy(movimientosMaterial.fecha, movimientosMaterial.id).all();
  const anulados = new Set(movs.filter((x) => x.mv.anulaId).map((x) => x.mv.anulaId));
  let saldo = 0;
  const filas = movs.map((x) => ({ ...x.mv, proveedor: x.proveedor, anulado: anulados.has(x.mv.id), saldoMil: (saldo += x.mv.cantidadMil) })).reverse();
  const historial = db.select().from(historialCostosMaterial).where(eq(historialCostosMaterial.materialId, id)).orderBy(desc(historialCostosMaterial.id)).limit(100).all();
  const usadoEn = db.select({ modeloId: modelos.id, modelo: modelos.nombre, cantidadMil: recetaItems.cantidadMil, talles: recetaItems.talles }).from(recetaItems)
    .innerJoin(modelos, eq(modelos.id, recetaItems.modeloId)).where(eq(recetaItems.materialId, id)).orderBy(modelos.nombre).all();
  return { ...m, stockMil: m.tipo === 'mano_obra' ? null : saldo, movimientos: filas, historial, usadoEn };
}

// ───────────── Recetas ─────────────

export interface LineaReceta { materialId: number; cantidadMil: number; talles?: string[] | null; notas?: string | null }

export function obtenerReceta(db: DB, modeloId: number) {
  return db.select({ r: recetaItems, codigo: materiales.codigo, material: materiales.nombre, unidad: materiales.unidad, tipo: materiales.tipo, costoCentavos: materiales.costoCentavos })
    .from(recetaItems).innerJoin(materiales, eq(materiales.id, recetaItems.materialId)).where(eq(recetaItems.modeloId, modeloId)).orderBy(asc(recetaItems.orden), asc(recetaItems.id)).all()
    .map((x) => ({ ...x.r, codigo: x.codigo, material: x.material, unidad: x.unidad, tipoMaterial: x.tipo, costoUnidadCentavos: x.costoCentavos }));
}

/** Reemplaza la receta de un modelo (es una definición, no una operación: queda el antes y después en auditoría). */
export function guardarReceta(ctx: Ctx, modeloId: number, lineas: LineaReceta[]) {
  if (!ctx.db.select({ id: modelos.id }).from(modelos).where(eq(modelos.id, modeloId)).get()) throw noEncontrado('El modelo');
  const ids = [...new Set(lineas.map((l) => l.materialId))];
  const mats = ids.length ? ctx.db.select().from(materiales).where(inArray(materiales.id, ids)).all() : [];
  if (mats.length !== ids.length) throw new ErrorNegocio('Hay materiales que no existen');
  const vistos = new Set<string>();
  for (const l of lineas) {
    if (!Number.isInteger(l.cantidadMil) || l.cantidadMil <= 0) throw new ErrorNegocio('Las cantidades tienen que ser mayores a cero');
    const clave = `${l.materialId}|${(l.talles ?? []).slice().sort().join(',')}`;
    if (vistos.has(clave)) throw new ErrorNegocio(`${mats.find((m) => m.id === l.materialId)!.nombre} está repetido para los mismos talles: juntá las cantidades`);
    vistos.add(clave);
  }
  const antes = obtenerReceta(ctx.db, modeloId);
  ctx.db.delete(recetaItems).where(eq(recetaItems.modeloId, modeloId)).run();
  if (lineas.length) {
    ctx.db.insert(recetaItems).values(lineas.map((l, i) => ({ modeloId, materialId: l.materialId, cantidadMil: l.cantidadMil, talles: l.talles?.length ? l.talles.map((t) => t.trim()) : null, notas: l.notas?.trim() || null, orden: i }))).run();
  }
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'receta', entidadId: modeloId,
    antes: antes.map((a) => ({ material: a.codigo, cantidadMil: a.cantidadMil, talles: a.talles })), despues: lineas.map((l) => ({ material: mats.find((m) => m.id === l.materialId)!.codigo, cantidadMil: l.cantidadMil, talles: l.talles ?? null })) });
  return obtenerReceta(ctx.db, modeloId);
}

// ───────────── Costeo ─────────────

type Componente = ReturnType<typeof leerConfig<'costos'>>['componentes'][number];

function componentesPara(db: DB, categoriaId: number) {
  return leerConfig(db, 'costos').componentes.filter((c) => c.activo && (c.categoriaId === null || c.categoriaId === categoriaId));
}

/**
 * Costo calculado de cada variante de los modelos indicados (o de todos los que tienen receta):
 * materiales + mano de obra según la receta (con los agregados por talle) + componentes de costo.
 */
export function costear(db: DB, modeloIds?: number[]) {
  const conReceta = modeloIds ?? db.selectDistinct({ m: recetaItems.modeloId }).from(recetaItems).all().map((x) => x.m);
  if (!conReceta.length) return [];
  const ms = db.select({ id: modelos.id, nombre: modelos.nombre, categoriaId: modelos.categoriaId, categoria: categorias.nombre }).from(modelos)
    .innerJoin(categorias, eq(categorias.id, modelos.categoriaId)).where(inArray(modelos.id, conReceta)).all();
  const vs = db.select({ id: variantes.id, modeloId: variantes.modeloId, sku: variantes.sku, talle: talles.nombre, costo: variantes.costoCentavos, adicional: variantes.costoAdicionalCentavos, logistico: variantes.costoLogisticoCentavos, activo: variantes.activo })
    .from(variantes).leftJoin(talles, eq(talles.id, variantes.talleId)).where(and(inArray(variantes.modeloId, conReceta), eq(variantes.activo, true))).orderBy(talles.orden, variantes.sku).all();
  return ms.sort((a, b) => a.nombre.localeCompare(b.nombre)).map((m) => {
    const receta = obtenerReceta(db, m.id);
    const comps = componentesPara(db, m.categoriaId);
    const filas = vs.filter((v) => v.modeloId === m.id).map((v) => {
      const lineas = receta.filter((l) => !l.talles || (v.talle !== null && l.talles.includes(v.talle)));
      const pendientes = lineas.filter((l) => l.costoUnidadCentavos === null).map((l) => l.material);
      const materialesC = lineas.filter((l) => l.tipoMaterial === 'material').reduce((s, l) => s + costoDeCantidad(l.costoUnidadCentavos ?? 0, l.cantidadMil), 0);
      const manoObra = lineas.filter((l) => l.tipoMaterial === 'mano_obra').reduce((s, l) => s + costoDeCantidad(l.costoUnidadCentavos ?? 0, l.cantidadMil), 0);
      // El costo de la prenda se lleva en pesos enteros (como en la planilla); el detalle conserva los centavos.
      const calculado = Math.round((materialesC + manoObra) / 100) * 100;
      const { adicional, detalle } = adicionales(comps, materialesC + manoObra);
      const conAgregados = lineas.filter((l) => l.talles).map((l) => `${l.material} +${l.cantidadMil / 1000}`);
      return {
        varianteId: v.id, sku: v.sku, talle: v.talle, materialesCentavos: materialesC, manoObraCentavos: manoObra, adicionalCentavos: adicional, componentes: detalle,
        calculadoCentavos: calculado, totalCalculadoCentavos: calculado + adicional + v.logistico,
        actualCentavos: v.costo, actualAdicionalCentavos: v.adicional, totalActualCentavos: v.costo === null ? null : v.costo + v.adicional + v.logistico,
        pendientes, agregados: conAgregados,
        cambia: v.costo !== calculado || v.adicional !== adicional,
      };
    });
    return { modeloId: m.id, modelo: m.nombre, categoria: m.categoria, lineasReceta: receta.length, variantes: filas };
  });
}

function adicionales(comps: Componente[], base: number) {
  const detalle = comps.filter((c) => c.tipo !== 'porcentaje_precio').map((c) => ({ nombre: c.nombre, centavos: c.tipo === 'fijo' ? c.valor : Math.round((base * c.valor) / 1000000) * 100 }));
  return { adicional: detalle.reduce((s, d) => s + d.centavos, 0), detalle };
}

/**
 * Aplica el costo calculado a las variantes elegidas: costo = materiales + mano de obra; costo adicional = componentes.
 * Se rechaza si el cálculo cambió desde que se mostró (por ejemplo, alguien modificó un material en el medio).
 */
export function aplicarCostos(ctx: Ctx, varianteIds: number[], motivo: string, previstos?: Record<string, number>) {
  if (!motivo?.trim()) throw new ErrorNegocio('Indicá el motivo');
  if (!varianteIds.length) throw new ErrorNegocio('Elegí al menos una variante');
  const modelosIds = [...new Set(ctx.db.select({ m: variantes.modeloId }).from(variantes).where(inArray(variantes.id, varianteIds)).all().map((x) => x.m))];
  const filas = costear(ctx.db, modelosIds).flatMap((m) => m.variantes).filter((v) => varianteIds.includes(v.varianteId));
  if (filas.length !== varianteIds.length) throw new ErrorNegocio('Hay variantes sin receta o inactivas');
  const conPendientes = filas.filter((f) => f.pendientes.length);
  if (conPendientes.length) throw new ErrorNegocio(`Faltan costos de materiales (${[...new Set(conPendientes.flatMap((f) => f.pendientes))].join(', ')}): cargalos antes de aplicar`);
  if (previstos && filas.some((f) => previstos[f.varianteId] !== undefined && previstos[f.varianteId] !== f.totalCalculadoCentavos)) {
    throw new ErrorNegocio('Los costos cambiaron desde que los viste. Volvé a calcular antes de aplicar.', 409);
  }
  let cambiadas = 0;
  for (const f of filas) {
    if (!f.cambia) continue;
    actualizarVariante(ctx, f.varianteId, { costoCentavos: f.calculadoCentavos, costoAdicionalCentavos: f.adicionalCentavos }, 'receta', motivo.trim());
    cambiadas++;
  }
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'aplicar_costos', entidad: 'costos', detalle: `${cambiadas} variantes · ${motivo.trim()}` });
  return { cambiadas };
}

// ───────────── Precios sugeridos ─────────────

export interface ParamsSugeridos { listaId: number; metodo: MetodoPrecio; valorBp: number; categoriaId?: number; modeloIds?: number[]; redondeoCentavos?: number; soloConCosto?: boolean }

/**
 * Precio sugerido para cada variante con costo, según el método (margen o markup) y los componentes que son
 * % sobre el precio. Muestra también la rentabilidad del precio actual, para ver dónde cayó.
 */
export function preciosSugeridos(db: DB, p: ParamsSugeridos) {
  if (p.metodo === 'precio_objetivo') throw new ErrorNegocio('Para un precio objetivo usá el cambio de precios');
  const conds = [eq(variantes.activo, true), eq(modelos.activo, true)];
  if (p.categoriaId) conds.push(eq(modelos.categoriaId, p.categoriaId));
  if (p.modeloIds?.length) conds.push(inArray(modelos.id, p.modeloIds));
  const filas = db.select({ varianteId: variantes.id, sku: variantes.sku, modeloId: modelos.id, modelo: modelos.nombre, categoriaId: modelos.categoriaId, talle: talles.nombre,
    costo: sql<number | null>`case when ${variantes.costoCentavos} is null then null else ${variantes.costoCentavos} + ${variantes.costoLogisticoCentavos} + ${variantes.costoAdicionalCentavos} end`,
    actual: sql<number | null>`(select pr.precio_centavos from precios pr where pr.variante_id = ${variantes.id} and pr.lista_id = ${p.listaId})` })
    .from(variantes).innerJoin(modelos, eq(modelos.id, variantes.modeloId)).leftJoin(talles, eq(talles.id, variantes.talleId))
    .where(and(...conds)).orderBy(modelos.nombre, talles.orden, variantes.sku).all();
  const comps = leerConfig(db, 'costos').componentes.filter((c) => c.activo && c.tipo === 'porcentaje_precio');
  const redondeo = p.redondeoCentavos ?? leerConfig(db, 'precios').redondeoCentavos;
  const objetivo = p.metodo === 'margen' ? p.valorBp : null;
  return filas.filter((f) => !p.soloConCosto || f.costo !== null).map((f) => {
    const pct = comps.filter((c) => c.categoriaId === null || c.categoriaId === f.categoriaId).reduce((s, c) => s + c.valor, 0);
    if (f.costo === null) return { ...f, costo: null, porcentajesSobrePrecioBp: pct, sugeridoCentavos: null, actualAnalisis: null, sugeridoAnalisis: null, debajoObjetivo: false };
    const costo = Number(f.costo);
    const r = calcularPrecio({ metodo: p.metodo, costoCentavos: costo, margenBp: p.metodo === 'margen' ? p.valorBp : undefined, markupBp: p.metodo === 'markup' ? p.valorBp : undefined, porcentajesSobrePrecioBp: pct });
    const sugerido = redondeo ? redondearPrecio(r.precioCentavos, redondeo) : r.precioCentavos;
    const actualAnalisis = f.actual === null ? null : analizarPrecio(Number(f.actual), costo, pct);
    return {
      ...f, costo, actual: f.actual === null ? null : Number(f.actual), porcentajesSobrePrecioBp: pct, sugeridoCentavos: sugerido,
      sugeridoAnalisis: analizarPrecio(sugerido, costo, pct), actualAnalisis,
      // El precio actual deja menos ganancia de la buscada.
      debajoObjetivo: actualAnalisis !== null && (objetivo !== null ? (actualAnalisis.margenNetoBp ?? 0) < objetivo : (actualAnalisis.gananciaNetaCentavos * 10000) / costo < p.valorBp),
    };
  });
}

/** Publica los precios elegidos. Solo cambia los que vienen en la lista y exige que coincidan con lo que se vio. */
export function aplicarPrecios(ctx: Ctx, listaId: number, cambios: { varianteId: number; precioCentavos: number }[], motivo: string) {
  if (!motivo?.trim()) throw new ErrorNegocio('Indicá el motivo del cambio de precios');
  if (!cambios.length) throw new ErrorNegocio('Elegí al menos un precio');
  let cambiados = 0;
  for (const c of cambios) {
    if (!Number.isInteger(c.precioCentavos) || c.precioCentavos <= 0) throw new ErrorNegocio('Precio inválido');
    if (fijarPrecio(ctx, listaId, c.varianteId, c.precioCentavos, 'precio_sugerido', motivo.trim())) cambiados++;
  }
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'aplicar_precios_sugeridos', entidad: 'lista_precio', entidadId: listaId, despues: { cambiados, motivo } });
  return { cambiados };
}

// ───────────── Producción ─────────────

/**
 * Cuando el taller entrega prendas (recepción de un pedido de confección), se descuentan los materiales
 * que usa cada una según su receta. La mano de obra no se descuenta (se paga con el pedido).
 * Si el modelo no tiene receta no se descuenta nada (se avisa).
 */
export function consumirPorProduccion(ctx: Ctx, recepcionId: number, numero: number, fecha: string, items: { varianteId: number; cantidad: number }[]) {
  const sinReceta: string[] = [];
  const consumo = new Map<number, number>();
  for (const it of items) {
    const v = ctx.db.select({ modeloId: variantes.modeloId, sku: variantes.sku, talle: talles.nombre }).from(variantes).leftJoin(talles, eq(talles.id, variantes.talleId)).where(eq(variantes.id, it.varianteId)).get()!;
    const receta = obtenerReceta(ctx.db, v.modeloId).filter((l) => l.tipoMaterial === 'material' && (!l.talles || (v.talle !== null && l.talles.includes(v.talle))));
    if (!receta.length) { sinReceta.push(v.sku); continue; }
    for (const l of receta) consumo.set(l.materialId, (consumo.get(l.materialId) ?? 0) + l.cantidadMil * it.cantidad);
  }
  const t = ahora();
  for (const [materialId, cant] of consumo) {
    const m = materialOError(ctx.db, materialId);
    ctx.db.insert(movimientosMaterial).values({ fecha, materialId, cantidadMil: -cant, tipo: 'produccion', costoUnitarioCentavos: m.costoCentavos, refTipo: 'recepcion', refId: recepcionId, motivo: `Producción · recepción R-${numero}`, usuarioId: ctx.usuarioId, creadoEn: t }).run();
  }
  return { materiales: consumo.size, sinReceta };
}

/** Al anular una recepción de confección, vuelven los materiales consumidos. */
export function revertirProduccion(ctx: Ctx, recepcionId: number, motivo: string) {
  const movs = ctx.db.select().from(movimientosMaterial).where(and(eq(movimientosMaterial.refTipo, 'recepcion'), eq(movimientosMaterial.refId, recepcionId), eq(movimientosMaterial.tipo, 'produccion'))).all();
  const t = ahora();
  for (const m of movs) {
    ctx.db.insert(movimientosMaterial).values({ fecha: m.fecha, materialId: m.materialId, cantidadMil: -m.cantidadMil, tipo: 'anulacion', costoUnitarioCentavos: m.costoUnitarioCentavos, refTipo: 'recepcion', refId: recepcionId, anulaId: m.id, motivo: `Anula producción: ${motivo}`, usuarioId: ctx.usuarioId, creadoEn: t }).run();
  }
}

/** Compras de material por proveedor (al costo de cada ingreso), para su cuenta corriente. */
export function comprasMaterialPorProveedor(db: DB) {
  return db.all<{ p: number; s: number }>(sql`
    select m.proveedor_id as p, coalesce(sum(round(m.cantidad_mil * m.costo_unitario_centavos / 1000.0)), 0) as s from movimientos_material m
    where m.proveedor_id is not null and m.tipo in ('compra', 'anulacion') and (m.tipo = 'compra' or exists (select 1 from movimientos_material o where o.id = m.anula_id and o.tipo = 'compra'))
    group by m.proveedor_id`);
}

export function ingresosMaterialDeProveedor(db: DB, proveedorId: number) {
  return db.select({ mv: movimientosMaterial, material: materiales.nombre, unidad: materiales.unidad }).from(movimientosMaterial).innerJoin(materiales, eq(materiales.id, movimientosMaterial.materialId))
    .where(and(eq(movimientosMaterial.proveedorId, proveedorId), inArray(movimientosMaterial.tipo, ['compra', 'anulacion']))).all()
    .map((r) => ({ ...r.mv, material: r.material, unidad: r.unidad, importeCentavos: costoDeCantidad(r.mv.costoUnitarioCentavos ?? 0, r.mv.cantidadMil) }));
}


export function preciosActuales(db: DB, listaId: number, varianteIds: number[]): [number, number][] {
  if (!varianteIds.length) return [];
  return db.select({ v: precios.varianteId, p: precios.precioCentavos }).from(precios).where(and(eq(precios.listaId, listaId), inArray(precios.varianteId, varianteIds))).all().map((r) => [r.v, r.p]);
}
