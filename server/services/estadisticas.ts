/**
 * Estadísticas generales (etapa 7). Todo sale de los libros en el momento, igual que el resto de los reportes.
 *
 * - plata(): lo FACTURADO (vendido) separado de lo COBRADO y de la plata DISPONIBLE hoy en las cuentas.
 *   Lo cobrado con tarjeta queda "a liquidar" hasta que entra a la cuenta: no es plata disponible.
 * - situacion(): foto de hoy: stock valorizado (a costo), materiales (en el local y en talleres),
 *   deudas con proveedores, lo que deben los clientes, pedidos por recibir y producción en curso.
 */
import { sql } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { totalesVentas, totalGastos } from './reportes.js';
import { listarCuentas, resumenCaja } from './caja.js';
import { saldosProveedores } from './gastos.js';
import { listarClientes } from './clientes.js';
import { listarCompras } from './compras.js';
import { listarMateriales } from './costos.js';
import { produccionEnCurso, resumenCustodia } from './custodia.js';
import { stockDe } from './stock.js';

const n = (x: unknown) => Number(x ?? 0);

/** Tipos de movimiento de caja que son plata que entra o sale del negocio (los pases entre cuentas no cuentan). */
const ENTRADAS = ['venta', 'aporte', 'saldo_inicial'] as const;
const SALIDAS = ['gasto', 'pago_proveedor', 'retiro', 'comision'] as const;

export function plata(db: DB, desde: string, hasta: string) {
  const t = totalesVentas(db, desde, hasta);
  // De lo vendido en el período: cuánto se cobró y cuánto falta.
  const cobros = db.get<{ cobrado: number; aLiquidar: number }>(sql`
    select coalesce(sum(p.importe_centavos), 0) as cobrado,
      coalesce(sum(case when c.tipo = 'a_liquidar' and p.liquidacion is null then p.importe_centavos end), 0) as aLiquidar
    from venta_pagos p join ventas v on v.id = p.venta_id join cuentas c on c.id = p.cuenta_id
    where p.estado = 'activo' and v.estado = 'confirmada' and v.fecha between ${desde} and ${hasta}`)!;
  const cobrado = n(cobros.cobrado);
  // Movimientos de caja del período, por tipo (en pesos). Las anulaciones se restan de su tipo original.
  const porTipo = db.all<{ tipo: string; total: number }>(sql`
    select coalesce(o.tipo, m.tipo) as tipo, sum(m.importe_ars_centavos) as total
    from movimientos_caja m left join movimientos_caja o on o.id = m.anula_id
    where m.fecha between ${desde} and ${hasta} group by coalesce(o.tipo, m.tipo)`);
  const tipo = (k: string) => n(porTipo.find((x) => x.tipo === k)?.total);
  const cuentas = listarCuentas(db).filter((c) => c.activo || c.saldoCentavos !== 0);
  const disponibles = cuentas.filter((c) => c.tipo !== 'externa' && c.tipo !== 'a_liquidar');
  const aLiquidarHoy = cuentas.filter((c) => c.tipo === 'a_liquidar').reduce((s, c) => s + c.saldoArsCentavos, 0);
  return {
    desde, hasta,
    facturado: { ventas: t.ventas, unidades: t.unidades, totalCentavos: t.totalCentavos, comisionCentavos: t.comisionCentavos },
    cobro: {
      cobradoCentavos: cobrado,
      // Cobrado con tarjeta y todavía no liquidado: está vendido y cobrado, pero no es plata en la cuenta.
      aLiquidarCentavos: n(cobros.aLiquidar),
      pendienteCentavos: Math.max(0, t.totalCentavos - cobrado),
    },
    flujo: {
      entradas: ENTRADAS.map((k) => ({ tipo: k, importeCentavos: tipo(k) })).filter((x) => x.importeCentavos !== 0),
      salidas: SALIDAS.map((k) => ({ tipo: k, importeCentavos: -tipo(k) })).filter((x) => x.importeCentavos !== 0),
      ajustesCentavos: tipo('ajuste'),
      netoCentavos: [...ENTRADAS, ...SALIDAS, 'ajuste'].reduce((s, k) => s + tipo(k), 0),
      gastosDelLocalCentavos: totalGastos(db, desde, hasta),
    },
    disponible: {
      totalCentavos: disponibles.reduce((s, c) => s + c.saldoArsCentavos, 0),
      aLiquidarCentavos: aLiquidarHoy,
      cuentas: disponibles.map((c) => ({ id: c.id, nombre: c.nombre, moneda: c.moneda, saldoCentavos: c.saldoCentavos, saldoArsCentavos: c.saldoArsCentavos })),
    },
    resumenCaja: resumenCaja(db, desde, hasta),
  };
}

export function situacion(db: DB) {
  // Productos terminados: unidades y valor a costo (los que no tienen costo se cuentan aparte, sin inventar).
  const stock = stockDe(db);
  const vars = db.all<{ id: number; costo: number | null; categoria: string; activo: number }>(sql`
    select va.id, va.costo_centavos as costo, c.nombre as categoria, va.activo from variantes va join modelos m on m.id = va.modelo_id join categorias c on c.id = m.categoria_id`);
  const porCat = new Map<string, { unidades: number; valorCentavos: number; sinCosto: number }>();
  let unidades = 0, valor = 0, sinCosto = 0, negativos = 0;
  for (const v of vars) {
    const q = stock.get(v.id) ?? 0;
    if (q < 0) negativos++;
    if (q <= 0) continue;
    const c = porCat.get(v.categoria) ?? { unidades: 0, valorCentavos: 0, sinCosto: 0 };
    c.unidades += q; unidades += q;
    if (v.costo === null) { c.sinCosto += q; sinCosto += q; } else { c.valorCentavos += q * v.costo; valor += q * v.costo; }
    porCat.set(v.categoria, c);
  }
  // Materiales: valor del stock positivo al costo vigente; dónde está (local / talleres).
  const mats = listarMateriales(db).filter((m) => m.tipo === 'material');
  const custodia = resumenCustodia(db);
  const valorMat = (mil: number, costo: number | null) => (costo === null || mil <= 0 ? 0 : Math.round((mil * costo) / 1000));
  const enTalleres = custodia.lugares.map((l) => ({
    lugar: l.ubicacion,
    valorCentavos: custodia.materiales.reduce((s, m) => s + valorMat(m.otros.find((o) => o.ubicacionProveedorId === l.ubicacionProveedorId)?.cantidadMil ?? 0, mats.find((x) => x.id === m.materialId)?.costoCentavos ?? null), 0),
  }));
  // Deudas.
  const provNombres = new Map(db.all<{ id: number; nombre: string }>(sql`select id, nombre from proveedores`).map((p) => [p.id, p.nombre]));
  const deudaProv = [...saldosProveedores(db).entries()].filter(([, s]) => s.saldoCentavos !== 0)
    .map(([id, s]) => ({ proveedorId: id, proveedor: provNombres.get(id) ?? '?', saldoCentavos: s.saldoCentavos })).sort((a, b) => b.saldoCentavos - a.saldoCentavos);
  const clientes = listarClientes(db).filter((c) => c.saldoCentavos > 0).map((c) => ({ clienteId: c.id, cliente: c.nombre, saldoCentavos: c.saldoCentavos })).sort((a, b) => b.saldoCentavos - a.saldoCentavos);
  const sinCliente = n(db.get<{ s: number }>(sql`
    select coalesce(sum(s), 0) as s from (select (select coalesce(sum(vi.cantidad * vi.precio_centavos), 0) from venta_items vi where vi.venta_id = v.id) - v.descuento_centavos
      - (select coalesce(sum(vp.importe_centavos), 0) from venta_pagos vp where vp.venta_id = v.id and vp.estado = 'activo') as s
      from ventas v where v.estado = 'confirmada' and v.cliente_id is null) where s > 0`)!.s);
  const pendientes = listarCompras(db, { pendientes: true }).filter((c) => c.estado === 'confirmada');
  const prod = produccionEnCurso(db);
  return {
    productos: {
      unidades, valorCostoCentavos: valor, unidadesSinCosto: sinCosto, variantesNegativas: negativos,
      porCategoria: [...porCat.entries()].map(([categoria, c]) => ({ categoria, ...c })).sort((a, b) => b.valorCentavos - a.valorCentavos),
    },
    materiales: {
      valorCentavos: mats.reduce((s, m) => s + valorMat(m.stockMil ?? 0, m.costoCentavos), 0),
      sinConteo: mats.filter((m) => m.activo && (m.stockMil ?? 0) <= 0).length,
      enTalleres,
    },
    deudas: {
      proveedoresCentavos: deudaProv.filter((d) => d.saldoCentavos > 0).reduce((s, d) => s + d.saldoCentavos, 0),
      proveedores: deudaProv,
      clientesCentavos: clientes.reduce((s, c) => s + c.saldoCentavos, 0) + sinCliente,
      clientes, ventasSinClienteCentavos: sinCliente,
    },
    compras: {
      pedidosPorRecibir: pendientes.filter((c) => c.estadoPedido !== 'entregado').length,
      // Lo pedido que falta llegar, valorizado al costo del pedido.
      porRecibirCentavos: pendientes.reduce((s, c) => s + Math.max(0, c.totalCentavos - c.recibidoCentavos), 0),
    },
    produccion: {
      pedidos: prod.length,
      camperasEncargadas: prod.reduce((s, p) => s + p.pedidas, 0),
      camperasEntregadas: prod.reduce((s, p) => s + p.recibidas, 0),
      materialesSinEntregar: prod.reduce((s, p) => s + p.faltaEntregar, 0),
    },
  };
}
