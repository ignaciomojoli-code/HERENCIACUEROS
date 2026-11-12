/**
 * Stock por movimientos. El stock de cada variante es la suma de su libro de movimientos;
 * nada se edita ni se borra: para corregir se agrega un ajuste o el movimiento contrario.
 */
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { categorias, colores, modelos, movimientosStock, talles, variantes } from '../db/schema.js';
import type { DB } from '../db/index.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { leerConfig } from './configuracion.js';

export type Ctx = { db: DB; usuarioId: number | null };
export type TipoMovimiento = (typeof movimientosStock.$inferInsert)['tipo'];

export const NOMBRE_MOVIMIENTO: Record<TipoMovimiento, string> = {
  inicial: 'Stock inicial', compra: 'Recepción de compra', ajuste: 'Ajuste', conteo: 'Conteo físico', venta: 'Venta',
  devolucion: 'Devolución', produccion: 'Producción', anulacion: 'Anulación',
};

export function stockDe(db: DB, varianteIds?: number[]): Map<number, number> {
  const q = db.select({ v: movimientosStock.varianteId, n: sql<number>`sum(${movimientosStock.cantidad})` }).from(movimientosStock);
  const filas = (varianteIds ? (varianteIds.length ? q.where(inArray(movimientosStock.varianteId, varianteIds)) : null) : q)?.groupBy(movimientosStock.varianteId).all() ?? [];
  return new Map(filas.map((f) => [f.v, Number(f.n)]));
}
export const stockDeUna = (db: DB, varianteId: number) => stockDe(db, [varianteId]).get(varianteId) ?? 0;

export interface DatosMovimiento {
  varianteId: number; cantidad: number; tipo: TipoMovimiento; costoUnitarioCentavos?: number | null;
  refTipo?: string; refId?: number; anulaId?: number; motivo?: string | null; fecha?: string;
}

/** Registra un movimiento. Controla que el stock no quede negativo (salvo que la configuración lo permita). */
export function registrarMovimiento(ctx: Ctx, d: DatosMovimiento) {
  if (!Number.isInteger(d.cantidad) || d.cantidad === 0) throw new ErrorNegocio('La cantidad tiene que ser un número entero distinto de cero');
  const v = ctx.db.select({ id: variantes.id, sku: variantes.sku, costo: variantes.costoCentavos }).from(variantes).where(eq(variantes.id, d.varianteId)).get();
  if (!v) throw noEncontrado('La variante');
  if (d.cantidad < 0) {
    const actual = stockDeUna(ctx.db, d.varianteId);
    if (actual + d.cantidad < 0 && !leerConfig(ctx.db, 'inventario').permitirVentaSinStock) {
      throw new ErrorNegocio(`No hay stock suficiente de ${v.sku}: hay ${actual} y se quieren sacar ${-d.cantidad}`, 409);
    }
  }
  const t = ahora();
  return ctx.db.insert(movimientosStock).values({
    fecha: d.fecha ?? t, varianteId: d.varianteId, cantidad: d.cantidad, tipo: d.tipo,
    costoUnitarioCentavos: d.costoUnitarioCentavos !== undefined ? d.costoUnitarioCentavos : v.costo,
    refTipo: d.refTipo ?? null, refId: d.refId ?? null, anulaId: d.anulaId ?? null, motivo: d.motivo ?? null,
    usuarioId: ctx.usuarioId, creadoEn: t,
  }).returning().get();
}

export function ajustarStock(ctx: Ctx, d: { varianteId: number; cantidad: number; motivo: string }) {
  if (!d.motivo?.trim()) throw new ErrorNegocio('Indicá el motivo del ajuste');
  const antes = stockDeUna(ctx.db, d.varianteId);
  const m = registrarMovimiento(ctx, { varianteId: d.varianteId, cantidad: d.cantidad, tipo: 'ajuste', motivo: d.motivo.trim() });
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'ajuste_stock', entidad: 'variante', entidadId: d.varianteId, antes: { stock: antes }, despues: { stock: antes + d.cantidad }, detalle: d.motivo });
  return { movimientoId: m.id, stock: antes + d.cantidad };
}

export type FiltroStock = 'todos' | 'con_stock' | 'sin_stock' | 'bajo_minimo' | 'negativo';

/** Una fila por variante activa, con su stock y valorización. */
export function listarStock(db: DB, f: { q?: string; categoriaId?: number; filtro?: FiltroStock; listaId?: number }) {
  const stock = sql<number>`coalesce((select sum(m.cantidad) from movimientos_stock m where m.variante_id = ${variantes.id}), 0)`;
  const conds = [eq(variantes.activo, true), eq(modelos.activo, true)];
  if (f.categoriaId) conds.push(eq(modelos.categoriaId, f.categoriaId));
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    conds.push(sql`(${variantes.sku} like ${q} or ${modelos.nombre} like ${q} or ${variantes.codigoBarras} like ${q} or ${colores.nombre} like ${q})`);
  }
  if (f.filtro === 'con_stock') conds.push(sql`${stock} > 0`);
  if (f.filtro === 'sin_stock') conds.push(sql`${stock} = 0`);
  if (f.filtro === 'negativo') conds.push(sql`${stock} < 0`);
  if (f.filtro === 'bajo_minimo') conds.push(sql`${variantes.stockMinimo} is not null and ${stock} < ${variantes.stockMinimo}`);
  const listaId = f.listaId ?? 1;
  return db.select({
    varianteId: variantes.id, sku: variantes.sku, modeloId: modelos.id, modelo: modelos.nombre, categoria: categorias.nombre,
    color: colores.nombre, talle: talles.nombre, stock, stockMinimo: variantes.stockMinimo, stockMaximo: variantes.stockMaximo,
    costoCentavos: sql<number | null>`case when ${variantes.costoCentavos} is null then null else ${variantes.costoCentavos} + ${variantes.costoLogisticoCentavos} + ${variantes.costoAdicionalCentavos} end`,
    precioCentavos: sql<number | null>`(select p.precio_centavos from precios p where p.variante_id = ${variantes.id} and p.lista_id = ${listaId})`,
  }).from(variantes)
    .innerJoin(modelos, eq(modelos.id, variantes.modeloId))
    .innerJoin(categorias, eq(categorias.id, modelos.categoriaId))
    .leftJoin(colores, eq(colores.id, variantes.colorId))
    .leftJoin(talles, eq(talles.id, variantes.talleId))
    .where(and(...conds))
    .orderBy(categorias.nombre, modelos.nombre, colores.nombre, talles.orden, variantes.sku)
    .all()
    .map((r) => ({ ...r, stock: Number(r.stock) }));
}

/** Movimientos de una variante con el saldo después de cada uno. */
export function kardex(db: DB, varianteId: number) {
  const v = db.select({ id: variantes.id, sku: variantes.sku, modelo: modelos.nombre, modeloId: modelos.id }).from(variantes).innerJoin(modelos, eq(modelos.id, variantes.modeloId)).where(eq(variantes.id, varianteId)).get();
  if (!v) throw noEncontrado('La variante');
  const movs = db.select().from(movimientosStock).where(eq(movimientosStock.varianteId, varianteId)).orderBy(movimientosStock.fecha, movimientosStock.id).all();
  let saldo = 0;
  const filas = movs.map((m) => ({ ...m, saldo: (saldo += m.cantidad) }));
  return { ...v, stock: saldo, movimientos: filas.reverse() };
}

export function listarMovimientos(db: DB, f: { desde?: string; hasta?: string; tipo?: TipoMovimiento; q?: string; pagina?: number; porPagina?: number }) {
  const conds = [];
  if (f.desde) conds.push(gte(movimientosStock.fecha, f.desde));
  if (f.hasta) conds.push(lte(movimientosStock.fecha, f.hasta + 'T23:59:59.999Z'));
  if (f.tipo) conds.push(eq(movimientosStock.tipo, f.tipo));
  if (f.q?.trim()) { const q = `%${f.q.trim()}%`; conds.push(sql`(${variantes.sku} like ${q} or ${modelos.nombre} like ${q} or ${movimientosStock.motivo} like ${q})`); }
  const where = conds.length ? and(...conds) : undefined;
  const base = () => db.select().from(movimientosStock).innerJoin(variantes, eq(variantes.id, movimientosStock.varianteId)).innerJoin(modelos, eq(modelos.id, variantes.modeloId));
  const total = Number(db.select({ n: sql<number>`count(*)` }).from(movimientosStock).innerJoin(variantes, eq(variantes.id, movimientosStock.varianteId)).innerJoin(modelos, eq(modelos.id, variantes.modeloId)).where(where).get()?.n ?? 0);
  const porPagina = f.porPagina ?? 50;
  const filas = base().where(where).orderBy(desc(movimientosStock.fecha), desc(movimientosStock.id)).limit(porPagina).offset(((f.pagina ?? 1) - 1) * porPagina).all()
    .map((r) => ({ ...r.movimientos_stock, sku: r.variantes.sku, modelo: r.modelos.nombre, modeloId: r.modelos.id }));
  return { total, filas };
}

/** Carga del stock de partida. Solo para variantes que todavía no tienen ningún movimiento. */
export interface FilaStockInicial { fila: number; sku: string; cantidad: number | null; varianteId?: number; modelo?: string; estado: 'ok' | 'cero' | 'no_existe' | 'ya_tiene' | 'invalida' | 'duplicada'; detalle?: string }

export function validarStockInicial(db: DB, filas: { fila: number; sku: string; cantidad: string }[]): FilaStockInicial[] {
  const todas = db.select({ id: variantes.id, sku: variantes.sku, modelo: modelos.nombre }).from(variantes).innerJoin(modelos, eq(modelos.id, variantes.modeloId)).all();
  const porSku = new Map(todas.map((v) => [v.sku.trim().toLowerCase(), v]));
  const conMovs = new Set(db.select({ v: movimientosStock.varianteId }).from(movimientosStock).groupBy(movimientosStock.varianteId).all().map((x) => x.v));
  const vistos = new Set<string>();
  return filas.filter((f) => f.sku.trim()).map((f) => {
    const clave = f.sku.trim().toLowerCase();
    const v = porSku.get(clave);
    const t = f.cantidad.replace(/\s/g, '');
    const n = t === '' || t === '-' ? 0 : Number(t.replace(',', '.'));
    const base = { fila: f.fila, sku: f.sku.trim(), cantidad: Number.isFinite(n) ? n : null, varianteId: v?.id, modelo: v?.modelo };
    if (vistos.has(clave)) return { ...base, estado: 'duplicada' as const, detalle: 'El código aparece más de una vez en el archivo' };
    vistos.add(clave);
    if (!v && n === 0) return { ...base, estado: 'cero' as const, detalle: 'Código sin producto y sin cantidad: se omite' };
    if (!v) return { ...base, estado: 'no_existe' as const, detalle: 'No está en el catálogo: importalo primero' };
    if (!Number.isInteger(n) || n < 0) return { ...base, estado: 'invalida' as const, detalle: `Cantidad inválida: "${f.cantidad}"` };
    if (conMovs.has(v.id)) return { ...base, estado: 'ya_tiene' as const, detalle: 'Ya tiene movimientos de stock: para corregirlo usá un ajuste o un conteo' };
    if (n === 0) return { ...base, estado: 'cero' as const };
    return { ...base, estado: 'ok' as const };
  });
}

export function confirmarStockInicial(ctx: Ctx, filas: FilaStockInicial[], fecha: string, archivo: string) {
  const ok = filas.filter((f) => f.estado === 'ok');
  for (const f of ok) registrarMovimiento(ctx, { varianteId: f.varianteId!, cantidad: f.cantidad!, tipo: 'inicial', fecha, motivo: `Stock inicial (${archivo})` });
  const unidades = ok.reduce((s, f) => s + f.cantidad!, 0);
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'stock_inicial', entidad: 'stock', detalle: `${ok.length} variantes, ${unidades} unidades, fecha ${fecha.slice(0, 10)}, archivo ${archivo}` });
  return { variantes: ok.length, unidades };
}
