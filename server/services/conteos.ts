/**
 * Conteo físico: se cargan las cantidades contadas (puede ser de a poco, desde el celular) y al aplicarlo
 * se genera un movimiento de tipo 'conteo' por cada diferencia con el sistema. Solo se ajustan los
 * productos contados; los que no se contaron no se tocan.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { categorias, colores, conteoItems, conteos, modelos, talles, variantes } from '../db/schema.js';
import type { DB } from '../db/index.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { siguienteNumero } from './numeracion.js';
import { registrarMovimiento, stockDe, type Ctx } from './stock.js';

export function crearConteo(ctx: Ctx, d: { categoriaId?: number | null; notas?: string | null }) {
  const t = ahora();
  const c = ctx.db.insert(conteos).values({ numero: siguienteNumero(ctx.db, 'conteo'), fecha: t, categoriaId: d.categoriaId ?? null, notas: d.notas ?? null, usuarioId: ctx.usuarioId, creadoEn: t, actualizadoEn: t }).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: 'conteo', entidadId: c.id, despues: c });
  return c;
}

function abierto(db: DB, id: number) {
  const c = db.select().from(conteos).where(eq(conteos.id, id)).get();
  if (!c) throw noEncontrado('El conteo');
  if (c.estado !== 'abierto') throw new ErrorNegocio(`El conteo ya está ${c.estado}`);
  return c;
}

/** Carga o corrige cantidades contadas. contado = null quita la línea. */
export function cargarConteo(ctx: Ctx, id: number, items: { varianteId: number; contado: number | null }[]) {
  const c = abierto(ctx.db, id);
  const t = ahora();
  for (const it of items) {
    const v = ctx.db.select({ id: variantes.id, modeloId: variantes.modeloId }).from(variantes).where(eq(variantes.id, it.varianteId)).get();
    if (!v) throw noEncontrado('La variante');
    if (c.categoriaId) {
      const m = ctx.db.select({ cat: modelos.categoriaId }).from(modelos).where(eq(modelos.id, v.modeloId)).get();
      if (m?.cat !== c.categoriaId) throw new ErrorNegocio('Ese producto no es de la categoría de este conteo');
    }
    if (it.contado === null) { ctx.db.delete(conteoItems).where(and(eq(conteoItems.conteoId, id), eq(conteoItems.varianteId, it.varianteId))).run(); continue; }
    if (!Number.isInteger(it.contado) || it.contado < 0) throw new ErrorNegocio('La cantidad contada tiene que ser un entero mayor o igual a cero');
    ctx.db.insert(conteoItems).values({ conteoId: id, varianteId: it.varianteId, contado: it.contado, actualizadoEn: t })
      .onConflictDoUpdate({ target: [conteoItems.conteoId, conteoItems.varianteId], set: { contado: it.contado, actualizadoEn: t } }).run();
  }
  ctx.db.update(conteos).set({ actualizadoEn: t }).where(eq(conteos.id, id)).run();
}

export function obtenerConteo(db: DB, id: number) {
  const c = db.select().from(conteos).where(eq(conteos.id, id)).get();
  if (!c) throw noEncontrado('El conteo');
  const cat = c.categoriaId ? db.select({ n: categorias.nombre }).from(categorias).where(eq(categorias.id, c.categoriaId)).get()?.n : null;
  const filas = db.select({ i: conteoItems, sku: variantes.sku, modelo: modelos.nombre, color: colores.nombre, talle: talles.nombre })
    .from(conteoItems).innerJoin(variantes, eq(variantes.id, conteoItems.varianteId)).innerJoin(modelos, eq(modelos.id, variantes.modeloId))
    .leftJoin(colores, eq(colores.id, variantes.colorId)).leftJoin(talles, eq(talles.id, variantes.talleId))
    .where(eq(conteoItems.conteoId, id)).orderBy(desc(conteoItems.actualizadoEn)).all();
  const stock = c.estado === 'abierto' ? stockDe(db, filas.map((f) => f.i.varianteId)) : null;
  const items = filas.map((f) => {
    const sistema = stock ? (stock.get(f.i.varianteId) ?? 0) : (f.i.esperado ?? 0);
    return { ...f.i, sku: f.sku, modelo: f.modelo, color: f.color, talle: f.talle, sistema, diferencia: f.i.contado - sistema };
  });
  // Variantes del alcance que tienen stock y todavía no se contaron (solo informativo).
  let sinContar: { varianteId: number; sku: string; modelo: string; stock: number }[] = [];
  if (c.estado === 'abierto') {
    const contadas = new Set(items.map((i) => i.varianteId));
    const vs = db.select({ id: variantes.id, sku: variantes.sku, modelo: modelos.nombre }).from(variantes).innerJoin(modelos, eq(modelos.id, variantes.modeloId))
      .where(and(eq(variantes.activo, true), c.categoriaId ? eq(modelos.categoriaId, c.categoriaId) : undefined)).all();
    const st = stockDe(db);
    sinContar = vs.filter((v) => !contadas.has(v.id) && (st.get(v.id) ?? 0) !== 0).map((v) => ({ varianteId: v.id, sku: v.sku, modelo: v.modelo, stock: st.get(v.id) ?? 0 }));
  }
  return { ...c, categoria: cat ?? null, items, sinContar };
}

export function aplicarConteo(ctx: Ctx, id: number) {
  const c = abierto(ctx.db, id);
  const items = ctx.db.select().from(conteoItems).where(eq(conteoItems.conteoId, id)).all();
  if (!items.length) throw new ErrorNegocio('El conteo no tiene nada cargado');
  const stock = stockDe(ctx.db, items.map((i) => i.varianteId));
  const t = ahora();
  let ajustes = 0, sobrante = 0, faltante = 0;
  for (const it of items) {
    const sistema = stock.get(it.varianteId) ?? 0;
    ctx.db.update(conteoItems).set({ esperado: sistema }).where(eq(conteoItems.id, it.id)).run();
    const dif = it.contado - sistema;
    if (dif === 0) continue;
    // Un conteo fija la cantidad real: puede dejar el stock en cero aunque el sistema dijera otra cosa.
    registrarMovimiento({ ...ctx }, { varianteId: it.varianteId, cantidad: dif, tipo: 'conteo', refTipo: 'conteo', refId: id, motivo: `Conteo C-${c.numero}: había ${sistema}, se contaron ${it.contado}` });
    ajustes++; if (dif > 0) sobrante += dif; else faltante -= dif;
  }
  ctx.db.update(conteos).set({ estado: 'aplicado', aplicadoEn: t, aplicadoPor: ctx.usuarioId, actualizadoEn: t }).where(eq(conteos.id, id)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'aplicar', entidad: 'conteo', entidadId: id, detalle: `${items.length} contados, ${ajustes} con diferencia (+${sobrante} / -${faltante})` });
  return { contados: items.length, ajustes, sobrante, faltante };
}

export function descartarConteo(ctx: Ctx, id: number) {
  abierto(ctx.db, id);
  ctx.db.update(conteos).set({ estado: 'descartado', actualizadoEn: ahora() }).where(eq(conteos.id, id)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'anular', entidad: 'conteo', entidadId: id });
}

export function listarConteos(db: DB) {
  const cs = db.select({ c: conteos, categoria: categorias.nombre }).from(conteos).leftJoin(categorias, eq(categorias.id, conteos.categoriaId)).orderBy(desc(conteos.id)).all();
  const ids = cs.map((x) => x.c.id);
  const items = ids.length ? db.select().from(conteoItems).where(inArray(conteoItems.conteoId, ids)).all() : [];
  return cs.map((x) => ({ ...x.c, categoria: x.categoria, items: items.filter((i) => i.conteoId === x.c.id).length }));
}
