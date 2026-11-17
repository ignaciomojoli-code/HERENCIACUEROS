import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus, Trash2, Truck } from 'lucide-react';
import { api } from '../api';
import { useSesion } from '../sesion';
import { Campo, Cargando, Confirmar, Encabezado, ErrorCarga, Modal, Vacio, avisar, avisarError } from '../componentes/ui';
import { fecha as fmtFecha } from '../formato';
import { hoy } from '../plata';
import { cant, leerCant, useMateriales, type Unidad } from '../costos';

interface Lugar { ubicacionProveedorId: number | null; nombre: string; rol: string | null }
interface MatPedido { materialId: number; codigo: string; nombre: string; unidad: Unidad; totalMil: number; pendienteMil: number; entregadoMil: number; enTallerMil: number; faltaEntregarMil: number }
interface EnCurso { compraId: number; numero: number; estado: string; fecha: string; fechaEsperada: string | null; taller: string; tallerId: number; pedidas: number; recibidas: number; materiales: MatPedido[]; sinReceta: string[]; faltaEntregar: number }
interface Custodia { lugares: { ubicacionProveedorId: number; ubicacion: string }[]; materiales: { materialId: number; codigo: string; nombre: string; unidad: Unidad; localMil: number; otros: { ubicacionProveedorId: number; ubicacion: string; cantidadMil: number }[]; totalMil: number }[] }
interface Traslado { id: number; numero: number; fecha: string; origen: string; destino: string; compraId: number | null; compraNumero: number | null; notas: string | null; estado: 'activo' | 'anulado'; motivoAnulacion: string | null; items: { materialId: number; material: string; unidad: Unidad; cantidadMil: number }[] }
export interface Prellenado { origen: number | null; destino: number | null; compraId: number | null; items: { materialId: number; texto: string }[] }

/** Colores validados (ver dataviz): el local siempre conac; los demás lugares en orden fijo; del tercero en adelante se juntan en "Otros". */
const COLORES = ['#A65A2E', '#2F6F9F', '#7A8C2E'];

export function PaginaProduccion() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const enCurso = useQuery({ queryKey: ['produccion'], queryFn: () => api.get<EnCurso[]>('/custodia/produccion') });
  const cust = useQuery({ queryKey: ['custodia'], queryFn: () => api.get<Custodia>('/custodia') });
  const trs = useQuery({ queryKey: ['traslados'], queryFn: () => api.get<Traslado[]>('/traslados') });
  const pedidoUrl = Number(params.get('pedido')) || null;
  const [entregar, setEntregar] = useState<Prellenado | null>(null);
  const [anular, setAnular] = useState<Traslado | null>(null);
  const [motivo, setMotivo] = useState('');
  const inv = () => ['produccion', 'custodia', 'traslados', 'materiales', 'material', 'reposicion-materiales', 'custodia-pedido'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const anu = useMutation({ mutationFn: () => api.post(`/traslados/${anular!.id}/anular`, { motivo }), onSuccess: () => { avisar('Entrega anulada'); setAnular(null); setMotivo(''); inv(); }, onError: avisarError });
  const puedeEntregar = puede('materiales', 'modificar');
  const faltante = (p: EnCurso): Prellenado => ({ origen: null, destino: p.tallerId, compraId: p.compraId, items: p.materiales.filter((m) => m.faltaEntregarMil > 0).map((m) => ({ materialId: m.materialId, texto: cant(m.faltaEntregarMil) })) });
  if (enCurso.isLoading || cust.isLoading) return <Cargando />;
  if (enCurso.isError) return <ErrorCarga error={enCurso.error} />;
  if (cust.isError) return <ErrorCarga error={cust.error} />;
  const lista = enCurso.data!;
  const pedUrl = pedidoUrl ? lista.find((p) => p.compraId === pedidoUrl) : null;
  return (
    <>
      <Encabezado titulo="Producción y custodia" sub="Qué tiene que hacer el taller, qué material le diste y dónde está cada material. La deuda con el taller sigue naciendo solo por las prendas que entrega.">
        {puedeEntregar && <button className="btn-primario" onClick={() => setEntregar(pedUrl ? faltante(pedUrl) : { origen: null, destino: lista[0]?.tallerId ?? null, compraId: null, items: [] })}><Truck className="h-4 w-4" />Entregar material</button>}
      </Encabezado>

      <h2 className="mb-3 text-xl font-bold">Pedidos al taller en curso</h2>
      {!lista.length ? <Vacio>No hay pedidos de confección abiertos. Se arman en <Link className="underline" to="/para-pedir">Para pedir</Link> o en <Link className="underline" to="/compras/nuevo">Pedidos</Link>.</Vacio> : (
        <div className="space-y-4">{lista.map((p) => (
          <section key={p.compraId} className={`tarjeta overflow-hidden ${p.compraId === pedidoUrl ? 'ring-2 ring-conac' : ''}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-arena/50 px-4 py-3">
              <div>
                <h3 className="text-lg font-bold"><Link className="hover:underline" to={`/compras/${p.compraId}`}>P-{p.numero}</Link> · {p.taller}</h3>
                <div className="text-sm text-carbon/60">{p.recibidas} de {p.pedidas} prendas entregadas{p.estado === 'borrador' ? ' · borrador (sin confirmar)' : ''}{p.fechaEsperada ? ` · espera ${fmtFecha(p.fechaEsperada + 'T12:00')}` : ''}</div>
              </div>
              {puedeEntregar && p.faltaEntregar > 0 && <button className="btn-secundario btn-chico" onClick={() => setEntregar(faltante(p))}><Truck className="h-4 w-4" />Entregar lo que falta</button>}
            </div>
            {p.sinReceta.length > 0 && <p className="bg-crema-50 px-4 py-2 text-xs text-bordo">Sin receta: {p.sinReceta.join(', ')}. No se puede calcular qué material necesita.</p>}
            {p.materiales.length > 0 && (
              <div className="overflow-x-auto">
                <table className="tabla">
                  <thead><tr><th>Material</th><th className="num">Necesita para lo que falta</th><th className="num">Le diste para este pedido</th><th className="num">Tiene hoy</th><th className="num">Falta entregarle</th></tr></thead>
                  <tbody>{p.materiales.map((m) => (
                    <tr key={m.materialId}>
                      <td>{m.nombre}</td><td className="num">{cant(m.pendienteMil)} {m.unidad}</td><td className="num">{cant(m.entregadoMil)}</td>
                      <td className={`num ${m.enTallerMil < 0 ? 'text-bordo' : ''}`}>{cant(m.enTallerMil)}</td>
                      <td className={`num ${m.faltaEntregarMil > 0 ? 'font-medium text-conac' : 'text-carbon/40'}`}>{cant(m.faltaEntregarMil)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        ))}</div>
      )}

      <h2 className="mb-3 mt-8 text-xl font-bold">Dónde está el material</h2>
      <DondeEsta c={cust.data!} />

      <h2 className="mb-3 mt-8 text-xl font-bold">Entregas</h2>
      {trs.isLoading ? <Cargando /> : !trs.data?.length ? <Vacio>Todavía no se registró ninguna entrega de material.</Vacio> : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead><tr><th>N°</th><th>Fecha</th><th>Movimiento</th><th>Materiales</th><th className="hidden md:table-cell">Pedido</th><th /></tr></thead>
            <tbody>{trs.data.map((t) => (
              <tr key={t.id} className={t.estado === 'anulado' ? 'text-carbon/40' : ''}>
                <td className="font-medium">E-{t.numero}</td><td>{fmtFecha(t.fecha + 'T12:00')}</td>
                <td className="whitespace-nowrap">{t.origen} <ArrowRight className="inline h-3 w-3" /> {t.destino}{t.estado === 'anulado' && <div className="text-xs">Anulada: {t.motivoAnulacion}</div>}</td>
                <td className="text-sm">{t.items.map((i) => `${i.material} ${cant(i.cantidadMil)} ${i.unidad}`).join(' · ')}{t.notas && <div className="text-xs text-carbon/50">{t.notas}</div>}</td>
                <td className="hidden md:table-cell">{t.compraId ? <Link className="underline" to={`/compras/${t.compraId}`}>P-{t.compraNumero}</Link> : '—'}</td>
                <td className="text-right">{t.estado === 'activo' && puede('materiales', 'anular') && <button className="btn-secundario btn-chico" onClick={() => setAnular(t)}>Anular</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {entregar && <ModalEntrega inicial={entregar} pedidos={lista} onCerrar={() => setEntregar(null)} onListo={inv} />}
      {anular && (
        <Confirmar titulo={`Anular entrega E-${anular.numero}`} textoBoton="Anular" peligro ocupado={anu.isPending} onCerrar={() => { setAnular(null); setMotivo(''); }} onConfirmar={() => anu.mutate()}>
          <p className="mb-3 text-sm">El material vuelve a figurar en {anular.origen} (se agregan movimientos contrarios, no se borra nada).</p>
          <Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus /></Campo>
        </Confirmar>
      )}
    </>
  );
}

/** Barras apiladas por material: qué parte está en el local y qué parte en cada taller o proveedor. */
function DondeEsta({ c }: { c: Custodia }) {
  const n = c.lugares.length;
  const series = [
    { nombre: 'Local', color: COLORES[0] },
    ...(n >= 1 ? [{ nombre: c.lugares[0].ubicacion, color: COLORES[1] }] : []),
    ...(n === 2 ? [{ nombre: c.lugares[1].ubicacion, color: COLORES[2] }] : n > 2 ? [{ nombre: 'Otros', color: COLORES[2] }] : []),
  ];
  // m.otros viene en el mismo orden que c.lugares.
  const partes = (m: Custodia['materiales'][number]) => [m.localMil, ...(n >= 1 ? [m.otros[0].cantidadMil] : []), ...(n >= 2 ? [m.otros.slice(1).reduce((a, o) => a + o.cantidadMil, 0)] : [])];
  const conAlgoAfuera = c.materiales.filter((m) => m.otros.some((o) => o.cantidadMil > 0));
  return (
    <div className="space-y-4">
      {conAlgoAfuera.length > 0 && (
        <div className="tarjeta p-4">
          <div className="mb-3 flex flex-wrap gap-4 text-sm" aria-label="Referencias">
            {series.map((s) => <span key={s.nombre} className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: s.color }} />{s.nombre}</span>)}
          </div>
          <div className="space-y-2">{conAlgoAfuera.map((m) => {
            const v = partes(m).map((n) => Math.max(0, n));
            const tot = v.reduce((a, b) => a + b, 0) || 1;
            return (
              <div key={m.materialId} className="grid grid-cols-[minmax(7rem,12rem)_1fr] items-center gap-3 text-sm">
                <span className="truncate" title={m.nombre}>{m.nombre}</span>
                <div className="flex h-5 gap-[2px]" role="img" aria-label={`${m.nombre}: ${series.map((s, i) => `${s.nombre} ${cant(v[i])} ${m.unidad}`).join(', ')}`}>
                  {v.map((n, i) => n > 0 && (
                    <div key={i} className="h-full first:rounded-l last:rounded-r" style={{ width: `${(n / tot) * 100}%`, background: series[i].color }} title={`${series[i].nombre}: ${cant(n)} ${m.unidad}`} />
                  ))}
                </div>
              </div>
            );
          })}</div>
          <p className="mt-3 text-xs text-carbon/55">Cada barra es el total de ese material repartido por lugar (pasá el dedo o el mouse para ver la cantidad). Los saldos negativos no se dibujan: están en la tabla.</p>
        </div>
      )}
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead><tr><th>Material</th><th className="num">Local</th>{c.lugares.map((l) => <th key={l.ubicacionProveedorId} className="num">{l.ubicacion}</th>)}<th className="num">Total</th></tr></thead>
          <tbody>{c.materiales.map((m) => (
            <tr key={m.materialId}>
              <td>{m.nombre}</td>
              <td className={`num ${m.localMil < 0 ? 'text-bordo' : ''}`}>{cant(m.localMil)}</td>
              {m.otros.map((o) => <td key={o.ubicacionProveedorId} className={`num ${o.cantidadMil < 0 ? 'text-bordo' : o.cantidadMil === 0 ? 'text-carbon/40' : ''}`}>{cant(o.cantidadMil)}</td>)}
              <td className="num font-medium">{cant(m.totalMil)} {m.unidad}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {!c.lugares.length && <p className="text-sm text-carbon/60">Todo el material figura en el local. Cuando le entregues material a Laura o a un proveedor, acá vas a ver cuánto tiene cada uno.</p>}
    </div>
  );
}

export function ModalEntrega({ inicial, pedidos, onCerrar, onListo }: { inicial: Prellenado; pedidos: EnCurso[]; onCerrar: () => void; onListo: () => void }) {
  const lugares = useQuery({ queryKey: ['custodia-lugares'], queryFn: () => api.get<Lugar[]>('/custodia/lugares') });
  const mats = useMateriales();
  const [d, setD] = useState({ fecha: hoy(), origen: inicial.origen, destino: inicial.destino, compraId: inicial.compraId, notas: '' });
  const [items, setItems] = useState(inicial.items);
  const valor = (x: number | null) => (x === null ? '' : String(x));
  const leer = (v: string) => (v === '' ? null : Number(v));
  const malos = items.filter((i) => !(leerCant(i.texto) > 0));
  const pedidosDelDestino = pedidos.filter((p) => p.tallerId === d.destino || p.tallerId === d.origen);
  const g = useMutation({
    mutationFn: () => api.post<{ numero: number; avisos: string[] }>('/traslados', { fecha: d.fecha, origenProveedorId: d.origen, destinoProveedorId: d.destino, compraId: d.compraId, notas: d.notas || null, items: items.map((i) => ({ materialId: i.materialId, cantidadMil: leerCant(i.texto) })) }, true),
    onSuccess: (r) => { avisar(`Entrega E-${r.numero} registrada${r.avisos.length ? `. Ojo: ${r.avisos.join('; ')}` : ''}`); onListo(); onCerrar(); }, onError: avisarError,
  });
  const nombreMat = (id: number) => mats.data?.find((m) => m.id === id);
  return (
    <Modal titulo="Entregar material" onCerrar={onCerrar} ancho="max-w-2xl">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (items.length && !malos.length && d.origen !== d.destino) g.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo etiqueta="Fecha"><input className="entrada" type="date" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></Campo>
          <Campo etiqueta="Sale de"><select className="entrada" value={valor(d.origen)} onChange={(e) => setD({ ...d, origen: leer(e.target.value) })}>{lugares.data?.map((l) => <option key={l.ubicacionProveedorId ?? 'local'} value={valor(l.ubicacionProveedorId)}>{l.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Va a"><select className="entrada" value={valor(d.destino)} onChange={(e) => setD({ ...d, destino: leer(e.target.value), compraId: null })}>{lugares.data?.map((l) => <option key={l.ubicacionProveedorId ?? 'local'} value={valor(l.ubicacionProveedorId)}>{l.nombre}</option>)}</select></Campo>
        </div>
        {d.origen === d.destino && <p className="text-xs text-bordo">Elegí lugares distintos.</p>}
        {pedidosDelDestino.length > 0 && (
          <Campo etiqueta="Para el pedido (opcional)">
            <select className="entrada" value={valor(d.compraId)} onChange={(e) => setD({ ...d, compraId: leer(e.target.value) })}>
              <option value="">Sin pedido</option>{pedidosDelDestino.map((p) => <option key={p.compraId} value={p.compraId}>P-{p.numero} · {p.taller} ({p.recibidas}/{p.pedidas})</option>)}
            </select>
          </Campo>
        )}
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead><tr><th>Material</th><th className="num w-36">Cantidad</th><th /></tr></thead>
            <tbody>
              {items.map((i, k) => (
                <tr key={i.materialId}>
                  <td>{nombreMat(i.materialId)?.nombre ?? '…'}</td>
                  <td><div className="flex items-center gap-1"><input className={`entrada py-1 text-right ${!(leerCant(i.texto) > 0) ? 'border-bordo' : ''}`} inputMode="decimal" value={i.texto} onChange={(e) => setItems(items.map((x, j) => (j === k ? { ...x, texto: e.target.value } : x)))} /><span className="text-xs text-carbon/55">{nombreMat(i.materialId)?.unidad}</span></div></td>
                  <td className="text-right"><button type="button" className="p-1 text-carbon/40 hover:text-bordo" aria-label="Quitar" onClick={() => setItems(items.filter((_, j) => j !== k))}><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={3} className="py-4 text-center text-carbon/50">Agregá los materiales que entregás.</td></tr>}
            </tbody>
          </table>
        </div>
        <Campo etiqueta="Agregar material">
          <select className="entrada" value="" onChange={(e) => { const id = Number(e.target.value); if (id) setItems([...items, { materialId: id, texto: '' }]); }}>
            <option value="">Elegí…</option>{mats.data?.filter((m) => m.tipo === 'material' && m.activo && !items.some((i) => i.materialId === m.id)).map((m) => <option key={m.id} value={m.id}>{m.codigo} · {m.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Notas (opcional)"><input className="entrada" value={d.notas} onChange={(e) => setD({ ...d, notas: e.target.value })} placeholder="Ej.: lo llevó Mojo" /></Campo>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn-primario" disabled={!items.length || malos.length > 0 || d.origen === d.destino || g.isPending}><Plus className="h-4 w-4" />Registrar entrega</button>
        </div>
      </form>
    </Modal>
  );
}
