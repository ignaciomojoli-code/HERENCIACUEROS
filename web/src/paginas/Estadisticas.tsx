import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../api';
import { useSesion } from '../sesion';
import { Cargando, ErrorCarga } from '../componentes/ui';
import { BarraHorizontal } from '../componentes/GraficoBarras';
import { pesos } from '../formato';
import { NOMBRE_TIPO_CAJA } from '../plata';
import { Tarjeta } from './Ventas';
import { periodos } from './Inicio';

interface Plata {
  desde: string; hasta: string;
  facturado: { ventas: number; unidades: number; totalCentavos: number; comisionCentavos: number };
  cobro: { cobradoCentavos: number; aLiquidarCentavos: number; pendienteCentavos: number };
  flujo: { entradas: { tipo: string; importeCentavos: number }[]; salidas: { tipo: string; importeCentavos: number }[]; ajustesCentavos: number; netoCentavos: number; gastosDelLocalCentavos: number };
  disponible: { totalCentavos: number; aLiquidarCentavos: number; cuentas: { id: number; nombre: string; moneda: string; saldoCentavos: number; saldoArsCentavos: number }[] };
}
interface Situacion {
  productos: { unidades: number; valorCostoCentavos?: number; unidadesSinCosto?: number; variantesNegativas: number; porCategoria: { categoria: string; unidades: number; valorCentavos?: number; sinCosto?: number }[] };
  materiales: { valorCentavos?: number; sinConteo: number; enTalleres: { lugar: string; valorCentavos?: number }[] };
  deudas: null | { proveedoresCentavos: number; proveedores: { proveedorId: number; proveedor: string; saldoCentavos: number }[]; clientesCentavos: number; clientes: { clienteId: number; cliente: string; saldoCentavos: number }[]; ventasSinClienteCentavos: number };
  compras: { pedidosPorRecibir: number; porRecibirCentavos?: number };
  produccion: { pedidos: number; camperasEncargadas: number; camperasEntregadas: number; materialesSinEntregar: number };
}

/** Colores de las tres partes de lo facturado (paleta validada contra el fondo crema). */
const C = { enCuenta: '#A65A2E', aLiquidar: '#2F6F9F', falta: '#7A8C2E' };

type Props = { params: URLSearchParams; fijar: (k: Record<string, string>) => void };

function Periodo({ params, fijar }: Props) {
  const ps = periodos();
  const clave = params.get('periodo') ?? 'mes';
  const el = ps.find((p) => p.clave === clave);
  const desde = el?.desde ?? params.get('desde') ?? ps[2].desde;
  const hasta = el?.hasta ?? params.get('hasta') ?? ps[2].hasta;
  return {
    desde, hasta,
    selector: (
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {ps.map((x) => <button key={x.clave} className={`rounded-full border px-3 py-1 text-sm ${x.clave === clave ? 'border-carbon bg-carbon text-crema' : 'border-arena hover:border-carbon/50'}`} onClick={() => fijar({ periodo: x.clave, desde: '', hasta: '' })}>{x.texto}</button>)}
        <div className="flex items-center gap-1 text-sm">
          <input className="entrada !w-auto py-1" type="date" value={desde} max={hasta} onChange={(e) => fijar({ periodo: 'otro', desde: e.target.value, hasta })} aria-label="Desde" />
          <span className="text-carbon/50">a</span>
          <input className="entrada !w-auto py-1" type="date" value={hasta} min={desde} onChange={(e) => fijar({ periodo: 'otro', desde, hasta: e.target.value })} aria-label="Hasta" />
        </div>
      </div>
    ),
  };
}

/** Lo facturado separado de lo cobrado y de la plata que hay hoy en las cuentas. */
export function VistaPlata(props: Props) {
  const { desde, hasta, selector } = Periodo(props);
  const q = useQuery({ queryKey: ['estadisticas-plata', desde, hasta], queryFn: () => api.get<Plata>('/estadisticas/plata' + qs({ desde, hasta })) });
  const d = q.data;
  const enCuenta = d ? Math.max(0, d.cobro.cobradoCentavos - d.cobro.aLiquidarCentavos) : 0;
  const partes = d ? [
    { clave: 'enCuenta', texto: 'Cobrado y en cuenta', valor: enCuenta, color: C.enCuenta },
    { clave: 'aLiquidar', texto: 'Cobrado con tarjeta, a liquidar', valor: d.cobro.aLiquidarCentavos, color: C.aLiquidar },
    { clave: 'falta', texto: 'Falta cobrar', valor: d.cobro.pendienteCentavos, color: C.falta },
  ] : [];
  const totalPartes = partes.reduce((s, p) => s + p.valor, 0);
  return (
    <>
      {selector}
      {q.isLoading ? <Cargando /> : q.isError ? <ErrorCarga error={q.error} /> : d && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tarjeta titulo="Facturado (vendido)" valor={pesos(d.facturado.totalCentavos)} sub={`${d.facturado.ventas} ventas · ${d.facturado.unidades} unidades`} />
            <Tarjeta titulo="Cobrado de esas ventas" valor={pesos(d.cobro.cobradoCentavos)} sub={d.cobro.pendienteCentavos > 0 ? `Falta cobrar ${pesos(d.cobro.pendienteCentavos)}` : 'Todo cobrado'} />
            <Tarjeta titulo="Plata disponible hoy" valor={pesos(d.disponible.totalCentavos)} sub={d.disponible.aLiquidarCentavos ? `Más ${pesos(d.disponible.aLiquidarCentavos)} de tarjetas a liquidar` : 'En las cuentas del local'} />
          </div>

          <div className="tarjeta mt-4 p-4">
            <h2 className="font-bold">Qué pasó con lo facturado</h2>
            <p className="mb-3 text-xs text-carbon/55">Lo vendido en el período, separado en lo que ya está en la cuenta, lo cobrado con tarjeta que todavía no se liquidó y lo que falta cobrar.</p>
            {totalPartes === 0 ? <p className="py-6 text-center text-sm text-carbon/50">No hubo ventas en el período.</p> : (
              <>
                <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded" role="img" aria-label={partes.map((p) => `${p.texto}: ${pesos(p.valor)}`).join('; ')}>
                  {partes.filter((p) => p.valor > 0).map((p) => <div key={p.clave} title={`${p.texto}: ${pesos(p.valor)}`} style={{ width: `${(p.valor / totalPartes) * 100}%`, background: p.color }} />)}
                </div>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                  {partes.map((p) => (
                    <div key={p.clave} className="flex items-start gap-2">
                      <span className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ background: p.color }} />
                      <span><span className="text-carbon/70">{p.texto}</span><br /><b className="tabular-nums">{pesos(p.valor)}</b> <span className="text-xs text-carbon/50">{Math.round((p.valor / totalPartes) * 100)}%</span></span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="tarjeta p-4">
              <h2 className="mb-1 font-bold">Movimiento de plata del período</h2>
              <p className="mb-3 text-xs text-carbon/55">Lo que entró y salió de las cuentas (sin contar pases entre cuentas).</p>
              <div className="etiqueta mb-1">Entró</div>
              {!d.flujo.entradas.length ? <p className="text-sm text-carbon/50">Nada.</p> : d.flujo.entradas.map((x) => <BarraHorizontal key={x.tipo} titulo={NOMBRE_TIPO_CAJA[x.tipo] ?? x.tipo} valor={pesos(x.importeCentavos)} parte={x.importeCentavos} total={Math.max(...d.flujo.entradas.map((e) => e.importeCentavos), ...d.flujo.salidas.map((e) => e.importeCentavos))} />)}
              <div className="etiqueta mb-1 mt-3">Salió</div>
              {!d.flujo.salidas.length ? <p className="text-sm text-carbon/50">Nada.</p> : d.flujo.salidas.map((x) => <BarraHorizontal key={x.tipo} titulo={NOMBRE_TIPO_CAJA[x.tipo] ?? x.tipo} valor={pesos(x.importeCentavos)} parte={x.importeCentavos} total={Math.max(...d.flujo.entradas.map((e) => e.importeCentavos), ...d.flujo.salidas.map((e) => e.importeCentavos))} />)}
              {d.flujo.ajustesCentavos !== 0 && <p className="mt-2 text-xs text-carbon/60">Ajustes de arqueo: {pesos(d.flujo.ajustesCentavos)}</p>}
              <div className="mt-3 flex justify-between border-t border-arena/60 pt-2 text-sm"><span>Saldo del período</span><b className={`tabular-nums ${d.flujo.netoCentavos < 0 ? 'text-bordo' : ''}`}>{pesos(d.flujo.netoCentavos)}</b></div>
            </div>
            <div className="tarjeta p-4">
              <h2 className="mb-1 font-bold">Dónde está la plata hoy</h2>
              <p className="mb-3 text-xs text-carbon/55">Saldo de cada cuenta del local (los dólares, en pesos a la cotización cargada).</p>
              {d.disponible.cuentas.map((c) => <BarraHorizontal key={c.id} titulo={c.nombre} valor={c.moneda === 'ARS' ? pesos(c.saldoArsCentavos) : `${c.moneda} ${(c.saldoCentavos / 100).toLocaleString('es-AR')} · ${pesos(c.saldoArsCentavos)}`} parte={Math.max(0, c.saldoArsCentavos)} total={d.disponible.totalCentavos} />)}
              {d.disponible.aLiquidarCentavos !== 0 && <p className="mt-2 text-xs text-carbon/60">Tarjetas a liquidar (todavía no es plata en la cuenta): {pesos(d.disponible.aLiquidarCentavos)}. <Link className="underline" to="/">Liquidar desde Caja</Link></p>}
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** Foto de hoy: stock, materiales, deudas, compras por recibir y producción. */
export function VistaSituacion() {
  const { puede } = useSesion();
  const q = useQuery({ queryKey: ['estadisticas-situacion'], queryFn: () => api.get<Situacion>('/estadisticas/situacion') });
  const s = q.data;
  if (q.isLoading) return <Cargando />;
  if (q.isError) return <ErrorCarga error={q.error} />;
  if (!s) return null;
  const verValor = s.productos.valorCostoCentavos !== undefined;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tarjeta titulo="Productos en stock" valor={`${s.productos.unidades} u.`} sub={verValor ? `${pesos(s.productos.valorCostoCentavos)} a costo${s.productos.unidadesSinCosto ? ` · ${s.productos.unidadesSinCosto} u. sin costo` : ''}` : undefined} />
        {s.deudas && <Tarjeta titulo="Le debés a proveedores" valor={pesos(s.deudas.proveedoresCentavos)} tono={s.deudas.proveedoresCentavos > 0 ? 'bordo' : undefined} sub={<Link className="underline" to="/pagos">Ver cuentas corrientes</Link>} />}
        {s.deudas && <Tarjeta titulo="Te deben clientes" valor={pesos(s.deudas.clientesCentavos)} sub={<Link className="underline" to="/ventas?saldo=true">Ver ventas con saldo</Link>} />}
        <Tarjeta titulo="Pedidos por recibir" valor={String(s.compras.pedidosPorRecibir)} sub={s.compras.porRecibirCentavos !== undefined ? `${pesos(s.compras.porRecibirCentavos)} a costo de pedido` : undefined} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="tarjeta p-4">
          <h2 className="mb-3 font-bold">Stock por categoría</h2>
          {!s.productos.porCategoria.length ? <p className="text-sm text-carbon/50">Sin stock.</p> : s.productos.porCategoria.map((c) => (
            <BarraHorizontal key={c.categoria} titulo={c.categoria} valor={verValor ? pesos(c.valorCentavos) : `${c.unidades} u.`} parte={verValor ? c.valorCentavos ?? 0 : c.unidades} total={verValor ? s.productos.valorCostoCentavos ?? 0 : s.productos.unidades} sub={`${c.unidades} unidades${c.sinCosto ? `, ${c.sinCosto} sin costo` : ''}`} />
          ))}
          {s.productos.variantesNegativas > 0 && <p className="mt-2 text-xs text-bordo">{s.productos.variantesNegativas} productos con stock negativo: conviene contarlos.</p>}
        </div>
        <div className="tarjeta p-4">
          <h2 className="mb-3 font-bold">Materiales y producción</h2>
          {verValor && <div className="mb-2 flex justify-between text-sm"><span>Materiales (valor a costo)</span><b className="tabular-nums">{pesos(s.materiales.valorCentavos)}</b></div>}
          {s.materiales.enTalleres.map((t) => <div key={t.lugar} className="mb-1 flex justify-between text-sm text-carbon/70"><span>En {t.lugar}</span>{t.valorCentavos !== undefined && <span className="tabular-nums">{pesos(t.valorCentavos)}</span>}</div>)}
          {s.materiales.sinConteo > 0 && <p className="mb-2 text-xs text-carbon/60">{s.materiales.sinConteo} materiales sin stock contado.</p>}
          <div className="mt-3 border-t border-arena/60 pt-3 text-sm">
            <div className="flex justify-between"><span>Pedidos al taller en curso</span><b>{s.produccion.pedidos}</b></div>
            <div className="flex justify-between"><span>Camperas encargadas / entregadas</span><b>{s.produccion.camperasEncargadas} / {s.produccion.camperasEntregadas}</b></div>
            {s.produccion.materialesSinEntregar > 0 && <div className="flex justify-between text-conac"><span>Materiales que faltan llevar</span><b>{s.produccion.materialesSinEntregar}</b></div>}
            {puede('materiales') && <Link className="mt-2 inline-block text-xs underline" to="/produccion">Ver producción y custodia</Link>}
          </div>
        </div>
        {s.deudas && (
          <div className="tarjeta p-4">
            <h2 className="mb-3 font-bold">Deudas</h2>
            <div className="etiqueta mb-1">Con proveedores</div>
            {!s.deudas.proveedores.length ? <p className="text-sm text-carbon/50">Ninguna.</p> : s.deudas.proveedores.slice(0, 6).map((p) => (
              <div key={p.proveedorId} className="flex justify-between text-sm"><Link className="hover:underline" to={`/pagos?proveedor=${p.proveedorId}`}>{p.proveedor}</Link><span className={`tabular-nums ${p.saldoCentavos < 0 ? 'text-carbon/50' : ''}`}>{pesos(p.saldoCentavos)}{p.saldoCentavos < 0 && ' a favor'}</span></div>
            ))}
            <div className="etiqueta mb-1 mt-3">Clientes</div>
            {!s.deudas.clientes.length && !s.deudas.ventasSinClienteCentavos ? <p className="text-sm text-carbon/50">Ninguna.</p> : <>
              {s.deudas.clientes.slice(0, 6).map((c) => <div key={c.clienteId} className="flex justify-between text-sm"><span>{c.cliente}</span><span className="tabular-nums">{pesos(c.saldoCentavos)}</span></div>)}
              {s.deudas.ventasSinClienteCentavos > 0 && <div className="flex justify-between text-sm text-carbon/70"><span>Ventas sin cliente asignado</span><span className="tabular-nums">{pesos(s.deudas.ventasSinClienteCentavos)}</span></div>}
            </>}
          </div>
        )}
      </div>
    </>
  );
}
