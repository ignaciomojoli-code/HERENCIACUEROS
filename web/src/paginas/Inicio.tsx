import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, AlertTriangle, ChevronRight, Info } from 'lucide-react';
import { api, qs } from '../api';
import { useSesion } from '../sesion';
import type { ModeloResumen } from '../tipos';
import { Encabezado, ErrorCarga } from '../componentes/ui';
import { BarraHorizontal, GraficoBarras } from '../componentes/GraficoBarras';
import { fechaHora, pct, pesos } from '../formato';
import { hoy, useCuentas } from '../plata';

interface Totales {
  ventas: number; unidades: number; totalCentavos: number; costoCentavos?: number; comisionCentavos: number; gananciaCentavos?: number;
  unidadesSinCosto?: number; ventasSinCostoCentavos?: number; gastosCentavos?: number; resultadoCentavos?: number; ticketPromedioCentavos: number;
}
export interface Panel {
  desde: string; hasta: string; anterior: { desde: string; hasta: string }; actual: Totales; previo: Totales;
  porDia: { fecha: string; totalCentavos: number; ventas: number }[];
  porFormaPago: { forma: string; importeCentavos: number; comisionCentavos: number; cobros: number }[];
  porCategoria: { categoria: string; unidades: number; totalCentavos: number; gananciaBrutaCentavos?: number }[];
  topProductos: { modeloId: number; modelo: string; unidades: number; totalCentavos: number; gananciaBrutaCentavos?: number; margenBrutoBp?: number | null; stock: number }[];
  gastosPorCategoria?: { categoria: string; totalCentavos: number }[];
}
export interface Alerta { id: string; nivel: 'critico' | 'atencion' | 'info'; modulo: string; titulo: string; detalle?: string; enlace: string }

const sumar = (f: string, d: number) => { const x = new Date(f + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
export function periodos() {
  const h = hoy();
  const [a, m] = h.split('-').map(Number);
  const mesAnt = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
  const finMesAnt = sumar(`${h.slice(0, 7)}-01`, -1);
  return [
    { clave: 'hoy', texto: 'Hoy', desde: h, hasta: h },
    { clave: '7d', texto: '7 días', desde: sumar(h, -6), hasta: h },
    { clave: 'mes', texto: 'Este mes', desde: `${h.slice(0, 7)}-01`, hasta: h },
    { clave: 'mes-anterior', texto: 'Mes anterior', desde: `${mesAnt}-01`, hasta: finMesAnt },
    { clave: 'anio', texto: 'Este año', desde: `${a}-01-01`, hasta: h },
  ];
}
const fCorta = (f: string) => f.slice(8, 10) + '/' + f.slice(5, 7);
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function PaginaInicio() {
  const { usuario, puede } = useSesion();
  const [params, setParams] = useSearchParams();
  const ps = periodos();
  const clave = params.get('periodo') ?? 'mes';
  const elegido = ps.find((p) => p.clave === clave);
  const desde = elegido?.desde ?? params.get('desde') ?? ps[2].desde;
  const hasta = elegido?.hasta ?? params.get('hasta') ?? ps[2].hasta;
  const fijar = (p: Record<string, string>) => setParams(p, { replace: true });
  const verPanel = puede('panel') && puede('ventas');
  const panel = useQuery({ queryKey: ['panel', desde, hasta], queryFn: () => api.get<Panel>('/panel' + qs({ desde, hasta })), enabled: verPanel });
  const alertas = useQuery({ queryKey: ['alertas'], queryFn: () => api.get<Alerta[]>('/alertas'), refetchInterval: 5 * 60_000 });
  const cuentas = useCuentas(puede('caja'));
  const plata = (cuentas.data ?? []).filter((c) => c.tipo !== 'externa').reduce((s, c) => s + (c.saldoArsCentavos ?? 0), 0);
  const hora = new Date().getHours();
  const saludo = hora < 13 ? 'Buen día' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';
  const p = panel.data;

  return (
    <>
      <Encabezado titulo={`${saludo}, ${usuario.nombre.split(' ')[0]}`} sub="Herencia Cuero · cómo viene el negocio" />
      <ListaAlertas alertas={alertas.data ?? []} />
      {verPanel && (
        <>
          <div className="mb-4 mt-6 flex flex-wrap items-center gap-2">
            {ps.map((x) => <button key={x.clave} className={`rounded-full border px-3 py-1 text-sm ${x.clave === clave ? 'border-carbon bg-carbon text-crema' : 'border-arena hover:border-carbon/50'}`} onClick={() => fijar({ periodo: x.clave })}>{x.texto}</button>)}
            <div className="flex items-center gap-1 text-sm">
              <input className="entrada !w-auto py-1" type="date" value={desde} max={hasta} onChange={(e) => fijar({ periodo: 'otro', desde: e.target.value, hasta })} aria-label="Desde" />
              <span className="text-carbon/50">a</span>
              <input className="entrada !w-auto py-1" type="date" value={hasta} min={desde} onChange={(e) => fijar({ periodo: 'otro', desde, hasta: e.target.value })} aria-label="Hasta" />
            </div>
          </div>
          {panel.isError ? <ErrorCarga error={panel.error} /> : <Indicadores p={p} plata={puede('caja') ? (cuentas.data ? plata : null) : undefined} />}
          {p && (
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <div className="tarjeta min-w-0 p-4 lg:col-span-2">
                <div className="mb-3 flex items-baseline justify-between"><h2 className="font-bold">Ventas por {serie(p).porMes ? 'mes' : 'día'}</h2><Link className="text-xs underline" to={`/ventas?desde=${desde}&hasta=${hasta}`}>Ver ventas</Link></div>
                {p.actual.ventas === 0 ? <p className="py-12 text-center text-sm text-carbon/50">No hubo ventas en este período.</p> : <GraficoBarras alto={280} datos={serie(p).datos} formato={(v) => pesos(v)} etiqueta="Ventas por día del período elegido" />}
              </div>
              <div className="tarjeta min-w-0 p-4">
                <h2 className="mb-3 font-bold">Cómo se cobró</h2>
                {!p.porFormaPago.length ? <p className="text-sm text-carbon/50">Sin cobros.</p> : p.porFormaPago.map((f) => (
                  <BarraHorizontal key={f.forma} titulo={f.forma} valor={pesos(f.importeCentavos)} parte={f.importeCentavos} total={p.actual.totalCentavos}
                    sub={f.comisionCentavos ? `Comisión ${pesos(f.comisionCentavos)}` : undefined} />
                ))}
              </div>
              <div className="tarjeta min-w-0 p-4 lg:col-span-2">
                <div className="mb-2 flex items-baseline justify-between"><h2 className="font-bold">Lo más vendido</h2>{puede('panel') && <Link className="text-xs underline" to={`/reportes?vista=productos&desde=${desde}&hasta=${hasta}`}>Ver todo</Link>}</div>
                {!p.topProductos.length ? <p className="text-sm text-carbon/50">Sin ventas.</p> : (
                  <div className="overflow-x-auto">
                    <table className="tabla text-sm">
                      <thead><tr><th>Producto</th><th className="num">Unidades</th><th className="num">Ventas</th>{p.topProductos[0].gananciaBrutaCentavos !== undefined && <th className="num hidden sm:table-cell">Margen</th>}<th className="num hidden sm:table-cell">Stock</th></tr></thead>
                      <tbody>{p.topProductos.map((t) => (
                        <tr key={t.modeloId}><td><Link className="hover:underline" to={`/catalogo/${t.modeloId}`}>{t.modelo}</Link></td><td className="num">{t.unidades}</td><td className="num">{pesos(t.totalCentavos)}</td>
                          {t.gananciaBrutaCentavos !== undefined && <td className="num hidden sm:table-cell">{t.margenBrutoBp == null ? '—' : pct(t.margenBrutoBp)}</td>}
                          <td className={`num hidden sm:table-cell ${t.stock <= 0 ? 'text-bordo' : ''}`}>{t.stock}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="tarjeta min-w-0 p-4">
                <h2 className="mb-3 font-bold">Por categoría</h2>
                {!p.porCategoria.length ? <p className="text-sm text-carbon/50">Sin ventas.</p> : p.porCategoria.map((c) => (
                  <BarraHorizontal key={c.categoria} titulo={c.categoria} valor={pesos(c.totalCentavos)} parte={c.totalCentavos} total={p.actual.totalCentavos} sub={`${c.unidades} unidades`} />
                ))}
                {p.gastosPorCategoria && p.gastosPorCategoria.length > 0 && <>
                  <h2 className="mb-3 mt-5 font-bold">Gastos</h2>
                  {p.gastosPorCategoria.map((g) => <BarraHorizontal key={g.categoria} titulo={g.categoria} valor={pesos(g.totalCentavos)} parte={g.totalCentavos} total={p.actual.gastosCentavos ?? 0} />)}
                </>}
              </div>
            </div>
          )}
        </>
      )}
      {!verPanel && <ResumenSinPanel />}
    </>
  );
}

/** Con más de dos meses, la serie se agrupa por mes para que las barras se lean. */
function serie(p: Panel) {
  if (p.porDia.length <= 62) return { porMes: false, datos: p.porDia.map((d) => ({ clave: d.fecha, texto: fCorta(d.fecha), valor: d.totalCentavos, detalle: `${d.ventas} ${d.ventas === 1 ? 'venta' : 'ventas'}` })) };
  const meses = new Map<string, { valor: number; ventas: number }>();
  for (const d of p.porDia) { const k = d.fecha.slice(0, 7); const x = meses.get(k) ?? { valor: 0, ventas: 0 }; x.valor += d.totalCentavos; x.ventas += d.ventas; meses.set(k, x); }
  return { porMes: true, datos: [...meses].map(([k, x]) => ({ clave: k, texto: `${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`, valor: x.valor, detalle: `${x.ventas} ventas` })) };
}

function Variacion({ actual, previo, invertir }: { actual: number; previo: number; invertir?: boolean }) {
  if (!previo) return <span className="text-carbon/45">sin datos del período anterior</span>;
  const v = ((actual - previo) / Math.abs(previo)) * 100;
  const bueno = invertir ? v <= 0 : v >= 0;
  return <span className={bueno ? 'text-carbon/70' : 'text-bordo'}>{v >= 0 ? '▲' : '▼'} {Math.abs(v).toLocaleString('es-AR', { maximumFractionDigits: 0 })}% vs. período anterior</span>;
}

function Indicadores({ p, plata }: { p?: Panel; plata?: number | null }) {
  const a = p?.actual, b = p?.previo;
  const t = (titulo: string, valor: React.ReactNode, sub?: React.ReactNode, a2?: string) => ({ titulo, valor, sub, a: a2 });
  const tiles = [
    t('Ventas', a ? pesos(a.totalCentavos) : '…', a && b && <Variacion actual={a.totalCentavos} previo={b.totalCentavos} />, '/ventas'),
    t('Cantidad de ventas', a ? a.ventas : '…', a && `${a.unidades} unidades · ticket promedio ${pesos(a.ticketPromedioCentavos)}`, '/ventas'),
    ...(a?.gananciaCentavos !== undefined ? [t('Ganancia bruta', pesos(a.gananciaCentavos), <>{b && <Variacion actual={a.gananciaCentavos} previo={b.gananciaCentavos ?? 0} />}{a.unidadesSinCosto ? <div className="text-bordo">{a.unidadesSinCosto} unidades vendidas sin costo no suman</div> : null}</>, '/reportes')] : []),
    ...(a?.resultadoCentavos !== undefined ? [t('Resultado', pesos(a.resultadoCentavos), `Ganancia menos gastos (${pesos(a.gastosCentavos)})`, '/reportes')] : []),
    ...(plata !== undefined ? [t('Plata en cuentas', plata === null ? '…' : pesos(plata), 'Hoy, incluye tarjetas a liquidar', '/caja')] : []),
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-5">
      {tiles.map((x) => (
        <Link key={x.titulo} to={x.a ?? '/'} className="tarjeta block min-w-0 p-3 transition-colors hover:border-dorado sm:p-4">
          <div className="etiqueta">{x.titulo}</div>
          <div className={`mt-1 font-titulo text-xl font-bold tabular-nums sm:text-2xl ${typeof x.valor === 'string' && x.valor.startsWith('-') ? 'text-bordo' : ''}`}>{x.valor}</div>
          {x.sub && <div className="mt-1 text-xs text-carbon/55">{x.sub}</div>}
        </Link>
      ))}
    </div>
  );
}

const ICONOS = { critico: AlertOctagon, atencion: AlertTriangle, info: Info };
const TONOS = { critico: 'border-bordo/40 bg-bordo-claro', atencion: 'border-dorado bg-dorado/15', info: 'border-arena bg-crema-50' };
const NOMBRES = { critico: 'Urgente', atencion: 'Atención', info: 'Para revisar' };

export function ListaAlertas({ alertas }: { alertas: Alerta[] }) {
  const [todas, setTodas] = useState(false);
  if (!alertas.length) return <p className="mt-4 text-sm text-carbon/55">Sin avisos pendientes.</p>;
  const visibles = todas ? alertas : alertas.slice(0, 5);
  return (
    <div className="mt-2 space-y-2">
      {visibles.map((a) => {
        const I = ICONOS[a.nivel];
        return (
          <Link key={a.id} to={a.enlace} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:border-carbon/40 ${TONOS[a.nivel]}`}>
            <I className={`mt-0.5 h-4 w-4 shrink-0 ${a.nivel === 'critico' ? 'text-bordo' : 'text-carbon/70'}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <span className="sr-only">{NOMBRES[a.nivel]}: </span><span className="font-medium">{a.titulo}</span>
              {a.detalle && <div className="text-xs text-carbon/60">{a.detalle}</div>}
            </div>
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-carbon/40" aria-hidden />
          </Link>
        );
      })}
      {alertas.length > 5 && <button className="text-xs underline" onClick={() => setTodas(!todas)}>{todas ? 'Ver menos' : `Ver los ${alertas.length} avisos`}</button>}
    </div>
  );
}

/** Para los roles que no ven ventas: lo de catálogo y stock. */
function ResumenSinPanel() {
  const { puede } = useSesion();
  const modelos = useQuery({ queryKey: ['modelos', '', 'activos', ''], queryFn: () => api.get<ModeloResumen[]>('/catalogo/modelos'), enabled: puede('catalogo') });
  const stockTotal = useQuery({ queryKey: ['stock', '', 'todos', ''], queryFn: () => api.get<{ totales: { unidades: number } }>('/stock'), enabled: puede('stock') });
  const pedidos = useQuery({ queryKey: ['compras', '', 'confirmada'], queryFn: () => api.get<unknown[]>('/compras?estado=confirmada'), enabled: puede('compras') });
  const backups = useQuery({ queryKey: ['backups'], queryFn: () => api.get<{ backups: { fecha: string }[] }>('/backups'), enabled: puede('backups') });
  const ms = modelos.data ?? [];
  const d = (titulo: string, valor: React.ReactNode, a: string) => (
    <Link key={titulo} to={a} className="tarjeta block p-4 transition-colors hover:border-dorado"><div className="etiqueta">{titulo}</div><div className="mt-2 font-titulo text-3xl font-bold">{valor}</div></Link>
  );
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {puede('catalogo') && d('Productos activos', modelos.isLoading ? '…' : ms.length, '/catalogo')}
      {puede('catalogo') && d('Variantes (color y talle)', modelos.isLoading ? '…' : ms.reduce((s, m) => s + m.variantes, 0), '/catalogo')}
      {puede('stock') && d('Unidades en stock', stockTotal.data ? stockTotal.data.totales.unidades.toLocaleString('es-AR') : '…', '/stock')}
      {puede('compras') && d('Pedidos por recibir', pedidos.data ? pedidos.data.length : '…', '/compras?estado=confirmada')}
      {puede('backups') && d('Última copia', backups.data?.backups[0] ? fechaHora(backups.data.backups[0].fecha) : '—', '/backups')}
    </div>
  );
}
