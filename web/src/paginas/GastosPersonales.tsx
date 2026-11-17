import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Download, FolderTree, Plus } from 'lucide-react';
import { api, qs } from '../api';
import { useSesion } from '../sesion';
import { Aviso, Campo, Cargando, Confirmar, Encabezado, ErrorCarga, Modal, Vacio, avisar, avisarError } from '../componentes/ui';
import { Th, useOrden } from '../componentes/Orden';
import { Importe } from '../componentes/Importe';
import { pesos } from '../formato';
import { fechaCorta, hoy, inicioMes, queriesPlata, useCategoriasGasto, useCuentas, type CategoriaGasto } from '../plata';
import { Tarjeta } from './Ventas';
import { ModalCategorias } from './Gastos';

interface GastoPersonal {
  id: number; numero: number; fecha: string; descripcion: string; categoriaId: number; subcategoriaId: number | null; categoria: string; subcategoria: string | null;
  importeCentavos: number; cuentaId: number | null; cuenta: string | null; notas: string | null; estado: 'activo' | 'anulado'; motivoAnulacion: string | null;
}
interface Lista {
  filas: GastoPersonal[];
  retiros: { id: number; fecha: string; concepto: string; importeCentavos: number; cuenta: string }[];
  totales: { gastosCentavos: number; conPlataDelLocalCentavos: number; porFueraCentavos: number; retirosSinDetalleCentavos: number; porCategoria: { categoria: string; importeCentavos: number }[] };
}
const inv = (qc: ReturnType<typeof useQueryClient>) => queriesPlata.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

/** Gastos personales: aparte de los del local. Si se pagan con plata del local salen de la caja como retiro. */
export function PaginaGastosPersonales() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const f = { desde: params.get('desde') ?? inicioMes(), hasta: params.get('hasta') ?? hoy(), categoriaId: params.get('categoria') ?? '', q: params.get('q') ?? '', estado: params.get('estado') ?? 'activo' };
  const fijar = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const todas = useCategoriasGasto();
  const cats = (todas.data ?? []).filter((c) => c.ambito === 'personal');
  const lista = useQuery({ queryKey: ['gastos-personales', f], queryFn: () => api.get<Lista>('/gastos-personales' + qs(f)) });
  const [editar, setEditar] = useState<Partial<GastoPersonal> | null>(null);
  const [anular, setAnular] = useState<GastoPersonal | null>(null);
  const [verCats, setVerCats] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [q, setQ] = useState(f.q);
  const anu = useMutation({
    mutationFn: () => api.post(`/gastos-personales/${anular!.id}/anular`, { motivo }),
    onSuccess: () => { avisar(anular?.cuentaId ? 'Gasto anulado: la plata volvió a la cuenta' : 'Gasto anulado'); setAnular(null); setMotivo(''); inv(qc); }, onError: avisarError,
  });
  const d = lista.data;
  const { filas, orden } = useOrden(d?.filas, {
    numero: (g) => g.numero, fecha: (g) => g.fecha, descripcion: (g) => g.descripcion, categoria: (g) => `${g.categoria} ${g.subcategoria ?? ''}`, cuenta: (g) => g.cuenta ?? '', importe: (g) => g.importeCentavos,
  }, { col: 'fecha', dir: 'desc' });
  const principales = cats.filter((c) => !c.padreId);
  return (
    <>
      <Encabezado titulo="Gastos personales" sub="No son gastos del local ni costo de mercadería. Si se pagan con plata del local, salen de la caja como retiro.">
        {puede('caja', 'modificar') && <button className="btn-secundario" onClick={() => setVerCats(true)}><FolderTree className="h-4 w-4" />Categorías</button>}
        {puede('caja', 'exportar') && <a className="btn-secundario" href={'/api/gastos-personales/exportar' + qs(f)}><Download className="h-4 w-4" />Excel</a>}
        {puede('caja', 'crear') && <button className="btn-primario" onClick={() => setEditar({})}><Plus className="h-4 w-4" />Nuevo gasto personal</button>}
      </Encabezado>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <form className="sm:col-span-2 lg:col-span-1" onSubmit={(e) => { e.preventDefault(); fijar('q', q); }}>
          <input className="entrada" placeholder="Buscar (Enter)" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => q !== f.q && fijar('q', q)} />
        </form>
        <input className="entrada" type="date" value={f.desde} onChange={(e) => fijar('desde', e.target.value)} aria-label="Desde" />
        <input className="entrada" type="date" value={f.hasta} onChange={(e) => fijar('hasta', e.target.value)} aria-label="Hasta" />
        <select className="entrada" value={f.categoriaId} onChange={(e) => fijar('categoria', e.target.value)}><option value="">Todas las categorías</option>{principales.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
        <select className="entrada" value={f.estado} onChange={(e) => fijar('estado', e.target.value)}><option value="activo">Vigentes</option><option value="anulado">Anulados</option><option value="todos">Todos</option></select>
      </div>
      {!todas.isLoading && !principales.length && puede('caja', 'modificar') && (
        <Aviso>Todavía no hay categorías de gastos personales. Creá las que uses (por ejemplo Auto, Salud, Ropa) con el botón Categorías.</Aviso>
      )}
      {d && (
        <div className="my-4 grid gap-3 lg:grid-cols-3">
          <div className="grid gap-3">
            <Tarjeta titulo="Gastos personales" valor={pesos(d.totales.gastosCentavos)} sub={`${pesos(d.totales.conPlataDelLocalCentavos)} con plata del local · ${pesos(d.totales.porFueraCentavos)} por fuera`} />
            {d.retiros.length > 0 && <Tarjeta titulo="Retiros sin detalle" valor={pesos(d.totales.retirosSinDetalleCentavos)} sub={`${d.retiros.length} retiros cargados desde Caja`} />}
          </div>
          <div className="tarjeta p-4 lg:col-span-2">
            <div className="etiqueta mb-2">Por categoría</div>
            {!d.totales.porCategoria.length ? <p className="text-sm text-carbon/50">Sin gastos personales en el período.</p> : d.totales.porCategoria.map((c) => (
              <div key={c.categoria} className="mb-2">
                <div className="flex items-center justify-between text-sm"><span className="font-medium">{c.categoria}</span><span className="tabular-nums">{pesos(c.importeCentavos)}</span></div>
                <div className="mt-1 h-1.5 rounded bg-arena/40"><div className="h-1.5 rounded bg-conac" style={{ width: `${d.totales.gastosCentavos ? (c.importeCentavos / d.totales.gastosCentavos) * 100 : 0}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      )}
      {lista.isLoading ? <Cargando /> : lista.isError ? <ErrorCarga error={lista.error} /> : !d!.filas.length && !d!.retiros.length ? <Vacio>No hay gastos personales con ese filtro.</Vacio> : (
        <>
          {d!.filas.length > 0 && (
            <div className="tarjeta overflow-x-auto">
              <table className="tabla">
                <thead><tr><Th col="numero" orden={orden}>N°</Th><Th col="fecha" orden={orden}>Fecha</Th><Th col="descripcion" orden={orden}>Descripción</Th><Th col="categoria" orden={orden} className="hidden sm:table-cell">Categoría</Th><Th col="cuenta" orden={orden} className="hidden md:table-cell">Pagado con</Th><Th col="importe" orden={orden} className="num">Importe</Th><th /></tr></thead>
                <tbody>
                  {filas.map((g) => (
                    <tr key={g.id} className={g.estado === 'anulado' ? 'text-carbon/40' : ''}>
                      <td className="font-medium">GP-{g.numero}</td>
                      <td className="whitespace-nowrap">{fechaCorta(g.fecha)}</td>
                      <td><span className={g.estado === 'anulado' ? 'line-through' : ''}>{g.descripcion}</span>{g.notas && <div className="text-xs text-carbon/50">{g.notas}</div>}{g.estado === 'anulado' && <div className="text-xs">Anulado: {g.motivoAnulacion}</div>}</td>
                      <td className="hidden sm:table-cell">{g.categoria}{g.subcategoria && <span className="text-carbon/55"> <ChevronRight className="inline h-3 w-3" /> {g.subcategoria}</span>}</td>
                      <td className="hidden md:table-cell">{g.cuenta ?? <span className="text-carbon/55">Por fuera del local</span>}</td>
                      <td className="num font-medium">{pesos(g.importeCentavos)}</td>
                      <td className="whitespace-nowrap text-right">
                        {g.estado === 'activo' && puede('caja', 'modificar') && <button className="btn-secundario btn-chico mr-1" onClick={() => setEditar(g)}>Editar</button>}
                        {g.estado === 'activo' && puede('caja', 'anular') && <button className="btn-secundario btn-chico" onClick={() => setAnular(g)}>Anular</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d!.retiros.length > 0 && (
            <div className="mt-5">
              <div className="etiqueta mb-1">Retiros personales cargados desde Caja (sin categoría)</div>
              <div className="tarjeta overflow-x-auto">
                <table className="tabla">
                  <thead><tr><th>Fecha</th><th>Concepto</th><th className="hidden md:table-cell">Cuenta</th><th className="num">Importe</th></tr></thead>
                  <tbody>{d!.retiros.map((r) => <tr key={r.id}><td className="whitespace-nowrap">{fechaCorta(r.fecha)}</td><td>{r.concepto}</td><td className="hidden md:table-cell">{r.cuenta}</td><td className="num">{pesos(r.importeCentavos)}</td></tr>)}</tbody>
                </table>
              </div>
              <p className="mt-1 text-xs text-carbon/55">Se muestran para que la consulta esté completa. Se anulan desde Caja.</p>
            </div>
          )}
        </>
      )}
      {editar && <ModalGastoPersonal gasto={editar} cats={cats} onCerrar={() => setEditar(null)} onListo={() => inv(qc)} />}
      {verCats && <ModalCategorias cats={cats} ambito="personal" onCerrar={() => setVerCats(false)} />}
      {anular && (
        <Confirmar titulo={`Anular gasto personal GP-${anular.numero}`} textoBoton="Anular" peligro ocupado={anu.isPending} onCerrar={() => { setAnular(null); setMotivo(''); }} onConfirmar={() => anu.mutate()}>
          <p>{anular.cuentaId ? `Vuelven ${pesos(anular.importeCentavos)} a ${anular.cuenta} (con un movimiento de anulación).` : 'Se pagó por fuera del local: no mueve la caja.'}</p>
          <Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
        </Confirmar>
      )}
    </>
  );
}

function ModalGastoPersonal({ gasto, cats, onCerrar, onListo }: { gasto: Partial<GastoPersonal>; cats: CategoriaGasto[]; onCerrar: () => void; onListo: () => void }) {
  const editando = !!gasto.id;
  const cuentas = useCuentas();
  const [d, setD] = useState({
    fecha: gasto.fecha?.slice(0, 10) ?? hoy(), descripcion: gasto.descripcion ?? '', categoriaId: gasto.categoriaId ?? 0, subcategoriaId: gasto.subcategoriaId ?? null as number | null,
    importeCentavos: gasto.importeCentavos ?? null as number | null, cuentaId: (editando ? gasto.cuentaId ?? -1 : 0) as number, notas: gasto.notas ?? '', motivo: '',
  });
  const principales = cats.filter((c) => !c.padreId && (c.activo || c.id === d.categoriaId));
  const subs = cats.filter((c) => c.padreId === d.categoriaId && (c.activo || c.id === d.subcategoriaId));
  const pagables = (cuentas.data ?? []).filter((c) => (c.activo || c.id === d.cuentaId) && c.tipo !== 'a_liquidar' && c.tipo !== 'externa' && c.moneda === 'ARS');
  const cambiaPlata = editando && (d.importeCentavos !== gasto.importeCentavos || d.fecha !== gasto.fecha || (d.cuentaId === -1 ? null : d.cuentaId) !== gasto.cuentaId);
  const m = useMutation({
    mutationFn: () => {
      const datos = { fecha: d.fecha, descripcion: d.descripcion, categoriaId: d.categoriaId, subcategoriaId: d.subcategoriaId, importeCentavos: d.importeCentavos, cuentaId: d.cuentaId === -1 ? null : d.cuentaId, notas: d.notas || null };
      return editando ? api.put(`/gastos-personales/${gasto.id}`, { ...datos, motivo: d.motivo }) : api.post('/gastos-personales', datos, true);
    },
    onSuccess: () => { avisar(editando ? 'Gasto personal corregido' : 'Gasto personal registrado'); onListo(); onCerrar(); }, onError: avisarError,
  });
  const valido = d.descripcion.trim() && d.categoriaId && d.importeCentavos && d.importeCentavos > 0 && d.cuentaId !== 0 && (!editando || d.motivo.trim());
  return (
    <Modal titulo={editando ? `Corregir gasto personal GP-${gasto.numero}` : 'Nuevo gasto personal'} onCerrar={onCerrar} ancho="max-w-xl">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valido) m.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Descripción" className="sm:col-span-2"><input className="entrada" value={d.descripcion} onChange={(e) => setD({ ...d, descripcion: e.target.value })} placeholder="Ej.: lavado del auto" autoFocus /></Campo>
          <Campo etiqueta="Categoría">
            <select className="entrada" value={d.categoriaId} onChange={(e) => setD({ ...d, categoriaId: Number(e.target.value), subcategoriaId: null })}><option value={0}>{principales.length ? 'Elegí…' : 'Creá una categoría primero'}</option>{principales.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
          </Campo>
          <Campo etiqueta="Subcategoría">
            <select className="entrada" value={d.subcategoriaId ?? ''} disabled={!subs.length} onChange={(e) => setD({ ...d, subcategoriaId: e.target.value ? Number(e.target.value) : null })}><option value="">{subs.length ? 'Sin subcategoría' : '—'}</option>{subs.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
          </Campo>
          <Campo etiqueta="Fecha"><input className="entrada" type="date" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></Campo>
          <Campo etiqueta="Importe"><Importe valor={d.importeCentavos} onCambio={(v) => setD({ ...d, importeCentavos: v })} /></Campo>
          <Campo etiqueta="Medio de pago" className="sm:col-span-2" ayuda={d.cuentaId === -1 ? 'No mueve la caja del local: queda solo registrado.' : d.cuentaId > 0 ? 'Sale de esa cuenta como retiro personal (no es gasto del local).' : undefined}>
            <select className="entrada" value={d.cuentaId} onChange={(e) => setD({ ...d, cuentaId: Number(e.target.value) })}>
              <option value={0}>Elegí…</option>
              {pagables.map((c) => <option key={c.id} value={c.id}>{c.nombre} (plata del local)</option>)}
              <option value={-1}>Pagado por fuera del local</option>
            </select>
          </Campo>
          <Campo etiqueta="Observaciones" className="sm:col-span-2"><input className="entrada" value={d.notas} onChange={(e) => setD({ ...d, notas: e.target.value })} /></Campo>
          {editando && <Campo etiqueta="Motivo de la corrección *" className="sm:col-span-2" ayuda="Queda en la auditoría junto con el antes y el después."><input className="entrada" value={d.motivo} onChange={(e) => setD({ ...d, motivo: e.target.value })} /></Campo>}
        </div>
        {cambiaPlata && <Aviso>Cambia el importe, la fecha o el medio de pago: el movimiento de caja anterior se compensa con uno contrario y se registra el nuevo.</Aviso>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={!valido || m.isPending}>{m.isPending ? 'Guardando…' : 'Guardar'}</button></div>
      </form>
    </Modal>
  );
}
