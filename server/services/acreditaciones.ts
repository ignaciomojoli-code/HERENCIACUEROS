/**
 * Cobros, comisiones y acreditaciones. No guarda nada nuevo: lee lo que ya registran las ventas y la caja.
 *  - Bruto: lo que se le cobró al cliente con ese medio (cancela la venta; es lo que cuentan las estadísticas comerciales).
 *  - Comisión estimada: la de la forma de pago al momento de cobrar. Comisión real: la que se cargó o la que salió de la liquidación.
 *  - Neto esperado = bruto − comisión estimada. Neto acreditado = bruto − comisión real (o estimada si no hay otra).
 *  - Estado: efectivo, transferencias y billeteras se acreditan en el momento (la caja ya registra la entrada y aparte la comisión).
 *    Lo cobrado a una cuenta "a liquidar" (tarjetas) queda PENDIENTE hasta que se carga su liquidación: recién ahí entra el neto real.
 */
import { sql } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import type { Ctx } from './stock.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { liquidar } from './caja.js';
import { totalesVentas } from './reportes.js';

export interface FiltroCobros {
  desde: string; hasta: string; formaPagoId?: number; medio?: string; procesador?: string; cuotas?: number;
  estado?: 'pendiente' | 'acreditado'; ventaNumero?: number; comisionBp?: number; importeMin?: number; importeMax?: number; conDiferencia?: boolean;
}

const n = (x: unknown) => Number(x ?? 0);

/**
 * Liquidaciones viejas que se cargaron sin elegir los cobros: no se sabe cuál cobro incluyó cada una, pero el saldo de la
 * cuenta "a liquidar" dice cuánto falta acreditar. Se toman como pendientes los cobros sin vincular más recientes hasta
 * cubrir ese saldo; los anteriores ya se acreditaron (sin fecha exacta). No se modifica ningún dato.
 */
function acreditadosSinVincular(db: DB) {
  const cobros = db.all<{ id: number; cuentaId: number; importe: number }>(sql`
    select p.id, p.cuenta_id as cuentaId, p.importe_centavos as importe from venta_pagos p join ventas v on v.id = p.venta_id join cuentas c on c.id = p.cuenta_id
    where c.tipo = 'a_liquidar' and p.estado = 'activo' and v.estado = 'confirmada' and p.liquidacion is null
    order by coalesce(p.fecha, v.fecha) desc, p.id desc`);
  const saldos = new Map(db.all<{ cuentaId: number; s: number }>(sql`
    select m.cuenta_id as cuentaId, coalesce(sum(m.importe_centavos), 0) as s from movimientos_caja m join cuentas c on c.id = m.cuenta_id where c.tipo = 'a_liquidar' group by m.cuenta_id`)
    .map((r) => [n(r.cuentaId), n(r.s)]));
  const resto = new Map(saldos);
  const acreditados = new Set<number>();
  for (const c of cobros) {
    const r = resto.get(n(c.cuentaId)) ?? 0;
    if (n(c.importe) <= r) resto.set(n(c.cuentaId), r - n(c.importe));
    else { acreditados.add(n(c.id)); resto.set(n(c.cuentaId), -Infinity); }
  }
  return acreditados;
}

export function listarCobros(db: DB, f: FiltroCobros) {
  const filas = db.all<Record<string, unknown>>(sql`
    select p.id, coalesce(p.fecha, v.fecha) as fecha, v.id as ventaId, v.numero as ventaNumero,
      f.id as formaPagoId, f.nombre as forma, f.medio, f.procesador, f.cuotas, f.comision_bp as comisionBpForma,
      c.id as cuentaId, c.nombre as cuenta, c.tipo as tipoCuenta,
      p.importe_centavos as brutoCentavos, p.comision_estimada_centavos as comisionEstimadaCentavos, p.comision_real_centavos as comisionRealCentavos,
      p.liquidacion,
      (select min(m.fecha) from movimientos_caja m where m.grupo = p.liquidacion and m.tipo = 'liquidacion' and m.anula_id is null) as fechaLiquidacion
    from venta_pagos p join ventas v on v.id = p.venta_id join formas_pago f on f.id = p.forma_pago_id join cuentas c on c.id = p.cuenta_id
    where p.estado = 'activo' and v.estado = 'confirmada' and coalesce(p.fecha, v.fecha) between ${f.desde} and ${f.hasta}
    order by coalesce(p.fecha, v.fecha) desc, p.id desc`);
  const viejos = acreditadosSinVincular(db);
  return filas.map((r) => {
    const bruto = n(r.brutoCentavos), est = n(r.comisionEstimadaCentavos), real = r.comisionRealCentavos == null ? null : n(r.comisionRealCentavos);
    const aLiquidar = r.tipoCuenta === 'a_liquidar';
    const sinVincular = aLiquidar && r.liquidacion == null && viejos.has(n(r.id));
    const acreditado = !aLiquidar || r.liquidacion != null || sinVincular;
    const netoEsperado = bruto - est;
    const netoAcreditado = acreditado ? bruto - (real ?? est) : null;
    return {
      id: n(r.id), fecha: String(r.fecha), ventaId: n(r.ventaId), ventaNumero: n(r.ventaNumero),
      formaPagoId: n(r.formaPagoId), forma: String(r.forma), medio: (r.medio as string | null) ?? null, procesador: (r.procesador as string | null) ?? null,
      cuotas: r.cuotas == null ? null : n(r.cuotas), cuentaId: n(r.cuentaId), cuenta: String(r.cuenta), aLiquidar,
      brutoCentavos: bruto, comisionEstimadaCentavos: est, comisionRealCentavos: real, comisionCentavos: real ?? est,
      /** Porcentaje aplicado (en puntos básicos), calculado sobre lo cobrado. */
      comisionBp: bruto ? Math.round(((real ?? est) * 10000) / bruto) : 0, comisionBpEstimada: bruto ? Math.round((est * 10000) / bruto) : 0,
      netoEsperadoCentavos: netoEsperado, netoAcreditadoCentavos: netoAcreditado,
      estado: (acreditado ? 'acreditado' : 'pendiente') as 'acreditado' | 'pendiente',
      fechaAcreditacion: acreditado ? (aLiquidar ? (r.fechaLiquidacion as string | null) : String(r.fecha)) : null,
      /** Acreditado en una liquidación vieja cargada sin elegir los cobros (no se sabe la fecha exacta). */
      sinVincular,
      diferenciaCentavos: netoAcreditado === null ? null : netoAcreditado - netoEsperado,
      liquidacion: (r.liquidacion as string | null) ?? null,
    };
  }).filter((c) => (!f.formaPagoId || c.formaPagoId === f.formaPagoId) && (!f.medio || (f.medio === 'sin' ? c.medio === null : c.medio === f.medio))
    && (!f.procesador || c.procesador === f.procesador) && (!f.cuotas || c.cuotas === f.cuotas) && (!f.estado || c.estado === f.estado)
    && (!f.ventaNumero || c.ventaNumero === f.ventaNumero) && (f.comisionBp === undefined || c.comisionBpEstimada === f.comisionBp)
    && (f.importeMin === undefined || c.brutoCentavos >= f.importeMin) && (f.importeMax === undefined || c.brutoCentavos <= f.importeMax)
    && (!f.conDiferencia || (c.diferenciaCentavos ?? 0) !== 0));
}

type Cobro = ReturnType<typeof listarCobros>[number];
function sumar(cs: Cobro[]) {
  return {
    cobros: cs.length,
    brutoCentavos: cs.reduce((s, c) => s + c.brutoCentavos, 0),
    comisionCentavos: cs.reduce((s, c) => s + c.comisionCentavos, 0),
    comisionEstimadaCentavos: cs.reduce((s, c) => s + c.comisionEstimadaCentavos, 0),
    netoEsperadoCentavos: cs.reduce((s, c) => s + c.netoEsperadoCentavos, 0),
    acreditadoCentavos: cs.reduce((s, c) => s + (c.netoAcreditadoCentavos ?? 0), 0),
    pendienteCentavos: cs.filter((c) => c.estado === 'pendiente').reduce((s, c) => s + c.netoEsperadoCentavos, 0),
    pendienteBrutoCentavos: cs.filter((c) => c.estado === 'pendiente').reduce((s, c) => s + c.brutoCentavos, 0),
    diferenciaCentavos: cs.reduce((s, c) => s + (c.diferenciaCentavos ?? 0), 0),
  };
}

/** Reporte: total de ventas del período, totales por medio de pago y el detalle de cada cobro. */
export function reporteCobros(db: DB, f: FiltroCobros) {
  const cobros = listarCobros(db, f);
  const porForma = new Map<number, { formaPagoId: number; forma: string; medio: string | null; procesador: string | null; cuotas: number | null; items: Cobro[] }>();
  for (const c of cobros) {
    const g = porForma.get(c.formaPagoId) ?? { formaPagoId: c.formaPagoId, forma: c.forma, medio: c.medio, procesador: c.procesador, cuotas: c.cuotas, items: [] };
    g.items.push(c); porForma.set(c.formaPagoId, g);
  }
  const v = totalesVentas(db, f.desde, f.hasta);
  return {
    desde: f.desde, hasta: f.hasta,
    ventas: { cantidad: v.ventas, totalCentavos: v.totalCentavos },
    totales: sumar(cobros),
    porMedio: [...porForma.values()].map(({ items, ...g }) => ({ ...g, ...sumar(items) })).sort((a, b) => b.brutoCentavos - a.brutoCentavos),
    cobros,
  };
}

/**
 * Registra la acreditación real de un cobro con tarjeta (cuenta "a liquidar"): entra el neto real a la cuenta destino,
 * la diferencia con el bruto queda como comisión real. Usa la misma liquidación de caja de siempre (se anula desde Caja).
 */
export function acreditarCobros(ctx: Ctx, d: { cobroIds: number[]; fecha: string; destinoId: number; netoCentavos: number; concepto?: string | null }) {
  if (!d.cobroIds.length) throw new ErrorNegocio('Elegí al menos un cobro');
  const filas = ctx.db.all<{ id: number; cuentaId: number; importe: number; liquidacion: string | null; tipo: string; estado: string; ventaEstado: string }>(sql`
    select p.id, p.cuenta_id as cuentaId, p.importe_centavos as importe, p.liquidacion, c.tipo, p.estado, v.estado as ventaEstado
    from venta_pagos p join cuentas c on c.id = p.cuenta_id join ventas v on v.id = p.venta_id where p.id in (${sql.join(d.cobroIds.map((i) => sql`${i}`), sql`, `)})`);
  if (filas.length !== new Set(d.cobroIds).size) throw noEncontrado('Algún cobro');
  if (filas.some((f) => f.estado !== 'activo' || f.ventaEstado !== 'confirmada')) throw new ErrorNegocio('Hay cobros anulados');
  if (filas.some((f) => f.tipo !== 'a_liquidar')) throw new ErrorNegocio('Solo se acredita lo cobrado a una cuenta de tarjetas a liquidar (lo demás ya entró a su cuenta)');
  const viejos = acreditadosSinVincular(ctx.db);
  if (filas.some((f) => f.liquidacion || viejos.has(Number(f.id)))) throw new ErrorNegocio('Hay cobros que ya están acreditados');
  if (new Set(filas.map((f) => f.cuentaId)).size > 1) throw new ErrorNegocio('Los cobros tienen que ser de la misma cuenta a liquidar');
  const bruto = filas.reduce((s, f) => s + Number(f.importe), 0);
  if (!Number.isInteger(d.netoCentavos) || d.netoCentavos <= 0 || d.netoCentavos > bruto) throw new ErrorNegocio('El neto acreditado tiene que ser mayor a cero y no más que lo cobrado');
  return liquidar(ctx, { fecha: d.fecha, origenId: filas[0].cuentaId, destinoId: d.destinoId, brutoCentavos: bruto, netoCentavos: d.netoCentavos, concepto: d.concepto ?? null, cobroIds: d.cobroIds });
}

/** Para la caja: lo disponible, lo pendiente de acreditar (bruto y neto esperado) y las comisiones de un período. */
export function resumenAcreditaciones(db: DB, desde: string, hasta: string) {
  const pend = listarCobros(db, { desde: '2000-01-01', hasta: '2999-12-31', estado: 'pendiente' });
  const com = n(db.get<{ c: number }>(sql`select coalesce(sum(importe_ars_centavos), 0) as c from movimientos_caja where tipo = 'comision' and fecha between ${desde} and ${hasta}`)!.c);
  const delPeriodo = listarCobros(db, { desde, hasta });
  return {
    pendienteBrutoCentavos: pend.reduce((s, c) => s + c.brutoCentavos, 0),
    pendienteNetoCentavos: pend.reduce((s, c) => s + c.netoEsperadoCentavos, 0),
    pendientes: pend.length,
    /** Comisiones ya descontadas en caja en el período (se ven como movimientos "Comisión"). */
    comisionesCajaCentavos: -com,
    /** Comisiones de los cobros del período (estimadas o reales), incluidas las de tarjetas todavía sin liquidar. */
    comisionesCobrosCentavos: delPeriodo.reduce((s, c) => s + c.comisionCentavos, 0),
    brutoCobradoCentavos: delPeriodo.reduce((s, c) => s + c.brutoCentavos, 0),
  };
}
