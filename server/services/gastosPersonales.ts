/**
 * Gastos personales: se registran aparte de los gastos del local y nunca cuentan como gasto del negocio
 * ni como costo de mercadería. Si se pagaron con plata del local, salen de la caja como RETIRO (igual que
 * un retiro personal); si se pagaron por fuera, quedan solo registrados (sin cuenta).
 */
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { categoriasGasto, cuentas, gastosPersonales, movimientosCaja } from '../db/schema.js';
import type { DB } from '../db/index.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { siguienteNumero } from './numeracion.js';
import type { Ctx } from './stock.js';
import { cuentaOError, hoyLocal, registrarCaja, revertirMovimientos } from './caja.js';
import { validarCategoria } from './gastos.js';

export interface DatosGastoPersonal {
  fecha: string; descripcion: string; categoriaId: number; subcategoriaId?: number | null; importeCentavos: number;
  /** Cuenta del local con la que se pagó. null = se pagó por fuera (no mueve la caja). */
  cuentaId: number | null; notas?: string | null;
}

function validar(db: DB, d: DatosGastoPersonal) {
  if (!d.descripcion?.trim()) throw new ErrorNegocio('Indicá la descripción');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha ?? '')) throw new ErrorNegocio('Fecha inválida');
  if (!Number.isInteger(d.importeCentavos) || d.importeCentavos <= 0) throw new ErrorNegocio('El importe tiene que ser mayor a cero');
  validarCategoria(db, d.categoriaId, d.subcategoriaId, 'personal');
  if (d.cuentaId !== null) {
    const c = cuentaOError(db, d.cuentaId);
    if (c.tipo === 'externa' || c.tipo === 'a_liquidar') throw new ErrorNegocio('Elegí una cuenta del local (efectivo, banco, Mercado Pago) o "Pagado por fuera"');
    if (c.moneda !== 'ARS') throw new ErrorNegocio('Se cargan en pesos. Si pagaste con dólares, hacé primero el cambio (pase de Dólares a Efectivo)');
  }
}

function moverCaja(ctx: Ctx, g: typeof gastosPersonales.$inferSelect) {
  if (g.cuentaId === null) return;
  registrarCaja(ctx, {
    fecha: g.fecha, cuentaId: g.cuentaId, importeCentavos: -g.importeCentavos, tipo: 'retiro',
    concepto: `Gasto personal GP-${g.numero}: ${g.descripcion}`, refTipo: 'gasto_personal', refId: g.id,
  });
}

export function crearGastoPersonal(ctx: Ctx, d: DatosGastoPersonal) {
  validar(ctx.db, d);
  const t = ahora();
  const g = ctx.db.insert(gastosPersonales).values({
    numero: siguienteNumero(ctx.db, 'gasto_personal'), fecha: d.fecha, descripcion: d.descripcion.trim(), categoriaId: d.categoriaId,
    subcategoriaId: d.subcategoriaId ?? null, importeCentavos: d.importeCentavos, cuentaId: d.cuentaId, notas: d.notas?.trim() || null,
    usuarioId: ctx.usuarioId, creadoEn: t, actualizadoEn: t,
  }).returning().get();
  moverCaja(ctx, g);
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: 'gasto_personal', entidadId: g.id, despues: g });
  return g;
}

/**
 * Corrige un gasto personal (con motivo). Si cambia el importe, la fecha o la cuenta, el movimiento de caja
 * anterior se compensa con su contrario y se registra uno nuevo: nada se borra.
 */
export function editarGastoPersonal(ctx: Ctx, id: number, d: DatosGastoPersonal & { motivo?: string }) {
  if (!d.motivo?.trim()) throw new ErrorNegocio('Indicá el motivo de la corrección');
  const antes = ctx.db.select().from(gastosPersonales).where(eq(gastosPersonales.id, id)).get();
  if (!antes) throw noEncontrado('El gasto personal');
  if (antes.estado === 'anulado') throw new ErrorNegocio('El gasto está anulado');
  validar(ctx.db, d);
  const g = ctx.db.update(gastosPersonales).set({
    fecha: d.fecha, descripcion: d.descripcion.trim(), categoriaId: d.categoriaId, subcategoriaId: d.subcategoriaId ?? null,
    importeCentavos: d.importeCentavos, cuentaId: d.cuentaId, notas: d.notas?.trim() || null, actualizadoEn: ahora(),
  }).where(eq(gastosPersonales.id, id)).returning().get();
  const cambiaPlata = antes.importeCentavos !== g.importeCentavos || antes.fecha !== g.fecha || antes.cuentaId !== g.cuentaId;
  if (cambiaPlata) {
    revertirMovimientos(ctx, { refTipo: 'gasto_personal', refId: id }, `corrección GP-${g.numero}: ${d.motivo.trim()}`, hoyLocal());
    moverCaja(ctx, g);
  }
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'gasto_personal', entidadId: id, antes, despues: g, detalle: d.motivo.trim() });
  return g;
}

export function anularGastoPersonal(ctx: Ctx, id: number, motivo: string) {
  if (!motivo?.trim()) throw new ErrorNegocio('Indicá el motivo de la anulación');
  const g = ctx.db.select().from(gastosPersonales).where(eq(gastosPersonales.id, id)).get();
  if (!g) throw noEncontrado('El gasto personal');
  if (g.estado === 'anulado') throw new ErrorNegocio('El gasto ya está anulado');
  revertirMovimientos(ctx, { refTipo: 'gasto_personal', refId: id }, `gasto personal GP-${g.numero} anulado: ${motivo.trim()}`, hoyLocal());
  ctx.db.update(gastosPersonales).set({ estado: 'anulado', motivoAnulacion: motivo.trim(), actualizadoEn: ahora() }).where(eq(gastosPersonales.id, id)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'anular', entidad: 'gasto_personal', entidadId: id, detalle: motivo });
  return { ok: true };
}

export interface FiltroPersonales { desde?: string; hasta?: string; categoriaId?: number; q?: string; estado?: 'activo' | 'anulado' | 'todos' }

export function listarGastosPersonales(db: DB, f: FiltroPersonales) {
  const sub = alias(categoriasGasto, 'sub');
  const conds = [];
  if (f.desde) conds.push(gte(gastosPersonales.fecha, f.desde));
  if (f.hasta) conds.push(lte(gastosPersonales.fecha, f.hasta));
  if (f.categoriaId) conds.push(eq(gastosPersonales.categoriaId, f.categoriaId));
  if (f.q?.trim()) conds.push(sql`(${gastosPersonales.descripcion} like ${'%' + f.q.trim() + '%'} or ${gastosPersonales.notas} like ${'%' + f.q.trim() + '%'})`);
  const est = f.estado ?? 'activo';
  if (est !== 'todos') conds.push(eq(gastosPersonales.estado, est));
  const filas = db.select({ g: gastosPersonales, categoria: categoriasGasto.nombre, subcategoria: sub.nombre, cuenta: cuentas.nombre })
    .from(gastosPersonales).innerJoin(categoriasGasto, eq(categoriasGasto.id, gastosPersonales.categoriaId))
    .leftJoin(sub, eq(sub.id, gastosPersonales.subcategoriaId)).leftJoin(cuentas, eq(cuentas.id, gastosPersonales.cuentaId))
    .where(conds.length ? and(...conds) : undefined).orderBy(desc(gastosPersonales.fecha), desc(gastosPersonales.id)).all()
    .map((r) => ({ ...r.g, categoria: r.categoria, subcategoria: r.subcategoria, cuenta: r.cuenta }));

  // Retiros personales cargados desde Caja (sin detalle de categoría): se muestran para que la consulta esté completa.
  const rc = [eq(movimientosCaja.tipo, 'retiro'), isNull(movimientosCaja.refTipo)];
  if (f.desde) rc.push(gte(movimientosCaja.fecha, f.desde));
  if (f.hasta) rc.push(lte(movimientosCaja.fecha, f.hasta));
  if (f.q?.trim()) rc.push(sql`${movimientosCaja.concepto} like ${'%' + f.q.trim() + '%'}`);
  const retirosTodos = db.select({ m: movimientosCaja, cuenta: cuentas.nombre }).from(movimientosCaja).innerJoin(cuentas, eq(cuentas.id, movimientosCaja.cuentaId))
    .where(and(...rc)).orderBy(desc(movimientosCaja.fecha), desc(movimientosCaja.id)).all();
  const ids = retirosTodos.map((r) => r.m.id);
  const anulados = new Set(ids.length ? db.select({ a: movimientosCaja.anulaId }).from(movimientosCaja).where(inArray(movimientosCaja.anulaId, ids)).all().map((x) => x.a) : []);
  const retiros = f.categoriaId || f.estado === 'anulado' ? [] : retirosTodos.filter((r) => !anulados.has(r.m.id))
    .map((r) => ({ id: r.m.id, fecha: r.m.fecha, concepto: r.m.concepto.replace(/^Retiro personal: /, ''), importeCentavos: -r.m.importeCentavos, cuenta: r.cuenta }));

  const activos = filas.filter((g) => g.estado === 'activo');
  const porCategoria = new Map<string, number>();
  for (const g of activos) porCategoria.set(g.categoria, (porCategoria.get(g.categoria) ?? 0) + g.importeCentavos);
  return {
    filas, retiros,
    totales: {
      gastosCentavos: activos.reduce((s, g) => s + g.importeCentavos, 0),
      conPlataDelLocalCentavos: activos.filter((g) => g.cuentaId !== null).reduce((s, g) => s + g.importeCentavos, 0),
      porFueraCentavos: activos.filter((g) => g.cuentaId === null).reduce((s, g) => s + g.importeCentavos, 0),
      retirosSinDetalleCentavos: retiros.reduce((s, r) => s + r.importeCentavos, 0),
      porCategoria: [...porCategoria.entries()].map(([categoria, importeCentavos]) => ({ categoria, importeCentavos })).sort((a, b) => b.importeCentavos - a.importeCentavos),
    },
  };
}
