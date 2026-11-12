import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, PackageCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, qs } from '../api';
import { useSesion } from '../sesion';
import { describirVariante, type VarianteBuscada } from '../tipos';
import { Aviso, Campo, Cargando, Confirmar, Encabezado, ErrorCarga, Modal, Vacio, avisar, avisarError } from '../componentes/ui';
import { Importe } from '../componentes/Importe';
import { BuscadorVariante } from '../componentes/BuscadorVariante';
import { fecha as fmtFecha, fechaHora, pesos } from '../formato';

type Estado = 'borrador' | 'confirmada' | 'cerrada' | 'anulada';
interface CompraResumen { id: number; numero: number; proveedorId: number; proveedor: string; tipo: 'reventa' | 'confeccion'; fecha: string; fechaEsperada: string | null; estado: Estado; pedidas: number; recibidas: number; totalCentavos?: number; recibidoCentavos?: number }
interface ItemC { id: number; varianteId: number; sku: string; modelo: string; modeloId: number; color: string | null; talle: string | null; cantidad: number; costoUnitarioCentavos?: number; recibido: number; pendiente: number; notas: string | null }
interface Recepcion { id: number; numero: number; fecha: string; comprobante: string | null; notas: string | null; estado: 'activa' | 'anulada'; motivoAnulacion: string | null; items: { id: number; sku: string; cantidad: number; costoUnitarioCentavos?: number }[] }
interface Compra extends Omit<CompraResumen, 'pedidas' | 'recibidas'> { notas: string | null; items: ItemC[]; recepciones: Recepcion[] }
interface Proveedor { id: number; nombre: string; activo: boolean }

const ESTADOS: Record<Estado, [string, string]> = {
  borrador: ['Borrador', 'bg-arena/50 text-carbon/70'], confirmada: ['Pendiente de entrega', 'bg-conac-claro text-conac'],
  cerrada: ['Cerrado', 'bg-carbon/5 text-carbon/60'], anulada: ['Anulado', 'bg-carbon/5 text-carbon/40 line-through'],
};
export const TIPOS = { reventa: 'Reventa', confeccion: 'Confección (taller)' };
const hoy = () => new Date().toLocaleDateString('en-CA');

export function PaginaCompras() {
  const { puede } = useSesion();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const proveedorId = params.get('proveedor') ?? '';
  const estado = params.get('estado') ?? 'abiertos';
  const fijar = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const provs = useQuery({ queryKey: ['proveedores'], queryFn: () => api.get<Proveedor[]>('/proveedores'), enabled: puede('proveedores') });
  const lista = useQuery({ queryKey: ['compras', proveedorId, estado], queryFn: () => api.get<CompraResumen[]>('/compras' + qs({ proveedorId, estado: estado === 'abiertos' || estado === 'todos' ? '' : estado, pendientes: estado === 'abiertos' ? 'true' : '' })) });
  const resumen = useQuery({ queryKey: ['resumen-proveedor', proveedorId], queryFn: () => api.get<{ compras: number; recibidoCentavos?: number; unidadesPendientes: number; pendienteCentavos?: number; pagadoCentavos?: number; saldoCentavos?: number }>(`/proveedores/${proveedorId}/resumen`), enabled: !!proveedorId && puede('proveedores') });
  const verCostos = puede('costos');
  return (
    <>
      <Encabezado titulo="Compras" sub="Pedidos a proveedores y al taller, y lo que van entregando.">
        {puede('compras', 'crear') && verCostos && <Link className="btn-primario" to="/compras/nuevo"><Plus className="h-4 w-4" />Nuevo pedido</Link>}
      </Encabezado>
      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        <select className="entrada" value={proveedorId} onChange={(e) => fijar('proveedor', e.target.value)}>
          <option value="">Todos los proveedores</option>{provs.data?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <select className="entrada" value={estado} onChange={(e) => fijar('estado', e.target.value === 'abiertos' ? '' : e.target.value)}>
          <option value="abiertos">Abiertos (borrador o pendientes)</option><option value="confirmada">Pendientes de entrega</option><option value="cerrada">Cerrados</option><option value="anulada">Anulados</option><option value="todos">Todos</option>
        </select>
      </div>
      {resumen.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="tarjeta p-4"><div className="etiqueta">Pedidos</div><div className="mt-1 font-titulo text-2xl font-bold">{resumen.data.compras}</div></div>
          <div className="tarjeta p-4"><div className="etiqueta">Unidades por entregar</div><div className="mt-1 font-titulo text-2xl font-bold">{resumen.data.unidadesPendientes}</div></div>
          {verCostos && <div className="tarjeta p-4"><div className="etiqueta">Total recibido</div><div className="mt-1 font-titulo text-2xl font-bold">{pesos(resumen.data.recibidoCentavos)}</div><div className="text-xs text-carbon/50">Pagado {pesos(resumen.data.pagadoCentavos)} · {(resumen.data.saldoCentavos ?? 0) > 0 ? `se le debe ${pesos(resumen.data.saldoCentavos)}` : (resumen.data.saldoCentavos ?? 0) < 0 ? `a favor ${pesos(-(resumen.data.saldoCentavos ?? 0))}` : 'al día'}{puede('caja') && <> · <Link className="underline" to={`/pagos?proveedor=${proveedorId}`}>cuenta corriente</Link></>}</div></div>}
        </div>
      )}
      {lista.isLoading ? <Cargando /> : lista.isError ? <ErrorCarga error={lista.error} /> : !lista.data!.length ? <Vacio>No hay pedidos con ese filtro.</Vacio> : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead><tr><th>N°</th><th>Fecha</th><th>Proveedor</th><th className="hidden md:table-cell">Tipo</th><th className="num">Recibido</th>{verCostos && <th className="num">Total</th>}<th>Estado</th></tr></thead>
            <tbody>
              {lista.data!.map((c) => (
                <tr key={c.id} className="cursor-pointer" onClick={() => nav(`/compras/${c.id}`)}>
                  <td className="font-medium">P-{c.numero}</td><td>{fmtFecha(c.fecha + 'T12:00')}</td><td>{c.proveedor}</td>
                  <td className="hidden md:table-cell">{TIPOS[c.tipo]}</td>
                  <td className="num">{c.recibidas} / {c.pedidas}</td>
                  {verCostos && <td className="num">{pesos(c.totalCentavos)}</td>}
                  <td><span className={`pildora ${ESTADOS[c.estado][1]}`}>{ESTADOS[c.estado][0]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

interface Linea { varianteId: number; sku: string; descripcion: string; cantidad: number; costoUnitarioCentavos: number | null }

export function PaginaCompraForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const editando = !!id;
  const provs = useQuery({ queryKey: ['proveedores'], queryFn: () => api.get<Proveedor[]>('/proveedores') });
  const existente = useQuery({ queryKey: ['compra', id], queryFn: () => api.get<Compra>(`/compras/${id}`), enabled: editando });
  const [d, setD] = useState({ proveedorId: 0, tipo: 'reventa' as 'reventa' | 'confeccion', fecha: hoy(), fechaEsperada: '', notas: '' });
  const [lineas, setLineas] = useState<Linea[]>([]);
  useEffect(() => {
    const c = existente.data;
    if (!c) return;
    setD({ proveedorId: c.proveedorId, tipo: c.tipo, fecha: c.fecha.slice(0, 10), fechaEsperada: c.fechaEsperada?.slice(0, 10) ?? '', notas: c.notas ?? '' });
    setLineas(c.items.map((i) => ({ varianteId: i.varianteId, sku: i.sku, descripcion: describirVariante(i), cantidad: i.cantidad, costoUnitarioCentavos: i.costoUnitarioCentavos ?? null })));
  }, [existente.data]);
  const agregar = (v: VarianteBuscada) => {
    const ya = lineas.find((l) => l.varianteId === v.varianteId);
    if (ya) setLineas(lineas.map((l) => (l === ya ? { ...l, cantidad: l.cantidad + 1 } : l)));
    else setLineas([...lineas, { varianteId: v.varianteId, sku: v.sku, descripcion: describirVariante(v), cantidad: 1, costoUnitarioCentavos: d.tipo === 'reventa' ? v.costoCentavos ?? null : lineas.at(-1)?.costoUnitarioCentavos ?? null }]);
  };
  const total = lineas.reduce((s, l) => s + l.cantidad * (l.costoUnitarioCentavos ?? 0), 0);
  const valido = d.proveedorId && lineas.length && lineas.every((l) => l.cantidad > 0 && l.costoUnitarioCentavos != null);
  const guardar = useMutation({
    mutationFn: (confirmar: boolean) => {
      const cuerpo = { ...d, fechaEsperada: d.fechaEsperada || null, notas: d.notas || null, items: lineas.map((l) => ({ varianteId: l.varianteId, cantidad: l.cantidad, costoUnitarioCentavos: l.costoUnitarioCentavos! })) };
      if (editando) return api.put(`/compras/${id}`, cuerpo).then(async () => { if (confirmar) await api.post(`/compras/${id}/estado`, { accion: 'confirmar' }); return { id: Number(id) }; });
      return api.post<{ id: number }>('/compras', { ...cuerpo, confirmar }, true);
    },
    onSuccess: (r) => { avisar('Pedido guardado'); qc.invalidateQueries({ queryKey: ['compras'] }); qc.invalidateQueries({ queryKey: ['compra'] }); nav(`/compras/${r.id}`); },
    onError: avisarError,
  });
  if (editando && existente.isLoading) return <Cargando />;
  if (existente.data && existente.data.estado !== 'borrador') return <Aviso tono="atencion">Este pedido ya está confirmado: no se edita. Volvé al <Link className="underline" to={`/compras/${id}`}>pedido</Link>.</Aviso>;

  return (
    <>
      <Link to={editando ? `/compras/${id}` : '/compras'} className="mb-3 inline-flex items-center gap-1 text-sm text-carbon/60 hover:text-carbon"><ArrowLeft className="h-4 w-4" />Volver</Link>
      <Encabezado titulo={editando ? `Editar pedido P-${existente.data?.numero}` : 'Nuevo pedido'} />
      <div className="tarjeta mb-4 grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Campo etiqueta="Proveedor / taller">
          <select className="entrada" value={d.proveedorId} onChange={(e) => setD({ ...d, proveedorId: Number(e.target.value) })}>
            <option value={0}>Elegí…</option>{provs.data?.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Tipo" ayuda={d.tipo === 'confeccion' ? 'Se paga la confección: suma stock pero no cambia el costo del producto' : 'Producto terminado: actualiza el costo promedio'}>
          <select className="entrada" value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value as typeof d.tipo })}><option value="reventa">{TIPOS.reventa}</option><option value="confeccion">{TIPOS.confeccion}</option></select>
        </Campo>
        <Campo etiqueta="Fecha del pedido"><input className="entrada" type="date" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></Campo>
        <Campo etiqueta="Entrega esperada"><input className="entrada" type="date" value={d.fechaEsperada} onChange={(e) => setD({ ...d, fechaEsperada: e.target.value })} /></Campo>
        <Campo etiqueta="Notas" className="sm:col-span-2 lg:col-span-4"><input className="entrada" value={d.notas} onChange={(e) => setD({ ...d, notas: e.target.value })} /></Campo>
      </div>
      <div className="tarjeta p-5">
        <Campo etiqueta="Agregar producto"><BuscadorVariante onElegir={agregar} mantenerFoco /></Campo>
        <div className="mt-4 overflow-x-auto">
          <table className="tabla">
            <thead><tr><th>Producto</th><th className="num w-24">Cantidad</th><th className="num w-40">{d.tipo === 'confeccion' ? 'Confección c/u' : 'Costo c/u'}</th><th className="num">Subtotal</th><th /></tr></thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={l.varianteId}>
                  <td><b>{l.sku}</b><div className="text-xs text-carbon/55">{l.descripcion}</div></td>
                  <td><input className="entrada py-1 text-right" type="number" min={1} value={l.cantidad} onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, cantidad: Math.max(0, Number(e.target.value)) } : x)))} /></td>
                  <td><Importe valor={l.costoUnitarioCentavos} onCambio={(c) => setLineas(lineas.map((x, j) => (j === i ? { ...x, costoUnitarioCentavos: c } : x)))} /></td>
                  <td className="num">{pesos(l.cantidad * (l.costoUnitarioCentavos ?? 0))}</td>
                  <td className="text-right"><button className="p-1 text-carbon/40 hover:text-bordo" aria-label="Quitar" onClick={() => setLineas(lineas.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
              {!lineas.length && <tr><td colSpan={5} className="py-6 text-center text-carbon/50">Buscá productos para agregarlos.</td></tr>}
            </tbody>
            {lineas.length > 0 && <tfoot><tr><td className="px-3 py-2 font-medium">{lineas.reduce((s, l) => s + l.cantidad, 0)} unidades</td><td /><td /><td className="num px-3 py-2 font-titulo text-lg font-bold">{pesos(total)}</td><td /></tr></tfoot>}
          </table>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button className="btn-secundario" disabled={!valido || guardar.isPending} onClick={() => guardar.mutate(false)}>Guardar borrador</button>
        <button className="btn-primario" disabled={!valido || guardar.isPending} onClick={() => guardar.mutate(true)}>Confirmar pedido</button>
      </div>
    </>
  );
}

export function PaginaCompra() {
  const { id } = useParams();
  const { puede } = useSesion();
  const qc = useQueryClient();
  const c = useQuery({ queryKey: ['compra', id], queryFn: () => api.get<Compra>(`/compras/${id}`) });
  const [recibir, setRecibir] = useState(false);
  const [accion, setAccion] = useState<'confirmar' | 'cerrar' | 'anular' | null>(null);
  const [anularRec, setAnularRec] = useState<Recepcion | null>(null);
  const [motivo, setMotivo] = useState('');
  const inv = () => { qc.invalidateQueries({ queryKey: ['compra', id] }); qc.invalidateQueries({ queryKey: ['compras'] }); qc.invalidateQueries({ queryKey: ['stock'] }); };
  const estado = useMutation({
    mutationFn: (a: NonNullable<typeof accion>) => api.post(`/compras/${id}/estado`, { accion: a, motivo }),
    onSuccess: () => { avisar('Listo'); setAccion(null); setMotivo(''); inv(); }, onError: avisarError,
  });
  const anular = useMutation({
    mutationFn: () => api.post<{ costosARevisar: string[] }>(`/recepciones/${anularRec!.id}/anular`, { motivo }),
    onSuccess: (r) => { avisar(r.costosARevisar.length ? `Anulada. Revisá a mano el costo de: ${r.costosARevisar.join(', ')}` : 'Recepción anulada'); setAnularRec(null); setMotivo(''); inv(); },
    onError: avisarError,
  });
  if (c.isLoading) return <Cargando />;
  if (c.isError) return <ErrorCarga error={c.error} />;
  const k = c.data!;
  const verCostos = puede('costos');
  const pendientes = k.items.reduce((s, i) => s + i.pendiente, 0);
  return (
    <>
      <Link to="/compras" className="mb-3 inline-flex items-center gap-1 text-sm text-carbon/60 hover:text-carbon"><ArrowLeft className="h-4 w-4" />Compras</Link>
      <Encabezado titulo={`Pedido P-${k.numero}`} sub={<>{k.proveedor} · {TIPOS[k.tipo]} · {fmtFecha(k.fecha + 'T12:00')}{k.fechaEsperada && ` · entrega esperada ${fmtFecha(k.fechaEsperada + 'T12:00')}`} · <span className={`pildora ${ESTADOS[k.estado][1]}`}>{ESTADOS[k.estado][0]}</span></>}>
        {k.estado === 'borrador' && puede('compras', 'modificar') && verCostos && <Link className="btn-secundario" to={`/compras/${k.id}/editar`}><Pencil className="h-4 w-4" />Editar</Link>}
        {k.estado === 'borrador' && puede('compras', 'crear') && <button className="btn-primario" onClick={() => setAccion('confirmar')}>Confirmar pedido</button>}
        {k.estado === 'confirmada' && puede('compras', 'crear') && <button className="btn-primario" onClick={() => setRecibir(true)}><PackageCheck className="h-4 w-4" />Recibir</button>}
        {k.estado === 'confirmada' && puede('compras', 'modificar') && <button className="btn-secundario" onClick={() => setAccion('cerrar')}>Cerrar con pendientes</button>}
        {k.estado !== 'anulada' && !k.recepciones.some((r) => r.estado === 'activa') && puede('compras', 'anular') && <button className="btn-secundario" onClick={() => setAccion('anular')}>Anular</button>}
      </Encabezado>
      {k.notas && <p className="mb-4 text-sm text-carbon/70">{k.notas}</p>}
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead><tr><th>Producto</th><th className="num">Pedido</th><th className="num">Recibido</th><th className="num">Falta</th>{verCostos && <th className="num">{k.tipo === 'confeccion' ? 'Confección c/u' : 'Costo c/u'}</th>}{verCostos && <th className="num">Subtotal</th>}</tr></thead>
          <tbody>
            {k.items.map((i) => (
              <tr key={i.id}>
                <td><Link className="font-medium hover:underline" to={`/catalogo/${i.modeloId}`}>{i.sku}</Link><div className="text-xs text-carbon/55">{describirVariante(i)}</div></td>
                <td className="num">{i.cantidad}</td><td className="num">{i.recibido}</td>
                <td className={`num ${i.pendiente > 0 && k.estado === 'confirmada' ? 'font-medium text-conac' : 'text-carbon/40'}`}>{i.pendiente}</td>
                {verCostos && <td className="num">{pesos(i.costoUnitarioCentavos)}</td>}
                {verCostos && <td className="num">{pesos((i.costoUnitarioCentavos ?? 0) * i.cantidad)}</td>}
              </tr>
            ))}
          </tbody>
          {verCostos && <tfoot><tr><td className="px-3 py-2" colSpan={4}>Recibido valorizado: <b>{pesos(k.recibidoCentavos)}</b></td><td /><td className="num px-3 py-2 font-titulo text-lg font-bold">{pesos(k.totalCentavos)}</td></tr></tfoot>}
        </table>
      </div>
      <h2 className="mb-3 mt-8 text-xl font-bold">Recepciones</h2>
      {!k.recepciones.length ? <Vacio>Todavía no entregó nada.</Vacio> : (
        <div className="space-y-3">
          {k.recepciones.map((r) => (
            <div key={r.id} className={`tarjeta p-4 ${r.estado === 'anulada' ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <b>R-{r.numero}</b> · {fmtFecha(r.fecha + 'T12:00')}{r.comprobante && ` · comprobante ${r.comprobante}`}
                  {r.estado === 'anulada' && <span className="ml-2 pildora bg-bordo-claro text-bordo">Anulada: {r.motivoAnulacion}</span>}
                </div>
                {r.estado === 'activa' && puede('compras', 'anular') && <button className="btn-secundario btn-chico" onClick={() => setAnularRec(r)}>Anular</button>}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">{r.items.map((i) => <span key={i.id}>{i.sku} × <b>{i.cantidad}</b>{verCostos && i.costoUnitarioCentavos != null && <span className="text-carbon/50"> a {pesos(i.costoUnitarioCentavos)}</span>}</span>)}</div>
              {r.notas && <div className="mt-1 text-xs text-carbon/60">{r.notas}</div>}
            </div>
          ))}
        </div>
      )}
      {recibir && <ModalRecepcion compra={k} onCerrar={() => setRecibir(false)} onListo={inv} />}
      {accion && (
        <Confirmar titulo={accion === 'confirmar' ? 'Confirmar pedido' : accion === 'cerrar' ? 'Cerrar con pendientes' : 'Anular pedido'} textoBoton={accion === 'confirmar' ? 'Confirmar' : accion === 'cerrar' ? 'Cerrar' : 'Anular'} peligro={accion === 'anular'}
          ocupado={estado.isPending} onCerrar={() => { setAccion(null); setMotivo(''); }} onConfirmar={() => estado.mutate(accion)}>
          {accion === 'confirmar' && <p>Una vez confirmado ya no se edita: queda esperando las entregas.</p>}
          {accion === 'cerrar' && <><p>Quedan <b>{pendientes}</b> unidades sin entregar que se dan por no recibidas.</p><Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo></>}
          {accion === 'anular' && <><p>El pedido queda anulado (no se borra).</p><Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo></>}
        </Confirmar>
      )}
      {anularRec && (
        <Confirmar titulo={`Anular recepción R-${anularRec.numero}`} textoBoton="Anular" peligro ocupado={anular.isPending} onCerrar={() => { setAnularRec(null); setMotivo(''); }} onConfirmar={() => anular.mutate()}>
          <p>Se descuenta del stock lo que entró con esta recepción (con un movimiento de anulación) y las unidades vuelven a quedar pendientes en el pedido.</p>
          <Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
        </Confirmar>
      )}
    </>
  );
}

function ModalRecepcion({ compra, onCerrar, onListo }: { compra: Compra; onCerrar: () => void; onListo: () => void }) {
  const { puede } = useSesion();
  const items = compra.items.filter((i) => i.pendiente > 0);
  const [cant, setCant] = useState<Record<number, number>>(Object.fromEntries(items.map((i) => [i.id, i.pendiente])));
  const [costos, setCostos] = useState<Record<number, number | null>>({});
  const [d, setD] = useState({ fecha: hoy(), comprobante: '', notas: '' });
  const editaCosto = puede('costos', 'modificar');
  const total = items.reduce((s, i) => s + (cant[i.id] ?? 0), 0);
  const guardar = useMutation({
    mutationFn: () => api.post<{ numero: number; pedidoCerrado: boolean; cambiosCosto?: { sku: string }[] }>(`/compras/${compra.id}/recepciones`, {
      ...d, comprobante: d.comprobante || null, notas: d.notas || null,
      items: items.map((i) => ({ compraItemId: i.id, cantidad: cant[i.id] ?? 0, ...(editaCosto && costos[i.id] != null && costos[i.id] !== i.costoUnitarioCentavos ? { costoUnitarioCentavos: costos[i.id] } : {}) })),
    }, true),
    onSuccess: (r) => { avisar(`Recepción R-${r.numero} registrada${r.cambiosCosto?.length ? ` · se actualizó el costo de ${r.cambiosCosto.length} productos` : ''}`); onListo(); onCerrar(); },
    onError: avisarError,
  });
  return (
    <Modal titulo={`Recibir · pedido P-${compra.numero}`} onCerrar={onCerrar} ancho="max-w-2xl">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Fecha de entrega"><input className="entrada" type="date" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></Campo>
          <Campo etiqueta="Remito / factura"><input className="entrada" value={d.comprobante} onChange={(e) => setD({ ...d, comprobante: e.target.value })} /></Campo>
        </div>
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead><tr><th>Producto</th><th className="num">Falta</th><th className="num w-24">Llegó</th>{editaCosto && <th className="num w-36">Costo c/u</th>}</tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td><b>{i.sku}</b><div className="text-xs text-carbon/55">{describirVariante(i)}</div></td>
                  <td className="num">{i.pendiente}</td>
                  <td><input className="entrada py-1 text-right" type="number" min={0} max={i.pendiente} value={cant[i.id] ?? 0} onChange={(e) => setCant({ ...cant, [i.id]: Math.min(i.pendiente, Math.max(0, Number(e.target.value))) })} /></td>
                  {editaCosto && <td><Importe valor={costos[i.id] ?? i.costoUnitarioCentavos} onCambio={(c) => setCostos({ ...costos, [i.id]: c })} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2 text-xs">
          <button className="text-conac underline" onClick={() => setCant(Object.fromEntries(items.map((i) => [i.id, i.pendiente])))}>Llegó todo</button>
          <button className="text-conac underline" onClick={() => setCant(Object.fromEntries(items.map((i) => [i.id, 0])))}>Poner todo en 0</button>
        </div>
        {compra.tipo === 'reventa' && <p className="text-xs text-carbon/55">Al recibir se recalcula el costo de cada producto por promedio ponderado (stock actual × costo actual + lo que llega × su costo).</p>}
        <Campo etiqueta="Notas"><input className="entrada" value={d.notas} onChange={(e) => setD({ ...d, notas: e.target.value })} /></Campo>
        <div className="flex justify-end gap-2">
          <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn-primario" disabled={!total || guardar.isPending} onClick={() => guardar.mutate()}>{guardar.isPending ? 'Guardando…' : `Recibir ${total} unidades`}</button>
        </div>
      </div>
    </Modal>
  );
}
