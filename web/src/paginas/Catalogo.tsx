import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Plus, Search } from 'lucide-react';
import { api, qs } from '../api';
import { useSesion } from '../sesion';
import type { Aux, ModeloResumen } from '../tipos';
import { Cargando, Demo, Encabezado, ErrorCarga, Estado, Modal, Pendiente, Vacio } from '../componentes/ui';
import { aproxUsd, pesos } from '../formato';

const rango = (a?: number | null, b?: number | null) => (a == null ? null : a === b ? pesos(a) : `${pesos(a)} – ${pesos(b)}`);

export function PaginaCatalogo() {
  const { puede, cotizUsd } = useSesion();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const estado = params.get('estado') ?? 'activos';
  const categoriaId = params.get('categoria') ?? '';
  const soloSinCosto = params.get('sinCosto') === '1';
  const [exportar, setExportar] = useState(false);
  const fijar = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };

  const aux = useQuery({ queryKey: ['aux'], queryFn: () => api.get<Aux>('/catalogo/aux') });
  const modelos = useQuery({ queryKey: ['modelos', q, estado, categoriaId], queryFn: () => api.get<ModeloResumen[]>('/catalogo/modelos' + qs({ q, estado, categoriaId })) });
  const listas = (aux.data?.listasPrecio ?? []).filter((l) => l.activo);
  const verCostos = puede('costos');
  const filas = useMemo(() => (modelos.data ?? []).filter((m) => !soloSinCosto || (m.sinCosto ?? 0) > 0), [modelos.data, soloSinCosto]);
  const categorias = (aux.data?.categorias ?? []).filter((c) => !c.padreId);

  return (
    <>
      <Encabezado titulo="Catálogo" sub={modelos.data ? `${filas.length} productos` : undefined}>
        {puede('catalogo', 'exportar') && <button className="btn-secundario" onClick={() => setExportar(true)}><Download className="h-4 w-4" />Exportar</button>}
        {puede('catalogo', 'crear') && <Link className="btn-primario" to="/catalogo/nuevo"><Plus className="h-4 w-4" />Nuevo producto</Link>}
      </Encabezado>

      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-carbon/40" />
          <input className="entrada pl-9" placeholder="Buscar por nombre o código…" value={q} onChange={(e) => fijar('q', e.target.value)} />
        </div>
        <select className="entrada" value={categoriaId} onChange={(e) => fijar('categoria', e.target.value)}>
          <option value="">Todas las categorías</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select className="entrada" value={estado} onChange={(e) => fijar('estado', e.target.value === 'activos' ? '' : e.target.value)}>
          <option value="activos">Activos</option><option value="inactivos">Inactivos</option><option value="todos">Todos</option>
        </select>
        {verCostos && (
          <label className="flex items-center gap-2 whitespace-nowrap px-1 text-sm">
            <input type="checkbox" checked={soloSinCosto} onChange={(e) => fijar('sinCosto', e.target.checked ? '1' : '')} />Sin costo
          </label>
        )}
      </div>

      {modelos.isLoading ? <Cargando /> : modelos.isError ? <ErrorCarga error={modelos.error} /> : !filas.length ? (
        <Vacio>{q || categoriaId || soloSinCosto ? 'No hay productos con ese filtro.' : <>Todavía no hay productos. {puede('importacion', 'crear') && <Link className="underline" to="/importar">Importá tu planilla</Link>}</>}</Vacio>
      ) : (<>
        <div className="space-y-2 sm:hidden">
          {filas.map((m) => (
            <Link key={m.id} to={`/catalogo/${m.id}`} className="tarjeta block p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{m.nombre} {m.esDemo && <Demo />}</span>
                <span className="text-xs text-carbon/50">{m.variantes} var.</span>
              </div>
              <div className="text-xs text-carbon/50">{[m.categoria, m.genero, m.proveedor].filter(Boolean).join(' · ')}{!m.activo && ' · Inactivo'}</div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {listas.map((l) => { const p = m.precios.find((x) => x.listaId === l.id); return p ? <span key={l.id}><span className="text-xs text-carbon/50">{l.nombre}: </span><b className="font-titulo">{rango(p.min, p.max)}</b></span> : null; })}
                {verCostos && (m.sinCosto ? <Pendiente texto="Sin costo" /> : null)}
              </div>
            </Link>
          ))}
        </div>
        <div className="tarjeta hidden overflow-x-auto sm:block">
          <table className="tabla">
            <thead>
              <tr>
                <th>Producto</th><th className="hidden md:table-cell">Categoría</th><th className="num">Var.</th>
                {verCostos && <th className="num hidden sm:table-cell">Costo</th>}
                {listas.map((l) => <th key={l.id} className="num">{l.nombre}</th>)}
                <th className="hidden md:table-cell">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((m) => (
                <tr key={m.id} className="cursor-pointer" onClick={() => nav(`/catalogo/${m.id}`)}>
                  <td>
                    <div className="font-medium">{m.nombre} {m.esDemo && <Demo />}</div>
                    <div className="text-xs text-carbon/50">{[m.genero, m.proveedor].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="hidden md:table-cell">{m.categoria}</td>
                  <td className="num">{m.variantes}</td>
                  {verCostos && <td className="num hidden sm:table-cell">{m.sinCosto ? <Pendiente texto={m.sinCosto === m.variantes ? 'Sin costo' : `${m.sinCosto} sin costo`} /> : rango(m.costoMin, m.costoMax)}</td>}
                  {listas.map((l) => {
                    const p = m.precios.find((x) => x.listaId === l.id);
                    const usd = p && p.min === p.max ? aproxUsd(p.min, cotizUsd) : null;
                    return <td key={l.id} className="num">{p ? <><span className="font-titulo font-bold">{rango(p.min, p.max)}</span>{usd && <div className="text-[11px] text-carbon/45">{usd}</div>}</> : <span className="text-carbon/30">—</span>}</td>;
                  })}
                  <td className="hidden md:table-cell"><Estado activo={m.activo} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}
      {exportar && <ModalExportar categoriaId={categoriaId} onCerrar={() => setExportar(false)} />}
    </>
  );
}

function ModalExportar({ categoriaId, onCerrar }: { categoriaId: string; onCerrar: () => void }) {
  const cols = useQuery({ queryKey: ['exportar-columnas'], queryFn: () => api.get<{ clave: string; titulo: string }[]>('/catalogo/exportar/columnas') });
  const [elegidas, setElegidas] = useState<string[] | null>(null);
  const [formato, setFormato] = useState<'xlsx' | 'csv'>('xlsx');
  const [inactivos, setInactivos] = useState(false);
  const sel = elegidas ?? cols.data?.map((c) => c.clave) ?? [];
  const url = '/api/catalogo/exportar' + qs({ formato, columnas: sel.join(','), inactivos: inactivos ? 'true' : '', categoriaId });
  return (
    <Modal titulo="Exportar catálogo" onCerrar={onCerrar}>
      {cols.isLoading ? <Cargando /> : (
        <div className="space-y-4 text-sm">
          <div>
            <div className="etiqueta mb-2">Columnas</div>
            <div className="grid grid-cols-2 gap-1">
              {cols.data?.map((c) => (
                <label key={c.clave} className="flex items-center gap-2">
                  <input type="checkbox" checked={sel.includes(c.clave)} onChange={(e) => setElegidas(e.target.checked ? [...sel, c.clave] : sel.filter((x) => x !== c.clave))} />{c.titulo}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2"><input type="radio" checked={formato === 'xlsx'} onChange={() => setFormato('xlsx')} />Excel (.xlsx)</label>
            <label className="flex items-center gap-2"><input type="radio" checked={formato === 'csv'} onChange={() => setFormato('csv')} />CSV</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={inactivos} onChange={(e) => setInactivos(e.target.checked)} />Incluir inactivos</label>
          </div>
          {categoriaId && <p className="text-xs text-carbon/50">Se exporta solo la categoría filtrada.</p>}
          <div className="flex justify-end gap-2">
            <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
            <a className={`btn-primario ${sel.length ? '' : 'pointer-events-none opacity-50'}`} href={url} onClick={() => setTimeout(onCerrar, 300)}><Download className="h-4 w-4" />Descargar</a>
          </div>
        </div>
      )}
    </Modal>
  );
}
