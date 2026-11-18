import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, PackageCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, qs } from '../api';
import { useSesion } from '../sesion';
import { describirVariante, type VarianteBuscada } from '../tipos';
import { Aviso, Campo, Cargando, Confirmar, Encabezado, ErrorCarga, Modal, Vacio, avisar, avisarError } from '../componentes/ui';
import { Th, coincide, useOrden } from '../componentes/Orden';
import { Importe } from '../componentes/Importe';
import { BuscadorVariante } from '../componentes/BuscadorVariante';
import { fecha as fmtFecha, fechaHora, pesos } from '../formato';
import { Adjuntos } from '../componentes/Adjuntos';
import { CONDICIONES, CamposComprobante, comprobanteDe, comprobanteValido, comprobanteVacio, cuerpoComprobante, type CondicionPago } from '../componentes/Comprobante';
import { cant, conColor, leerCant, useMateriales, type Unidad } from '../costos';
import { SelectorColor } from '../componentes/SelectorColor';
import { Abastecimiento } from './Abastecimiento';

type Estado = 'borrador' | 'confirmada' | 'cerrada' | 'anulada';
type TipoCompra = 'reventa' | 'confeccion' | 'materiales';
type EstadoPedido = 'pendiente_solicitar' | 'solicitado' | 'pendiente_entrega' | 'entrega_parcial' | 'entregado' | 'cerrado_incompleto' | 'cancelado';
interface Comp { comprobante: string | null; fechaComprobante: string | null; descuentoCentavos: number; impuestosCentavos: number; condicionPago: CondicionPago | null; plazoPagoDias: number | null; vencimiento: string | null }
interface CompraResumen extends Comp {
  id: number; numero: number; proveedorId: number; proveedor: string; tipo: TipoCompra; fecha: string; fechaEsperada: string | null; estado: Estado; estadoPedido: EstadoPedido;
  pedidas: number; recibidas: number; totalCentavos?: number; recibidoCentavos?: number; vencimientoEfectivo: string | null; aPagarCentavos?: number; pagadoCentavos?: number; saldoCentavos?: number;
}
interface ItemC { id: number; varianteId: number; sku: string; modelo: string; modeloId: number; color: string | null; talle: string | null; cantidad: number; costoUnitarioCentavos?: number; recibido: number; pendiente: number; notas: string | null }
interface LineaMat { id: number; materialId: number; colorId: number | null; color: string | null; codigo: string; material: string; unidad: Unidad; cantidadMil: number; costoUnitarioCentavos?: number; recibidoMil: number; pendienteMil: number; notas: string | null }
interface Recepcion {
  id: number; numero: number; fecha: string; comprobante: string | null; notas: string | null; estado: 'activa' | 'anulada'; motivoAnulacion: string | null;
  items: { id: number; sku: string; cantidad: number; costoUnitarioCentavos?: number }[]; materiales: { id: number; material: string; unidad: Unidad; cantidadMil: number; costoUnitarioCentavos?: number }[];
}
interface Compra extends Omit<CompraResumen, 'pedidas' | 'recibidas'> { notas: string | null; items: ItemC[]; materiales: LineaMat[]; recepciones: Recepcion[]; pagos: { pagoId: number; numero: number; fecha: string; importeCentavos: number; totalPagoCentavos: number }[] }
interface Proveedor { id: number; nombre: string; activo: boolean; condicionPago: CondicionPago | null; plazoPagoDias: number | null }

export const ESTADOS_PEDIDO: Record<EstadoPedido, [string, string]> = {
  pendiente_solicitar: ['Pendiente de solicitar', 'bg-arena/50 text-carbon/70'], solicitado: ['Solicitado', 'bg-conac-claro text-conac'],
  pendiente_entrega: ['Pendiente de entrega', 'bg-bordo-claro text-bordo'], entrega_parcial: ['Entrega parcial', 'bg-conac-claro text-conac'],
  entregado: ['Entregado', 'bg-carbon/5 text-carbon/60'], cerrado_incompleto: ['Cerrado incompleto', 'bg-carbon/5 text-carbon/60'], cancelado: ['Cancelado', 'bg-carbon/5 text-carbon/40 line-through'],
};
const Estado = ({ e }: { e: EstadoPedido }) => <span className={`pildora ${ESTADOS_PEDIDO[e][1]}`}>{ESTADOS_PEDIDO[e][0]}</span>;
const vencido = (c: { vencimientoEfectivo: string | null; saldoCentavos?: number }) => !!c.vencimientoEfectivo && (c.saldoCentavos ?? 0) > 0 && c.vencimientoEfectivo < hoy();
export const TIPOS: Record<TipoCompra, string> = { reventa: 'Reventa', confeccion: 'Confección (taller)', materiales: 'Materiales' };
const hoy = () => new Date().toLocaleDateString('en-CA');

export function PaginaCompras() {
  const { puede } = useSesion();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const proveedorId = params.get('proveedor') ?? '';
  const estado = params.get('estado') ?? 'abiertos';
  const fijar = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const provs = useQuery({ queryKey: ['proveedores'], queryFn: () => api.get<Proveedor[]>('/proveedores'), enabled: puede('proveedores') });
  const lista = useQuery({ queryKey: ['compras', proveedorId, estado], queryFn: () => api.get<CompraResumen[]>('/compras' + qs({ proveedorId, estadoPedido: estado === 'abiertos' || estado === 'todos' || estado === 'con_saldo' ? '' : estado, pendientes: estado === 'abiertos' ? 'true' : '' })) });
  const resumen = useQuery({ queryKey: ['resumen-proveedor', proveedorId], queryFn: () => api.get<{ compras: number; recibidoCentavos?: number; unidadesPendientes: number; pendienteCentavos?: number; pagadoCentavos?: number; saldoCentavos?: number }>(`/proveedores/${proveedorId}/resumen`), enabled: !!proveedorId && puede('proveedores') });
  const verCostos = puede('costos');
  const [q, setQ] = useState('');
  const { filas: compras, orden } = useOrden((lista.data ?? []).filter((c) => coincide(q, `P-${c.numero}`, c.proveedor, c.comprobante) && (estado !== 'con_saldo' || (c.saldoCentavos ?? 0) > 0)), {
    numero: (c) => c.numero, fecha: (c) => c.fecha, proveedor: (c) => c.proveedor, tipo: (c) => TIPOS[c.tipo], recibido: (c) => (c.pedidas ? c.recibidas / c.pedidas : 0), total: (c) => c.totalCentavos, estado: (c) => ESTADOS_PEDIDO[c.estadoPedido][0],
    vence: (c) => ((c.saldoCentavos ?? 0) > 0 ? c.vencimientoEfectivo : null), saldo: (c) => c.saldoCentavos,
  }, { col: 'numero', dir: 'desc' });
  return (
    <>
      <Encabezado titulo="Compras" sub="Pedidos a proveedores y al taller, y lo que van entregando.">
        {puede('compras', 'crear') && verCostos && <Link className="btn-primario" to="/compras/nuevo"><Plus className="h-4 w-4" />Nuevo pedido</Link>}
      </Encabezado>
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <input className="entrada" placeholder="Buscar por N°, proveedor o factura" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="entrada" value={proveedorId} onChange={(e) => fijar('proveedor', e.target.value)}>
          <option value="">Todos los proveedores</option>{provs.data?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <select className="entrada" value={estado} onChange={(e) => fijar('estado', e.target.value === 'abiertos' ? '' : e.target.value)}>
          <option value="abiertos">Abiertos (sin solicitar o sin terminar de entregar)</option>
          {Object.entries(ESTADOS_PEDIDO).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
          {verCostos && <option value="con_saldo">Con saldo a pagar</option>}<option value="todos">Todos</option>
        </select>
      </div>
      {resumen.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="tarjeta p-4"><div className="etiqueta">Pedidos</div><div className="mt-1 font-titulo text-2xl font-bold">{resumen.data.compras}</div></div>
          <div className="tarjeta p-4"><div className="etiqueta">Unidades por entregar</div><div className="mt-1 font-titulo text-2xl font-bold">{resumen.data.unidadesPendientes}</div></div>
          {verCostos && <div className="tarjeta p-4"><div className="etiqueta">Total recibido</div><div className="mt-1 font-titulo text-2xl font-bold">{pesos(resumen.data.recibidoCentavos)}</div><div className="text-xs text-carbon/50">Pagado {pesos(resumen.data.pagadoCentavos)} · {(resumen.data.saldoCentavos ?? 0) > 0 ? `se le debe ${pesos(resumen.data.saldoCentavos)}` : (resumen.data.saldoCentavos ?? 0) < 0 ? `a favor ${pesos(-(resumen.data.saldoCentavos ?? 0))}` : 'al día'}{puede('caja') && <> · <Link className="underline" to={`/pagos?proveedor=${proveedorId}`}>cuenta corriente</Link></>}</div></div>}
        </div>
      )}
      {lista.isLoading ? <Cargando /> : lista.isError ? <ErrorCarga error={lista.error} /> : !compras.length ? <Vacio>No hay pedidos con ese filtro.</Vacio> : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead><tr><Th col="numero" orden={orden}>N°</Th><Th col="fecha" orden={orden}>Fecha</Th><Th col="proveedor" orden={orden}>Proveedor</Th><Th col="tipo" orden={orden} className="hidden md:table-cell">Tipo</Th><Th col="recibido" orden={orden} className="num">Recibido</Th>{verCostos && <Th col="total" orden={orden} className="num">Total</Th>}{verCostos && <Th col="saldo" orden={orden} className="num hidden sm:table-cell">Saldo</Th>}{verCostos && <Th col="vence" orden={orden} className="hidden md:table-cell">Vence</Th>}<Th col="estado" orden={orden}>Estado</Th></tr></thead>
            <tbody>
              {compras.map((c) => (
                <tr key={c.id} className="cursor-pointer" onClick={() => nav(`/compras/${c.id}`)}>
                  <td className="font-medium">P-{c.numero}</td><td>{fmtFecha(c.fecha + 'T12:00')}</td><td>{c.proveedor}</td>
                  <td className="hidden md:table-cell">{TIPOS[c.tipo]}</td>
                  <td className="num">{c.tipo === 'materiales' ? `${c.pedidas ? Math.round((c.recibidas * 100) / c.pedidas) : 0}%` : `${c.recibidas} / ${c.pedidas}`}</td>
                  {verCostos && <td className="num">{pesos(c.totalCentavos)}</td>}
                  {verCostos && <td className={`num hidden sm:table-cell ${(c.saldoCentavos ?? 0) > 0 ? '' : 'text-carbon/40'}`}>{(c.saldoCentavos ?? 0) !== 0 ? pesos(c.saldoCentavos) : '—'}</td>}
                  {verCostos && <td className={`hidden md:table-cell whitespace-nowrap ${vencido(c) ? 'font-medium text-bordo' : ''}`}>{(c.saldoCentavos ?? 0) > 0 && c.vencimientoEfectivo ? fmtFecha(c.vencimientoEfectivo + 'T12:00') : '—'}</td>}
                  <td><Estado e={c.estadoPedido} /></td>
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
interface LineaMatForm { materialId: number; colorId?: number | null; porColor: boolean; codigo: string; nombre: string; unidad: Unidad; texto: string; costoUnitarioCentavos: number | null }

export function PaginaCompraForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const editando = !!id;
  const provs = useQuery({ queryKey: ['proveedores'], queryFn: () => api.get<Proveedor[]>('/proveedores') });
  const existente = useQuery({ queryKey: ['compra', id], queryFn: () => api.get<Compra>(`/compras/${id}`), enabled: editando });
  const [d, setD] = useState({ proveedorId: 0, tipo: 'reventa' as TipoCompra, fecha: hoy(), fechaEsperada: '', notas: '' });
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [mats, setMats] = useState<LineaMatForm[]>([]);
  const esMat = d.tipo === 'materiales';
  const materiales = useMateriales(esMat);
  const [comp, setComp] = useState(comprobanteVacio());
  const provSel = provs.data?.find((p) => p.id === d.proveedorId);
  // Al elegir proveedor se propone su condición habitual (se puede cambiar para esta operación).
  useEffect(() => { if (!editando && provSel) setComp((x) => ({ ...x, condicionPago: provSel.condicionPago ?? '', plazoPagoDias: provSel.plazoPagoDias })); }, [provSel?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const c = existente.data;
    if (!c) return;
    setComp(comprobanteDe(c));
    setD({ proveedorId: c.proveedorId, tipo: c.tipo, fecha: c.fecha.slice(0, 10), fechaEsperada: c.fechaEsperada?.slice(0, 10) ?? '', notas: c.notas ?? '' });
    setLineas(c.items.map((i) => ({ varianteId: i.varianteId, sku: i.sku, descripcion: describirVariante(i), cantidad: i.cantidad, costoUnitarioCentavos: i.costoUnitarioCentavos ?? null })));
    setMats(c.materiales.map((m) => ({ materialId: m.materialId, colorId: m.colorId, porColor: m.colorId !== null || !!materiales.data?.find((x) => x.id === m.materialId)?.porColor, codigo: m.codigo, nombre: m.material, unidad: m.unidad, texto: cant(m.cantidadMil), costoUnitarioCentavos: m.costoUnitarioCentavos ?? null })));
  }, [existente.data]);
  const agregarMat = (id: number) => {
    const m = materiales.data?.find((x) => x.id === id);
    if (!m || (!m.porColor && mats.some((x) => x.materialId === id))) return;
    setMats([...mats, { materialId: m.id, colorId: m.porColor ? undefined : null, porColor: m.porColor, codigo: m.codigo, nombre: m.nombre, unidad: m.unidad, texto: '', costoUnitarioCentavos: m.costoCentavos ?? null }]);
  };
  const agregar = (v: VarianteBuscada) => {
    const ya = lineas.find((l) => l.varianteId === v.varianteId);
    if (ya) setLineas(lineas.map((l) => (l === ya ? { ...l, cantidad: l.cantidad + 1 } : l)));
    else setLineas([...lineas, { varianteId: v.varianteId, sku: v.sku, descripcion: describirVariante(v), cantidad: 1, costoUnitarioCentavos: d.tipo === 'reventa' ? v.costoCentavos ?? null : lineas.at(-1)?.costoUnitarioCentavos ?? null }]);
  };
  const milDe = (l: LineaMatForm) => leerCant(l.texto);
  const total = esMat
    ? mats.reduce((s, l) => s + (Number.isFinite(milDe(l)) ? Math.round((milDe(l) * (l.costoUnitarioCentavos ?? 0)) / 1000) : 0), 0)
    : lineas.reduce((s, l) => s + l.cantidad * (l.costoUnitarioCentavos ?? 0), 0);
  const lineasOk = esMat
    ? mats.length > 0 && mats.every((l) => milDe(l) > 0 && l.costoUnitarioCentavos != null && l.colorId !== undefined)
    : lineas.length > 0 && lineas.every((l) => l.cantidad > 0 && l.costoUnitarioCentavos != null);
  const valido = d.proveedorId && lineasOk && comprobanteValido(comp);
  const guardar = useMutation({
    mutationFn: (confirmar: boolean) => {
      const cuerpo = {
        ...d, ...cuerpoComprobante(comp), fechaEsperada: d.fechaEsperada || null, notas: d.notas || null,
        items: esMat ? [] : lineas.map((l) => ({ varianteId: l.varianteId, cantidad: l.cantidad, costoUnitarioCentavos: l.costoUnitarioCentavos! })),
        ...(esMat ? { materiales: mats.map((l) => ({ materialId: l.materialId, colorId: l.colorId ?? null, cantidadMil: milDe(l), costoUnitarioCentavos: l.costoUnitarioCentavos! })) } : {}),
      };
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
        <Campo etiqueta="Tipo" ayuda={d.tipo === 'confeccion' ? 'Se paga la confección: suma stock pero no cambia el costo del producto' : esMat ? 'Cuero, forrería, avíos: entra al stock de materiales y actualiza su costo' : 'Producto terminado: actualiza el costo promedio'}>
          <select className="entrada" value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value as TipoCompra })}>
            {(!editando || !esMat) && <><option value="reventa">{TIPOS.reventa}</option><option value="confeccion">{TIPOS.confeccion}</option></>}
            {(!editando || esMat) && <option value="materiales">{TIPOS.materiales}</option>}
          </select>
        </Campo>
        <Campo etiqueta="Fecha del pedido"><input className="entrada" type="date" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></Campo>
        <Campo etiqueta="Entrega esperada"><input className="entrada" type="date" value={d.fechaEsperada} onChange={(e) => setD({ ...d, fechaEsperada: e.target.value })} /></Campo>
        <Campo etiqueta="Notas" className="sm:col-span-2 lg:col-span-4"><input className="entrada" value={d.notas} onChange={(e) => setD({ ...d, notas: e.target.value })} /></Campo>
      </div>
      {esMat ? (
        <div className="tarjeta p-5">
          <Campo etiqueta="Agregar material">
            <select className="entrada" value="" onChange={(e) => agregarMat(Number(e.target.value))}>
              <option value="">Elegí…</option>
              {materiales.data?.filter((m) => m.tipo === 'material' && m.activo && (m.porColor || !mats.some((x) => x.materialId === m.id))).map((m) => <option key={m.id} value={m.id}>{m.codigo} · {m.nombre}{m.proveedor ? ` (${m.proveedor})` : ''}</option>)}
            </select>
          </Campo>
          <div className="mt-4 overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>Material</th><th className="num w-32">Cantidad</th><th className="num w-40">Costo por unidad</th><th className="num">Subtotal</th><th /></tr></thead>
              <tbody>
                {mats.map((l, i) => {
                  const mil = milDe(l);
                  return (
                    <tr key={i}>
                      <td><b>{l.codigo}</b><div className="text-xs text-carbon/55">{l.nombre}</div>{l.porColor && <SelectorColor className={`entrada mt-1 py-1 text-sm ${l.colorId === undefined ? 'border-bordo' : ''}`} valor={l.colorId} onCambio={(c) => setMats(mats.map((x, j) => (j === i ? { ...x, colorId: c } : x)))} />}</td>
                      <td><div className="flex items-center gap-1"><input className={`entrada py-1 text-right ${l.texto && !(mil > 0) ? 'border-bordo' : ''}`} inputMode="decimal" placeholder="0" value={l.texto} onChange={(e) => setMats(mats.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))} /><span className="text-xs text-carbon/55">{l.unidad}</span></div></td>
                      <td><Importe valor={l.costoUnitarioCentavos} onCambio={(c) => setMats(mats.map((x, j) => (j === i ? { ...x, costoUnitarioCentavos: c } : x)))} /></td>
                      <td className="num">{mil > 0 ? pesos(Math.round((mil * (l.costoUnitarioCentavos ?? 0)) / 1000)) : '—'}</td>
                      <td className="text-right"><button className="p-1 text-carbon/40 hover:text-bordo" aria-label="Quitar" onClick={() => setMats(mats.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></td>
                    </tr>
                  );
                })}
                {!mats.length && <tr><td colSpan={5} className="py-6 text-center text-carbon/50">Elegí los materiales que vas a pedir. La cantidad va en la unidad del material (por ejemplo 12,5 m).</td></tr>}
              </tbody>
              {mats.length > 0 && <tfoot><tr><td className="px-3 py-2 font-medium">{mats.length} {mats.length === 1 ? 'material' : 'materiales'}</td><td /><td /><td className="num px-3 py-2 font-titulo text-lg font-bold">{pesos(total)}</td><td /></tr></tfoot>}
            </table>
          </div>
        </div>
      ) : (
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
      )}
      <div className="tarjeta mt-4 p-5">
        <div className="etiqueta mb-3">Pago y factura</div>
        <CamposComprobante d={comp} onCambio={setComp} />
        {(lineas.length > 0 || mats.length > 0) && ((comp.descuentoCentavos ?? 0) > 0 || (comp.impuestosCentavos ?? 0) > 0) && <p className="mt-2 text-sm">Total de la factura: <b>{pesos(total - (comp.descuentoCentavos ?? 0) + (comp.impuestosCentavos ?? 0))}</b></p>}
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
  const [editComp, setEditComp] = useState(false);
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
  const esMat = k.tipo === 'materiales';
  const pendientes = k.items.reduce((s, i) => s + i.pendiente, 0);
  const pendientesMat = k.materiales.filter((m) => m.pendienteMil > 0).length;
  return (
    <>
      <Link to="/compras" className="mb-3 inline-flex items-center gap-1 text-sm text-carbon/60 hover:text-carbon"><ArrowLeft className="h-4 w-4" />Compras</Link>
      <Encabezado titulo={`Pedido P-${k.numero}`} sub={<>{k.proveedor} · {TIPOS[k.tipo]} · {fmtFecha(k.fecha + 'T12:00')}{k.fechaEsperada && ` · entrega esperada ${fmtFecha(k.fechaEsperada + 'T12:00')}`} · <Estado e={k.estadoPedido} /></>}>
        {k.estado === 'borrador' && puede('compras', 'modificar') && verCostos && <Link className="btn-secundario" to={`/compras/${k.id}/editar`}><Pencil className="h-4 w-4" />Editar</Link>}
        {k.estado === 'borrador' && puede('compras', 'crear') && <button className="btn-primario" onClick={() => setAccion('confirmar')}>Confirmar pedido</button>}
        {k.estado === 'confirmada' && puede('compras', 'crear') && <button className="btn-primario" onClick={() => setRecibir(true)}><PackageCheck className="h-4 w-4" />Recibir</button>}
        {k.estado === 'confirmada' && puede('compras', 'modificar') && <button className="btn-secundario" onClick={() => setAccion('cerrar')}>Cerrar con pendientes</button>}
        {k.estado !== 'anulada' && !k.recepciones.some((r) => r.estado === 'activa') && puede('compras', 'anular') && <button className="btn-secundario" onClick={() => setAccion('anular')}>Anular</button>}
      </Encabezado>
      {k.notas && <p className="mb-4 text-sm text-carbon/70">{k.notas}</p>}
      {verCostos && (
        <div className="tarjeta mb-4 grid gap-4 p-5 md:grid-cols-3">
          <div className="space-y-1 text-sm">
            <div className="etiqueta">Factura</div>
            <div>{k.comprobante ?? <span className="text-carbon/50">Sin cargar</span>}{k.fechaComprobante && <span className="text-carbon/60"> · {fmtFecha(k.fechaComprobante + 'T12:00')}</span>}</div>
            <div className="text-carbon/70">Pago: {k.condicionPago ? CONDICIONES[k.condicionPago].replace(' (días)', '') + (k.condicionPago === 'a_plazo' && k.plazoPagoDias ? ` ${k.plazoPagoDias} días` : '') : 'sin definir'}</div>
            <div className={vencido(k) ? 'font-medium text-bordo' : 'text-carbon/70'}>Vence: {k.vencimientoEfectivo ? fmtFecha(k.vencimientoEfectivo + 'T12:00') : '—'}{vencido(k) && ' (vencido)'}{k.vencimiento && <span className="text-xs text-carbon/50"> · fijado a mano</span>}</div>
          </div>
          <div className="space-y-1 text-sm">
            <div className="etiqueta">Lo que se le debe</div>
            <div className="flex justify-between"><span className="text-carbon/60">Recibido</span><span>{pesos(k.recibidoCentavos)}</span></div>
            {k.descuentoCentavos > 0 && <div className="flex justify-between"><span className="text-carbon/60">Descuento</span><span>{pesos(-k.descuentoCentavos)}</span></div>}
            {k.impuestosCentavos > 0 && <div className="flex justify-between"><span className="text-carbon/60">Impuestos</span><span>{pesos(k.impuestosCentavos)}</span></div>}
            <div className="flex justify-between"><span className="text-carbon/60">Pagado</span><span>{pesos(-(k.pagadoCentavos ?? 0))}</span></div>
            <div className="flex justify-between border-t border-arena pt-1 font-medium"><span>Saldo</span><span className={(k.saldoCentavos ?? 0) > 0 ? 'text-bordo' : ''}>{pesos(k.saldoCentavos)}</span></div>
          </div>
          <div className="space-y-2 text-sm">
            <div className="etiqueta">Pagos imputados</div>
            {k.pagos.length ? k.pagos.map((p) => <div key={p.pagoId}><Link className="underline" to={`/pagos?proveedor=${k.proveedorId}`}>PP-{p.numero}</Link> · {fmtFecha(p.fecha + 'T12:00')} · {pesos(p.importeCentavos)}{p.totalPagoCentavos !== p.importeCentavos && <span className="text-xs text-carbon/50"> (de {pesos(p.totalPagoCentavos)})</span>}</div>) : <div className="text-carbon/50">Ninguno</div>}
            <div className="flex flex-wrap gap-2 pt-1">
              {k.estado !== 'anulada' && puede('compras', 'modificar') && <button className="btn-secundario btn-chico" onClick={() => setEditComp(true)}>Editar factura y pago</button>}
              {puede('caja', 'crear') && k.estado !== 'anulada' && <Link className="btn-secundario btn-chico" to={`/pagos?proveedor=${k.proveedorId}&pagar=${k.id}`}>Registrar pago</Link>}
            </div>
          </div>
          <div className="md:col-span-3"><Adjuntos entidad="compra" entidadId={k.id} /></div>
        </div>
      )}
      {esMat ? (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead><tr><th>Material</th><th className="num">Pedido</th><th className="num">Recibido</th><th className="num">Falta</th>{verCostos && <th className="num">Costo por unidad</th>}{verCostos && <th className="num">Subtotal</th>}</tr></thead>
            <tbody>
              {k.materiales.map((m) => (
                <tr key={m.id}>
                  <td><b>{m.codigo}</b><div className="text-xs text-carbon/55">{conColor(m.material, m.color)}</div></td>
                  <td className="num">{cant(m.cantidadMil)} {m.unidad}</td><td className="num">{cant(m.recibidoMil)}</td>
                  <td className={`num ${m.pendienteMil > 0 && k.estado === 'confirmada' ? 'font-medium text-conac' : 'text-carbon/40'}`}>{cant(m.pendienteMil)}</td>
                  {verCostos && <td className="num">{pesos(m.costoUnitarioCentavos)}</td>}
                  {verCostos && <td className="num">{pesos(Math.round(((m.costoUnitarioCentavos ?? 0) * m.cantidadMil) / 1000))}</td>}
                </tr>
              ))}
            </tbody>
            {verCostos && <tfoot><tr><td className="px-3 py-2" colSpan={4}>Recibido valorizado: <b>{pesos(k.recibidoCentavos)}</b></td><td /><td className="num px-3 py-2 font-titulo text-lg font-bold">{pesos(k.totalCentavos)}</td></tr></tfoot>}
          </table>
        </div>
      ) : (
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
      )}
      {k.tipo === 'confeccion' && puede('materiales') && <Abastecimiento compraId={k.id} />}
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
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {r.items.map((i) => <span key={i.id}>{i.sku} × <b>{i.cantidad}</b>{verCostos && i.costoUnitarioCentavos != null && <span className="text-carbon/50"> a {pesos(i.costoUnitarioCentavos)}</span>}</span>)}
                {r.materiales.map((i) => <span key={'m' + i.id}>{i.material}: <b>{cant(i.cantidadMil)} {i.unidad}</b>{verCostos && i.costoUnitarioCentavos != null && <span className="text-carbon/50"> a {pesos(i.costoUnitarioCentavos)}</span>}</span>)}
              </div>
              {r.notas && <div className="mt-1 text-xs text-carbon/60">{r.notas}</div>}
              <div className="mt-2"><Adjuntos entidad="recepcion" entidadId={r.id} compacto /></div>
            </div>
          ))}
        </div>
      )}
      {recibir && (esMat ? <ModalRecepcionMateriales compra={k} onCerrar={() => setRecibir(false)} onListo={inv} /> : <ModalRecepcion compra={k} onCerrar={() => setRecibir(false)} onListo={inv} />)}
      {editComp && <ModalComprobante compra={k} onCerrar={() => setEditComp(false)} onListo={inv} />}
      {accion && (
        <Confirmar titulo={accion === 'confirmar' ? 'Confirmar pedido' : accion === 'cerrar' ? 'Cerrar con pendientes' : 'Anular pedido'} textoBoton={accion === 'confirmar' ? 'Confirmar' : accion === 'cerrar' ? 'Cerrar' : 'Anular'} peligro={accion === 'anular'}
          ocupado={estado.isPending} onCerrar={() => { setAccion(null); setMotivo(''); }} onConfirmar={() => estado.mutate(accion)}>
          {accion === 'confirmar' && <p>Una vez confirmado ya no se edita: queda esperando las entregas.</p>}
          {accion === 'cerrar' && <><p>{esMat ? <>Quedan <b>{pendientesMat}</b> {pendientesMat === 1 ? 'material' : 'materiales'} sin entregar del todo, que se dan por no recibidos.</> : <>Quedan <b>{pendientes}</b> unidades sin entregar que se dan por no recibidas.</>}</p><Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo></>}
          {accion === 'anular' && <><p>El pedido queda anulado (no se borra).</p><Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo></>}
        </Confirmar>
      )}
      {anularRec && (
        <Confirmar titulo={`Anular recepción R-${anularRec.numero}`} textoBoton="Anular" peligro ocupado={anular.isPending} onCerrar={() => { setAnularRec(null); setMotivo(''); }} onConfirmar={() => anular.mutate()}>
          <p>Se descuenta del stock {esMat ? 'de materiales ' : ''}lo que entró con esta recepción (con un movimiento de anulación) y {esMat ? 'las cantidades vuelven' : 'las unidades vuelven'} a quedar pendientes en el pedido.</p>
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
    mutationFn: () => api.post<{ numero: number; pedidoCerrado: boolean; cambiosCosto?: { sku: string }[]; produccion: { materiales: number; sinReceta: string[] } | null }>(`/compras/${compra.id}/recepciones`, {
      ...d, comprobante: d.comprobante || null, notas: d.notas || null,
      items: items.map((i) => ({ compraItemId: i.id, cantidad: cant[i.id] ?? 0, ...(editaCosto && costos[i.id] != null && costos[i.id] !== i.costoUnitarioCentavos ? { costoUnitarioCentavos: costos[i.id] } : {}) })),
    }, true),
    onSuccess: (r) => { avisar(`Recepción R-${r.numero} registrada${r.cambiosCosto?.length ? ` · se actualizó el costo de ${r.cambiosCosto.length} productos` : ''}${r.produccion ? (r.produccion.materiales ? ` · se descontaron ${r.produccion.materiales} materiales` : '') + (r.produccion.sinReceta.length ? ` · sin receta: ${r.produccion.sinReceta.join(', ')}` : '') : ''}`); onListo(); onCerrar(); },
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
        {compra.tipo === 'confeccion' && <p className="text-xs text-carbon/55">Al recibir se descuentan del stock de materiales los que usa cada prenda según su receta.</p>}
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

function ModalRecepcionMateriales({ compra, onCerrar, onListo }: { compra: Compra; onCerrar: () => void; onListo: () => void }) {
  const { puede } = useSesion();
  const lineas = compra.materiales.filter((m) => m.pendienteMil > 0);
  const [cants, setCants] = useState<Record<number, string>>(Object.fromEntries(lineas.map((m) => [m.id, cant(m.pendienteMil)])));
  const [costos, setCostos] = useState<Record<number, number | null>>({});
  const [d, setD] = useState({ fecha: hoy(), comprobante: '', notas: '' });
  const editaCosto = puede('costos', 'modificar');
  const mil = (id: number) => (cants[id]?.trim() ? leerCant(cants[id]) : 0);
  const pend = (id: number) => lineas.find((m) => m.id === id)!.pendienteMil;
  const errores = lineas.filter((m) => !Number.isFinite(mil(m.id)) || mil(m.id) < 0 || mil(m.id) > pend(m.id));
  const conAlgo = lineas.filter((m) => mil(m.id) > 0);
  const guardar = useMutation({
    mutationFn: () => api.post<{ numero: number; pedidoCerrado: boolean; cambiosCosto?: { material: string }[] }>(`/compras/${compra.id}/recepciones`, {
      ...d, comprobante: d.comprobante || null, notas: d.notas || null, items: [],
      materiales: conAlgo.map((m) => ({ compraMaterialId: m.id, cantidadMil: mil(m.id), ...(editaCosto && costos[m.id] != null && costos[m.id] !== m.costoUnitarioCentavos ? { costoUnitarioCentavos: costos[m.id] } : {}) })),
    }, true),
    onSuccess: (r) => { avisar(`Recepción R-${r.numero} registrada · entró al stock de materiales${r.cambiosCosto?.length ? ` · se actualizó el costo de ${r.cambiosCosto.map((c) => c.material).join(', ')}` : ''}`); onListo(); onCerrar(); },
    onError: avisarError,
  });
  return (
    <Modal titulo={`Recibir materiales · pedido P-${compra.numero}`} onCerrar={onCerrar} ancho="max-w-2xl">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Fecha de entrega"><input className="entrada" type="date" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></Campo>
          <Campo etiqueta="Remito / factura"><input className="entrada" value={d.comprobante} onChange={(e) => setD({ ...d, comprobante: e.target.value })} /></Campo>
        </div>
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead><tr><th>Material</th><th className="num">Falta</th><th className="num w-32">Llegó</th>{editaCosto && <th className="num w-36">Costo por unidad</th>}</tr></thead>
            <tbody>
              {lineas.map((m) => (
                <tr key={m.id}>
                  <td><b>{m.codigo}</b><div className="text-xs text-carbon/55">{conColor(m.material, m.color)}</div></td>
                  <td className="num">{cant(m.pendienteMil)} {m.unidad}</td>
                  <td><input className={`entrada py-1 text-right ${errores.includes(m) ? 'border-bordo' : ''}`} inputMode="decimal" value={cants[m.id] ?? ''} onChange={(e) => setCants({ ...cants, [m.id]: e.target.value })} /></td>
                  {editaCosto && <td><Importe valor={costos[m.id] ?? m.costoUnitarioCentavos ?? null} onCambio={(c) => setCostos({ ...costos, [m.id]: c })} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {errores.length > 0 && <p className="text-xs text-bordo">Revisá las cantidades: no puede llegar más de lo que falta. Si vino de más, cargalo aparte como ingreso en Materiales.</p>}
        <div className="flex gap-2 text-xs">
          <button className="text-conac underline" onClick={() => setCants(Object.fromEntries(lineas.map((m) => [m.id, cant(m.pendienteMil)])))}>Llegó todo</button>
          <button className="text-conac underline" onClick={() => setCants(Object.fromEntries(lineas.map((m) => [m.id, '0'])))}>Poner todo en 0</button>
        </div>
        <p className="text-xs text-carbon/55">Al recibir entra al stock de materiales y se recalcula el costo por promedio ponderado. La deuda con el proveedor nace por lo recibido.</p>
        <Campo etiqueta="Notas"><input className="entrada" value={d.notas} onChange={(e) => setD({ ...d, notas: e.target.value })} /></Campo>
        <div className="flex justify-end gap-2">
          <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn-primario" disabled={!conAlgo.length || errores.length > 0 || guardar.isPending} onClick={() => guardar.mutate()}>{guardar.isPending ? 'Guardando…' : 'Recibir'}</button>
        </div>
      </div>
    </Modal>
  );
}

function ModalComprobante({ compra, onCerrar, onListo }: { compra: Compra; onCerrar: () => void; onListo: () => void }) {
  const [d, setD] = useState(comprobanteDe(compra));
  const [motivo, setMotivo] = useState('');
  const pideMotivo = compra.estado !== 'borrador';
  const m = useMutation({
    mutationFn: () => api.put(`/compras/${compra.id}/comprobante`, { ...cuerpoComprobante(d), motivo: motivo || undefined }),
    onSuccess: () => { avisar('Datos de la factura guardados'); onListo(); onCerrar(); }, onError: avisarError,
  });
  const valido = comprobanteValido(d) && (!pideMotivo || motivo.trim());
  return (
    <Modal titulo={`Factura y pago · P-${compra.numero}`} onCerrar={onCerrar} ancho="max-w-3xl">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valido) m.mutate(); }}>
        <CamposComprobante d={d} onCambio={setD} />
        <p className="text-xs text-carbon/55">El descuento y los impuestos cambian lo que se le debe al proveedor; no cambian el costo de los productos.</p>
        {pideMotivo && <Campo etiqueta="Motivo del cambio"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: llegó la factura" /></Campo>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={!valido || m.isPending}>Guardar</button></div>
      </form>
    </Modal>
  );
}
