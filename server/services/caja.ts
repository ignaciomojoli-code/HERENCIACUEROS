/**
 * Caja: cuentas de plata y su libro de movimientos. El saldo de cada cuenta es la suma de sus movimientos;
 * nada se edita ni se borra. Ventas, gastos y pagos generan sus movimientos desde sus propios servicios;
 * acá están las operaciones de caja propiamente dichas (pases, liquidaciones, aportes, retiros, arqueos).
 */
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { arqueos, cuentas, formasPago, listasPrecio, movimientosCaja } from '../db/schema.js';
import type { DB } from '../db/index.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { leerConfig } from './configuracion.js';
import { siguienteNumero } from './numeracion.js';
import type { Ctx } from './stock.js';

export type TipoCaja = (typeof movimientosCaja.$inferInsert)['tipo'];
export type Cuenta = typeof cuentas.$inferSelect;

export const NOMBRE_TIPO_CAJA: Record<TipoCaja, string> = {
  saldo_inicial: 'Saldo inicial', venta: 'Venta', comision: 'Comisión', gasto: 'Gasto', pago_proveedor: 'Pago a proveedor',
  pase: 'Pase entre cuentas', liquidacion: 'Liquidación de tarjetas', aporte: 'Aporte', retiro: 'Retiro personal', ajuste: 'Ajuste', anulacion: 'Anulación',
};
/** Tipos que se cargan desde la pantalla de caja y se anulan desde ahí. El resto se anula desde su documento (venta, gasto, pago). */
const TIPOS_MANUALES: TipoCaja[] = ['saldo_inicial', 'pase', 'liquidacion', 'aporte', 'retiro', 'ajuste'];

export function cuentaOError(db: DB, id: number, { activa = true } = {}): Cuenta {
  const c = db.select().from(cuentas).where(eq(cuentas.id, id)).get();
  if (!c) throw noEncontrado('La cuenta');
  if (activa && !c.activo) throw new ErrorNegocio(`La cuenta ${c.nombre} está inactiva`);
  return c;
}

/** Pasa un importe en la moneda de la cuenta a pesos, con la cotización cargada en Configuración. */
export function aPesosDeCuenta(db: DB, cuenta: Cuenta, importe: number): number {
  if (cuenta.moneda === 'ARS') return importe;
  const cot = leerConfig(db, 'cotizaciones').usdCentavos;
  if (!cot) throw new ErrorNegocio('Para mover dólares cargá primero la cotización del dólar en Configuración');
  return Math.round((importe * cot) / 100);
}

export interface DatosMovCaja {
  fecha: string; cuentaId: number; importeCentavos: number; tipo: TipoCaja; concepto: string;
  importeArsCentavos?: number; refTipo?: string; refId?: number; grupo?: string; anulaId?: number;
}

export function registrarCaja(ctx: Ctx, d: DatosMovCaja) {
  if (!Number.isInteger(d.importeCentavos) || d.importeCentavos === 0) throw new ErrorNegocio('El importe tiene que ser distinto de cero');
  const c = cuentaOError(ctx.db, d.cuentaId, { activa: d.tipo !== 'anulacion' });
  const ars = d.importeArsCentavos ?? aPesosDeCuenta(ctx.db, c, d.importeCentavos);
  return ctx.db.insert(movimientosCaja).values({
    fecha: d.fecha, cuentaId: d.cuentaId, importeCentavos: d.importeCentavos, importeArsCentavos: ars, tipo: d.tipo, concepto: d.concepto.trim(),
    refTipo: d.refTipo ?? null, refId: d.refId ?? null, grupo: d.grupo ?? null, anulaId: d.anulaId ?? null, usuarioId: ctx.usuarioId, creadoEn: ahora(),
  }).returning().get();
}

/**
 * Salida de plata (gasto, pago a proveedor, retiro). Si la cuenta es "externa" (la paga alguien de afuera,
 * ej. el inversor), primero entra el aporte y después sale el pago: queda registrado cuánto puso y el saldo no cambia.
 */
export function registrarSalida(ctx: Ctx, d: DatosMovCaja & { aportante?: string }) {
  const c = cuentaOError(ctx.db, d.cuentaId);
  if (c.tipo === 'externa') {
    registrarCaja(ctx, { fecha: d.fecha, cuentaId: c.id, importeCentavos: Math.abs(d.importeCentavos), tipo: 'aporte', concepto: `Aporte de ${c.nombre}: ${d.concepto}`, refTipo: d.refTipo, refId: d.refId, grupo: d.grupo });
  }
  return registrarCaja(ctx, { ...d, importeCentavos: -Math.abs(d.importeCentavos), importeArsCentavos: d.importeArsCentavos === undefined ? undefined : -Math.abs(d.importeArsCentavos) });
}

/** Agrega el movimiento contrario de cada movimiento de un documento (venta, gasto, pago) o de un grupo. */
export function revertirMovimientos(ctx: Ctx, filtro: { refTipo: string; refId: number } | { grupo: string }, motivo: string, fecha?: string) {
  const where = 'grupo' in filtro ? eq(movimientosCaja.grupo, filtro.grupo) : and(eq(movimientosCaja.refTipo, filtro.refTipo), eq(movimientosCaja.refId, filtro.refId));
  const movs = ctx.db.select().from(movimientosCaja).where(where).all();
  const yaAnulados = new Set(movs.filter((m) => m.anulaId).map((m) => m.anulaId));
  const t = fecha ?? hoyLocal();
  for (const m of movs.filter((m) => m.tipo !== 'anulacion' && !yaAnulados.has(m.id))) {
    registrarCaja(ctx, {
      fecha: t, cuentaId: m.cuentaId, importeCentavos: -m.importeCentavos, importeArsCentavos: -m.importeArsCentavos, tipo: 'anulacion',
      concepto: `Anula: ${m.concepto} (${motivo})`, refTipo: m.refTipo ?? undefined, refId: m.refId ?? undefined, grupo: m.grupo ?? undefined, anulaId: m.id,
    });
  }
}

/** Fecha de hoy en Buenos Aires, AAAA-MM-DD. */
export function hoyLocal(): string {
  return new Date(ahora()).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}

// ───────────── Cuentas y formas de pago ─────────────

export function listarCuentas(db: DB) {
  const saldos = db.select({ c: movimientosCaja.cuentaId, s: sql<number>`sum(${movimientosCaja.importeCentavos})`, ars: sql<number>`sum(${movimientosCaja.importeArsCentavos})`, n: sql<number>`count(*)` })
    .from(movimientosCaja).groupBy(movimientosCaja.cuentaId).all();
  return db.select().from(cuentas).orderBy(asc(cuentas.orden), asc(cuentas.id)).all().map((c) => {
    const s = saldos.find((x) => x.c === c.id);
    return { ...c, saldoCentavos: Number(s?.s ?? 0), saldoArsCentavos: Number(s?.ars ?? 0), movimientos: Number(s?.n ?? 0) };
  });
}

export function saldoDe(db: DB, cuentaId: number, hasta?: string) {
  const r = db.select({ s: sql<number>`coalesce(sum(${movimientosCaja.importeCentavos}), 0)` }).from(movimientosCaja)
    .where(and(eq(movimientosCaja.cuentaId, cuentaId), hasta ? lte(movimientosCaja.fecha, hasta) : undefined)).get();
  return Number(r?.s ?? 0);
}

export interface DatosCuenta { nombre: string; tipo: Cuenta['tipo']; moneda: 'ARS' | 'USD'; orden?: number; activo?: boolean }

export function guardarCuenta(ctx: Ctx, id: number | null, d: DatosCuenta) {
  if (!d.nombre.trim()) throw new ErrorNegocio('Poné un nombre a la cuenta');
  if (d.tipo === 'externa' && d.moneda !== 'ARS') throw new ErrorNegocio('Una cuenta externa va en pesos');
  const t = ahora();
  const repetida = ctx.db.select().from(cuentas).where(sql`lower(${cuentas.nombre}) = lower(${d.nombre.trim()})`).get();
  if (repetida && repetida.id !== id) throw new ErrorNegocio('Ya hay una cuenta con ese nombre');
  if (id === null) {
    const c = ctx.db.insert(cuentas).values({ nombre: d.nombre.trim(), tipo: d.tipo, moneda: d.moneda, orden: d.orden ?? 0, activo: d.activo ?? true, creadoEn: t, actualizadoEn: t }).returning().get();
    auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: 'cuenta', entidadId: c.id, despues: c });
    return c;
  }
  const antes = cuentaOError(ctx.db, id, { activa: false });
  const tieneMovs = saldoDe(ctx.db, id) !== 0 || ctx.db.select({ id: movimientosCaja.id }).from(movimientosCaja).where(eq(movimientosCaja.cuentaId, id)).limit(1).get();
  if (tieneMovs && (antes.moneda !== d.moneda || antes.tipo !== d.tipo)) throw new ErrorNegocio('La cuenta ya tiene movimientos: no se le puede cambiar el tipo ni la moneda');
  if (antes.activo && d.activo === false && saldoDe(ctx.db, id) !== 0) throw new ErrorNegocio('Para desactivar la cuenta, primero pasá el saldo a otra');
  const c = ctx.db.update(cuentas).set({ nombre: d.nombre.trim(), tipo: d.tipo, moneda: d.moneda, orden: d.orden ?? antes.orden, activo: d.activo ?? antes.activo, actualizadoEn: t }).where(eq(cuentas.id, id)).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'cuenta', entidadId: id, antes, despues: c });
  return c;
}

export function listarFormasPago(db: DB) {
  return db.select({ f: formasPago, cuenta: cuentas.nombre, tipoCuenta: cuentas.tipo, moneda: cuentas.moneda, lista: listasPrecio.nombre })
    .from(formasPago).innerJoin(cuentas, eq(cuentas.id, formasPago.cuentaId)).leftJoin(listasPrecio, eq(listasPrecio.id, formasPago.listaPrecioId))
    .orderBy(asc(formasPago.orden), asc(formasPago.id)).all()
    .map((r) => ({ ...r.f, cuenta: r.cuenta, tipoCuenta: r.tipoCuenta, moneda: r.moneda, lista: r.lista }));
}

export interface DatosForma { nombre: string; cuentaId: number; listaPrecioId: number | null; comisionBp: number; orden?: number; activo?: boolean }

export function guardarFormaPago(ctx: Ctx, id: number | null, d: DatosForma) {
  if (!d.nombre.trim()) throw new ErrorNegocio('Poné un nombre a la forma de pago');
  if (!Number.isInteger(d.comisionBp) || d.comisionBp < 0 || d.comisionBp >= 10000) throw new ErrorNegocio('Comisión inválida');
  const cta = cuentaOError(ctx.db, d.cuentaId);
  if (cta.tipo === 'externa') throw new ErrorNegocio('Una venta no puede cobrarse en una cuenta externa');
  const t = ahora();
  const repetida = ctx.db.select().from(formasPago).where(sql`lower(${formasPago.nombre}) = lower(${d.nombre.trim()})`).get();
  if (repetida && repetida.id !== id) throw new ErrorNegocio('Ya hay una forma de pago con ese nombre');
  const valores = { nombre: d.nombre.trim(), cuentaId: d.cuentaId, listaPrecioId: d.listaPrecioId, comisionBp: d.comisionBp, orden: d.orden ?? 0, activo: d.activo ?? true, actualizadoEn: t };
  if (id === null) {
    const f = ctx.db.insert(formasPago).values({ ...valores, creadoEn: t }).returning().get();
    auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: 'forma_pago', entidadId: f.id, despues: f });
    return f;
  }
  const antes = ctx.db.select().from(formasPago).where(eq(formasPago.id, id)).get();
  if (!antes) throw noEncontrado('La forma de pago');
  const f = ctx.db.update(formasPago).set(valores).where(eq(formasPago.id, id)).returning().get();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'forma_pago', entidadId: id, antes, despues: f });
  return f;
}

// ───────────── Operaciones de caja ─────────────

const grupoNuevo = (db: DB, prefijo: string) => `${prefijo}-${siguienteNumero(db, 'grupo_caja')}`;

export function cargarSaldoInicial(ctx: Ctx, d: { cuentaId: number; fecha: string; importeCentavos: number }) {
  const ya = ctx.db.select({ id: movimientosCaja.id }).from(movimientosCaja).where(eq(movimientosCaja.cuentaId, d.cuentaId)).limit(1).get();
  if (ya) throw new ErrorNegocio('La cuenta ya tiene movimientos: para corregir el saldo hacé un arqueo');
  const g = grupoNuevo(ctx.db, 'inicial');
  const m = registrarCaja(ctx, { fecha: d.fecha, cuentaId: d.cuentaId, importeCentavos: d.importeCentavos, tipo: 'saldo_inicial', concepto: 'Saldo inicial', grupo: g });
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'saldo_inicial', entidad: 'cuenta', entidadId: d.cuentaId, despues: { importeCentavos: d.importeCentavos, fecha: d.fecha } });
  return m;
}

/** Pase entre cuentas propias. Si las monedas son distintas (ej. cambio de dólares) se indica cuánto llega. */
export function pase(ctx: Ctx, d: { fecha: string; origenId: number; destinoId: number; importeCentavos: number; importeDestinoCentavos?: number | null; concepto?: string | null }) {
  if (d.origenId === d.destinoId) throw new ErrorNegocio('El origen y el destino son la misma cuenta');
  if (!(d.importeCentavos > 0)) throw new ErrorNegocio('El importe tiene que ser mayor a cero');
  const o = cuentaOError(ctx.db, d.origenId);
  const de = cuentaOError(ctx.db, d.destinoId);
  if (o.tipo === 'externa' || de.tipo === 'externa') throw new ErrorNegocio('Para plata que pone alguien de afuera usá "Aporte"');
  let llega = d.importeCentavos;
  if (o.moneda !== de.moneda) {
    if (!d.importeDestinoCentavos || d.importeDestinoCentavos <= 0) throw new ErrorNegocio(`Indicá cuánto llega en ${de.moneda} (cambio de moneda)`);
    llega = d.importeDestinoCentavos;
  }
  const g = grupoNuevo(ctx.db, 'pase');
  const concepto = d.concepto?.trim() || `Pase de ${o.nombre} a ${de.nombre}`;
  // En un cambio de moneda, el valor en pesos de las dos patas es el de la parte en pesos.
  const ars = o.moneda === 'ARS' ? d.importeCentavos : de.moneda === 'ARS' ? llega : aPesosDeCuenta(ctx.db, o, d.importeCentavos);
  registrarCaja(ctx, { fecha: d.fecha, cuentaId: o.id, importeCentavos: -d.importeCentavos, importeArsCentavos: -ars, tipo: 'pase', concepto, grupo: g });
  registrarCaja(ctx, { fecha: d.fecha, cuentaId: de.id, importeCentavos: llega, importeArsCentavos: ars, tipo: 'pase', concepto, grupo: g });
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'pase', entidad: 'caja', entidadId: g, despues: d });
  return { grupo: g };
}

/**
 * Liquidación de tarjetas: sale lo cobrado (bruto) de "a liquidar", entra el neto en la cuenta destino,
 * y la diferencia queda como comisión real (cargos + IVA + retenciones).
 */
export function liquidar(ctx: Ctx, d: { fecha: string; origenId: number; destinoId: number; brutoCentavos: number; netoCentavos: number; concepto?: string | null }) {
  const o = cuentaOError(ctx.db, d.origenId);
  const de = cuentaOError(ctx.db, d.destinoId);
  if (o.tipo !== 'a_liquidar') throw new ErrorNegocio('El origen tiene que ser una cuenta de tarjetas a liquidar');
  if (de.tipo === 'a_liquidar' || de.tipo === 'externa' || de.moneda !== 'ARS') throw new ErrorNegocio('El destino tiene que ser una cuenta en pesos donde llega la plata');
  if (!(d.netoCentavos > 0) || d.brutoCentavos < d.netoCentavos) throw new ErrorNegocio('El neto tiene que ser mayor a cero y no puede superar al bruto');
  const g = grupoNuevo(ctx.db, 'liq');
  const concepto = d.concepto?.trim() || `Liquidación a ${de.nombre}`;
  registrarCaja(ctx, { fecha: d.fecha, cuentaId: o.id, importeCentavos: -d.netoCentavos, tipo: 'liquidacion', concepto, grupo: g });
  registrarCaja(ctx, { fecha: d.fecha, cuentaId: de.id, importeCentavos: d.netoCentavos, tipo: 'liquidacion', concepto, grupo: g });
  const comision = d.brutoCentavos - d.netoCentavos;
  if (comision > 0) registrarCaja(ctx, { fecha: d.fecha, cuentaId: o.id, importeCentavos: -comision, tipo: 'comision', concepto: `Comisiones y retenciones · ${concepto}`, grupo: g });
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'liquidacion', entidad: 'caja', entidadId: g, despues: { ...d, comisionCentavos: comision } });
  return { grupo: g, comisionCentavos: comision };
}

/** Plata que pone alguien de afuera (inversor externo, familia). No es venta: no suma a la ganancia. */
export function aporte(ctx: Ctx, d: { fecha: string; cuentaId: number; importeCentavos: number; aportante: string; concepto?: string | null }) {
  if (!(d.importeCentavos > 0)) throw new ErrorNegocio('El importe tiene que ser mayor a cero');
  if (!d.aportante?.trim()) throw new ErrorNegocio('Indicá quién hace el aporte');
  const c = cuentaOError(ctx.db, d.cuentaId);
  if (c.tipo === 'externa') throw new ErrorNegocio('Elegí la cuenta donde entra la plata. Los pagos que hace directamente el inversor se cargan como gasto pagado con su cuenta');
  const g = grupoNuevo(ctx.db, 'aporte');
  registrarCaja(ctx, { fecha: d.fecha, cuentaId: c.id, importeCentavos: d.importeCentavos, tipo: 'aporte', concepto: `Aporte de ${d.aportante.trim()}${d.concepto?.trim() ? ': ' + d.concepto.trim() : ''}`, grupo: g });
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'aporte', entidad: 'caja', entidadId: g, despues: d });
  return { grupo: g };
}

/** Plata que se saca para uso personal. No es gasto del local. */
export function retiro(ctx: Ctx, d: { fecha: string; cuentaId: number; importeCentavos: number; concepto: string }) {
  if (!(d.importeCentavos > 0)) throw new ErrorNegocio('El importe tiene que ser mayor a cero');
  if (!d.concepto?.trim()) throw new ErrorNegocio('Indicá el concepto del retiro');
  const c = cuentaOError(ctx.db, d.cuentaId);
  if (c.tipo === 'externa' || c.tipo === 'a_liquidar') throw new ErrorNegocio('No se puede retirar de esa cuenta');
  const g = grupoNuevo(ctx.db, 'retiro');
  registrarCaja(ctx, { fecha: d.fecha, cuentaId: c.id, importeCentavos: -d.importeCentavos, tipo: 'retiro', concepto: `Retiro personal: ${d.concepto.trim()}`, grupo: g });
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'retiro', entidad: 'caja', entidadId: g, despues: d });
  return { grupo: g };
}

/**
 * Arqueo: se cuenta la plata real de una cuenta. Si no coincide con el sistema, la diferencia queda
 * como un ajuste ("diferencia de caja no identificada"), separado de los gastos del local.
 */
export function arquear(ctx: Ctx, d: { fecha: string; cuentaId: number; saldoRealCentavos: number; notas?: string | null }) {
  const c = cuentaOError(ctx.db, d.cuentaId);
  if (c.tipo === 'externa') throw new ErrorNegocio('Una cuenta externa no se arquea');
  if (!Number.isInteger(d.saldoRealCentavos)) throw new ErrorNegocio('Saldo inválido');
  const sistema = saldoDe(ctx.db, c.id, d.fecha);
  const t = ahora();
  const a = ctx.db.insert(arqueos).values({ fecha: d.fecha, cuentaId: c.id, saldoSistemaCentavos: sistema, saldoRealCentavos: d.saldoRealCentavos, notas: d.notas ?? null, usuarioId: ctx.usuarioId, creadoEn: t }).returning().get();
  const dif = d.saldoRealCentavos - sistema;
  if (dif !== 0) {
    registrarCaja(ctx, {
      fecha: d.fecha, cuentaId: c.id, importeCentavos: dif, tipo: 'ajuste', refTipo: 'arqueo', refId: a.id, grupo: `arqueo-${a.id}`,
      concepto: `Diferencia de caja no identificada (arqueo: sistema ${(sistema / 100).toLocaleString('es-AR')}, real ${(d.saldoRealCentavos / 100).toLocaleString('es-AR')})${d.notas?.trim() ? ' · ' + d.notas.trim() : ''}`,
    });
  }
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'arqueo', entidad: 'cuenta', entidadId: c.id, despues: { sistema, real: d.saldoRealCentavos, diferencia: dif } });
  return { ...a, diferenciaCentavos: dif };
}

export function listarArqueos(db: DB, cuentaId?: number) {
  return db.select({ a: arqueos, cuenta: cuentas.nombre }).from(arqueos).innerJoin(cuentas, eq(cuentas.id, arqueos.cuentaId))
    .where(cuentaId ? eq(arqueos.cuentaId, cuentaId) : undefined).orderBy(desc(arqueos.fecha), desc(arqueos.id)).limit(100).all()
    .map((r) => ({ ...r.a, cuenta: r.cuenta, diferenciaCentavos: r.a.saldoRealCentavos - r.a.saldoSistemaCentavos }));
}

/** Anula una operación manual de caja (pase, aporte, retiro, liquidación, saldo inicial, ajuste de arqueo). */
export function anularOperacion(ctx: Ctx, grupo: string, motivo: string) {
  if (!motivo?.trim()) throw new ErrorNegocio('Indicá el motivo de la anulación');
  const movs = ctx.db.select().from(movimientosCaja).where(eq(movimientosCaja.grupo, grupo)).all();
  if (!movs.length) throw noEncontrado('La operación');
  if (movs.some((m) => m.tipo === 'anulacion')) throw new ErrorNegocio('La operación ya está anulada');
  if (!movs.every((m) => TIPOS_MANUALES.includes(m.tipo) || m.tipo === 'comision')) throw new ErrorNegocio('Esta operación se anula desde su venta, gasto o pago');
  revertirMovimientos(ctx, { grupo }, motivo.trim());
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'anular', entidad: 'caja', entidadId: grupo, detalle: motivo });
  return { ok: true };
}

export interface FiltroCaja { cuentaId?: number; desde?: string; hasta?: string; tipo?: TipoCaja; q?: string; pagina?: number; porPagina?: number }

export function listarMovimientosCaja(db: DB, f: FiltroCaja) {
  const conds = [];
  if (f.cuentaId) conds.push(eq(movimientosCaja.cuentaId, f.cuentaId));
  if (f.desde) conds.push(gte(movimientosCaja.fecha, f.desde));
  if (f.hasta) conds.push(lte(movimientosCaja.fecha, f.hasta));
  if (f.tipo) conds.push(eq(movimientosCaja.tipo, f.tipo));
  if (f.q?.trim()) conds.push(sql`${movimientosCaja.concepto} like ${'%' + f.q.trim() + '%'}`);
  const where = conds.length ? and(...conds) : undefined;
  const total = Number(db.select({ n: sql<number>`count(*)` }).from(movimientosCaja).where(where).get()?.n ?? 0);
  const totales = db.select({ entra: sql<number>`coalesce(sum(case when ${movimientosCaja.importeArsCentavos} > 0 then ${movimientosCaja.importeArsCentavos} end), 0)`, sale: sql<number>`coalesce(sum(case when ${movimientosCaja.importeArsCentavos} < 0 then ${movimientosCaja.importeArsCentavos} end), 0)` })
    .from(movimientosCaja).where(where).get()!;
  const porPagina = f.porPagina ?? 50;
  // Saldo de la cuenta después de cada movimiento (solo tiene sentido viendo una cuenta).
  const saldo = sql<number>`sum(${movimientosCaja.importeCentavos}) over (partition by ${movimientosCaja.cuentaId} order by ${movimientosCaja.fecha}, ${movimientosCaja.id})`;
  const sub = db.select({ id: movimientosCaja.id, saldo: saldo.as('saldo') }).from(movimientosCaja).as('s');
  const anulados = new Set(db.select({ a: movimientosCaja.anulaId }).from(movimientosCaja).where(sql`${movimientosCaja.anulaId} is not null`).all().map((x) => x.a));
  const filas = db.select({ m: movimientosCaja, cuenta: cuentas.nombre, moneda: cuentas.moneda, saldo: sub.saldo })
    .from(movimientosCaja).innerJoin(cuentas, eq(cuentas.id, movimientosCaja.cuentaId)).innerJoin(sub, eq(sub.id, movimientosCaja.id))
    .where(where).orderBy(desc(movimientosCaja.fecha), desc(movimientosCaja.id)).limit(porPagina).offset(((f.pagina ?? 1) - 1) * porPagina).all()
    .map((r) => ({ ...r.m, cuenta: r.cuenta, moneda: r.moneda, saldoCentavos: Number(r.saldo), anulado: anulados.has(r.m.id), manual: TIPOS_MANUALES.includes(r.m.tipo) }));
  return { total, entraCentavos: Number(totales.entra), saleCentavos: Number(totales.sale), filas };
}

/** Resumen de un período por tipo de movimiento (en pesos), para ver de dónde vino y a dónde fue la plata. */
export function resumenCaja(db: DB, desde?: string, hasta?: string) {
  const filas = db.select({ tipo: movimientosCaja.tipo, total: sql<number>`sum(${movimientosCaja.importeArsCentavos})` }).from(movimientosCaja)
    .where(and(desde ? gte(movimientosCaja.fecha, desde) : undefined, hasta ? lte(movimientosCaja.fecha, hasta) : undefined))
    .groupBy(movimientosCaja.tipo).all();
  return Object.fromEntries(filas.map((f) => [f.tipo, Number(f.total)])) as Partial<Record<TipoCaja, number>>;
}

export const idsCuentas = (db: DB, ids: number[]) => (ids.length ? db.select().from(cuentas).where(inArray(cuentas.id, ids)).all() : []);
