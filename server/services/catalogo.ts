/**
 * Lógica de negocio del catálogo: categorías, colores, talles, modelos y variantes (SKU),
 * con historial de costos y precios. Ninguna función borra registros: las bajas son lógicas.
 */
import { and, asc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import {
  categorias, colores, talles, modelos, variantes, proveedores, unidades,
  listasPrecio, precios, historialCostos, historialPrecios,
} from '../db/schema.js';
import type { DB } from '../db/index.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { normalizarClave, normalizarSku, prolijo } from '../domain/texto.js';
import { aplicarAjuste, redondearPrecio } from '../domain/dinero.js';
import { stockDe } from './stock.js';

type Ctx = { db: DB; usuarioId: number | null };

// ───────────── Tablas auxiliares (búsqueda tolerante a mayúsculas/acentos) ─────────────

export function buscarCategoria(db: DB, nombre: string, padreId: number | null) {
  const clave = normalizarClave(nombre);
  const filas = db.select().from(categorias).where(padreId === null ? isNull(categorias.padreId) : eq(categorias.padreId, padreId)).all();
  return filas.find((c) => normalizarClave(c.nombre) === clave) ?? null;
}

export function obtenerOCrearCategoria(ctx: Ctx, nombre: string, padreId: number | null = null) {
  const existente = buscarCategoria(ctx.db, nombre, padreId);
  if (existente) return existente;
  const c = ctx.db.insert(categorias).values({ nombre: prolijo(nombre), padreId, creadoEn: ahora() }).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: padreId ? 'subcategoria' : 'categoria', entidadId: c.id, despues: c });
  return c;
}

function obtenerOCrearSimple<T extends { id: number; nombre: string }>(
  ctx: Ctx, tabla: typeof colores | typeof talles, entidad: string, nombre: string,
): T {
  const clave = normalizarClave(nombre);
  const filas = ctx.db.select().from(tabla).all() as unknown as T[];
  const e = filas.find((f) => normalizarClave(f.nombre) === clave);
  if (e) return e;
  const valores = entidad === 'talle' ? { nombre: nombre.trim().toUpperCase(), orden: ordenTalle(nombre) } : { nombre: prolijo(nombre) };
  const n = ctx.db.insert(tabla).values(valores as never).returning().get() as unknown as T;
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad, entidadId: n.id, despues: n });
  return n;
}

export const obtenerOCrearColor = (ctx: Ctx, nombre: string) => obtenerOCrearSimple<typeof colores.$inferSelect>(ctx, colores, 'color', nombre);
export const obtenerOCrearTalle = (ctx: Ctx, nombre: string) => obtenerOCrearSimple<typeof talles.$inferSelect>(ctx, talles, 'talle', nombre);

/** Orden natural de talles: numéricos primero (1..8, 90..120), luego letras. */
function ordenTalle(nombre: string): number {
  const n = Number(nombre.trim());
  if (Number.isFinite(n)) return n;
  const letras = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL'];
  const i = letras.indexOf(nombre.trim().toUpperCase());
  return i >= 0 ? 1000 + i : 2000;
}

export function obtenerOCrearProveedor(ctx: Ctx, nombre: string) {
  const clave = normalizarClave(nombre);
  const e = ctx.db.select().from(proveedores).all().find((p) => normalizarClave(p.nombre) === clave);
  if (e) return e;
  const t = ahora();
  const p = ctx.db.insert(proveedores).values({ nombre: nombre.trim(), creadoEn: t, actualizadoEn: t }).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: 'proveedor', entidadId: p.id, despues: p });
  return p;
}

// ───────────── Consultas ─────────────

export interface FiltroModelos {
  q?: string;
  categoriaId?: number;
  estado?: 'activos' | 'inactivos' | 'todos';
}

/** Listado de modelos con resumen de variantes, costo y precios. */
export function listarModelos(db: DB, f: FiltroModelos = {}) {
  const conds = [];
  if (f.estado !== 'todos') conds.push(eq(modelos.activo, f.estado !== 'inactivos'));
  if (f.categoriaId) conds.push(eq(modelos.categoriaId, f.categoriaId));
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    // Busca por nombre del modelo, SKU, color o código de barras.
    conds.push(or(
      like(modelos.nombre, q),
      sql`exists (select 1 from variantes v left join colores c on c.id = v.color_id where v.modelo_id = ${modelos.id} and (v.sku like ${q} or v.codigo_barras like ${q} or c.nombre like ${q}))`,
    ));
  }
  const filas = db
    .select({
      id: modelos.id, nombre: modelos.nombre, activo: modelos.activo, genero: modelos.genero, esDemo: modelos.esDemo,
      categoriaId: modelos.categoriaId, categoria: categorias.nombre, subcategoriaId: modelos.subcategoriaId,
      proveedor: proveedores.nombre,
      variantes: sql<number>`(select count(*) from variantes v where v.modelo_id = ${modelos.id} and v.activo = 1)`,
      costoMin: sql<number | null>`(select min(v.costo_centavos) from variantes v where v.modelo_id = ${modelos.id} and v.activo = 1)`,
      costoMax: sql<number | null>`(select max(v.costo_centavos) from variantes v where v.modelo_id = ${modelos.id} and v.activo = 1)`,
      sinCosto: sql<number>`(select count(*) from variantes v where v.modelo_id = ${modelos.id} and v.activo = 1 and v.costo_centavos is null)`,
      stock: sql<number>`(select coalesce(sum(ms.cantidad), 0) from movimientos_stock ms join variantes v on v.id = ms.variante_id where v.modelo_id = ${modelos.id} and v.activo = 1)`,
    })
    .from(modelos)
    .innerJoin(categorias, eq(categorias.id, modelos.categoriaId))
    .leftJoin(proveedores, eq(proveedores.id, modelos.proveedorId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(categorias.orden), asc(categorias.nombre), asc(modelos.nombre))
    .all();
  // Rango de precios por lista
  const ids = filas.map((m) => m.id);
  const rangos = ids.length
    ? db.select({
        modeloId: variantes.modeloId, listaId: precios.listaId,
        min: sql<number>`min(${precios.precioCentavos})`, max: sql<number>`max(${precios.precioCentavos})`,
      }).from(precios).innerJoin(variantes, eq(variantes.id, precios.varianteId))
        .where(and(inArray(variantes.modeloId, ids), eq(variantes.activo, true)))
        .groupBy(variantes.modeloId, precios.listaId).all()
    : [];
  return filas.map((m) => ({
    ...m,
    precios: rangos.filter((r) => r.modeloId === m.id).map(({ listaId, min, max }) => ({ listaId, min, max })),
  }));
}

export function obtenerModelo(db: DB, id: number) {
  const m = db.select().from(modelos).where(eq(modelos.id, id)).get();
  if (!m) throw noEncontrado('El modelo');
  const vs = db
    .select({ v: variantes, color: colores.nombre, talle: talles.nombre, ordenTalle: talles.orden })
    .from(variantes)
    .leftJoin(colores, eq(colores.id, variantes.colorId))
    .leftJoin(talles, eq(talles.id, variantes.talleId))
    .where(eq(variantes.modeloId, id))
    .all()
    .sort((a, b) => (a.color ?? '').localeCompare(b.color ?? '') || (a.ordenTalle ?? 0) - (b.ordenTalle ?? 0));
  const vIds = vs.map((x) => x.v.id);
  const ps = vIds.length ? db.select().from(precios).where(inArray(precios.varianteId, vIds)).all() : [];
  const stock = stockDe(db, vIds);
  const hc = vIds.length ? db.select().from(historialCostos).where(inArray(historialCostos.varianteId, vIds)).orderBy(sql`${historialCostos.fecha} desc`).limit(200).all() : [];
  const hp = vIds.length ? db.select().from(historialPrecios).where(inArray(historialPrecios.varianteId, vIds)).orderBy(sql`${historialPrecios.fecha} desc`).limit(200).all() : [];
  return {
    ...m,
    variantes: vs.map((x) => ({
      ...x.v, color: x.color, talle: x.talle, stock: stock.get(x.v.id) ?? 0,
      precios: Object.fromEntries(ps.filter((p) => p.varianteId === x.v.id).map((p) => [p.listaId, p.precioCentavos])),
    })),
    historialCostos: hc,
    historialPrecios: hp,
  };
}

// ───────────── Altas y modificaciones ─────────────

export interface DatosModelo {
  nombre: string;
  descripcion?: string | null;
  categoriaId: number;
  subcategoriaId?: number | null;
  genero?: 'Hombre' | 'Mujer' | 'Unisex' | null;
  marca?: string | null;
  unidadId?: number | null;
  proveedorId?: number | null;
  impuestoBp?: number | null;
  notas?: string | null;
}

export interface DatosVariante {
  sku: string;
  codigoBarras?: string | null;
  colorId?: number | null;
  talleId?: number | null;
  costoCentavos?: number | null;
  costoLogisticoCentavos?: number;
  costoAdicionalCentavos?: number;
  stockMinimo?: number | null;
  stockMaximo?: number | null;
  notas?: string | null;
  /** precios por lista: { [listaId]: centavos } */
  precios?: Record<number, number | null>;
}

function validarModelo(db: DB, d: DatosModelo, excluirId?: number) {
  if (!d.nombre?.trim()) throw new ErrorNegocio('El modelo necesita un nombre');
  const cat = db.select().from(categorias).where(eq(categorias.id, d.categoriaId)).get();
  if (!cat || cat.padreId !== null) throw new ErrorNegocio('Elegí una categoría válida');
  if (d.subcategoriaId) {
    const sub = db.select().from(categorias).where(eq(categorias.id, d.subcategoriaId)).get();
    if (!sub || sub.padreId !== d.categoriaId) throw new ErrorNegocio('La subcategoría no corresponde a la categoría');
  }
  const clave = normalizarClave(d.nombre);
  const mismo = db.select().from(modelos).where(eq(modelos.categoriaId, d.categoriaId)).all()
    .find((m) => normalizarClave(m.nombre) === clave && m.id !== excluirId);
  if (mismo) throw new ErrorNegocio(`Ya existe el modelo "${mismo.nombre}" en esa categoría`, 409);
}

function validarSku(db: DB, sku: string, excluirVarianteId?: number) {
  const s = normalizarSku(sku);
  if (!s) throw new ErrorNegocio('Cada variante necesita un código (SKU)');
  const e = db.select().from(variantes).where(sql`lower(${variantes.sku}) = lower(${s})`).get();
  if (e && e.id !== excluirVarianteId) throw new ErrorNegocio(`El código ${s} ya está usado`, 409);
  return s;
}

function validarImporte(c: number | null | undefined, que: string) {
  if (c === null || c === undefined) return;
  if (!Number.isInteger(c) || c < 0) throw new ErrorNegocio(`${que}: importe inválido`);
}

export function crearModelo(ctx: Ctx, d: DatosModelo, vs: DatosVariante[] = []) {
  validarModelo(ctx.db, d);
  const t = ahora();
  const m = ctx.db.insert(modelos).values({
    nombre: prolijo(d.nombre), descripcion: d.descripcion ?? null, categoriaId: d.categoriaId, subcategoriaId: d.subcategoriaId ?? null,
    genero: d.genero ?? null, marca: d.marca ?? null, unidadId: d.unidadId ?? null, proveedorId: d.proveedorId ?? null,
    impuestoBp: d.impuestoBp ?? null, notas: d.notas ?? null, creadoEn: t, actualizadoEn: t,
  }).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: 'modelo', entidadId: m.id, despues: m });
  for (const v of vs) crearVariante(ctx, m.id, v, 'alta');
  return m;
}

export function actualizarModelo(ctx: Ctx, id: number, d: DatosModelo) {
  const antes = ctx.db.select().from(modelos).where(eq(modelos.id, id)).get();
  if (!antes) throw noEncontrado('El modelo');
  validarModelo(ctx.db, d, id);
  const despues = ctx.db.update(modelos).set({
    nombre: prolijo(d.nombre), descripcion: d.descripcion ?? null, categoriaId: d.categoriaId, subcategoriaId: d.subcategoriaId ?? null,
    genero: d.genero ?? null, marca: d.marca ?? null, unidadId: d.unidadId ?? null, proveedorId: d.proveedorId ?? null,
    impuestoBp: d.impuestoBp ?? null, notas: d.notas ?? null, actualizadoEn: ahora(),
  }).where(eq(modelos.id, id)).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'modelo', entidadId: id, antes, despues });
  return despues;
}

/** Baja o reactivación lógica. La baja de un modelo da de baja sus variantes; el historial se conserva. */
export function cambiarEstadoModelo(ctx: Ctx, id: number, activo: boolean, motivo?: string) {
  const antes = ctx.db.select().from(modelos).where(eq(modelos.id, id)).get();
  if (!antes) throw noEncontrado('El modelo');
  ctx.db.update(modelos).set({ activo, actualizadoEn: ahora() }).where(eq(modelos.id, id)).run();
  if (!activo) ctx.db.update(variantes).set({ activo: false, actualizadoEn: ahora() }).where(eq(variantes.modeloId, id)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: activo ? 'alta' : 'baja', entidad: 'modelo', entidadId: id, antes: { activo: antes.activo }, despues: { activo }, detalle: motivo });
}

export function crearVariante(ctx: Ctx, modeloId: number, d: DatosVariante, origen = 'alta') {
  const m = ctx.db.select().from(modelos).where(eq(modelos.id, modeloId)).get();
  if (!m) throw noEncontrado('El modelo');
  const sku = validarSku(ctx.db, d.sku);
  validarImporte(d.costoCentavos, 'Costo');
  if (d.codigoBarras) validarCodigoBarras(ctx.db, d.codigoBarras);
  const t = ahora();
  const v = ctx.db.insert(variantes).values({
    modeloId, sku, codigoBarras: d.codigoBarras?.trim() || null, colorId: d.colorId ?? null, talleId: d.talleId ?? null,
    costoCentavos: d.costoCentavos ?? null, costoLogisticoCentavos: d.costoLogisticoCentavos ?? 0, costoAdicionalCentavos: d.costoAdicionalCentavos ?? 0,
    stockMinimo: d.stockMinimo ?? null, stockMaximo: d.stockMaximo ?? null, notas: d.notas ?? null, creadoEn: t, actualizadoEn: t,
  }).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: 'variante', entidadId: v.id, despues: v });
  if (v.costoCentavos !== null) {
    ctx.db.insert(historialCostos).values({ varianteId: v.id, anteriorCentavos: null, nuevoCentavos: v.costoCentavos, fecha: t, usuarioId: ctx.usuarioId, origen }).run();
  }
  for (const [listaId, precio] of Object.entries(d.precios ?? {})) {
    if (precio !== null && precio !== undefined) fijarPrecio(ctx, Number(listaId), v.id, precio, origen);
  }
  return v;
}

function validarCodigoBarras(db: DB, cb: string, excluir?: number) {
  const e = db.select().from(variantes).where(eq(variantes.codigoBarras, cb.trim())).get();
  if (e && e.id !== excluir) throw new ErrorNegocio(`El código de barras ${cb} ya está usado por ${e.sku}`, 409);
}

export function actualizarVariante(ctx: Ctx, id: number, d: Partial<DatosVariante>, origen = 'edicion', motivo?: string) {
  const antes = ctx.db.select().from(variantes).where(eq(variantes.id, id)).get();
  if (!antes) throw noEncontrado('La variante');
  const sku = d.sku !== undefined ? validarSku(ctx.db, d.sku, id) : antes.sku;
  validarImporte(d.costoCentavos, 'Costo');
  if (d.codigoBarras) validarCodigoBarras(ctx.db, d.codigoBarras, id);
  const t = ahora();
  const despues = ctx.db.update(variantes).set({
    sku,
    codigoBarras: d.codigoBarras !== undefined ? d.codigoBarras?.trim() || null : antes.codigoBarras,
    colorId: d.colorId !== undefined ? d.colorId : antes.colorId,
    talleId: d.talleId !== undefined ? d.talleId : antes.talleId,
    costoCentavos: d.costoCentavos !== undefined ? d.costoCentavos : antes.costoCentavos,
    costoLogisticoCentavos: d.costoLogisticoCentavos ?? antes.costoLogisticoCentavos,
    costoAdicionalCentavos: d.costoAdicionalCentavos ?? antes.costoAdicionalCentavos,
    stockMinimo: d.stockMinimo !== undefined ? d.stockMinimo : antes.stockMinimo,
    stockMaximo: d.stockMaximo !== undefined ? d.stockMaximo : antes.stockMaximo,
    notas: d.notas !== undefined ? d.notas : antes.notas,
    actualizadoEn: t,
  }).where(eq(variantes.id, id)).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'variante', entidadId: id, antes, despues, detalle: motivo });
  if (despues.costoCentavos !== antes.costoCentavos) {
    ctx.db.insert(historialCostos).values({ varianteId: id, anteriorCentavos: antes.costoCentavos, nuevoCentavos: despues.costoCentavos, fecha: t, usuarioId: ctx.usuarioId, origen, motivo: motivo ?? null }).run();
  }
  for (const [listaId, precio] of Object.entries(d.precios ?? {})) {
    if (precio !== null && precio !== undefined) fijarPrecio(ctx, Number(listaId), id, precio, origen, motivo);
  }
  return despues;
}

export function cambiarEstadoVariante(ctx: Ctx, id: number, activo: boolean, motivo?: string) {
  const antes = ctx.db.select().from(variantes).where(eq(variantes.id, id)).get();
  if (!antes) throw noEncontrado('La variante');
  if (activo) {
    const m = ctx.db.select().from(modelos).where(eq(modelos.id, antes.modeloId)).get();
    if (m && !m.activo) throw new ErrorNegocio('Primero reactivá el modelo');
  }
  ctx.db.update(variantes).set({ activo, actualizadoEn: ahora() }).where(eq(variantes.id, id)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: activo ? 'alta' : 'baja', entidad: 'variante', entidadId: id, antes: { activo: antes.activo }, despues: { activo }, detalle: motivo });
}

/** Fija el precio de una variante en una lista, guardando historial. No hace nada si no cambia. */
export function fijarPrecio(ctx: Ctx, listaId: number, varianteId: number, precioCentavos: number, origen: string, motivo?: string) {
  validarImporte(precioCentavos, 'Precio');
  const lista = ctx.db.select().from(listasPrecio).where(eq(listasPrecio.id, listaId)).get();
  if (!lista) throw noEncontrado('La lista de precios');
  const actual = ctx.db.select().from(precios).where(and(eq(precios.listaId, listaId), eq(precios.varianteId, varianteId))).get();
  if (actual?.precioCentavos === precioCentavos) return false;
  const t = ahora();
  ctx.db.insert(precios).values({ listaId, varianteId, precioCentavos, actualizadoEn: t })
    .onConflictDoUpdate({ target: [precios.listaId, precios.varianteId], set: { precioCentavos, actualizadoEn: t } }).run();
  ctx.db.insert(historialPrecios).values({ listaId, varianteId, anteriorCentavos: actual?.precioCentavos ?? null, nuevoCentavos: precioCentavos, fecha: t, usuarioId: ctx.usuarioId, origen, motivo: motivo ?? null }).run();
  return true;
}

/** Duplica un modelo con sus variantes. Los SKU nuevos se arman reemplazando un prefijo o agregando un sufijo. */
export function duplicarModelo(ctx: Ctx, id: number, opciones: { nombre: string; skuDe?: string; skuA?: string; sufijo?: string }) {
  const original = obtenerModelo(ctx.db, id);
  const nuevo = crearModelo(ctx, {
    nombre: opciones.nombre, descripcion: original.descripcion, categoriaId: original.categoriaId, subcategoriaId: original.subcategoriaId,
    genero: original.genero, marca: original.marca, unidadId: original.unidadId, proveedorId: original.proveedorId,
    impuestoBp: original.impuestoBp, notas: original.notas,
  });
  for (const v of original.variantes.filter((x) => x.activo)) {
    let sku = v.sku;
    if (opciones.skuDe && opciones.skuA !== undefined && sku.toLowerCase().startsWith(opciones.skuDe.toLowerCase())) {
      sku = opciones.skuA + sku.slice(opciones.skuDe.length);
    } else {
      sku = sku + (opciones.sufijo ?? '-COPIA');
    }
    crearVariante(ctx, nuevo.id, {
      sku, colorId: v.colorId, talleId: v.talleId, costoCentavos: v.costoCentavos, costoLogisticoCentavos: v.costoLogisticoCentavos,
      costoAdicionalCentavos: v.costoAdicionalCentavos, stockMinimo: v.stockMinimo, stockMaximo: v.stockMaximo, precios: v.precios,
    }, `duplicado de ${original.nombre}`);
  }
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'duplicar', entidad: 'modelo', entidadId: nuevo.id, detalle: `Copia del modelo #${id} ${original.nombre}` });
  return nuevo;
}

// ───────────── Precios masivos ─────────────

export interface CambioMasivo {
  listaId: number;
  /** Alcance: si no se indica nada, aplica a todas las variantes activas. */
  modeloIds?: number[];
  categoriaId?: number;
  tipo: 'porcentaje' | 'fijo' | 'desde_lista';
  /** porcentaje: bp (+1000 = +10%). fijo: centavos. desde_lista: bp de ajuste sobre la lista base. */
  valor: number;
  listaBaseId?: number;
  redondeoCentavos?: number;
  motivo?: string;
}

/** Calcula el cambio masivo SIN aplicarlo: devuelve cada variante con precio actual y nuevo. */
export function previsualizarCambioMasivo(db: DB, c: CambioMasivo) {
  const conds = [eq(variantes.activo, true)];
  if (c.modeloIds?.length) conds.push(inArray(variantes.modeloId, c.modeloIds));
  if (c.categoriaId) conds.push(eq(modelos.categoriaId, c.categoriaId));
  const filas = db.select({ varianteId: variantes.id, sku: variantes.sku, modelo: modelos.nombre, costo: variantes.costoCentavos })
    .from(variantes).innerJoin(modelos, eq(modelos.id, variantes.modeloId)).where(and(...conds)).all();
  const ids = filas.map((f) => f.varianteId);
  const actuales = new Map(
    (ids.length ? db.select().from(precios).where(and(eq(precios.listaId, c.listaId), inArray(precios.varianteId, ids))).all() : [])
      .map((p) => [p.varianteId, p.precioCentavos]),
  );
  const base = c.tipo === 'desde_lista' && c.listaBaseId
    ? new Map((ids.length ? db.select().from(precios).where(and(eq(precios.listaId, c.listaBaseId), inArray(precios.varianteId, ids))).all() : []).map((p) => [p.varianteId, p.precioCentavos]))
    : null;
  return filas.map((f) => {
    const actual = actuales.get(f.varianteId) ?? null;
    let nuevo: number | null = null;
    if (c.tipo === 'fijo') nuevo = c.valor;
    else if (c.tipo === 'porcentaje') nuevo = actual === null ? null : aplicarAjuste(actual, c.valor);
    else if (base) { const b = base.get(f.varianteId); nuevo = b === undefined ? null : aplicarAjuste(b, c.valor); }
    if (nuevo !== null && c.redondeoCentavos) nuevo = redondearPrecio(nuevo, c.redondeoCentavos);
    return { ...f, actual, nuevo, bajoCosto: nuevo !== null && f.costo !== null && nuevo <= f.costo };
  });
}

/** Aplica el cambio masivo. Requiere permiso de aprobación (lo controla la ruta). */
export function aplicarCambioMasivo(ctx: Ctx, c: CambioMasivo) {
  const filas = previsualizarCambioMasivo(ctx.db, c);
  let cambiados = 0;
  for (const f of filas) {
    if (f.nuevo !== null && f.nuevo !== f.actual && fijarPrecio(ctx, c.listaId, f.varianteId, f.nuevo, 'cambio_masivo', c.motivo)) cambiados++;
  }
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'cambio_masivo_precios', entidad: 'lista_precio', entidadId: c.listaId, despues: { ...c, cambiados } });
  return { cambiados, total: filas.length };
}

export function listarAuxiliares(db: DB) {
  return {
    categorias: db.select().from(categorias).orderBy(asc(categorias.orden), asc(categorias.nombre)).all(),
    colores: db.select().from(colores).orderBy(asc(colores.nombre)).all(),
    talles: db.select().from(talles).orderBy(asc(talles.orden), asc(talles.nombre)).all(),
    unidades: db.select().from(unidades).all(),
    proveedores: db.select({ id: proveedores.id, nombre: proveedores.nombre, activo: proveedores.activo, estado: proveedores.estado }).from(proveedores).orderBy(asc(proveedores.nombre)).all(),
    listasPrecio: db.select().from(listasPrecio).orderBy(asc(listasPrecio.orden)).all(),
  };
}
