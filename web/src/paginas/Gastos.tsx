import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Download, FolderTree, Plus } from 'lucide-react';
import { api, qs } from '../api';
import { useSesion } from '../sesion';
import { Aviso, Campo, Cargando, Confirmar, Encabezado, ErrorCarga, Modal, Vacio, avisar, avisarError } from '../componentes/ui';
import { Importe } from '../componentes/Importe';
import { pesos } from '../formato';
import { fechaCorta, hoy, inicioMes, queriesPlata, useCategoriasGasto, useCuentas, type CategoriaGasto } from '../plata';
import { Tarjeta } from './Ventas';

interface Gasto {
  id: number; numero: number; fecha: string; concepto: string; categoriaId: number; subcategoriaId: number | null; categoria: string; subcategoria: string | null;
  importeCentavos: number; cuentaId: number; cuenta: string; tipoCuenta: string; proveedorId: number | null; proveedor: string | null;
  comprobante: string | null; notas: string | null; estado: 'activo' | 'anulado'; motivoAnulacion: string | null;
}
interface ListaGastos { totalCentavos: number; pagadoPorExternosCentavos: number; porCategoria: { categoria: string; totalCentavos: number; cantidad: number; sub: { nombre: string; totalCentavos: number }[] }[]; filas: Gasto[] }
const inv = (qc: ReturnType<typeof useQueryClient>) => queriesPlata.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

export function PaginaGastos() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const f = { desde: params.get('desde') ?? inicioMes(), hasta: params.get('hasta') ?? hoy(), categoriaId: params.get('categoria') ?? '', subcategoriaId: params.get('sub') ?? '', cuentaId: params.get('cuenta') ?? '', q: params.get('q') ?? '', estado: params.get('estado') ?? 'activo' };
  const fijar = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); if (k === 'categoria') p.delete('sub'); setParams(p, { replace: true }); };
  const cats = useCategoriasGasto();
  const cuentas = useCuentas();
  const filtro = { desde: f.desde, hasta: f.hasta, categoriaId: f.categoriaId, subcategoriaId: f.subcategoriaId, cuentaId: f.cuentaId, q: f.q, estado: f.estado };
  const lista = useQuery({ queryKey: ['gastos', filtro], queryFn: () => api.get<ListaGastos>('/gastos' + qs(filtro)) });
  const [editar, setEditar] = useState<Partial<Gasto> | null>(null);
  const [anular, setAnular] = useState<Gasto | null>(null);
  const [verCats, setVerCats] = useState(false);
  const [motivo, setMotivo] = useState('');
  const anu = useMutation({
    mutationFn: () => api.post(`/gastos/${anular!.id}/anular`, { motivo }),
    onSuccess: () => { avisar('Gasto anulado: la plata volvió a la cuenta'); setAnular(null); setMotivo(''); inv(qc); }, onError: avisarError,
  });
  const principales = (cats.data ?? []).filter((c) => !c.padreId);
  const subs = (cats.data ?? []).filter((c) => f.categoriaId && c.padreId === Number(f.categoriaId));
  const d = lista.data;
  return (
    <>
      <Encabezado titulo="Gastos" sub="Gastos del local por categoría. Los gastos personales van como retiro en Caja.">
        {puede('gastos', 'modificar') && <button className="btn-secundario" onClick={() => setVerCats(true)}><FolderTree className="h-4 w-4" />Categorías</button>}
        {puede('gastos', 'exportar') && <a className="btn-secundario" href={'/api/gastos/exportar' + qs(filtro)}><Download className="h-4 w-4" />Excel</a>}
        {puede('gastos', 'crear') && <button className="btn-primario" onClick={() => setEditar({ fecha: hoy() } as Partial<Gasto>)}><Plus className="h-4 w-4" />Nuevo gasto</button>}
      </Encabezado>
      <div className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <input className="entrada" type="date" value={f.desde} onChange={(e) => fijar('desde', e.target.value)} aria-label="Desde" />
        <input className="entrada" type="date" value={f.hasta} onChange={(e) => fijar('hasta', e.target.value)} aria-label="Hasta" />
        <select className="entrada" value={f.categoriaId} onChange={(e) => fijar('categoria', e.target.value)}><option value="">Todas las categorías</option>{principales.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
        <select className="entrada" value={f.subcategoriaId} onChange={(e) => fijar('sub', e.target.value)} disabled={!subs.length}><option value="">Todas las subcategorías</option>{subs.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
        <select className="entrada" value={f.cuentaId} onChange={(e) => fijar('cuenta', e.target.value)}><option value="">Pagado con cualquier cuenta</option>{cuentas.data?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
        <select className="entrada" value={f.estado} onChange={(e) => fijar('estado', e.target.value)}><option value="activo">Vigentes</option><option value="anulado">Anulados</option><option value="todos">Todos</option></select>
      </div>
      {d && (
        <div className="mb-4 grid gap-3 lg:grid-cols-3">
          <div className="grid gap-3">
            <Tarjeta titulo="Total de gastos" valor={pesos(d.totalCentavos)} sub={`${d.filas.filter((g) => g.estado === 'activo').length} gastos`} />
            {d.pagadoPorExternosCentavos > 0 && <Tarjeta titulo="Pagado por el inversor externo" valor={pesos(d.pagadoPorExternosCentavos)} sub="Ya incluido en el total" />}
          </div>
          <div className="tarjeta p-4 lg:col-span-2">
            <div className="etiqueta mb-2">Por categoría</div>
            {!d.porCategoria.length ? <p className="text-sm text-carbon/50">Sin gastos.</p> : d.porCategoria.map((c) => (
              <div key={c.categoria} className="mb-2">
                <div className="flex items-center justify-between text-sm"><span className="font-medium">{c.categoria}</span><span className="tabular-nums">{pesos(c.totalCentavos)}</span></div>
                <div className="mt-1 h-1.5 rounded bg-arena/40"><div className="h-1.5 rounded bg-conac" style={{ width: `${d.totalCentavos ? (c.totalCentavos / d.totalCentavos) * 100 : 0}%` }} /></div>
                {c.sub.length > 1 || c.sub[0]?.nombre !== 'Sin subcategoría' ? <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-carbon/55">{c.sub.map((s) => <span key={s.nombre}>{s.nombre} {pesos(s.totalCentavos)}</span>)}</div> : null}
              </div>
            ))}
          </div>
        </div>
      )}
      <input className="entrada mb-3" placeholder="Buscar concepto, nota o comprobante" defaultValue={f.q} onKeyDown={(e) => e.key === 'Enter' && fijar('q', (e.target as HTMLInputElement).value)} onBlur={(e) => fijar('q', e.target.value)} />
      {lista.isLoading ? <Cargando /> : lista.isError ? <ErrorCarga error={lista.error} /> : !d!.filas.length ? <Vacio>No hay gastos con ese filtro.</Vacio> : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead><tr><th>N°</th><th>Fecha</th><th>Concepto</th><th className="hidden sm:table-cell">Categoría</th><th className="hidden md:table-cell">Pagado con</th><th className="num">Importe</th><th /></tr></thead>
            <tbody>
              {d!.filas.map((g) => (
                <tr key={g.id} className={g.estado === 'anulado' ? 'text-carbon/40' : ''}>
                  <td className="font-medium">G-{g.numero}</td>
                  <td className="whitespace-nowrap">{fechaCorta(g.fecha)}</td>
                  <td><span className={g.estado === 'anulado' ? 'line-through' : ''}>{g.concepto}</span>{g.notas && <div className="text-xs text-carbon/50">{g.notas}</div>}{g.estado === 'anulado' && <div className="text-xs">Anulado: {g.motivoAnulacion}</div>}</td>
                  <td className="hidden sm:table-cell">{g.categoria}{g.subcategoria && <span className="text-carbon/55"> <ChevronRight className="inline h-3 w-3" /> {g.subcategoria}</span>}</td>
                  <td className="hidden md:table-cell">{g.cuenta}</td>
                  <td className="num font-medium">{pesos(g.importeCentavos)}</td>
                  <td className="whitespace-nowrap text-right">
                    {g.estado === 'activo' && puede('gastos', 'modificar') && <button className="btn-secundario btn-chico mr-1" onClick={() => setEditar(g)}>Editar</button>}
                    {g.estado === 'activo' && puede('gastos', 'anular') && <button className="btn-secundario btn-chico" onClick={() => setAnular(g)}>Anular</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editar && <ModalGasto gasto={editar} cats={cats.data ?? []} onCerrar={() => setEditar(null)} onListo={() => inv(qc)} />}
      {verCats && <ModalCategorias cats={cats.data ?? []} onCerrar={() => setVerCats(false)} />}
      {anular && (
        <Confirmar titulo={`Anular gasto G-${anular.numero}`} textoBoton="Anular" peligro ocupado={anu.isPending} onCerrar={() => { setAnular(null); setMotivo(''); }} onConfirmar={() => anu.mutate()}>
          <p>Vuelven {pesos(anular.importeCentavos)} a {anular.cuenta} (con un movimiento de anulación). Para corregir el importe, la fecha o la cuenta, anulalo y cargalo de nuevo.</p>
          <Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
        </Confirmar>
      )}
    </>
  );
}

function ModalGasto({ gasto, cats, onCerrar, onListo }: { gasto: Partial<Gasto>; cats: CategoriaGasto[]; onCerrar: () => void; onListo: () => void }) {
  const editando = !!gasto.id;
  const cuentas = useCuentas();
  const provs = useQuery({ queryKey: ['proveedores'], queryFn: () => api.get<{ id: number; nombre: string; activo: boolean }[]>('/proveedores') });
  const [d, setD] = useState({
    fecha: gasto.fecha?.slice(0, 10) ?? hoy(), concepto: gasto.concepto ?? '', categoriaId: gasto.categoriaId ?? 0, subcategoriaId: gasto.subcategoriaId ?? null as number | null,
    importeCentavos: gasto.importeCentavos ?? null as number | null, cuentaId: gasto.cuentaId ?? 0, proveedorId: gasto.proveedorId ?? null as number | null,
    comprobante: gasto.comprobante ?? '', notas: gasto.notas ?? '',
  });
  const principales = cats.filter((c) => !c.padreId && (c.activo || c.id === d.categoriaId));
  const subs = cats.filter((c) => c.padreId === d.categoriaId && (c.activo || c.id === d.subcategoriaId));
  const pagables = (cuentas.data ?? []).filter((c) => c.activo && c.tipo !== 'a_liquidar' && c.moneda === 'ARS');
  const cuenta = pagables.find((c) => c.id === d.cuentaId);
  const m = useMutation({
    mutationFn: () => {
      const comun = { concepto: d.concepto, categoriaId: d.categoriaId, subcategoriaId: d.subcategoriaId, proveedorId: d.proveedorId, comprobante: d.comprobante || null, notas: d.notas || null };
      return editando ? api.put(`/gastos/${gasto.id}`, comun) : api.post('/gastos', { ...comun, fecha: d.fecha, importeCentavos: d.importeCentavos, cuentaId: d.cuentaId }, true);
    },
    onSuccess: () => { avisar(editando ? 'Gasto actualizado' : 'Gasto registrado'); onListo(); onCerrar(); }, onError: avisarError,
  });
  const valido = d.concepto.trim() && d.categoriaId && (editando || (d.importeCentavos && d.importeCentavos > 0 && d.cuentaId));
  return (
    <Modal titulo={editando ? `Editar gasto G-${gasto.numero}` : 'Nuevo gasto'} onCerrar={onCerrar} ancho="max-w-xl">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valido) m.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Concepto" className="sm:col-span-2"><input className="entrada" value={d.concepto} onChange={(e) => setD({ ...d, concepto: e.target.value })} placeholder="Ej.: luz de octubre" autoFocus /></Campo>
          <Campo etiqueta="Categoría">
            <select className="entrada" value={d.categoriaId} onChange={(e) => setD({ ...d, categoriaId: Number(e.target.value), subcategoriaId: null })}><option value={0}>Elegí…</option>{principales.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
          </Campo>
          <Campo etiqueta="Subcategoría">
            <select className="entrada" value={d.subcategoriaId ?? ''} disabled={!subs.length} onChange={(e) => setD({ ...d, subcategoriaId: e.target.value ? Number(e.target.value) : null })}><option value="">{subs.length ? 'Sin subcategoría' : '—'}</option>{subs.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
          </Campo>
          {!editando && <>
            <Campo etiqueta="Fecha"><input className="entrada" type="date" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></Campo>
            <Campo etiqueta="Importe"><Importe valor={d.importeCentavos} onCambio={(v) => setD({ ...d, importeCentavos: v })} /></Campo>
            <Campo etiqueta="Pagado con" className="sm:col-span-2" ayuda={cuenta?.tipo === 'externa' ? `Queda registrado como aporte de ${cuenta.nombre}: la plata del local no se mueve.` : undefined}>
              <select className="entrada" value={d.cuentaId} onChange={(e) => setD({ ...d, cuentaId: Number(e.target.value) })}><option value={0}>Elegí…</option>{pagables.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
            </Campo>
          </>}
          <Campo etiqueta="Proveedor (opcional)">
            <select className="entrada" value={d.proveedorId ?? ''} onChange={(e) => setD({ ...d, proveedorId: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{provs.data?.filter((p) => p.activo || p.id === d.proveedorId).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
          </Campo>
          <Campo etiqueta="Comprobante (opcional)"><input className="entrada" value={d.comprobante} onChange={(e) => setD({ ...d, comprobante: e.target.value })} /></Campo>
          <Campo etiqueta="Notas" className="sm:col-span-2"><input className="entrada" value={d.notas} onChange={(e) => setD({ ...d, notas: e.target.value })} /></Campo>
        </div>
        {editando && <Aviso>El importe, la fecha y la cuenta no se editan: si están mal, anulá el gasto y cargalo de nuevo.</Aviso>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={!valido || m.isPending}>{m.isPending ? 'Guardando…' : 'Guardar'}</button></div>
      </form>
    </Modal>
  );
}

function ModalCategorias({ cats, onCerrar }: { cats: CategoriaGasto[]; onCerrar: () => void }) {
  const qc = useQueryClient();
  const [nueva, setNueva] = useState<{ nombre: string; padreId: number | null } | null>(null);
  const [renombrar, setRenombrar] = useState<CategoriaGasto | null>(null);
  const guardar = useMutation({
    mutationFn: (c: { id?: number; nombre: string; padreId: number | null; activo?: boolean }) => (c.id ? api.put(`/gastos/categorias/${c.id}`, c) : api.post('/gastos/categorias', c)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['categorias-gasto'] }); setNueva(null); setRenombrar(null); }, onError: avisarError,
  });
  const principales = cats.filter((c) => !c.padreId);
  const fila = (c: CategoriaGasto, sub = false) => (
    <div key={c.id} className={`flex items-center justify-between gap-2 py-1.5 ${sub ? 'pl-6 text-sm' : 'font-medium'} ${c.activo ? '' : 'text-carbon/40'}`}>
      {renombrar?.id === c.id ? (
        <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); guardar.mutate({ id: c.id, nombre: renombrar.nombre, padreId: c.padreId }); }}>
          <input className="entrada py-1" value={renombrar.nombre} onChange={(e) => setRenombrar({ ...renombrar, nombre: e.target.value })} autoFocus />
          <button className="btn-primario btn-chico">Guardar</button>
        </form>
      ) : <span>{c.nombre}{!c.activo && ' (inactiva)'}</span>}
      <span className="flex shrink-0 gap-1">
        {!sub && c.activo && <button className="btn-secundario btn-chico" onClick={() => setNueva({ nombre: '', padreId: c.id })}>+ Sub</button>}
        <button className="btn-secundario btn-chico" onClick={() => setRenombrar(c)}>Renombrar</button>
        <button className="btn-secundario btn-chico" onClick={() => guardar.mutate({ id: c.id, nombre: c.nombre, padreId: c.padreId, activo: !c.activo })}>{c.activo ? 'Desactivar' : 'Activar'}</button>
      </span>
    </div>
  );
  return (
    <Modal titulo="Categorías de gastos" onCerrar={onCerrar} ancho="max-w-2xl">
      <div className="divide-y divide-arena/50">
        {principales.map((c) => <div key={c.id} className="py-1">{fila(c)}{cats.filter((s) => s.padreId === c.id).map((s) => fila(s, true))}
          {nueva?.padreId === c.id && (
            <form className="flex gap-2 py-1.5 pl-6" onSubmit={(e) => { e.preventDefault(); guardar.mutate(nueva); }}>
              <input className="entrada py-1" placeholder={`Nueva subcategoría de ${c.nombre}`} value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} autoFocus />
              <button className="btn-primario btn-chico" disabled={!nueva.nombre.trim()}>Agregar</button>
            </form>
          )}
        </div>)}
      </div>
      <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (nueva?.padreId === null && nueva.nombre.trim()) guardar.mutate(nueva); }}>
        <input className="entrada" placeholder="Nueva categoría" value={nueva?.padreId === null ? nueva.nombre : ''} onChange={(e) => setNueva({ nombre: e.target.value, padreId: null })} />
        <button className="btn-primario" disabled={!(nueva?.padreId === null && nueva.nombre.trim())}>Agregar</button>
      </form>
      <p className="mt-3 text-xs text-carbon/55">Las categorías no se borran (los gastos viejos las siguen usando): se desactivan y dejan de aparecer al cargar.</p>
    </Modal>
  );
}
