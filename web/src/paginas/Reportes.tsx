import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api, qs } from '../api';
import { useSesion } from '../sesion';
import { Cargando, Encabezado, ErrorCarga, Vacio } from '../componentes/ui';
import { pct, pesos } from '../formato';
import { hoy } from '../plata';
import { VistaPlata, VistaSituacion } from './Estadisticas';
import { VistaCobros } from './ReporteCobros';

interface FilaResultado {
  mes: string; ventasCentavos: number; costoCentavos: number; comisionesCentavos: number; ventasSinCostoCentavos: number; gananciaBrutaCentavos: number;
  gastos: Record<string, number>; gastosCentavos: number; resultadoCentavos: number; retirosCentavos: number; aportesCentavos: number; ventas: number; unidades: number;
}
interface Producto { modeloId: number; modelo: string; categoria: string; unidades: number; totalCentavos: number; costoCentavos?: number; gananciaBrutaCentavos?: number; margenBrutoBp?: number | null; sinCosto?: boolean; stock: number }
interface Quieto { modeloId: number; modelo: string; categoria: string; stock: number; valorCostoCentavos?: number | null; ultimaVenta: string | null; diasSinVenta: number | null }

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export function PaginaReportes() {
  const { puede } = useSesion();
  const [params, setParams] = useSearchParams();
  const vistas = [
    ...(puede('ventas') && puede('caja') ? [{ clave: 'plata', texto: 'Facturado y plata' }] : []),
    ...(puede('caja') ? [{ clave: 'cobros', texto: 'Cobros y comisiones' }] : []),
    { clave: 'situacion', texto: 'Situación de hoy' },
    ...(puede('costos') && puede('gastos') ? [{ clave: 'resultados', texto: 'Estado de resultados' }] : []),
    ...(puede('ventas') ? [{ clave: 'productos', texto: 'Ventas por producto' }] : []),
    ...(puede('stock') ? [{ clave: 'quietos', texto: 'Stock sin movimiento' }] : []),
  ];
  const vista = vistas.find((v) => v.clave === params.get('vista'))?.clave ?? vistas[0]?.clave;
  const fijar = (k: Record<string, string>) => { const p = new URLSearchParams(params); Object.entries(k).forEach(([a, b]) => (b ? p.set(a, b) : p.delete(a))); setParams(p, { replace: true }); };
  return (
    <>
      <Encabezado titulo="Estadísticas" sub="Calculadas en el momento con lo cargado en el sistema. Las tablas se pueden bajar a Excel." />
      <div className="mb-4 flex flex-wrap gap-2 border-b border-arena/70">
        {vistas.map((v) => <button key={v.clave} onClick={() => fijar({ vista: v.clave })} className={`-mb-px border-b-2 px-3 py-2 text-sm ${v.clave === vista ? 'border-conac font-semibold' : 'border-transparent text-carbon/60 hover:text-carbon'}`}>{v.texto}</button>)}
      </div>
      {!vistas.length && <Vacio>Tu rol no tiene reportes disponibles.</Vacio>}
      {vista === 'plata' && <VistaPlata params={params} fijar={fijar} />}
      {vista === 'cobros' && <VistaCobros params={params} fijar={fijar} />}
      {vista === 'situacion' && <VistaSituacion />}
      {vista === 'resultados' && <Resultados params={params} fijar={fijar} />}
      {vista === 'productos' && <Productos params={params} fijar={fijar} />}
      {vista === 'quietos' && <Quietos params={params} fijar={fijar} />}
    </>
  );
}

type Props = { params: URLSearchParams; fijar: (k: Record<string, string>) => void };

function Resultados({ params, fijar }: Props) {
  const { puede } = useSesion();
  const h = hoy().slice(0, 7);
  const hasta = params.get('mhasta') ?? h;
  const desde = params.get('mdesde') ?? (() => { const [a, m] = hasta.split('-').map(Number); return m >= 6 ? `${a}-${String(m - 5).padStart(2, '0')}` : `${a - 1}-${String(m + 7).padStart(2, '0')}`; })();
  const q = useQuery({ queryKey: ['resultados', desde, hasta], queryFn: () => api.get<{ meses: string[]; categoriasGasto: string[]; filas: FilaResultado[] }>('/reportes/resultados' + qs({ desde, hasta })) });
  const d = q.data;
  const fila = (titulo: string, f: (x: FilaResultado) => number, o: { fuerte?: boolean; sub?: boolean; signo?: -1 } = {}) => {
    const vals = d!.filas.map((x) => f(x) * (o.signo ?? 1));
    const total = vals.reduce((s, v) => s + v, 0);
    if (o.sub && total === 0) return null;
    return (
      <tr key={titulo} className={o.fuerte ? 'bg-arena/20 font-semibold' : ''}>
        <td className={`sticky left-0 bg-inherit ${o.sub ? 'pl-6 text-carbon/70' : ''}`}>{titulo}</td>
        {vals.map((v, i) => <td key={d!.meses[i]} className={`num ${v < 0 && o.fuerte ? 'text-bordo' : ''}`}>{v === 0 ? '—' : pesos(v)}</td>)}
        <td className={`num font-semibold ${total < 0 && o.fuerte ? 'text-bordo' : ''}`}>{total === 0 ? '—' : pesos(total)}</td>
      </tr>
    );
  };
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-sm">Desde <input className="entrada !w-auto" type="month" value={desde} max={hasta} onChange={(e) => fijar({ mdesde: e.target.value })} /></label>
        <label className="text-sm">Hasta <input className="entrada !w-auto" type="month" value={hasta} min={desde} onChange={(e) => fijar({ mhasta: e.target.value })} /></label>
        {puede('panel', 'exportar') && <a className="btn-secundario ml-auto" href={'/api/reportes/resultados/exportar' + qs({ desde, hasta })}><Download className="h-4 w-4" />Excel</a>}
      </div>
      {q.isLoading ? <Cargando /> : q.isError ? <ErrorCarga error={q.error} /> : (
        <>
          <div className="tarjeta overflow-x-auto">
            <table className="tabla text-sm">
              <thead><tr><th className="sticky left-0 bg-inherit">Concepto</th>{d!.meses.map((m) => <th key={m} className="num">{nombreMes(m)}</th>)}<th className="num">Total</th></tr></thead>
              <tbody>
                {fila('Ventas', (x) => x.ventasCentavos, { fuerte: true })}
                {fila('Costo de la mercadería', (x) => x.costoCentavos, { signo: -1, sub: true })}
                {fila('Comisiones de cobro', (x) => x.comisionesCentavos, { signo: -1, sub: true })}
                {fila('Ventas de productos sin costo', (x) => x.ventasSinCostoCentavos, { signo: -1, sub: true })}
                {fila('Ganancia bruta', (x) => x.gananciaBrutaCentavos, { fuerte: true })}
                {d!.categoriasGasto.map((c) => fila(c, (x) => x.gastos[c] ?? 0, { signo: -1, sub: true }))}
                {fila('Resultado', (x) => x.resultadoCentavos, { fuerte: true })}
                {fila('Retiros personales', (x) => x.retirosCentavos, { signo: -1, sub: true })}
                {fila('Aportes', (x) => x.aportesCentavos, { sub: true })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-carbon/55">
            Ganancia bruta = ventas − costo de lo vendido − comisiones. Lo vendido sin costo cargado se resta para no inflar la ganancia. Resultado = ganancia bruta − gastos del local.
            Retiros y aportes se muestran aparte: no son gastos ni ingresos del negocio.
          </p>
        </>
      )}
    </>
  );
}

function RangoFechas({ params, fijar }: Props) {
  const h = hoy();
  return (
    <>
      <input className="entrada !w-auto" type="date" value={params.get('desde') ?? `${h.slice(0, 7)}-01`} onChange={(e) => fijar({ desde: e.target.value })} aria-label="Desde" />
      <span className="self-center text-sm text-carbon/50">a</span>
      <input className="entrada !w-auto" type="date" value={params.get('hasta') ?? h} onChange={(e) => fijar({ hasta: e.target.value })} aria-label="Hasta" />
    </>
  );
}

function Productos({ params, fijar }: Props) {
  const { puede } = useSesion();
  const h = hoy();
  const desde = params.get('desde') ?? `${h.slice(0, 7)}-01`, hasta = params.get('hasta') ?? h;
  const orden = params.get('orden') ?? 'total';
  const q = useQuery({ queryKey: ['reporte-productos', desde, hasta], queryFn: () => api.get<Producto[]>('/reportes/productos' + qs({ desde, hasta })) });
  const conCostos = q.data?.[0]?.gananciaBrutaCentavos !== undefined;
  const filas = [...(q.data ?? [])].sort((a, b) => orden === 'unidades' ? b.unidades - a.unidades : orden === 'ganancia' ? (b.gananciaBrutaCentavos ?? 0) - (a.gananciaBrutaCentavos ?? 0) : orden === 'margen' ? (b.margenBrutoBp ?? -1e9) - (a.margenBrutoBp ?? -1e9) : b.totalCentavos - a.totalCentavos);
  const total = filas.reduce((s, f) => s + f.totalCentavos, 0);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <RangoFechas params={params} fijar={fijar} />
        <select className="entrada !w-auto" value={orden} onChange={(e) => fijar({ orden: e.target.value })} aria-label="Ordenar por">
          <option value="total">Más vendido en plata</option><option value="unidades">Más unidades</option>
          {conCostos && <><option value="ganancia">Más ganancia</option><option value="margen">Mejor margen</option></>}
        </select>
        {puede('panel', 'exportar') && <a className="btn-secundario ml-auto" href={'/api/reportes/productos/exportar' + qs({ desde, hasta })}><Download className="h-4 w-4" />Excel</a>}
      </div>
      {q.isLoading ? <Cargando /> : q.isError ? <ErrorCarga error={q.error} /> : !filas.length ? <Vacio>No hubo ventas en este período.</Vacio> : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla text-sm">
            <thead><tr><th>Producto</th><th className="hidden sm:table-cell">Categoría</th><th className="num">Unidades</th><th className="num">Ventas</th><th className="num hidden md:table-cell">% del total</th>
              {conCostos && <><th className="num">Ganancia</th><th className="num">Margen</th></>}<th className="num">Stock</th></tr></thead>
            <tbody>{filas.map((f) => (
              <tr key={f.modeloId}>
                <td><Link className="hover:underline" to={`/catalogo/${f.modeloId}`}>{f.modelo}</Link></td><td className="hidden sm:table-cell">{f.categoria}</td>
                <td className="num">{f.unidades}</td><td className="num">{pesos(f.totalCentavos)}</td><td className="num hidden md:table-cell">{total ? pct(Math.round((f.totalCentavos / total) * 10000)) : '—'}</td>
                {conCostos && <><td className={`num ${(f.gananciaBrutaCentavos ?? 0) < 0 ? 'text-bordo' : ''}`}>{pesos(f.gananciaBrutaCentavos)}{f.sinCosto && <span title="Parte de lo vendido no tenía costo" className="text-bordo">*</span>}</td>
                  <td className="num">{f.margenBrutoBp == null ? '—' : pct(f.margenBrutoBp)}</td></>}
                <td className={`num ${f.stock <= 0 ? 'text-bordo' : ''}`}>{f.stock}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {conCostos && filas.some((f) => f.sinCosto) && <p className="mt-2 text-xs text-carbon/55">* Parte de lo vendido no tenía costo cargado: esa parte no suma ganancia.</p>}
    </>
  );
}

function Quietos({ params, fijar }: Props) {
  const dias = params.get('dias') ?? '';
  const q = useQuery({ queryKey: ['sin-movimiento', dias], queryFn: () => api.get<Quieto[]>('/reportes/sin-movimiento' + qs({ dias })) });
  const conValor = q.data?.[0]?.valorCostoCentavos !== undefined;
  const totalValor = (q.data ?? []).reduce((s, x) => s + (x.valorCostoCentavos ?? 0), 0);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        Productos con stock que no se venden hace más de
        <select className="entrada !w-auto" value={dias} onChange={(e) => fijar({ dias: e.target.value })} aria-label="Días">
          <option value="">lo configurado</option>{[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} días</option>)}
        </select>
      </div>
      {q.isLoading ? <Cargando /> : q.isError ? <ErrorCarga error={q.error} /> : !q.data!.length ? <Vacio>Todo lo que tiene stock se vendió en ese plazo.</Vacio> : (
        <>
          {conValor && <p className="mb-2 text-sm">Hay <b>{pesos(totalValor)}</b> al costo en {q.data!.length} productos quietos.</p>}
          <div className="tarjeta overflow-x-auto">
            <table className="tabla text-sm">
              <thead><tr><th>Producto</th><th className="hidden sm:table-cell">Categoría</th><th className="num">Stock</th>{conValor && <th className="num">Valor al costo</th>}<th className="num">Última venta</th></tr></thead>
              <tbody>{q.data!.map((x) => (
                <tr key={x.modeloId}><td><Link className="hover:underline" to={`/catalogo/${x.modeloId}`}>{x.modelo}</Link></td><td className="hidden sm:table-cell">{x.categoria}</td><td className="num">{x.stock}</td>
                  {conValor && <td className="num">{x.valorCostoCentavos == null ? '—' : pesos(x.valorCostoCentavos)}</td>}
                  <td className="num">{x.ultimaVenta ? `${x.ultimaVenta.split('-').reverse().join('/')} (${x.diasSinVenta} días)` : 'Nunca en el sistema'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
