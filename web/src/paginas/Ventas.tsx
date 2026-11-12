import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, Plus, Trash2 } from 'lucide-react';
import { api, qs } from '../api';
import { useSesion } from '../sesion';
import { describirVariante, type Aux, type VarianteBuscada } from '../tipos';
import { Aviso, Campo, Cargando, Confirmar, Encabezado, ErrorCarga, Modal, Vacio, avisar, avisarError } from '../componentes/ui';
import { Importe } from '../componentes/Importe';
import { BuscadorVariante } from '../componentes/BuscadorVariante';
import { fechaHora, pct, pesos } from '../formato';
import { dolares, fechaCorta, hoy, inicioMes, queriesPlata, useFormasPago } from '../plata';

interface VentaFila {
  id: number; numero: number; fecha: string; cliente: string | null; estado: 'confirmada' | 'anulada'; notas: string | null;
  totalCentavos: number; listaCentavos: number | null; diferenciaListaCentavos: number | null; comisionCentavos: number;
  costoMercaderiaCentavos?: number | null; gananciaCentavos?: number | null; unidades: number; productos: string; skus: string; formas: string;
}
interface Resumen { ventas: number; unidades: number; totalCentavos: number; comisionCentavos: number; costoMercaderiaCentavos?: number; gananciaCentavos?: number; sinCosto: number; ticketPromedioCentavos: number }
interface Venta extends Omit<VentaFila, 'productos' | 'skus' | 'formas'> {
  lista: string | null; motivoAnulacion: string | null; creadoEn: string;
  items: { id: number; varianteId: number; sku: string; modelo: string; modeloId: number; color: string | null; talle: string | null; cantidad: number; precioListaCentavos: number | null; precioCentavos: number; costoUnitarioCentavos?: number | null }[];
  pagos: { id: number; forma: string; cuenta: string; moneda: 'ARS' | 'USD'; tipoCuenta: string; importeCentavos: number; importeMonedaCentavos: number | null; comisionEstimadaCentavos: number; comisionRealCentavos: number | null }[];
}
const invalidarPlata = (qc: ReturnType<typeof useQueryClient>) => queriesPlata.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

export function PaginaVentas() {
  const { puede } = useSesion();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const f = { desde: params.get('desde') ?? inicioMes(), hasta: params.get('hasta') ?? hoy(), q: params.get('q') ?? '', formaPagoId: params.get('forma') ?? '', estado: params.get('estado') ?? '' };
  const fijar = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const formas = useFormasPago();
  const [q, setQ] = useState(f.q);
  useEffect(() => { const t = setTimeout(() => q !== f.q && fijar('q', q), 300); return () => clearTimeout(t); });
  const filtro = { desde: f.desde, hasta: f.hasta, q: f.q, formaPagoId: f.formaPagoId, estado: f.estado };
  const lista = useQuery({ queryKey: ['ventas', filtro], queryFn: () => api.get<{ total: number; resumen: Resumen; filas: VentaFila[] }>('/ventas' + qs(filtro)) });
  const costos = puede('costos');
  const r = lista.data?.resumen;
  return (
    <>
      <Encabezado titulo="Ventas" sub="Cada venta descuenta stock y registra la plata en su cuenta.">
        {puede('ventas', 'exportar') && <a className="btn-secundario" href={'/api/ventas/exportar' + qs(filtro)}><Download className="h-4 w-4" />Excel</a>}
        {puede('ventas', 'crear') && <Link className="btn-primario" to="/ventas/nueva"><Plus className="h-4 w-4" />Nueva venta</Link>}
      </Encabezado>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <input className="entrada" type="date" value={f.desde} onChange={(e) => fijar('desde', e.target.value)} aria-label="Desde" />
        <input className="entrada" type="date" value={f.hasta} onChange={(e) => fijar('hasta', e.target.value)} aria-label="Hasta" />
        <input className="entrada" placeholder="Producto, código, cliente o N°" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="entrada" value={f.formaPagoId} onChange={(e) => fijar('forma', e.target.value)}>
          <option value="">Todas las formas de pago</option>{formas.data?.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
        </select>
        <select className="entrada" value={f.estado} onChange={(e) => fijar('estado', e.target.value)}><option value="">Confirmadas y anuladas</option><option value="confirmada">Solo confirmadas</option><option value="anulada">Solo anuladas</option></select>
      </div>
      {r && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tarjeta titulo="Facturado" valor={pesos(r.totalCentavos)} sub={`${r.ventas} ventas · ${r.unidades} unidades`} />
          <Tarjeta titulo="Ticket promedio" valor={pesos(r.ticketPromedioCentavos)} />
          <Tarjeta titulo="Comisiones" valor={pesos(r.comisionCentavos)} sub={r.totalCentavos ? `${pct(Math.round((r.comisionCentavos / r.totalCentavos) * 10000))} de lo facturado` : undefined} />
          {costos && <Tarjeta titulo="Ganancia bruta" valor={pesos(r.gananciaCentavos)} sub={r.sinCosto ? `${r.sinCosto} ventas sin costo cargado no suman` : r.totalCentavos ? `margen ${pct(Math.round(((r.gananciaCentavos ?? 0) / r.totalCentavos) * 10000))}` : undefined} />}
        </div>
      )}
      {lista.isLoading ? <Cargando /> : lista.isError ? <ErrorCarga error={lista.error} /> : !lista.data!.filas.length ? <Vacio>No hay ventas en ese período.</Vacio> : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead><tr><th>N°</th><th>Fecha</th><th>Productos</th><th className="hidden md:table-cell">Forma de pago</th><th className="num">Total</th><th className="num hidden lg:table-cell">vs lista</th>{costos && <th className="num hidden sm:table-cell">Ganancia</th>}</tr></thead>
            <tbody>
              {lista.data!.filas.map((v) => (
                <tr key={v.id} className={`cursor-pointer ${v.estado === 'anulada' ? 'text-carbon/40 line-through' : ''}`} onClick={() => nav(`/ventas/${v.id}`)}>
                  <td className="font-medium">V-{v.numero}</td>
                  <td className="whitespace-nowrap">{fechaCorta(v.fecha)}</td>
                  <td><div className="max-w-xs truncate">{v.productos}</div><div className="text-xs text-carbon/50">{v.skus}{v.cliente && ` · ${v.cliente}`}</div></td>
                  <td className="hidden md:table-cell text-xs">{v.formas}</td>
                  <td className="num font-medium">{pesos(v.totalCentavos)}</td>
                  <td className={`num hidden lg:table-cell text-xs ${(v.diferenciaListaCentavos ?? 0) < 0 ? 'text-bordo' : 'text-carbon/50'}`}>{v.diferenciaListaCentavos ? pesos(v.diferenciaListaCentavos) : '—'}</td>
                  {costos && <td className="num hidden sm:table-cell">{v.gananciaCentavos == null ? <span className="text-xs text-conac">sin costo</span> : pesos(v.gananciaCentavos)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function Tarjeta({ titulo, valor, sub, tono }: { titulo: string; valor: React.ReactNode; sub?: React.ReactNode; tono?: 'bordo' }) {
  return (
    <div className="tarjeta p-4">
      <div className="etiqueta">{titulo}</div>
      <div className={`mt-1 font-titulo text-2xl font-bold ${tono === 'bordo' ? 'text-bordo' : ''}`}>{valor}</div>
      {sub && <div className="mt-0.5 text-xs text-carbon/55">{sub}</div>}
    </div>
  );
}

interface Linea { varianteId: number; sku: string; descripcion: string; stock: number; cantidad: number; precioLista: number | null; precio: number | null; tocado: boolean }
interface Pago { formaPagoId: number; importe: number | null; usd: number | null }

export function PaginaVentaNueva() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { cotizUsd } = useSesion();
  const aux = useQuery({ queryKey: ['aux'], queryFn: () => api.get<Aux>('/catalogo/aux') });
  const listas = { data: aux.data?.listasPrecio };
  const formas = useFormasPago();
  const activas = (formas.data ?? []).filter((x) => x.activo);
  const [d, setD] = useState({ fecha: hoy(), listaPrecioId: 0, cliente: '', notas: '' });
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [pagos, setPagos] = useState<Pago[]>([]);
  useEffect(() => { if (!d.listaPrecioId && listas.data?.length) setD((x) => ({ ...x, listaPrecioId: listas.data![0].id })); }, [listas.data, d.listaPrecioId]);

  // Precios de lista de los productos cargados, para la lista elegida.
  const ids = lineas.map((l) => l.varianteId).sort().join(',');
  const preciosLista = useQuery({ queryKey: ['precios-venta', d.listaPrecioId, ids], queryFn: () => api.get<Record<string, number>>('/ventas/precios' + qs({ listaId: d.listaPrecioId, ids })), enabled: !!ids && !!d.listaPrecioId });
  useEffect(() => {
    if (!preciosLista.data) return;
    setLineas((ls) => ls.map((l) => {
      const p = preciosLista.data![l.varianteId] ?? null;
      return { ...l, precioLista: p, precio: l.tocado ? l.precio : p };
    }));
  }, [preciosLista.data]);

  const total = lineas.reduce((s, l) => s + l.cantidad * (l.precio ?? 0), 0);
  const lista = lineas.every((l) => l.precioLista != null) ? lineas.reduce((s, l) => s + l.cantidad * l.precioLista!, 0) : null;
  const cobrado = pagos.reduce((s, p) => s + (p.importe ?? 0), 0);
  // Con un solo pago, el importe sigue al total.
  useEffect(() => { if (pagos.length === 1) setPagos((ps) => [{ ...ps[0], importe: total }]); }, [total, pagos.length]);
  useEffect(() => {
    if (pagos.length || !activas.length) return;
    const def = activas.find((x) => x.listaPrecioId === d.listaPrecioId) ?? activas[0];
    setPagos([{ formaPagoId: def.id, importe: total, usd: null }]);
  }, [activas.length, d.listaPrecioId]); // eslint-disable-line react-hooks/exhaustive-deps

  const agregar = (v: VarianteBuscada) => {
    const ya = lineas.find((l) => l.varianteId === v.varianteId);
    if (ya) setLineas(lineas.map((l) => (l === ya ? { ...l, cantidad: l.cantidad + 1 } : l)));
    else setLineas([...lineas, { varianteId: v.varianteId, sku: v.sku, descripcion: describirVariante(v), stock: v.stock, cantidad: 1, precioLista: null, precio: null, tocado: false }]);
  };
  const forma = (id: number) => activas.find((x) => x.id === id);
  const faltaUsd = pagos.some((p) => forma(p.formaPagoId)?.moneda === 'USD' && !(p.usd && p.usd > 0));
  const sinStock = lineas.filter((l) => l.cantidad > l.stock);
  const valido = lineas.length > 0 && lineas.every((l) => l.cantidad > 0 && l.precio != null) && pagos.length > 0 && pagos.every((p) => (p.importe ?? 0) > 0) && cobrado === total && !faltaUsd;

  const guardar = useMutation({
    mutationFn: () => api.post<{ id: number; numero: number }>('/ventas', {
      fecha: d.fecha, listaPrecioId: d.listaPrecioId || null, cliente: d.cliente || null, notas: d.notas || null,
      items: lineas.map((l) => ({ varianteId: l.varianteId, cantidad: l.cantidad, precioCentavos: l.precio! })),
      pagos: pagos.map((p) => ({ formaPagoId: p.formaPagoId, importeCentavos: p.importe!, importeMonedaCentavos: forma(p.formaPagoId)?.moneda === 'USD' ? p.usd : null })),
    }, true),
    onSuccess: (r) => { avisar(`Venta V-${r.numero} registrada`); invalidarPlata(qc); nav(`/ventas/${r.id}`); },
    onError: avisarError,
  });

  return (
    <>
      <Link to="/ventas" className="mb-3 inline-flex items-center gap-1 text-sm text-carbon/60 hover:text-carbon"><ArrowLeft className="h-4 w-4" />Ventas</Link>
      <Encabezado titulo="Nueva venta" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <div className="tarjeta grid gap-3 p-5 sm:grid-cols-3">
            <Campo etiqueta="Fecha"><input className="entrada" type="date" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></Campo>
            <Campo etiqueta="Lista de precios">
              <select className="entrada" value={d.listaPrecioId} onChange={(e) => setD({ ...d, listaPrecioId: Number(e.target.value) })}>{listas.data?.filter((l) => l.activo).map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</select>
            </Campo>
            <Campo etiqueta="Cliente (opcional)"><input className="entrada" value={d.cliente} onChange={(e) => setD({ ...d, cliente: e.target.value })} /></Campo>
          </div>
          <div className="tarjeta p-5">
            <Campo etiqueta="Agregar producto" ayuda="Escribí el código o pasá el lector de código de barras"><BuscadorVariante onElegir={agregar} autoFocus mantenerFoco /></Campo>
            <div className="mt-4 overflow-x-auto">
              <table className="tabla">
                <thead><tr><th>Producto</th><th className="num w-20">Cant.</th><th className="num hidden sm:table-cell">Lista</th><th className="num w-36">Cobrado c/u</th><th className="num">Subtotal</th><th /></tr></thead>
                <tbody>
                  {lineas.map((l, i) => (
                    <tr key={l.varianteId}>
                      <td><b>{l.sku}</b><div className="text-xs text-carbon/55">{l.descripcion}</div><div className={`text-xs ${l.cantidad > l.stock ? 'text-bordo' : 'text-carbon/40'}`}>stock {l.stock}</div></td>
                      <td><input className="entrada py-1 text-right" type="number" min={1} value={l.cantidad} onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, cantidad: Math.max(0, Number(e.target.value)) } : x)))} /></td>
                      <td className="num hidden sm:table-cell text-carbon/60">{l.precioLista == null ? <span className="text-xs text-conac">sin precio</span> : pesos(l.precioLista)}</td>
                      <td><Importe valor={l.precio} onCambio={(c) => setLineas(lineas.map((x, j) => (j === i ? { ...x, precio: c, tocado: true } : x)))} /></td>
                      <td className="num">{pesos(l.cantidad * (l.precio ?? 0))}</td>
                      <td className="text-right"><button className="p-1 text-carbon/40 hover:text-bordo" aria-label="Quitar" onClick={() => setLineas(lineas.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></td>
                    </tr>
                  ))}
                  {!lineas.length && <tr><td colSpan={6} className="py-6 text-center text-carbon/50">Buscá productos para agregarlos.</td></tr>}
                </tbody>
              </table>
            </div>
            {sinStock.length > 0 && <div className="mt-3"><Aviso tono="critico">No hay stock suficiente de {sinStock.map((l) => l.sku).join(', ')}. Si el stock está mal, corregilo antes con un ajuste.</Aviso></div>}
          </div>
          <div className="tarjeta p-5"><Campo etiqueta="Notas"><input className="entrada" value={d.notas} onChange={(e) => setD({ ...d, notas: e.target.value })} placeholder="Ej.: descuento por pago en efectivo" /></Campo></div>
        </div>
        <div className="tarjeta h-fit min-w-0 space-y-4 p-5 lg:sticky lg:top-6">
          <div>
            <div className="etiqueta">Total</div>
            <div className="font-titulo text-4xl font-bold">{pesos(total)}</div>
            {lista != null && lista !== total && <div className={`text-sm ${total < lista ? 'text-bordo' : 'text-carbon/60'}`}>{total < lista ? 'Descuento' : 'Recargo'} de {pesos(Math.abs(total - lista))} sobre lista ({pesos(lista)})</div>}
          </div>
          <div className="space-y-3 border-t border-arena pt-4">
            <div className="etiqueta">Cobro</div>
            {pagos.map((p, i) => {
              const fp = forma(p.formaPagoId);
              return (
                <div key={i} className="space-y-2 rounded-md border border-arena/60 p-3">
                  <div className="flex gap-2">
                    <select className="entrada" value={p.formaPagoId} onChange={(e) => setPagos(pagos.map((x, j) => (j === i ? { ...x, formaPagoId: Number(e.target.value) } : x)))}>
                      {activas.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                    </select>
                    {pagos.length > 1 && <button className="p-1 text-carbon/40 hover:text-bordo" aria-label="Quitar pago" onClick={() => setPagos(pagos.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
                  </div>
                  {pagos.length > 1 && <Importe valor={p.importe} onCambio={(c) => setPagos(pagos.map((x, j) => (j === i ? { ...x, importe: c } : x)))} placeholder="Importe en pesos" />}
                  {fp?.moneda === 'USD' && (
                    <div>
                      <label className="etiqueta">Dólares recibidos</label>
                      <input className="entrada text-right" inputMode="decimal" value={p.usd == null ? '' : p.usd / 100} onChange={(e) => { const n = Number(e.target.value.replace(',', '.')); setPagos(pagos.map((x, j) => (j === i ? { ...x, usd: e.target.value === '' || Number.isNaN(n) ? null : Math.round(n * 100) } : x))); }} />
                      {p.usd && p.importe ? <div className="mt-1 text-xs text-carbon/55">Cambio tomado: {pesos(Math.round((p.importe / p.usd) * 100))} por dólar{cotizUsd ? ` (cotización cargada ${pesos(cotizUsd)})` : ''}</div> : null}
                    </div>
                  )}
                  {fp && <div className="text-xs text-carbon/55">Entra en {fp.cuenta}{fp.comisionBp > 0 && ` · comisión estimada ${pct(fp.comisionBp)} (${pesos(Math.round(((p.importe ?? 0) * fp.comisionBp) / 10000))})`}{fp.tipoCuenta === 'a_liquidar' && ' · se descuenta al liquidar'}</div>}
                </div>
              );
            })}
            <button className="text-sm text-conac underline" onClick={() => setPagos([...pagos, { formaPagoId: activas[0]?.id ?? 0, importe: Math.max(0, total - cobrado), usd: null }])}>+ Otra forma de pago</button>
            {pagos.length > 1 && cobrado !== total && <div className="text-sm text-bordo">{cobrado < total ? `Faltan ${pesos(total - cobrado)}` : `Sobran ${pesos(cobrado - total)}`}</div>}
          </div>
          <button className="btn-primario w-full py-3 text-base" disabled={!valido || guardar.isPending || sinStock.length > 0} onClick={() => guardar.mutate()}>{guardar.isPending ? 'Guardando…' : 'Confirmar venta'}</button>
        </div>
      </div>
    </>
  );
}

export function PaginaVenta() {
  const { id } = useParams();
  const { puede } = useSesion();
  const qc = useQueryClient();
  const v = useQuery({ queryKey: ['venta', id], queryFn: () => api.get<Venta>(`/ventas/${id}`) });
  const [anular, setAnular] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [comision, setComision] = useState<Venta['pagos'][number] | null>(null);
  const anu = useMutation({
    mutationFn: () => api.post(`/ventas/${id}/anular`, { motivo }),
    onSuccess: () => { avisar('Venta anulada: volvió el stock y se revirtió la plata'); setAnular(false); setMotivo(''); invalidarPlata(qc); },
    onError: avisarError,
  });
  if (v.isLoading) return <Cargando />;
  if (v.isError) return <ErrorCarga error={v.error} />;
  const k = v.data!;
  const costos = puede('costos');
  return (
    <>
      <Link to="/ventas" className="mb-3 inline-flex items-center gap-1 text-sm text-carbon/60 hover:text-carbon"><ArrowLeft className="h-4 w-4" />Ventas</Link>
      <Encabezado titulo={`Venta V-${k.numero}`} sub={<>{fechaCorta(k.fecha)}{k.lista && ` · lista ${k.lista}`}{k.cliente && ` · ${k.cliente}`} · cargada {fechaHora(k.creadoEn)}</>}>
        {k.estado === 'confirmada' && puede('ventas', 'anular') && <button className="btn-secundario" onClick={() => setAnular(true)}>Anular</button>}
      </Encabezado>
      {k.estado === 'anulada' && <div className="mb-4"><Aviso tono="critico">Venta anulada: {k.motivoAnulacion}</Aviso></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="tarjeta min-w-0 overflow-x-auto lg:col-span-2">
          <table className="tabla">
            <thead><tr><th>Producto</th><th className="num">Cant.</th><th className="num">Lista</th><th className="num">Cobrado c/u</th>{costos && <th className="num">Costo c/u</th>}<th className="num">Subtotal</th></tr></thead>
            <tbody>
              {k.items.map((i) => (
                <tr key={i.id}>
                  <td>{puede('catalogo') ? <Link className="font-medium hover:underline" to={`/catalogo/${i.modeloId}`}>{i.sku}</Link> : <b>{i.sku}</b>}<div className="text-xs text-carbon/55">{describirVariante(i)}</div></td>
                  <td className="num">{i.cantidad}</td>
                  <td className="num text-carbon/60">{pesos(i.precioListaCentavos)}</td>
                  <td className="num">{pesos(i.precioCentavos)}</td>
                  {costos && <td className="num text-carbon/60">{i.costoUnitarioCentavos == null ? <span className="text-xs text-conac">pendiente</span> : pesos(i.costoUnitarioCentavos)}</td>}
                  <td className="num font-medium">{pesos(i.cantidad * i.precioCentavos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {k.notas && <p className="p-4 text-sm text-carbon/70">{k.notas}</p>}
        </div>
        <div className="space-y-4">
          <div className="tarjeta space-y-2 p-5 text-sm">
            <Fila t="Total cobrado" v={<b className="font-titulo text-xl">{pesos(k.totalCentavos)}</b>} />
            {k.diferenciaListaCentavos != null && k.diferenciaListaCentavos !== 0 && <Fila t="Diferencia vs lista" v={<span className={k.diferenciaListaCentavos < 0 ? 'text-bordo' : ''}>{pesos(k.diferenciaListaCentavos)}</span>} />}
            <Fila t="Comisiones" v={pesos(-k.comisionCentavos)} />
            {costos && <Fila t="Costo de mercadería" v={k.costoMercaderiaCentavos == null ? 'pendiente' : pesos(-k.costoMercaderiaCentavos)} />}
            {costos && <div className="border-t border-arena pt-2"><Fila t="Ganancia" v={<b>{k.gananciaCentavos == null ? 'falta el costo' : pesos(k.gananciaCentavos)}</b>} /></div>}
          </div>
          <div className="tarjeta p-5">
            <div className="etiqueta mb-2">Cobros</div>
            {k.pagos.map((p) => (
              <div key={p.id} className="border-b border-arena/40 py-2 text-sm last:border-0">
                <div className="flex justify-between gap-2"><span>{p.forma}</span><b>{pesos(p.importeCentavos)}</b></div>
                <div className="text-xs text-carbon/55">
                  {p.cuenta}{p.importeMonedaCentavos != null && ` · ${dolares(p.importeMonedaCentavos)}`} · comisión {p.comisionRealCentavos != null ? <>real {pesos(p.comisionRealCentavos)}</> : <>estimada {pesos(p.comisionEstimadaCentavos)}</>}
                  {k.estado === 'confirmada' && puede('ventas', 'modificar') && <button className="ml-2 text-conac underline" onClick={() => setComision(p)}>cargar real</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {anular && (
        <Confirmar titulo={`Anular venta V-${k.numero}`} textoBoton="Anular venta" peligro ocupado={anu.isPending} onCerrar={() => setAnular(false)} onConfirmar={() => anu.mutate()}>
          <p>Los productos vuelven al stock y la plata se descuenta de las cuentas donde había entrado (con movimientos de anulación, no se borra nada).</p>
          <Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: devolución, mal cargada" /></Campo>
        </Confirmar>
      )}
      {comision && <ModalComision pago={comision} onCerrar={() => setComision(null)} onListo={() => invalidarPlata(qc)} />}
    </>
  );
}

function Fila({ t, v }: { t: string; v: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-3"><span className="text-carbon/60">{t}</span><span className="tabular-nums">{v}</span></div>;
}

function ModalComision({ pago, onCerrar, onListo }: { pago: Venta['pagos'][number]; onCerrar: () => void; onListo: () => void }) {
  const [valor, setValor] = useState<number | null>(pago.comisionRealCentavos ?? pago.comisionEstimadaCentavos);
  const m = useMutation({
    mutationFn: (c: number | null) => api.put(`/ventas/pagos/${pago.id}/comision`, { comisionRealCentavos: c }),
    onSuccess: () => { avisar('Comisión actualizada'); onListo(); onCerrar(); }, onError: avisarError,
  });
  return (
    <Modal titulo={`Comisión real · ${pago.forma}`} onCerrar={onCerrar}>
      <div className="space-y-4 text-sm">
        <p>Cobrado {pesos(pago.importeCentavos)}. Estimada: {pesos(pago.comisionEstimadaCentavos)}.</p>
        <Campo etiqueta="Lo que realmente descontaron (comisión + IVA + retenciones)"><Importe valor={valor} onCambio={setValor} /></Campo>
        {pago.tipoCuenta !== 'a_liquidar' && <p className="text-xs text-carbon/55">La diferencia con lo ya descontado se registra en {pago.cuenta}.</p>}
        <div className="flex justify-between gap-2">
          {pago.comisionRealCentavos != null ? <button className="btn-secundario" onClick={() => m.mutate(null)}>Volver a la estimada</button> : <span />}
          <div className="flex gap-2"><button className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={valor == null || m.isPending} onClick={() => m.mutate(valor)}>Guardar</button></div>
        </div>
      </div>
    </Modal>
  );
}

