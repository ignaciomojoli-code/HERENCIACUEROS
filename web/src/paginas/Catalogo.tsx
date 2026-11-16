import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Search, Shapes } from 'lucide-react';
import { api, qs } from '../api';
import { useSesion } from '../sesion';
import { CLASIFICACIONES, CLASIFICACION_CORTA, type Aux, type Clasificacion, type ModeloResumen } from '../tipos';
import { Cargando, Demo, Encabezado, ErrorCarga, Estado, Modal, Pendiente, Vacio, avisar, avisarError } from '../componentes/ui';
import { Th, useOrden } from '../componentes/Orden';
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
  const clasificacion = params.get('tipo') ?? '';
  const [exportar, setExportar] = useState(false);
  const [clasificar, setClasificar] = useState(false);
  const fijar = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };

  const aux = useQuery({ queryKey: ['aux'], queryFn: () => api.get<Aux>('/catalogo/aux') });
  const modelos = useQuery({ queryKey: ['modelos', q, estado, categoriaId, clasificacion], queryFn: () => api.get<ModeloResumen[]>('/catalogo/modelos' + qs({ q, estado, categoriaId, clasificacion })) });
  const listas = (aux.data?.listasPrecio ?? []).filter((l) => l.activo);
  const verCostos = puede('costos');
  const filtradas = useMemo(() => (modelos.data ?? []).filter((m) => !soloSinCosto || (m.sinCosto ?? 0) > 0), [modelos.data, soloSinCosto]);
  const precioDe = (m: ModeloResumen, listaId: number) => m.precios.find((x) => x.listaId === listaId)?.min ?? null;
  const { filas, orden } = useOrden(filtradas, {
    nombre: (m) => m.nombre, categoria: (m) => m.categoria, tipo: (m) => (m.clasificacion ? CLASIFICACION_CORTA[m.clasificacion] : null), variantes: (m) => m.variantes,
    stock: (m) => m.stock ?? 0, costo: (m) => m.costoMin ?? null, estado: (m) => m.activo,
    ...Object.fromEntries(listas.map((l) => [`lista${l.id}`, (m: ModeloResumen) => precioDe(m, l.id)])),
  }, { col: 'nombre' });
  const categorias = (aux.data?.categorias ?? []).filter((c) => !c.padreId);

  return (
    <>
      <Encabezado titulo="Catálogo" sub={modelos.data ? `${filas.length} productos` : undefined}>
        {puede('catalogo', 'modificar') && <button className="btn-secundario" onClick={() => setClasificar(true)}><Shapes className="h-4 w-4" />Clasificar</button>}
        {puede('catalogo', 'exportar') && <button className="btn-secundario" onClick={() => setExportar(true)}><Download className="h-4 w-4" />Exportar</button>}
        {puede('catalogo', 'crear') && <Link className="btn-primario" to="/catalogo/nuevo"><Plus className="h-4 w-4" />Nuevo producto</Link>}
      </Encabezado>

      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-carbon/40" />
          <input className="entrada pl-9" placeholder="Buscar por nombre o código…" value={q} onChange={(e) => fijar('q', e.target.value)} />
        </div>
        <select className="entrada" value={categoriaId} onChange={(e) => fijar('categoria', e.target.value)}>
          <option value="">Todas las categorías</option>
          {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select className="entrada" value={clasificacion} onChange={(e) => fijar('tipo', e.target.value)} aria-label="Tipo de producto">
          <option value="">Todos los tipos</option>{Object.entries(CLASIFICACIONES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}<option value="pendiente">Sin clasificar</option>
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
        <Vacio>{q || categoriaId || soloSinCosto || clasificacion ? 'No hay productos con ese filtro.' : <>Todavía no hay productos. {puede('importacion', 'crear') && <Link className="underline" to="/importar">Importá tu planilla</Link>}</>}</Vacio>
      ) : (<>
        <div className="space-y-2 sm:hidden">
          {filas.map((m) => (
            <Link key={m.id} to={`/catalogo/${m.id}`} className="tarjeta block p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{m.nombre} {m.esDemo && <Demo />}</span>
                <span className="text-xs text-carbon/50">{m.variantes} var.{m.stock !== undefined && ` · stock ${m.stock}`}</span>
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
                <Th col="nombre" orden={orden}>Producto</Th><Th col="categoria" orden={orden} className="hidden md:table-cell">Categoría</Th><Th col="tipo" orden={orden} className="hidden lg:table-cell">Tipo</Th>
                <Th col="variantes" orden={orden} className="num">Var.</Th>{puede('stock') && <Th col="stock" orden={orden} className="num">Stock</Th>}
                {verCostos && <Th col="costo" orden={orden} className="num hidden sm:table-cell">Costo</Th>}
                {listas.map((l) => <Th key={l.id} col={`lista${l.id}`} orden={orden} className="num">{l.nombre}</Th>)}
                <Th col="estado" orden={orden} className="hidden md:table-cell">Estado</Th>
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
                  <td className="hidden lg:table-cell">{m.clasificacion ? CLASIFICACION_CORTA[m.clasificacion] : <Pendiente texto="Sin clasificar" />}</td>
                  <td className="num">{m.variantes}</td>
                  {puede('stock') && <td className={`num font-medium ${(m.stock ?? 0) <= 0 ? 'text-carbon/35' : ''}`}>{m.stock ?? 0}</td>}
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
      {clasificar && <ModalClasificar onCerrar={() => setClasificar(false)} />}
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

/** Clasifica los productos sin tipo. Propone un tipo según los datos (receta, pedidos, proveedor); nada se guarda hasta confirmar. */
function ModalClasificar({ onCerrar }: { onCerrar: () => void }) {
  const qc = useQueryClient();
  const pend = useQuery({ queryKey: ['modelos', 'sin-clasificar'], queryFn: () => api.get<ModeloResumen[]>('/catalogo/modelos' + qs({ estado: 'todos', clasificacion: 'pendiente' })) });
  const [elegido, setElegido] = useState<Record<number, Clasificacion | ''>>({});
  const valor = (m: ModeloResumen) => (m.id in elegido ? elegido[m.id] : m.sugerencia ?? '');
  const filas = pend.data ?? [];
  const aGuardar = filas.filter((m) => valor(m));
  const m = useMutation({
    mutationFn: async () => {
      const grupos = new Map<Clasificacion, number[]>();
      for (const f of aGuardar) { const c = valor(f) as Clasificacion; grupos.set(c, [...(grupos.get(c) ?? []), f.id]); }
      let n = 0;
      for (const [clasificacion, ids] of grupos) n += (await api.post<{ cambiados: number }>('/catalogo/modelos/clasificar', { ids, clasificacion })).cambiados;
      return n;
    },
    onSuccess: (n) => { avisar(`${n} productos clasificados`); qc.invalidateQueries({ queryKey: ['modelos'] }); onCerrar(); },
    onError: (e) => { avisarError(e); qc.invalidateQueries({ queryKey: ['modelos'] }); },
  });
  return (
    <Modal titulo="Clasificar productos" onCerrar={onCerrar} ancho="max-w-3xl">
      {pend.isLoading ? <Cargando /> : !filas.length ? <Vacio>Todos los productos tienen tipo. Para cambiar uno, editalo desde su ficha.</Vacio> : (
        <div className="space-y-4">
          <p className="text-sm text-carbon/70">Hay {filas.length} productos sin tipo. Te propongo uno según los datos: si tiene receta, fabricación propia; si no, según el último pedido o el proveedor. Revisá y corregí antes de guardar. Los que dejes en blanco quedan sin clasificar.</p>
          <div className="max-h-[55vh] overflow-y-auto rounded border border-arena">
            <table className="tabla">
              <thead><tr><th>Producto</th><th className="hidden sm:table-cell">Proveedor</th><th>Tipo</th></tr></thead>
              <tbody>{filas.map((f) => (
                <tr key={f.id}>
                  <td>{f.nombre}<div className="text-xs text-carbon/50">{f.categoria}</div></td>
                  <td className="hidden sm:table-cell">{f.proveedor ?? '—'}</td>
                  <td>
                    <select className="entrada py-1" value={valor(f)} onChange={(e) => setElegido({ ...elegido, [f.id]: e.target.value as Clasificacion | '' })}>
                      <option value="">Sin clasificar</option>{Object.entries(CLASIFICACIONES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                    </select>
                    {f.sugerencia && valor(f) === f.sugerencia && !(f.id in elegido) && <div className="text-[11px] text-carbon/45">Sugerido</div>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2"><button className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={!aGuardar.length || m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Guardando…' : `Guardar ${aGuardar.length}`}</button></div>
        </div>
      )}
    </Modal>
  );
}
