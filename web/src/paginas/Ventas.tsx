import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, HandCoins, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, qs } from '../api';
import { useSesion } from '../sesion';
import { describirVariante, type Aux, type VarianteBuscada } from '../tipos';
import { Aviso, Campo, Cargando, Confirmar, Encabezado, ErrorCarga, Modal, Vacio, avisar, avisarError } from '../componentes/ui';
import { Th, useOrden } from '../componentes/Orden';
import { Importe } from '../componentes/Importe';
import { BuscadorVariante } from '../componentes/BuscadorVariante';
import { fechaHora, pct, pesos } from '../formato';
import { dolares, fechaCorta, hoy, inicioMes, queriesPlata, useFormasPago } from '../plata';

interface VentaFila {
  id: number; numero: number; fecha: string; cliente: string | null; clienteId: number | null; estado: 'confirmada' | 'anulada'; notas: string | null;
  listaPrecioId: number | null; descuentoCentavos: number; motivoDescuento: string | null; version: number; efectivoRecibidoCentavos?: number | null;
  subtotalCentavos: number; cobradoCentavos: number; saldoCentavos: number; totalCentavos: number; listaCentavos: number | null; diferenciaListaCentavos: number | null; comisionCentavos: number;
  costoMercaderiaCentavos?: number | null; gananciaCentavos?: number | null; unidades: number; productos: string; skus: string; formas: string;
}
interface Resumen { saldoCentavos: number; descuentoCentavos: number; ventas: number; unidades: number; totalCentavos: number; comisionCentavos: number; costoMercaderiaCentavos?: number; gananciaCentavos?: number; sinCosto: number; ticketPromedioCentavos: number }
interface Venta extends Omit<VentaFila, 'productos' | 'skus' | 'formas'> {
  lista: string | null; motivoAnulacion: string | null; creadoEn: string;
  items: { id: number; varianteId: number; sku: string; modelo: string; modeloId: number; color: string | null; talle: string | null; cantidad: number; precioListaCentavos: number | null; precioCentavos: number; costoUnitarioCentavos?: number | null }[];
  versiones: { id: number; version: number; motivo: string; fecha: string }[];
  pagos: { id: number; formaPagoId: number; fecha: string | null; estado: 'activo' | 'anulado'; motivoAnulacion: string | null; liquidacion: string | null; forma: string; cuenta: string; moneda: 'ARS' | 'USD'; tipoCuenta: string; importeCentavos: number; importeMonedaCentavos: number | null; comisionEstimadaCentavos: number; comisionRealCentavos: number | null }[];
}
const invalidarPlata = (qc: ReturnType<typeof useQueryClient>) => queriesPlata.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

export function PaginaVentas() {
  const { puede } = useSesion();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const f = { desde: params.get('desde') ?? inicioMes(), hasta: params.get('hasta') ?? hoy(), q: params.get('q') ?? '', formaPagoId: params.get('forma') ?? '', estado: params.get('estado') ?? '', clienteId: params.get('cliente') ?? '', conSaldo: params.get('saldo') ?? '' };
  const fijar = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const formas = useFormasPago();
  const [q, setQ] = useState(f.q);
  useEffect(() => { const t = setTimeout(() => q !== f.q && fijar('q', q), 300); return () => clearTimeout(t); });
  const filtro = { desde: f.desde, hasta: f.hasta, q: f.q, formaPagoId: f.formaPagoId, estado: f.estado, clienteId: f.clienteId, conSaldo: f.conSaldo };
  const clientes = useClientes();
  const lista = useQuery({ queryKey: ['ventas', filtro], queryFn: () => api.get<{ total: number; resumen: Resumen; filas: VentaFila[] }>('/ventas' + qs(filtro)) });
  const costos = puede('costos');
  const r = lista.data?.resumen;
  const { filas: ventas, orden } = useOrden(lista.data?.filas, {
    numero: (v) => v.numero, fecha: (v) => v.fecha, productos: (v) => v.productos, forma: (v) => v.formas, total: (v) => v.totalCentavos,
    lista: (v) => v.diferenciaListaCentavos ?? 0, ganancia: (v) => v.gananciaCentavos, saldo: (v) => v.saldoCentavos,
  }, { col: 'numero', dir: 'desc' });
  return (
    <>
      <Encabezado titulo="Ventas" sub="Cada venta descuenta stock y registra la plata en su cuenta.">
        {puede('ventas', 'exportar') && <a className="btn-secundario" href={'/api/ventas/exportar' + qs(filtro)}><Download className="h-4 w-4" />Excel</a>}
        {puede('ventas', 'crear') && <Link className="btn-secundario" to="/ventas/nueva" title="Con otra fecha, cliente o notas"><Plus className="h-4 w-4" />Venta detallada</Link>}
        {puede('ventas', 'crear') && <Link className="btn-primario" to="/facturar"><Plus className="h-4 w-4" />Facturar</Link>}
      </Encabezado>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <input className="entrada" type="date" value={f.desde} onChange={(e) => fijar('desde', e.target.value)} aria-label="Desde" />
        <input className="entrada" type="date" value={f.hasta} onChange={(e) => fijar('hasta', e.target.value)} aria-label="Hasta" />
        <input className="entrada" placeholder="Producto, código, cliente o N°" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="entrada" value={f.formaPagoId} onChange={(e) => fijar('forma', e.target.value)}>
          <option value="">Todas las formas de pago</option>{formas.data?.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
        </select>
        <select className="entrada" value={f.estado} onChange={(e) => fijar('estado', e.target.value)}><option value="">Confirmadas y anuladas</option><option value="confirmada">Solo confirmadas</option><option value="anulada">Solo anuladas</option></select>
        <select className="entrada" value={f.clienteId} onChange={(e) => fijar('cliente', e.target.value)} aria-label="Cliente">
          <option value="">Todos los clientes</option>{clientes.data?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <label className="entrada flex items-center gap-2"><input type="checkbox" checked={f.conSaldo === 'true'} onChange={(e) => fijar('saldo', e.target.checked ? 'true' : '')} />Solo con saldo a cobrar</label>
      </div>
      {r && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tarjeta titulo="Facturado" valor={pesos(r.totalCentavos)} sub={<>{r.ventas} ventas · {r.unidades} unidades{r.descuentoCentavos > 0 && ` · descuentos ${pesos(r.descuentoCentavos)}`}</>} />
          {r.saldoCentavos > 0 ? <Tarjeta titulo="Falta cobrar" valor={pesos(r.saldoCentavos)} tono="bordo" sub={<button className="underline" onClick={() => fijar('saldo', 'true')}>ver ventas con saldo</button>} /> : <Tarjeta titulo="Ticket promedio" valor={pesos(r.ticketPromedioCentavos)} />}
          <Tarjeta titulo="Comisiones" valor={pesos(r.comisionCentavos)} sub={r.totalCentavos ? `${pct(Math.round((r.comisionCentavos / r.totalCentavos) * 10000))} de lo facturado` : undefined} />
          {costos && <Tarjeta titulo="Ganancia bruta" valor={pesos(r.gananciaCentavos)} sub={r.sinCosto ? `${r.sinCosto} ventas sin costo cargado no suman` : r.totalCentavos ? `margen ${pct(Math.round(((r.gananciaCentavos ?? 0) / r.totalCentavos) * 10000))}` : undefined} />}
        </div>
      )}
      {lista.isLoading ? <Cargando /> : lista.isError ? <ErrorCarga error={lista.error} /> : !lista.data!.filas.length ? <Vacio>No hay ventas en ese período.</Vacio> : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead><tr><Th col="numero" orden={orden}>N°</Th><Th col="fecha" orden={orden}>Fecha</Th><Th col="productos" orden={orden}>Productos</Th><Th col="forma" orden={orden} className="hidden md:table-cell">Forma de pago</Th><Th col="total" orden={orden} className="num">Total</Th><Th col="saldo" orden={orden} className="num">Saldo</Th><Th col="lista" orden={orden} className="num hidden lg:table-cell">vs lista</Th>{costos && <Th col="ganancia" orden={orden} className="num hidden sm:table-cell">Ganancia</Th>}</tr></thead>
            <tbody>
              {ventas.map((v) => (
                <tr key={v.id} className={`cursor-pointer ${v.estado === 'anulada' ? 'text-carbon/40 line-through' : ''}`} onClick={() => nav(`/ventas/${v.id}`)}>
                  <td className="font-medium">V-{v.numero}</td>
                  <td className="whitespace-nowrap">{fechaCorta(v.fecha)}</td>
                  <td><div className="max-w-xs truncate">{v.productos}</div><div className="text-xs text-carbon/50">{v.skus}{v.cliente && ` · ${v.cliente}`}</div></td>
                  <td className="hidden md:table-cell text-xs">{v.formas}</td>
                  <td className="num font-medium">{pesos(v.totalCentavos)}</td>
                  <td className={`num ${v.saldoCentavos > 0 && v.estado === 'confirmada' ? 'font-medium text-bordo' : 'text-carbon/40'}`}>{v.saldoCentavos > 0 && v.estado === 'confirmada' ? pesos(v.saldoCentavos) : '—'}</td>
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

interface Linea { varianteId: number; sku: string; descripcion: string; stock: number | null; cantidad: number; precioLista: number | null; precio: number | null; tocado: boolean }
interface Pago { formaPagoId: number; importe: number | null; usd: number | null; tocado?: boolean }
export interface Cliente { id: number; nombre: string; telefono: string | null; email: string | null; documento: string | null; notas: string | null; activo: boolean; saldoCentavos: number; ventas: number; ultimaCompra: string | null }
export const useClientes = (habilitado = true) => useQuery({ queryKey: ['clientes'], queryFn: () => api.get<Cliente[]>('/clientes'), enabled: habilitado });

export function PaginaVentaNueva() { return <FormVenta />; }

export function PaginaVentaEditar() {
  const { id } = useParams();
  const v = useQuery({ queryKey: ['venta', id], queryFn: () => api.get<Venta>(`/ventas/${id}`) });
  if (v.isLoading) return <Cargando />;
  if (v.isError) return <ErrorCarga error={v.error} />;
  if (v.data!.estado === 'anulada') return <Aviso tono="critico">La venta está anulada: no se puede editar.</Aviso>;
  return <FormVenta venta={v.data!} />;
}

function FormVenta({ venta }: { venta?: Venta }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { cotizUsd } = useSesion();
  const aux = useQuery({ queryKey: ['aux'], queryFn: () => api.get<Aux>('/catalogo/aux') });
  const listas = { data: aux.data?.listasPrecio };
  const formas = useFormasPago();
  const clientes = useClientes();
  const activas = (formas.data ?? []).filter((x) => x.activo);
  // Al editar, solo se reemplazan los cobros hechos al vender; los posteriores quedan como están.
  const posteriores = (venta?.pagos ?? []).filter((p) => p.fecha && p.estado === 'activo');
  const cobradoDespues = posteriores.reduce((s, p) => s + p.importeCentavos, 0);
  const [d, setD] = useState({
    fecha: venta?.fecha ?? hoy(), listaPrecioId: venta?.listaPrecioId ?? 0, clienteId: venta?.clienteId ?? null as number | null,
    clienteTexto: venta && !venta.clienteId ? venta.cliente ?? '' : '', notas: venta?.notas ?? '',
    descuento: venta?.descuentoCentavos || null as number | null, motivoDescuento: venta?.motivoDescuento ?? '', motivo: '',
  });
  const [lineas, setLineas] = useState<Linea[]>(() => (venta?.items ?? []).map((i) => ({
    varianteId: i.varianteId, sku: i.sku, descripcion: describirVariante(i), stock: null, cantidad: i.cantidad, precioLista: i.precioListaCentavos, precio: i.precioCentavos, tocado: true,
  })));
  const [pagos, setPagos] = useState<Pago[]>(() => (venta?.pagos ?? []).filter((p) => !p.fecha && p.estado === 'activo').map((p) => ({ formaPagoId: p.formaPagoId, importe: p.importeCentavos, usd: p.importeMonedaCentavos, tocado: true })));
  const [nuevoCliente, setNuevoCliente] = useState(false);
  useEffect(() => { if (!d.listaPrecioId && !venta && listas.data?.length) setD((x) => ({ ...x, listaPrecioId: listas.data![0].id })); }, [listas.data, d.listaPrecioId, venta]);

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

  const subtotal = lineas.reduce((s, l) => s + l.cantidad * (l.precio ?? 0), 0);
  const descuento = d.descuento ?? 0;
  const total = subtotal - descuento;
  const aCobrar = total - cobradoDespues;
  const lista = lineas.every((l) => l.precioLista != null) ? lineas.reduce((s, l) => s + l.cantidad * l.precioLista!, 0) : null;
  const cobrado = pagos.reduce((s, p) => s + (p.importe ?? 0), 0);
  // Con un solo pago que no se tocó a mano, el importe sigue al total.
  useEffect(() => { if (pagos.length === 1 && !pagos[0].tocado) setPagos((ps) => [{ ...ps[0], importe: Math.max(0, aCobrar) }]); }, [aCobrar, pagos.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (venta || pagos.length || !activas.length) return;
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
  const sinStock = lineas.filter((l) => l.stock != null && l.cantidad > l.stock);
  const saldo = aCobrar - cobrado;
  const cliente = clientes.data?.find((c) => c.id === d.clienteId);
  const errores: string[] = [];
  if (descuento > subtotal) errores.push('El descuento no puede ser mayor que el total.');
  if (descuento > 0 && !d.motivoDescuento.trim()) errores.push('Indicá el motivo del descuento.');
  if (saldo < 0) errores.push(`Lo cobrado supera el total por ${pesos(-saldo)}.`);
  if (saldo > 0 && !d.clienteId) errores.push(`Faltan ${pesos(saldo)}. Si queda debiendo, elegí el cliente.`);
  if (venta && !d.motivo.trim()) errores.push('Indicá el motivo de la corrección.');
  const valido = lineas.length > 0 && lineas.every((l) => l.cantidad > 0 && l.precio != null) && pagos.every((p) => (p.importe ?? 0) > 0) && !faltaUsd && !errores.length;

  const guardar = useMutation({
    mutationFn: () => {
      const cuerpo = {
        fecha: d.fecha, listaPrecioId: d.listaPrecioId || null, clienteId: d.clienteId, cliente: d.clienteId ? null : d.clienteTexto || null, notas: d.notas || null,
        descuentoCentavos: descuento, motivoDescuento: descuento ? d.motivoDescuento : null,
        items: lineas.map((l) => ({ varianteId: l.varianteId, cantidad: l.cantidad, precioCentavos: l.precio! })),
        pagos: pagos.map((p) => ({ formaPagoId: p.formaPagoId, importeCentavos: p.importe!, importeMonedaCentavos: forma(p.formaPagoId)?.moneda === 'USD' ? p.usd : null })),
      };
      return venta ? api.put<{ id: number; numero: number }>(`/ventas/${venta.id}`, { ...cuerpo, motivo: d.motivo }) : api.post<{ id: number; numero: number }>('/ventas', cuerpo, true);
    },
    onSuccess: (r) => { avisar(venta ? `Venta V-${r.numero} corregida` : `Venta V-${r.numero} registrada`); invalidarPlata(qc); qc.invalidateQueries({ queryKey: ['clientes'] }); nav(`/ventas/${r.id}`); },
    onError: avisarError,
  });

  return (
    <>
      <Link to={venta ? `/ventas/${venta.id}` : '/ventas'} className="mb-3 inline-flex items-center gap-1 text-sm text-carbon/60 hover:text-carbon"><ArrowLeft className="h-4 w-4" />{venta ? `Venta V-${venta.numero}` : 'Ventas'}</Link>
      <Encabezado titulo={venta ? `Editar venta V-${venta.numero}` : 'Nueva venta'} sub={venta ? 'Se guarda la versión anterior. El stock y la plata se corrigen con movimientos de ajuste (no se borra nada).' : undefined} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <div className="tarjeta grid gap-3 p-5 sm:grid-cols-3">
            <Campo etiqueta="Fecha"><input className="entrada" type="date" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></Campo>
            <Campo etiqueta="Lista de precios">
              <select className="entrada" value={d.listaPrecioId} onChange={(e) => setD({ ...d, listaPrecioId: Number(e.target.value) })}>{!d.listaPrecioId && <option value={0}>Sin lista</option>}{listas.data?.filter((l) => l.activo || l.id === d.listaPrecioId).map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</select>
            </Campo>
            <div>
              <span className="etiqueta mb-1 block">Cliente {saldo > 0 ? '' : '(opcional)'}</span>
              <div className="flex gap-1">
                <select className="entrada" value={d.clienteId ?? ''} onChange={(e) => setD({ ...d, clienteId: e.target.value ? Number(e.target.value) : null })} aria-label="Cliente">
                  <option value="">{d.clienteTexto ? `${d.clienteTexto} (sin ficha)` : 'Sin cliente'}</option>
                  {clientes.data?.filter((c) => c.activo || c.id === d.clienteId).map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.saldoCentavos > 0 ? ` · debe ${pesos(c.saldoCentavos)}` : ''}</option>)}
                </select>
                <button type="button" className="btn-secundario px-2" title="Nuevo cliente" aria-label="Nuevo cliente" onClick={() => setNuevoCliente(true)}><Plus className="h-4 w-4" /></button>
              </div>
              {cliente && cliente.saldoCentavos > 0 && <div className="mt-1 text-xs text-bordo">Ya debe {pesos(cliente.saldoCentavos)}</div>}
            </div>
          </div>
          <div className="tarjeta p-5">
            <Campo etiqueta="Agregar producto" ayuda="Escribí el código o pasá el lector de código de barras"><BuscadorVariante onElegir={agregar} autoFocus={!venta} mantenerFoco /></Campo>
            <div className="mt-4 overflow-x-auto">
              <table className="tabla">
                <thead><tr><th>Producto</th><th className="num w-20">Cant.</th><th className="num hidden sm:table-cell">Lista</th><th className="num w-36">Cobrado c/u</th><th className="num">Subtotal</th><th /></tr></thead>
                <tbody>
                  {lineas.map((l, i) => (
                    <tr key={l.varianteId}>
                      <td><b>{l.sku}</b><div className="text-xs text-carbon/55">{l.descripcion}</div>{l.stock != null && <div className={`text-xs ${l.cantidad > l.stock ? 'text-bordo' : 'text-carbon/40'}`}>stock {l.stock}</div>}</td>
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
          <div className="tarjeta grid gap-3 p-5 sm:grid-cols-3">
            <Campo etiqueta="Descuento sobre el total"><Importe valor={d.descuento} onCambio={(c) => setD({ ...d, descuento: c })} placeholder="0" /></Campo>
            <Campo etiqueta={descuento ? 'Motivo del descuento' : 'Motivo (si hay descuento)'} className="sm:col-span-2"><input className="entrada" value={d.motivoDescuento} onChange={(e) => setD({ ...d, motivoDescuento: e.target.value })} placeholder="Ej.: pago en efectivo, cliente frecuente" /></Campo>
            <Campo etiqueta="Notas" className="sm:col-span-3"><input className="entrada" value={d.notas} onChange={(e) => setD({ ...d, notas: e.target.value })} /></Campo>
            {venta && <Campo etiqueta="Motivo de la corrección (obligatorio)" className="sm:col-span-3"><input className="entrada" value={d.motivo} onChange={(e) => setD({ ...d, motivo: e.target.value })} placeholder="Ej.: se cargó mal el talle, cambió la forma de pago" /></Campo>}
          </div>
        </div>
        <div className="tarjeta h-fit min-w-0 space-y-4 p-5 lg:sticky lg:top-6">
          <div>
            <div className="etiqueta">Total</div>
            <div className="font-titulo text-4xl font-bold">{pesos(total)}</div>
            {descuento > 0 && <div className="text-sm text-carbon/60">Subtotal {pesos(subtotal)} − descuento {pesos(descuento)}</div>}
            {lista != null && lista !== subtotal && <div className={`text-sm ${subtotal < lista ? 'text-bordo' : 'text-carbon/60'}`}>Precios {subtotal < lista ? 'por debajo' : 'por encima'} de lista en {pesos(Math.abs(subtotal - lista))} ({pesos(lista)})</div>}
          </div>
          <div className="space-y-3 border-t border-arena pt-4">
            <div className="etiqueta">{venta ? 'Cobrado al vender' : 'Cobro'}</div>
            {cobradoDespues > 0 && <p className="text-xs text-carbon/55">Ya hay cobros posteriores por {pesos(cobradoDespues)}: no se tocan.</p>}
            {pagos.map((p, i) => {
              const fp = forma(p.formaPagoId);
              return (
                <div key={i} className="space-y-2 rounded-md border border-arena/60 p-3">
                  <div className="flex gap-2">
                    <select className="entrada" value={p.formaPagoId} onChange={(e) => setPagos(pagos.map((x, j) => (j === i ? { ...x, formaPagoId: Number(e.target.value) } : x)))}>
                      {activas.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                    </select>
                    {(pagos.length > 1 || d.clienteId) && <button className="p-1 text-carbon/40 hover:text-bordo" aria-label="Quitar pago" onClick={() => setPagos(pagos.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
                  </div>
                  <Importe valor={p.importe} onCambio={(c) => setPagos(pagos.map((x, j) => (j === i ? { ...x, importe: c, tocado: true } : x)))} placeholder="Importe en pesos" />
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
            <button className="text-sm text-conac underline" onClick={() => setPagos([...pagos, { formaPagoId: activas[0]?.id ?? 0, importe: Math.max(0, saldo), usd: null }])}>+ {pagos.length ? 'Otra forma de pago' : 'Agregar cobro'}</button>
            {saldo > 0 && d.clienteId && <Aviso tono="atencion">{cliente?.nombre ?? 'El cliente'} queda debiendo {pesos(saldo)}. Lo cobrás después desde la venta.</Aviso>}
            {errores.map((e) => <div key={e} className="text-sm text-bordo">{e}</div>)}
          </div>
          <button className="btn-primario w-full py-3 text-base" disabled={!valido || guardar.isPending || sinStock.length > 0} onClick={() => guardar.mutate()}>{guardar.isPending ? 'Guardando…' : venta ? 'Guardar corrección' : 'Confirmar venta'}</button>
        </div>
      </div>
      {nuevoCliente && <ModalCliente onCerrar={() => setNuevoCliente(false)} onListo={(c) => setD((x) => ({ ...x, clienteId: c.id, clienteTexto: '' }))} />}
    </>
  );
}

/** Alta o edición de un cliente. */
export function ModalCliente({ cliente, onCerrar, onListo }: { cliente?: Cliente; onCerrar: () => void; onListo?: (c: Cliente) => void }) {
  const qc = useQueryClient();
  const [c, setC] = useState({ nombre: cliente?.nombre ?? '', telefono: cliente?.telefono ?? '', email: cliente?.email ?? '', documento: cliente?.documento ?? '', notas: cliente?.notas ?? '', activo: cliente?.activo ?? true });
  const m = useMutation({
    mutationFn: () => (cliente ? api.put<Cliente>(`/clientes/${cliente.id}`, c) : api.post<Cliente>('/clientes', c)),
    onSuccess: (r) => { avisar(cliente ? 'Cliente actualizado' : `Cliente ${r.nombre} creado`); qc.invalidateQueries({ queryKey: ['clientes'] }); qc.invalidateQueries({ queryKey: ['ventas'] }); onListo?.(r); onCerrar(); },
    onError: avisarError,
  });
  return (
    <Modal titulo={cliente ? `Editar ${cliente.nombre}` : 'Nuevo cliente'} onCerrar={onCerrar}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (c.nombre.trim()) m.mutate(); }}>
        <Campo etiqueta="Nombre"><input className="entrada" value={c.nombre} onChange={(e) => setC({ ...c, nombre: e.target.value })} autoFocus /></Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Teléfono"><input className="entrada" value={c.telefono} onChange={(e) => setC({ ...c, telefono: e.target.value })} /></Campo>
          <Campo etiqueta="DNI / CUIT"><input className="entrada" value={c.documento} onChange={(e) => setC({ ...c, documento: e.target.value })} /></Campo>
        </div>
        <Campo etiqueta="Email"><input className="entrada" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></Campo>
        <Campo etiqueta="Notas"><input className="entrada" value={c.notas} onChange={(e) => setC({ ...c, notas: e.target.value })} /></Campo>
        {cliente && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.activo} onChange={(e) => setC({ ...c, activo: e.target.checked })} />Activo (si no, no aparece al vender)</label>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={!c.nombre.trim() || m.isPending}>Guardar</button></div>
      </form>
    </Modal>
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
  const [cobrar, setCobrar] = useState(false);
  const [anularCobro, setAnularCobro] = useState<Venta['pagos'][number] | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const anu = useMutation({
    mutationFn: () => api.post(`/ventas/${id}/anular`, { motivo }),
    onSuccess: () => { avisar('Venta anulada: volvió el stock y se revirtió la plata'); setAnular(false); setMotivo(''); invalidarPlata(qc); qc.invalidateQueries({ queryKey: ['clientes'] }); },
    onError: avisarError,
  });
  const anuCobro = useMutation({
    mutationFn: () => api.post(`/ventas/cobros/${anularCobro!.id}/anular`, { motivo }),
    onSuccess: () => { avisar('Cobro anulado: se revirtió la plata'); setAnularCobro(null); setMotivo(''); invalidarPlata(qc); qc.invalidateQueries({ queryKey: ['clientes'] }); },
    onError: avisarError,
  });
  if (v.isLoading) return <Cargando />;
  if (v.isError) return <ErrorCarga error={v.error} />;
  const k = v.data!;
  const costos = puede('costos');
  const vigente = k.estado === 'confirmada';
  const alVender = k.pagos.filter((p) => !p.fecha);
  const despues = k.pagos.filter((p) => p.fecha);
  const filaPago = (p: Venta['pagos'][number]) => (
    <div key={p.id} className={`border-b border-arena/40 py-2 text-sm last:border-0 ${p.estado === 'anulado' ? 'text-carbon/40' : ''}`}>
      <div className="flex justify-between gap-2"><span>{p.fecha && <span className="text-carbon/55">{fechaCorta(p.fecha)} · </span>}{p.forma}</span><b className={p.estado === 'anulado' ? 'line-through' : ''}>{pesos(p.importeCentavos)}</b></div>
      <div className="text-xs text-carbon/55">
        {p.estado === 'anulado' ? <>anulado: {p.motivoAnulacion}</> : <>
          {p.cuenta}{p.importeMonedaCentavos != null && ` · ${dolares(p.importeMonedaCentavos)}`} · comisión {p.comisionRealCentavos != null ? <>real {pesos(p.comisionRealCentavos)}</> : <>estimada {pesos(p.comisionEstimadaCentavos)}</>}
          {p.liquidacion && ' · liquidado'}
          {vigente && puede('ventas', 'modificar') && !p.liquidacion && <button className="ml-2 text-conac underline" onClick={() => setComision(p)}>cargar real</button>}
          {vigente && p.fecha && puede('ventas', 'anular') && <button className="ml-2 text-bordo underline" onClick={() => { setMotivo(''); setAnularCobro(p); }}>anular</button>}
        </>}
      </div>
    </div>
  );
  return (
    <>
      <Link to="/ventas" className="mb-3 inline-flex items-center gap-1 text-sm text-carbon/60 hover:text-carbon"><ArrowLeft className="h-4 w-4" />Ventas</Link>
      <Encabezado titulo={`Venta V-${k.numero}`} sub={<>{fechaCorta(k.fecha)}{k.lista && ` · lista ${k.lista}`}{k.cliente && <> · {k.clienteId ? <Link className="underline" to={`/ventas?cliente=${k.clienteId}&desde=2000-01-01`}>{k.cliente}</Link> : k.cliente}</>} · cargada {fechaHora(k.creadoEn)}{k.version > 1 && ` · corregida ${k.version - 1} ${k.version === 2 ? 'vez' : 'veces'}`}</>}>
        {vigente && k.saldoCentavos > 0 && puede('ventas', 'crear') && <button className="btn-primario" onClick={() => setCobrar(true)}><HandCoins className="h-4 w-4" />Registrar cobro</button>}
        {vigente && puede('ventas', 'modificar') && <Link className="btn-secundario" to={`/ventas/${k.id}/editar`}><Pencil className="h-4 w-4" />Editar</Link>}
        {vigente && puede('ventas', 'anular') && <button className="btn-secundario" onClick={() => { setMotivo(''); setAnular(true); }}>Anular</button>}
      </Encabezado>
      {k.estado === 'anulada' && <div className="mb-4"><Aviso tono="critico">Venta anulada: {k.motivoAnulacion}</Aviso></div>}
      {vigente && k.saldoCentavos > 0 && <div className="mb-4"><Aviso tono="atencion">{k.cliente ?? 'El cliente'} debe {pesos(k.saldoCentavos)} de esta venta.</Aviso></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <div className="tarjeta min-w-0 overflow-x-auto">
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
          {k.versiones.length > 0 && (
            <div className="tarjeta p-5">
              <div className="etiqueta mb-2">Correcciones</div>
              {k.versiones.map((x) => (
                <div key={x.id} className="flex items-baseline justify-between gap-2 border-b border-arena/40 py-2 text-sm last:border-0">
                  <span><span className="text-carbon/55">{fechaHora(x.fecha)} · </span>{x.motivo}</span>
                  <button className="shrink-0 text-xs text-conac underline" onClick={() => setVersion(x.version)}>ver cómo era</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div className="tarjeta space-y-2 p-5 text-sm">
            {k.descuentoCentavos > 0 && <>
              <Fila t="Subtotal" v={pesos(k.subtotalCentavos)} />
              <Fila t={`Descuento${k.motivoDescuento ? ` (${k.motivoDescuento})` : ''}`} v={pesos(-k.descuentoCentavos)} />
            </>}
            <Fila t="Total" v={<b className="font-titulo text-xl">{pesos(k.totalCentavos)}</b>} />
            <Fila t="Cobrado" v={pesos(k.cobradoCentavos)} />
            {k.saldoCentavos !== 0 && <Fila t="Falta cobrar" v={<b className="text-bordo">{pesos(k.saldoCentavos)}</b>} />}
            {k.diferenciaListaCentavos != null && k.diferenciaListaCentavos !== 0 && <Fila t="Diferencia vs lista" v={<span className={k.diferenciaListaCentavos < 0 ? 'text-bordo' : ''}>{pesos(k.diferenciaListaCentavos)}</span>} />}
            <Fila t="Comisiones" v={pesos(-k.comisionCentavos)} />
            {costos && <Fila t="Costo de mercadería" v={k.costoMercaderiaCentavos == null ? 'pendiente' : pesos(-k.costoMercaderiaCentavos)} />}
            {costos && <div className="border-t border-arena pt-2"><Fila t="Ganancia" v={<b>{k.gananciaCentavos == null ? 'falta el costo' : pesos(k.gananciaCentavos)}</b>} /></div>}
          </div>
          <div className="tarjeta p-5">
            <div className="etiqueta mb-2">Cobrado al vender</div>
            {alVender.length ? alVender.map(filaPago) : <p className="text-sm text-carbon/55">Nada: quedó todo a cobrar.</p>}
            {v.data!.efectivoRecibidoCentavos != null && <p className="mt-2 text-xs text-carbon/60">Pagó con {pesos(v.data!.efectivoRecibidoCentavos)} en efectivo · vuelto {pesos(v.data!.efectivoRecibidoCentavos - alVender.filter((p) => p.tipoCuenta === 'efectivo' && p.moneda === 'ARS').reduce((s, p) => s + p.importeCentavos, 0))}</p>}
            {despues.length > 0 && <>
              <div className="etiqueta mb-2 mt-4">Cobros posteriores</div>
              {despues.map(filaPago)}
            </>}
          </div>
        </div>
      </div>
      {anular && (
        <Confirmar titulo={`Anular venta V-${k.numero}`} textoBoton="Anular venta" peligro ocupado={anu.isPending} onCerrar={() => setAnular(false)} onConfirmar={() => anu.mutate()}>
          <p>Los productos vuelven al stock y la plata (incluidos los cobros posteriores) se descuenta de las cuentas donde había entrado, con movimientos de anulación: no se borra nada.</p>
          <Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: devolución, mal cargada" /></Campo>
        </Confirmar>
      )}
      {anularCobro && (
        <Confirmar titulo={`Anular cobro de ${pesos(anularCobro.importeCentavos)}`} textoBoton="Anular cobro" peligro ocupado={anuCobro.isPending} onCerrar={() => setAnularCobro(null)} onConfirmar={() => anuCobro.mutate()}>
          <p>La plata se descuenta de {anularCobro.cuenta} con un movimiento de anulación y la venta vuelve a quedar con saldo.</p>
          <Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
        </Confirmar>
      )}
      {comision && <ModalComision pago={comision} onCerrar={() => setComision(null)} onListo={() => invalidarPlata(qc)} />}
      {cobrar && <ModalCobro venta={k} onCerrar={() => setCobrar(false)} onListo={() => { invalidarPlata(qc); qc.invalidateQueries({ queryKey: ['clientes'] }); }} />}
      {version != null && <ModalVersion ventaId={k.id} version={version} onCerrar={() => setVersion(null)} />}
    </>
  );
}

function ModalCobro({ venta, onCerrar, onListo }: { venta: Venta; onCerrar: () => void; onListo: () => void }) {
  const formas = useFormasPago();
  const activas = (formas.data ?? []).filter((x) => x.activo);
  const [d, setD] = useState({ fecha: hoy(), formaPagoId: 0, importe: venta.saldoCentavos as number | null, usd: null as number | null });
  const fp = activas.find((x) => x.id === d.formaPagoId) ?? activas[0];
  const m = useMutation({
    mutationFn: () => api.post<{ saldoCentavos: number }>(`/ventas/${venta.id}/cobros`, { fecha: d.fecha, formaPagoId: fp!.id, importeCentavos: d.importe, importeMonedaCentavos: fp?.moneda === 'USD' ? d.usd : null }, true),
    onSuccess: (r) => { avisar(r.saldoCentavos > 0 ? `Cobro registrado. Todavía debe ${pesos(r.saldoCentavos)}` : 'Cobro registrado: venta saldada'); onListo(); onCerrar(); },
    onError: avisarError,
  });
  const valido = !!fp && !!d.importe && d.importe > 0 && d.importe <= venta.saldoCentavos && (fp.moneda !== 'USD' || !!d.usd);
  return (
    <Modal titulo={`Cobrar saldo de V-${venta.numero}`} onCerrar={onCerrar}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valido) m.mutate(); }}>
        <p className="text-sm">{venta.cliente ?? 'El cliente'} debe <b>{pesos(venta.saldoCentavos)}</b>.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Fecha"><input className="entrada" type="date" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></Campo>
          <Campo etiqueta="Forma de pago"><select className="entrada" value={fp?.id ?? 0} onChange={(e) => setD({ ...d, formaPagoId: Number(e.target.value) })}>{activas.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></Campo>
        </div>
        <Campo etiqueta="Importe"><Importe valor={d.importe} onCambio={(c) => setD({ ...d, importe: c })} /></Campo>
        {fp?.moneda === 'USD' && <Campo etiqueta="Dólares recibidos"><input className="entrada text-right" inputMode="decimal" value={d.usd == null ? '' : d.usd / 100} onChange={(e) => { const n = Number(e.target.value.replace(',', '.')); setD({ ...d, usd: e.target.value === '' || Number.isNaN(n) ? null : Math.round(n * 100) }); }} /></Campo>}
        {fp && <p className="text-xs text-carbon/55">Entra en {fp.cuenta}{fp.comisionBp > 0 && ` · comisión estimada ${pct(fp.comisionBp)}`}</p>}
        {d.importe != null && d.importe > venta.saldoCentavos && <p className="text-sm text-bordo">Es más de lo que debe.</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={!valido || m.isPending}>Registrar cobro</button></div>
      </form>
    </Modal>
  );
}

function ModalVersion({ ventaId, version, onCerrar }: { ventaId: number; version: number; onCerrar: () => void }) {
  const q = useQuery({ queryKey: ['venta-version', ventaId, version], queryFn: () => api.get<{ motivo: string; fecha: string; datos: Venta }>(`/ventas/${ventaId}/versiones/${version}`) });
  const x = q.data?.datos;
  return (
    <Modal titulo="Cómo era antes de la corrección" onCerrar={onCerrar} ancho="max-w-2xl">
      {q.isLoading ? <Cargando /> : q.isError ? <ErrorCarga error={q.error} /> : x && (
        <div className="space-y-3 text-sm">
          <p className="text-carbon/60">Corregida el {fechaHora(q.data!.fecha)}: {q.data!.motivo}</p>
          <p>{fechaCorta(x.fecha)}{x.cliente && ` · ${x.cliente}`}{x.lista && ` · lista ${x.lista}`}</p>
          <table className="tabla">
            <thead><tr><th>Producto</th><th className="num">Cant.</th><th className="num">c/u</th></tr></thead>
            <tbody>{x.items.map((i) => <tr key={i.id}><td>{i.sku}<div className="text-xs text-carbon/55">{describirVariante(i)}</div></td><td className="num">{i.cantidad}</td><td className="num">{pesos(i.precioCentavos)}</td></tr>)}</tbody>
          </table>
          {(x.descuentoCentavos ?? 0) > 0 && <Fila t="Descuento" v={pesos(-x.descuentoCentavos)} />}
          <Fila t="Total" v={<b>{pesos(x.totalCentavos)}</b>} />
          <div className="etiqueta">Cobros</div>
          {x.pagos.filter((p) => p.estado !== 'anulado').map((p) => <Fila key={p.id} t={`${p.fecha ? fechaCorta(p.fecha) + ' · ' : ''}${p.forma}`} v={pesos(p.importeCentavos)} />)}
        </div>
      )}
    </Modal>
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

