/**
 * Panel, reportes y alertas. Todo se calcula en el momento a partir de los libros (ventas, caja, stock,
 * gastos): no hay totales guardados que se puedan desincronizar.
 *
 * Criterios:
 * - Ventas = lo cobrado por los productos (precio × cantidad) de ventas confirmadas.
 * - Costo de mercadería = el costo guardado en cada venta al momento de vender. Si una venta tenía
 *   productos sin costo, se cuenta aparte ("sin costo") y la ganancia de esos productos no se inventa.
 * - Comisiones = la real si se cargó, si no la estimada.
 * - Resultado = ventas − costo − comisiones − gastos del local (los retiros personales no son gasto).
 */
import { sql } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { leerConfig } from './configuracion.js';
import { listarCuentas, hoyLocal } from './caja.js';
import { saldosProveedores } from './gastos.js';
import { costear, listarMateriales } from './costos.js';
import { tienePermiso, type MapaPermisos, type Modulo } from '../domain/permisos.js';

const n = (x: unknown) => Number(x ?? 0);
/** "1 producto" / "3 productos". */
const pl = (k: number, uno: string, varios: string) => `${k} ${k === 1 ? uno : varios}`;

/** Suma días a una fecha AAAA-MM-DD. */
export function sumarDias(fecha: string, dias: number) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
export const diasEntre = (desde: string, hasta: string) => Math.round((Date.parse(hasta + 'T12:00:00Z') - Date.parse(desde + 'T12:00:00Z')) / 86400000);

interface Totales { ventas: number; unidades: number; totalCentavos: number; costoCentavos: number; comisionCentavos: number; gananciaCentavos: number; unidadesSinCosto: number; ventasSinCostoCentavos: number }

/** Totales de ventas confirmadas en un rango. La ganancia solo cuenta los productos con costo conocido. */
export function totalesVentas(db: DB, desde: string, hasta: string): Totales {
  const it = db.get<{ ventas: number; unidades: number; total: number; costo: number; sinCostoU: number; sinCostoT: number }>(sql`
    select count(distinct v.id) as ventas, coalesce(sum(i.cantidad), 0) as unidades, coalesce(sum(i.cantidad * i.precio_centavos), 0) as total,
      coalesce(sum(case when i.costo_unitario_centavos is not null then i.cantidad * i.costo_unitario_centavos end), 0) as costo,
      coalesce(sum(case when i.costo_unitario_centavos is null then i.cantidad end), 0) as sinCostoU,
      coalesce(sum(case when i.costo_unitario_centavos is null then i.cantidad * i.precio_centavos end), 0) as sinCostoT
    from ventas v join venta_items i on i.venta_id = v.id
    where v.estado = 'confirmada' and v.fecha between ${desde} and ${hasta}`)!;
  const com = db.get<{ c: number }>(sql`
    select coalesce(sum(coalesce(p.comision_real_centavos, p.comision_estimada_centavos)), 0) as c
    from venta_pagos p join ventas v on v.id = p.venta_id where p.estado = 'activo' and v.estado = 'confirmada' and v.fecha between ${desde} and ${hasta}`)!;
  // Descuentos sobre el total de la venta (los de cada producto ya están en su precio).
  const desc = n(db.get<{ d: number }>(sql`select coalesce(sum(descuento_centavos), 0) as d from ventas where estado = 'confirmada' and fecha between ${desde} and ${hasta}`)!.d);
  const total = n(it.total) - desc, costo = n(it.costo), comision = n(com.c), sinCostoT = n(it.sinCostoT);
  return {
    ventas: n(it.ventas), unidades: n(it.unidades), totalCentavos: total, costoCentavos: costo, comisionCentavos: comision,
    // Las ventas de productos sin costo no suman ganancia (no se puede saber).
    gananciaCentavos: total - sinCostoT - costo - comision,
    unidadesSinCosto: n(it.sinCostoU), ventasSinCostoCentavos: sinCostoT,
  };
}

export function totalGastos(db: DB, desde: string, hasta: string) {
  return n(db.get<{ s: number }>(sql`select coalesce(sum(importe_centavos), 0) as s from gastos where estado = 'activo' and fecha between ${desde} and ${hasta}`)!.s);
}

/** Panel de un período: totales, comparación con el período anterior del mismo largo, serie por día y desgloses. */
export function panel(db: DB, desde: string, hasta: string) {
  const largo = diasEntre(desde, hasta) + 1;
  const antHasta = sumarDias(desde, -1), antDesde = sumarDias(desde, -largo);
  const actual = totalesVentas(db, desde, hasta);
  const anterior = totalesVentas(db, antDesde, antHasta);
  const gastos = totalGastos(db, desde, hasta);
  const gastosAnt = totalGastos(db, antDesde, antHasta);

  const porDiaFilas = db.all<{ fecha: string; total: number; ventas: number }>(sql`
    select v.fecha, sum(i.cantidad * i.precio_centavos) - (select coalesce(sum(v2.descuento_centavos), 0) from ventas v2 where v2.estado = 'confirmada' and v2.fecha = v.fecha) as total, count(distinct v.id) as ventas
    from ventas v join venta_items i on i.venta_id = v.id where v.estado = 'confirmada' and v.fecha between ${desde} and ${hasta} group by v.fecha`);
  const porDia: { fecha: string; totalCentavos: number; ventas: number }[] = [];
  for (let f = desde; f <= hasta && porDia.length < 400; f = sumarDias(f, 1)) {
    const x = porDiaFilas.find((r) => r.fecha === f);
    porDia.push({ fecha: f, totalCentavos: n(x?.total), ventas: n(x?.ventas) });
  }

  const porFormaPago = db.all<{ forma: string; importe: number; comision: number; cobros: number }>(sql`
    select f.nombre as forma, sum(p.importe_centavos) as importe, sum(coalesce(p.comision_real_centavos, p.comision_estimada_centavos)) as comision, count(*) as cobros
    from venta_pagos p join ventas v on v.id = p.venta_id join formas_pago f on f.id = p.forma_pago_id
    where p.estado = 'activo' and v.estado = 'confirmada' and v.fecha between ${desde} and ${hasta} group by f.id order by importe desc`)
    .map((r) => ({ forma: r.forma, importeCentavos: n(r.importe), comisionCentavos: n(r.comision), cobros: n(r.cobros) }));

  const porCategoria = db.all<{ categoria: string; unidades: number; total: number; costo: number; sinCosto: number }>(sql`
    select c.nombre as categoria, sum(i.cantidad) as unidades, sum(i.cantidad * i.precio_centavos) as total,
      sum(case when i.costo_unitario_centavos is not null then i.cantidad * i.costo_unitario_centavos end) as costo,
      sum(case when i.costo_unitario_centavos is null then i.cantidad * i.precio_centavos else 0 end) as sinCosto
    from ventas v join venta_items i on i.venta_id = v.id join variantes va on va.id = i.variante_id join modelos m on m.id = va.modelo_id join categorias c on c.id = m.categoria_id
    where v.estado = 'confirmada' and v.fecha between ${desde} and ${hasta} group by c.id order by total desc`)
    .map((r) => ({ categoria: r.categoria, unidades: n(r.unidades), totalCentavos: n(r.total), costoCentavos: n(r.costo), gananciaBrutaCentavos: n(r.total) - n(r.sinCosto) - n(r.costo) }));

  const topProductos = rankingProductos(db, desde, hasta).slice(0, 8);

  const gastosPorCategoria = db.all<{ categoria: string; total: number }>(sql`
    select c.nombre as categoria, sum(g.importe_centavos) as total from gastos g join categorias_gasto c on c.id = g.categoria_id
    where g.estado = 'activo' and g.fecha between ${desde} and ${hasta} group by c.id order by total desc`).map((r) => ({ categoria: r.categoria, totalCentavos: n(r.total) }));

  return {
    desde, hasta, anterior: { desde: antDesde, hasta: antHasta },
    actual: { ...actual, gastosCentavos: gastos, resultadoCentavos: actual.gananciaCentavos - gastos, ticketPromedioCentavos: actual.ventas ? Math.round(actual.totalCentavos / actual.ventas) : 0 },
    previo: { ...anterior, gastosCentavos: gastosAnt, resultadoCentavos: anterior.gananciaCentavos - gastosAnt, ticketPromedioCentavos: anterior.ventas ? Math.round(anterior.totalCentavos / anterior.ventas) : 0 },
    porDia, porFormaPago, porCategoria, topProductos, gastosPorCategoria,
  };
}

/** Ranking de modelos vendidos en el período, con ganancia y stock actual. */
export function rankingProductos(db: DB, desde: string, hasta: string) {
  return db.all<{ modeloId: number; modelo: string; categoria: string; unidades: number; total: number; costo: number; sinCosto: number; stock: number }>(sql`
    select m.id as modeloId, m.nombre as modelo, c.nombre as categoria, sum(i.cantidad) as unidades, sum(i.cantidad * i.precio_centavos) as total,
      sum(case when i.costo_unitario_centavos is not null then i.cantidad * i.costo_unitario_centavos end) as costo,
      sum(case when i.costo_unitario_centavos is null then i.cantidad * i.precio_centavos else 0 end) as sinCosto,
      (select coalesce(sum(ms.cantidad), 0) from movimientos_stock ms join variantes v2 on v2.id = ms.variante_id where v2.modelo_id = m.id) as stock
    from ventas v join venta_items i on i.venta_id = v.id join variantes va on va.id = i.variante_id join modelos m on m.id = va.modelo_id join categorias c on c.id = m.categoria_id
    where v.estado = 'confirmada' and v.fecha between ${desde} and ${hasta} group by m.id order by total desc`)
    .map((r) => {
      const conCosto = n(r.total) - n(r.sinCosto);
      const ganancia = conCosto - n(r.costo);
      return {
        modeloId: r.modeloId, modelo: r.modelo, categoria: r.categoria, unidades: n(r.unidades), totalCentavos: n(r.total), costoCentavos: n(r.costo),
        gananciaBrutaCentavos: ganancia, margenBrutoBp: conCosto > 0 ? Math.round((ganancia * 10000) / conCosto) : null, sinCosto: n(r.sinCosto) > 0, stock: n(r.stock),
      };
    });
}

/** Modelos con stock que no se venden hace más de N días (o nunca), con su valor al costo. */
export function sinMovimiento(db: DB, dias: number, hoy = hoyLocal()) {
  const limite = sumarDias(hoy, -dias);
  return db.all<{ modeloId: number; modelo: string; categoria: string; stock: number; valor: number | null; ultimaVenta: string | null }>(sql`
    select m.id as modeloId, m.nombre as modelo, c.nombre as categoria, s.stock, s.valor,
      (select max(v.fecha) from ventas v join venta_items i on i.venta_id = v.id join variantes va on va.id = i.variante_id where va.modelo_id = m.id and v.estado = 'confirmada') as ultimaVenta
    from modelos m join categorias c on c.id = m.categoria_id
    join (select va.modelo_id as mid, sum(x.st) as stock, sum(case when va.costo_centavos is not null and x.st > 0 then x.st * va.costo_centavos end) as valor
          from variantes va join (select variante_id, sum(cantidad) as st from movimientos_stock group by variante_id) x on x.variante_id = va.id group by va.modelo_id) s on s.mid = m.id
    where m.activo = 1 and s.stock > 0`)
    .filter((r) => !r.ultimaVenta || r.ultimaVenta < limite)
    .map((r) => ({ ...r, stock: n(r.stock), valorCostoCentavos: r.valor === null ? null : n(r.valor), diasSinVenta: r.ultimaVenta ? diasEntre(r.ultimaVenta, hoy) : null }))
    .sort((a, b) => (b.valorCostoCentavos ?? 0) - (a.valorCostoCentavos ?? 0));
}

/** Estado de resultados mes por mes (AAAA-MM) entre dos meses inclusive. */
export function estadoResultados(db: DB, mesDesde: string, mesHasta: string) {
  const meses: string[] = [];
  for (let m = mesDesde; m <= mesHasta && meses.length < 36; ) {
    meses.push(m);
    const [a, mm] = m.split('-').map(Number);
    m = mm === 12 ? `${a + 1}-01` : `${a}-${String(mm + 1).padStart(2, '0')}`;
  }
  const categorias = new Set<string>();
  const filas = meses.map((mes) => {
    const desde = `${mes}-01`, hasta = `${mes}-31`;
    const t = totalesVentas(db, desde, hasta);
    const gastos = db.all<{ categoria: string; total: number }>(sql`
      select c.nombre as categoria, sum(g.importe_centavos) as total from gastos g join categorias_gasto c on c.id = g.categoria_id
      where g.estado = 'activo' and g.fecha between ${desde} and ${hasta} group by c.id`);
    gastos.forEach((g) => categorias.add(g.categoria));
    const totalGastosMes = gastos.reduce((s, g) => s + n(g.total), 0);
    const retiros = n(db.get<{ s: number }>(sql`select coalesce(-sum(importe_ars_centavos), 0) as s from movimientos_caja where tipo = 'retiro' and fecha between ${desde} and ${hasta} and id not in (select anula_id from movimientos_caja where anula_id is not null)`)!.s);
    const aportes = n(db.get<{ s: number }>(sql`select coalesce(sum(importe_ars_centavos), 0) as s from movimientos_caja where tipo = 'aporte' and fecha between ${desde} and ${hasta}`)!.s);
    return {
      mes, ventasCentavos: t.totalCentavos, costoCentavos: t.costoCentavos, comisionesCentavos: t.comisionCentavos, ventasSinCostoCentavos: t.ventasSinCostoCentavos,
      gananciaBrutaCentavos: t.gananciaCentavos, gastos: Object.fromEntries(gastos.map((g) => [g.categoria, n(g.total)])), gastosCentavos: totalGastosMes,
      resultadoCentavos: t.gananciaCentavos - totalGastosMes, retirosCentavos: retiros, aportesCentavos: aportes, ventas: t.ventas, unidades: t.unidades,
    };
  });
  return { meses, categoriasGasto: [...categorias].sort(), filas };
}

// ───────────── Alertas ─────────────

export type NivelAlerta = 'critico' | 'atencion' | 'info';
export interface Alerta { id: string; nivel: NivelAlerta; modulo: Modulo; titulo: string; detalle?: string; enlace: string; cantidad?: number }

/**
 * Lista de avisos para el inicio, filtrada por lo que el rol puede ver.
 * Son avisos: nunca frenan una operación.
 */
export function alertas(db: DB, permisos: MapaPermisos, extra: { ultimoBackup?: string | null } = {}, hoy = hoyLocal()): Alerta[] {
  const puede = (m: Modulo) => tienePermiso(permisos, m, 'ver');
  const cfg = leerConfig(db, 'alertas');
  const r: Alerta[] = [];
  const contar = (q: ReturnType<typeof sql>) => n(db.get<{ n: number }>(q)?.n);

  if (puede('stock')) {
    const st = sql`(select coalesce(sum(cantidad), 0) from movimientos_stock where variante_id = v.id)`;
    const neg = contar(sql`select count(*) as n from variantes v where v.activo = 1 and ${st} < 0`);
    if (neg) r.push({ id: 'stock-negativo', nivel: 'critico', modulo: 'stock', titulo: `${pl(neg, 'producto', 'productos')} con stock negativo`, detalle: 'Se vendió o se usó más de lo que había: revisá con un conteo.', enlace: '/stock?filtro=negativo', cantidad: neg });
    const bajo = contar(sql`select count(*) as n from variantes v where v.activo = 1 and v.stock_minimo is not null and ${st} >= 0 and ${st} < v.stock_minimo`);
    if (bajo) r.push({ id: 'stock-bajo', nivel: 'atencion', modulo: 'stock', titulo: `${pl(bajo, 'producto', 'productos')} por debajo del mínimo`, enlace: '/stock?filtro=bajo_minimo', cantidad: bajo });
  }
  if (puede('materiales')) {
    const mats = listarMateriales(db).filter((m) => m.activo && m.stockMil !== null && (m.stockMil < 0 || (m.stockMinimoMil !== null && m.stockMil <= m.stockMinimoMil)));
    if (mats.length) r.push({ id: 'materiales', nivel: mats.some((m) => (m.stockMil ?? 0) < 0) ? 'critico' : 'atencion', modulo: 'materiales', titulo: `${pl(mats.length, 'material', 'materiales')} para reponer`, detalle: mats.slice(0, 4).map((m) => m.nombre).join(', ') + (mats.length > 4 ? '…' : ''), enlace: '/materiales', cantidad: mats.length });
  }
  if (puede('compras')) {
    const atr = db.all<{ numero: number; proveedor: string }>(sql`select c.numero, p.nombre as proveedor from compras c join proveedores p on p.id = c.proveedor_id where c.estado = 'confirmada' and c.fecha_esperada is not null and substr(c.fecha_esperada, 1, 10) < ${hoy}`);
    if (atr.length) r.push({ id: 'pedidos-atrasados', nivel: 'atencion', modulo: 'compras', titulo: `${pl(atr.length, 'pedido atrasado', 'pedidos atrasados')}`, detalle: atr.slice(0, 3).map((a) => `P-${a.numero} ${a.proveedor}`).join(', '), enlace: '/compras?estado=confirmada', cantidad: atr.length });
  }
  if (puede('costos')) {
    const sinCosto = contar(sql`select count(*) as n from variantes v join modelos m on m.id = v.modelo_id where v.activo = 1 and m.activo = 1 and v.costo_centavos is null`);
    if (sinCosto) r.push({ id: 'sin-costo', nivel: 'atencion', modulo: 'costos', titulo: `${pl(sinCosto, 'producto', 'productos')} sin costo`, detalle: 'Sus ventas no suman ganancia hasta que tengan costo.', enlace: '/catalogo?sinCosto=1', cantidad: sinCosto });
    const desact = costear(db).flatMap((m) => m.variantes.map((v) => ({ ...v, modelo: m.modelo })));
    const distintos = desact.filter((v) => v.cambia && !v.pendientes.length);
    const modelosDistintos = new Set(distintos.map((v) => v.modelo));
    if (distintos.length) r.push({ id: 'costos-receta', nivel: 'info', modulo: 'costos', titulo: `El costo de ${pl(modelosDistintos.size, 'modelo', 'modelos')} no coincide con su receta`, detalle: 'Pasa cuando cambia el precio de un material. Revisalo en Recetas y costeo.', enlace: '/costeo', cantidad: distintos.length });
    const matPend = [...new Set(desact.flatMap((v) => v.pendientes))];
    if (matPend.length) r.push({ id: 'materiales-sin-costo', nivel: 'atencion', modulo: 'costos', titulo: matPend.length === 1 ? `Falta el costo de ${matPend[0]}, que se usa en recetas` : `Falta el costo de ${matPend.length} materiales que se usan en recetas`, detalle: matPend.length === 1 ? 'Mientras no tenga costo no se pueden aplicar los costos de esas recetas.' : matPend.join(', '), enlace: '/materiales', cantidad: matPend.length });
    const bajoCosto = contar(sql`select count(*) as n from venta_items i join ventas v on v.id = i.venta_id where v.estado = 'confirmada' and v.fecha >= ${sumarDias(hoy, -30)} and i.costo_unitario_centavos is not null and i.precio_centavos < i.costo_unitario_centavos`);
    if (bajoCosto) r.push({ id: 'venta-bajo-costo', nivel: 'atencion', modulo: 'costos', titulo: `${pl(bajoCosto, 'producto vendido', 'productos vendidos')} por debajo del costo en los últimos 30 días`, enlace: '/reportes?vista=productos', cantidad: bajoCosto });
  }
  if (puede('precios')) {
    const sinPrecio = contar(sql`select count(*) as n from variantes v join modelos m on m.id = v.modelo_id where v.activo = 1 and m.activo = 1 and not exists (select 1 from precios p where p.variante_id = v.id)`);
    if (sinPrecio) r.push({ id: 'sin-precio', nivel: 'atencion', modulo: 'precios', titulo: `${pl(sinPrecio, 'producto', 'productos')} sin precio`, enlace: '/catalogo', cantidad: sinPrecio });
  }
  if (puede('caja')) {
    const cuentas = listarCuentas(db).filter((c) => c.activo);
    for (const c of cuentas.filter((c) => c.tipo !== 'externa' && c.saldoCentavos < 0)) {
      r.push({ id: `cuenta-negativa-${c.id}`, nivel: 'critico', modulo: 'caja', titulo: `${c.nombre} tiene saldo negativo`, detalle: 'Falta cargar un ingreso o hay un movimiento de más.', enlace: `/caja?cuenta=${c.id}` });
    }
    for (const c of cuentas.filter((c) => c.tipo === 'a_liquidar' && c.saldoCentavos > 0)) {
      const ultLiq = db.get<{ f: string | null }>(sql`select max(fecha) as f from movimientos_caja where cuenta_id = ${c.id} and tipo = 'liquidacion'`)?.f ?? '0000-00-00';
      const primera = db.get<{ f: string | null }>(sql`select min(fecha) as f from movimientos_caja where cuenta_id = ${c.id} and tipo = 'venta' and fecha > ${ultLiq}`)?.f;
      if (primera && diasEntre(primera, hoy) > cfg.diasLiquidacion) {
        r.push({ id: `liquidar-${c.id}`, nivel: 'atencion', modulo: 'caja', titulo: `Hay cobros en ${c.nombre} sin liquidar desde el ${primera.split('-').reverse().join('/')}`, detalle: 'Cargá la liquidación para registrar la comisión real.', enlace: '/caja' });
      }
    }
    for (const c of cuentas.filter((c) => c.tipo === 'efectivo' && c.movimientos > 0)) {
      const ult = db.get<{ f: string | null }>(sql`select max(fecha) as f from arqueos where cuenta_id = ${c.id}`)?.f;
      if (!ult || diasEntre(ult.slice(0, 10), hoy) > cfg.diasArqueo) {
        r.push({ id: `arqueo-${c.id}`, nivel: 'info', modulo: 'caja', titulo: ult ? `Último arqueo de ${c.nombre} hace ${diasEntre(ult.slice(0, 10), hoy)} días` : `Nunca se hizo un arqueo de ${c.nombre}`, detalle: 'Contar la plata y cargarla detecta diferencias a tiempo.', enlace: '/caja' });
      }
    }
    const deuda = [...saldosProveedores(db).values()].filter((s) => s.saldoCentavos > 0);
    if (deuda.length) {
      const total = deuda.reduce((s, d) => s + d.saldoCentavos, 0);
      r.push({ id: 'deuda-proveedores', nivel: 'info', modulo: 'caja', titulo: deuda.length === 1 ? 'Hay deuda con 1 proveedor' : `Hay deuda con ${deuda.length} proveedores`, detalle: `Total ${(total / 100).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })}`, enlace: '/pagos', cantidad: deuda.length });
    }
  }
  if (puede('configuracion') && !leerConfig(db, 'cotizaciones').usdCentavos) {
    r.push({ id: 'cotizacion', nivel: 'atencion', modulo: 'configuracion', titulo: 'La cotización del dólar está pendiente', detalle: 'Sin ella no se muestra el "≈ USD" ni se pueden pasar dólares a pesos.', enlace: '/configuracion' });
  }
  if (puede('backups') && extra.ultimoBackup !== undefined) {
    if (!extra.ultimoBackup) r.push({ id: 'backup', nivel: 'critico', modulo: 'backups', titulo: 'Todavía no hay ninguna copia de seguridad', enlace: '/backups' });
    else if (diasEntre(extra.ultimoBackup.slice(0, 10), hoy) > cfg.diasBackup) r.push({ id: 'backup', nivel: 'critico', modulo: 'backups', titulo: `La última copia de seguridad es del ${extra.ultimoBackup.slice(0, 10).split('-').reverse().join('/')}`, detalle: 'Revisá que el sistema esté prendido y la carpeta de copias exista.', enlace: '/backups' });
  }
  const orden: Record<NivelAlerta, number> = { critico: 0, atencion: 1, info: 2 };
  return r.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
}
