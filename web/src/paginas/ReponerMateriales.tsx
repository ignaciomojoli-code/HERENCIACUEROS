import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCopy, Info, PackagePlus } from 'lucide-react';
import { api } from '../api';
import { useSesion } from '../sesion';
import { Aviso, Campo, Cargando, Encabezado, ErrorCarga, Modal, Vacio, avisar, avisarError } from '../componentes/ui';
import { Importe } from '../componentes/Importe';
import { fecha as fmtFecha, pesos } from '../formato';
import { cant, leerCant, type Unidad, conColor } from '../costos';

interface Origen { texto: string; unidades: number; cantidadMil: number }
interface Decision { id: number; tipo: 'posponer' | 'descartar' | 'proveedor'; cantidadMil: number | null; hasta: string | null; proveedor: string | null; motivo: string | null; creadoEn: string }
interface Fila {
  clave: string; materialId: number; colorId: number | null; color: string | null; codigo: string; nombre: string; unidad: Unidad; costoCentavos?: number | null; proveedorId: number | null; proveedor: string | null; proveedorHabitual: string | null; proveedorCambiado: boolean;
  stockMil: number; sinConteo: boolean; minimoMil: number; ventasMil: number; comprometidoMil: number; pedidoMil: number; borradorMil: number; necesidadMil: number; faltanteMil: number;
  descartadoMil: number; aPedirMil: number; pospuestoHasta: string | null; valorCentavos?: number | null;
  detalle: { ventas: Origen[]; taller: Origen[]; pedidos: { compraId: number; numero: number; estado: string; proveedor: string; cantidadMil: number }[]; decisiones: Decision[] };
}
interface Grupo { proveedorId: number | null; proveedor: string; items: Fila[]; valorCentavos?: number }
interface Repo { hoy: string; materiales: Fila[]; grupos: Grupo[]; pospuestos: Fila[]; sinConteo: Fila[]; modelosSinReceta: string[] }
interface Proveedor { id: number; nombre: string; activo: boolean }

const c = (mil: number, u: Unidad) => `${cant(mil)} ${u}`;

/** Qué materiales hay que reponer según las recetas: ventas sin encargar, pedidos al taller, stock y lo ya pedido. */
export function PaginaReponerMateriales() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['reposicion-materiales'], queryFn: () => api.get<Repo>('/reposicion-materiales') });
  const [verTodo, setVerTodo] = useState(false);
  const [detalle, setDetalle] = useState<Fila | null>(null);
  const inv = () => { ['reposicion-materiales', 'compras', 'materiales'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };
  if (q.isLoading) return <Cargando />;
  if (q.isError) return <ErrorCarga error={q.error} />;
  const r = q.data!;
  const enJuego = r.materiales.filter((m) => m.necesidadMil > 0 || m.pedidoMil > 0 || m.borradorMil > 0 || m.stockMil !== 0);
  return (
    <>
      <Encabezado titulo="Reponer materiales" sub="Lo que hace falta pedir de cuero, forrería y avíos según las recetas: ventas todavía no encargadas al taller, pedidos al taller sin entregar y stock mínimo, menos el stock y lo ya pedido." />
      {r.modelosSinReceta.length > 0 && <div className="mb-4"><Aviso>Sin receta (no suman materiales): {r.modelosSinReceta.join(', ')}. Cargala en <Link className="underline" to="/costeo">Recetas y costeo</Link>.</Aviso></div>}
      {!r.grupos.length ? <Vacio>{r.sinConteo.length ? 'No hay materiales con conteo que haga falta pedir. Los que no tienen conteo están abajo.' : 'No hace falta pedir materiales: lo que hay en stock y lo ya pedido cubre lo que se necesita.'}</Vacio> : (
        <div className="space-y-5">{r.grupos.map((g) => <TarjetaProveedor key={g.proveedorId ?? 'ninguno'} g={g} onDetalle={setDetalle} onCambio={inv} />)}</div>
      )}
      {r.sinConteo.length > 0 && (
        <section className="tarjeta mt-6 overflow-x-auto">
          <div className="border-b border-arena/50 px-4 py-3">
            <h2 className="text-lg font-bold">Falta el conteo inicial</h2>
            <div className="text-sm text-carbon/60">De estos materiales nunca se cargó cuánto había, así que el stock que figura sale solo de lo que consumió el taller y no es real. No sugiero cantidades hasta que cargues cuánto hay: en <Link className="underline" to="/materiales">Materiales</Link>, abrí el material y tocá "Cargar conteo".</div>
          </div>
          <table className="tabla"><thead><tr><th>Material</th><th className="num">Consumido</th><th className="num hidden sm:table-cell">Ventas y taller piden</th><th className="num hidden sm:table-cell">Ya pedido</th><th /></tr></thead>
            <tbody>{r.sinConteo.map((m) => (
              <tr key={m.clave}>
                <td>{conColor(m.nombre, m.color)}<div className="text-xs text-carbon/50">{m.proveedor ?? 'sin proveedor'}</div></td>
                <td className="num">{m.stockMil < 0 ? c(-m.stockMil, m.unidad) : '—'}</td>
                <td className="num hidden sm:table-cell">{c(m.ventasMil + m.comprometidoMil, m.unidad)}</td>
                <td className="num hidden sm:table-cell">{c(m.pedidoMil + m.borradorMil, m.unidad)}</td>
                <td className="text-right"><button className="btn-secundario btn-chico" onClick={() => setDetalle(m)}><Info className="h-4 w-4" />Ver</button></td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
      {r.pospuestos.length > 0 && (
        <section className="tarjeta mt-6 overflow-x-auto">
          <div className="border-b border-arena/50 px-4 py-3"><h2 className="text-lg font-bold">Pospuestos</h2><div className="text-sm text-carbon/60">Vuelven a aparecer solos en la fecha elegida.</div></div>
          <table className="tabla"><thead><tr><th>Material</th><th className="num">Falta</th><th>Hasta</th><th /></tr></thead>
            <tbody>{r.pospuestos.map((m) => (
              <tr key={m.clave}><td>{conColor(m.nombre, m.color)}</td><td className="num">{c(m.faltanteMil, m.unidad)}</td><td>{fmtFecha(m.pospuestoHasta + 'T12:00')}</td><td className="text-right"><button className="btn-secundario btn-chico" onClick={() => setDetalle(m)}>Ver</button></td></tr>
            ))}</tbody>
          </table>
        </section>
      )}
      <div className="mt-6">
        <button className="text-sm text-conac underline" onClick={() => setVerTodo(!verTodo)}>{verTodo ? 'Ocultar' : 'Ver'} la cuenta de todos los materiales</button>
        {verTodo && (
          <div className="tarjeta mt-3 overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>Material</th><th className="num">Stock</th><th className="num">Ventas sin encargar</th><th className="num">En el taller</th><th className="num">Mínimo</th><th className="num">Ya pedido</th><th className="num">Falta</th><th className="num">A pedir</th></tr></thead>
              <tbody>{enJuego.map((m) => (
                <tr key={m.clave} className="cursor-pointer" onClick={() => setDetalle(m)}>
                  <td>{conColor(m.nombre, m.color)}{m.sinConteo && <span className="ml-1 text-xs text-bordo">sin conteo</span>}</td>
                  <td className={`num ${m.stockMil < 0 ? 'text-bordo' : ''}`}>{cant(m.stockMil)}</td><td className="num">{cant(m.ventasMil)}</td><td className="num">{cant(m.comprometidoMil)}</td>
                  <td className="num">{cant(m.minimoMil)}</td><td className="num">{cant(m.pedidoMil + m.borradorMil)}</td><td className="num">{cant(m.faltanteMil)}</td><td className="num font-medium">{cant(m.aPedirMil)} {m.unidad}</td>
                </tr>
              ))}{!enJuego.length && <tr><td colSpan={8} className="py-6 text-center text-carbon/50">Ningún material tiene movimiento ni necesidad.</td></tr>}</tbody>
            </table>
          </div>
        )}
      </div>
      {detalle && <ModalDetalle f={r.materiales.find((m) => m.clave === detalle.clave) ?? detalle} onCerrar={() => setDetalle(null)} onCambio={inv} />}
    </>
  );
}

function TarjetaProveedor({ g, onDetalle, onCambio }: { g: Grupo; onDetalle: (f: Fila) => void; onCambio: () => void }) {
  const { puede } = useSesion();
  const nav = useNavigate();
  const [armar, setArmar] = useState(false);
  const costos = puede('costos');
  const copiar = async () => {
    try {
      const { texto } = await api.get<{ texto: string }>(`/reposicion-materiales/texto?proveedorId=${g.proveedorId ?? 'ninguno'}`);
      await navigator.clipboard.writeText(texto);
      avisar('Lista copiada: pegala en WhatsApp o en un mail');
    } catch (e) { avisarError(e); }
  };
  return (
    <section className="tarjeta overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-arena/50 px-4 py-3">
        <div>
          <h2 className="text-lg font-bold">{g.proveedor}</h2>
          <div className="text-sm text-carbon/60">{g.items.length} {g.items.length === 1 ? 'material' : 'materiales'}{costos && (g.valorCentavos ?? 0) > 0 ? ` · ${pesos(g.valorCentavos)} al costo actual` : ''}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn-secundario btn-chico" onClick={copiar}><ClipboardCopy className="h-4 w-4" />Copiar lista</button>
          {puede('compras', 'crear') && costos && g.proveedorId !== null && <button className="btn-primario btn-chico" onClick={() => setArmar(true)}><PackagePlus className="h-4 w-4" />Armar pedido</button>}
        </div>
      </div>
      {g.proveedorId === null && <p className="bg-crema-50 px-4 py-2 text-xs text-carbon/60">Estos materiales no tienen proveedor: asignáselo en Materiales o elegí uno con "Ver".</p>}
      <div className="overflow-x-auto">
        <table className="tabla">
          <thead><tr><th>Material</th><th className="num">Stock</th><th className="num hidden sm:table-cell">Se necesita</th><th className="num hidden sm:table-cell">Ya pedido</th><th className="num">A pedir</th><th /></tr></thead>
          <tbody>{g.items.map((m) => (
            <tr key={m.clave}>
              <td>{conColor(m.nombre, m.color)}{m.proveedorCambiado && <div className="text-xs text-carbon/50">habitual: {m.proveedorHabitual ?? '—'}</div>}{m.descartadoMil > 0 && <div className="text-xs text-carbon/50">descartado {c(m.descartadoMil, m.unidad)}</div>}</td>
              <td className={`num ${m.stockMil < 0 ? 'text-bordo' : ''}`}>{cant(m.stockMil)}{m.sinConteo && <div className="text-xs text-bordo">sin conteo</div>}</td>
              <td className="num hidden sm:table-cell">{cant(m.necesidadMil)}</td>
              <td className="num hidden sm:table-cell">{cant(m.pedidoMil + m.borradorMil)}</td>
              <td className="num font-medium">{c(m.aPedirMil, m.unidad)}</td>
              <td className="text-right"><button className="btn-secundario btn-chico" onClick={() => onDetalle(m)}><Info className="h-4 w-4" />Ver</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {armar && g.proveedorId !== null && <ModalArmar g={g} onCerrar={() => setArmar(false)} onListo={(id) => { onCambio(); nav(`/compras/${id}`); }} />}
    </section>
  );
}

function ModalArmar({ g, onCerrar, onListo }: { g: Grupo; onCerrar: () => void; onListo: (compraId: number) => void }) {
  const [filas, setFilas] = useState(g.items.map((m) => ({ m, usar: true, texto: cant(m.aPedirMil), costo: m.costoCentavos ?? null })));
  const elegidas = filas.filter((f) => f.usar);
  const malas = elegidas.filter((f) => !(leerCant(f.texto) > 0) || f.costo == null);
  const total = elegidas.reduce((s, f) => s + (leerCant(f.texto) > 0 ? Math.round((leerCant(f.texto) * (f.costo ?? 0)) / 1000) : 0), 0);
  const mut = useMutation({
    mutationFn: () => api.post<{ compraId: number; numero: number }>('/reposicion-materiales/armar', { proveedorId: g.proveedorId, lineas: elegidas.map((f) => ({ materialId: f.m.materialId, colorId: f.m.colorId, cantidadMil: leerCant(f.texto), costoUnitarioCentavos: f.costo })) }, true),
    onSuccess: (r) => { avisar(`Pedido P-${r.numero} armado en borrador: revisalo y confirmalo`); onListo(r.compraId); }, onError: avisarError,
  });
  return (
    <Modal titulo={`Armar pedido a ${g.proveedor}`} onCerrar={onCerrar} ancho="max-w-2xl">
      <div className="space-y-4">
        <p className="text-sm text-carbon/70">Se crea un pedido de materiales en <strong>borrador</strong>. Podés redondear las cantidades (por ejemplo el cuero a metros enteros). Antes de confirmarlo lo revisás en Pedidos; si lo anulás, la necesidad vuelve a aparecer acá.</p>
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead><tr><th /><th>Material</th><th className="num">Falta</th><th className="num w-32">Pedir</th><th className="num w-36">Costo por unidad</th></tr></thead>
            <tbody>{filas.map((f, i) => (
              <tr key={f.m.clave}>
                <td><input type="checkbox" checked={f.usar} onChange={(e) => setFilas(filas.map((x, j) => (j === i ? { ...x, usar: e.target.checked } : x)))} aria-label={`Incluir ${f.m.nombre}`} /></td>
                <td>{conColor(f.m.nombre, f.m.color)}</td>
                <td className="num">{c(f.m.aPedirMil, f.m.unidad)}</td>
                <td><div className="flex items-center gap-1"><input className={`entrada py-1 text-right ${f.usar && !(leerCant(f.texto) > 0) ? 'border-bordo' : ''}`} inputMode="decimal" value={f.texto} disabled={!f.usar} onChange={(e) => setFilas(filas.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)))} /><span className="text-xs text-carbon/55">{f.m.unidad}</span></div></td>
                <td><Importe valor={f.costo} onCambio={(v) => setFilas(filas.map((x, j) => (j === i ? { ...x, costo: v } : x)))} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {malas.length > 0 && <p className="text-xs text-bordo">Revisá {malas.map((f) => f.m.nombre).join(', ')}: falta la cantidad o el costo.</p>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">Total: <b>{pesos(total)}</b></span>
          <div className="flex gap-2"><button className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={!elegidas.length || malas.length > 0 || mut.isPending} onClick={() => mut.mutate()}>{mut.isPending ? 'Armando…' : 'Armar pedido'}</button></div>
        </div>
      </div>
    </Modal>
  );
}

const TIPO_DEC: Record<Decision['tipo'], string> = { posponer: 'Pospuesto', descartar: 'Descartado', proveedor: 'Otro proveedor' };

function ModalDetalle({ f, onCerrar, onCambio }: { f: Fila; onCerrar: () => void; onCambio: () => void }) {
  const { puede } = useSesion();
  const editable = puede('compras', 'crear');
  const [accion, setAccion] = useState<'posponer' | 'descartar' | 'proveedor' | null>(null);
  const deshacer = useMutation({ mutationFn: (id: number) => api.post(`/reposicion-materiales/decisiones/${id}/anular`, {}), onSuccess: () => { avisar('Listo'); onCambio(); }, onError: avisarError });
  const linea = (t: string, mil: number, signo = '') => <div className="flex justify-between gap-4"><span className="text-carbon/70">{t}</span><span>{signo}{c(mil, f.unidad)}</span></div>;
  return (
    <Modal titulo={conColor(f.nombre, f.color)} onCerrar={onCerrar} ancho="max-w-2xl">
      <div className="space-y-4 text-sm">
        <div className="space-y-1">
          {linea('Ventas todavía no encargadas al taller', f.ventasMil)}
          {linea('Pedidos al taller sin entregar', f.comprometidoMil)}
          {f.minimoMil > 0 && linea('Stock mínimo', f.minimoMil)}
          <div className="border-t border-arena pt-1">{linea('Se necesita', f.necesidadMil)}</div>
          {linea(`Stock actual${f.sinConteo ? ' (sin conteo inicial)' : ''}`, f.stockMil, '− ')}
          {f.pedidoMil > 0 && linea('Pedido al proveedor, sin entregar', f.pedidoMil, '− ')}
          {f.borradorMil > 0 && linea('En pedidos borrador (sin confirmar)', f.borradorMil, '− ')}
          <div className="border-t border-arena pt-1">{linea('Falta', f.faltanteMil)}</div>
          {f.descartadoMil > 0 && linea('Descartado', f.descartadoMil, '− ')}
          <div className="flex justify-between gap-4 font-medium"><span>A pedir{f.proveedor ? ` a ${f.proveedor}` : ''}</span><span>{c(f.aPedirMil, f.unidad)}</span></div>
        </div>
        {(f.detalle.ventas.length > 0 || f.detalle.taller.length > 0) && (
          <div><div className="etiqueta mb-1">De dónde sale</div>
            <ul className="space-y-0.5 text-carbon/80">{[...f.detalle.ventas, ...f.detalle.taller].map((o, i) => <li key={i}>{o.texto}: {o.unidades} u. → {c(o.cantidadMil, f.unidad)}</li>)}</ul>
          </div>
        )}
        {f.detalle.pedidos.length > 0 && (
          <div><div className="etiqueta mb-1">Pedidos de este material</div>
            <ul className="space-y-0.5">{f.detalle.pedidos.map((p) => <li key={p.compraId}><Link className="underline" to={`/compras/${p.compraId}`}>P-{p.numero}</Link> · {p.proveedor} · falta entregar {c(p.cantidadMil, f.unidad)}{p.estado === 'borrador' && ' (borrador)'}</li>)}</ul>
          </div>
        )}
        {f.detalle.decisiones.length > 0 && (
          <div><div className="etiqueta mb-1">Decisiones</div>
            <ul className="space-y-1">{f.detalle.decisiones.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{TIPO_DEC[d.tipo]}{d.tipo === 'posponer' && d.hasta ? ` hasta ${fmtFecha(d.hasta + 'T12:00')}` : ''}{d.tipo === 'descartar' && d.cantidadMil ? ` ${c(d.cantidadMil, f.unidad)}` : ''}{d.tipo === 'proveedor' ? `: ${d.proveedor}` : ''}{d.motivo ? ` · ${d.motivo}` : ''}</span>
                {editable && <button className="btn-secundario btn-chico" disabled={deshacer.isPending} onClick={() => deshacer.mutate(d.id)}>Deshacer</button>}
              </li>
            ))}</ul>
          </div>
        )}
        {editable && (
          <div className="flex flex-wrap gap-2 border-t border-arena pt-3">
            <button className="btn-secundario btn-chico" onClick={() => setAccion('posponer')}>Posponer</button>
            <button className="btn-secundario btn-chico" disabled={f.aPedirMil <= 0} onClick={() => setAccion('descartar')}>Descartar</button>
            <button className="btn-secundario btn-chico" onClick={() => setAccion('proveedor')}>Cambiar proveedor</button>
          </div>
        )}
        {accion && <FormDecision f={f} accion={accion} onCerrar={() => setAccion(null)} onListo={() => { setAccion(null); onCambio(); }} />}
      </div>
    </Modal>
  );
}

function FormDecision({ f, accion, onCerrar, onListo }: { f: Fila; accion: 'posponer' | 'descartar' | 'proveedor'; onCerrar: () => void; onListo: () => void }) {
  const provs = useQuery({ queryKey: ['proveedores'], queryFn: () => api.get<Proveedor[]>('/proveedores'), enabled: accion === 'proveedor' });
  const [hasta, setHasta] = useState('');
  const [texto, setTexto] = useState(cant(f.aPedirMil));
  const [prov, setProv] = useState(f.proveedorId ?? 0);
  const [motivo, setMotivo] = useState('');
  const mut = useMutation({
    mutationFn: () => api.post(`/reposicion-materiales/${accion}`, accion === 'posponer' ? { materialId: f.materialId, colorId: f.colorId, hasta, motivo: motivo || null }
      : accion === 'descartar' ? { materialId: f.materialId, colorId: f.colorId, cantidadMil: leerCant(texto), motivo } : { materialId: f.materialId, colorId: f.colorId, proveedorId: prov, motivo: motivo || null }),
    onSuccess: () => { avisar('Listo'); onListo(); }, onError: avisarError,
  });
  const valido = accion === 'posponer' ? !!hasta : accion === 'descartar' ? leerCant(texto) > 0 && !!motivo.trim() : prov > 0;
  return (
    <form className="space-y-3 rounded border border-arena p-3" onSubmit={(e) => { e.preventDefault(); if (valido) mut.mutate(); }}>
      {accion === 'posponer' && <Campo etiqueta="No pedir hasta"><input className="entrada" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>}
      {accion === 'descartar' && <Campo etiqueta={`Cantidad que no se pide (${f.unidad})`} ayuda="Lo que falta hoy y no vas a pedir. Si después hace falta más, aparece solo lo nuevo."><input className="entrada w-32" inputMode="decimal" value={texto} onChange={(e) => setTexto(e.target.value)} /></Campo>}
      {accion === 'proveedor' && (
        <Campo etiqueta="Pedírselo a" ayuda="Solo para este pedido. El proveedor habitual se cambia en Materiales.">
          <select className="entrada" value={prov} onChange={(e) => setProv(Number(e.target.value))}><option value={0}>Elegí…</option>{provs.data?.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
        </Campo>
      )}
      <Campo etiqueta={accion === 'descartar' ? 'Motivo' : 'Motivo (opcional)'}><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
      <div className="flex justify-end gap-2"><button type="button" className="btn-secundario btn-chico" onClick={onCerrar}>Cancelar</button><button className="btn-primario btn-chico" disabled={!valido || mut.isPending}>Guardar</button></div>
    </form>
  );
}
