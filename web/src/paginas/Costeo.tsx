import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Plus, Settings2, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useSesion } from '../sesion';
import type { Aux, ModeloResumen } from '../tipos';
import { Aviso, Campo, Cargando, Confirmar, Encabezado, ErrorCarga, Modal, Pendiente, Vacio, avisar, avisarError } from '../componentes/ui';
import { Importe } from '../componentes/Importe';
import { pct, pesos } from '../formato';
import { TIPOS_COMPONENTE, cant, leerCant, useMateriales, type Componente, type FilaCosteo, type LineaReceta, type ModeloCosteo } from '../costos';

/** Las variantes de un mismo talle (colores) suelen costar lo mismo: se muestran juntas. */
function agrupar(vs: FilaCosteo[]) {
  const grupos = new Map<string, { v: FilaCosteo; ids: number[]; skus: string }>();
  for (const v of vs) {
    const k = [v.talle ?? v.sku, v.totalCalculadoCentavos, v.totalActualCentavos, v.cambia, v.pendientes.join()].join('|');
    const g = grupos.get(k);
    if (g) { g.ids.push(v.varianteId); g.skus += ' ' + v.sku; } else grupos.set(k, { v, ids: [v.varianteId], skus: v.sku });
  }
  return [...grupos.values()];
}

interface VarianteModelo { id: number; sku: string; talle: string | null; activo: boolean }

export function PaginaCosteo() {
  const { puede } = useSesion();
  const [params, setParams] = useSearchParams();
  const modeloId = Number(params.get('modelo')) || null;
  const elegir = (id: number | null) => { const p = new URLSearchParams(params); if (id) p.set('modelo', String(id)); else p.delete('modelo'); setParams(p, { replace: true }); };
  const todos = useQuery({ queryKey: ['costeo', 'todos'], queryFn: () => api.get<ModeloCosteo[]>('/costeo') });
  const modelos = useQuery({ queryKey: ['modelos', 'activos'], queryFn: () => api.get<ModeloResumen[]>('/catalogo/modelos'), enabled: puede('catalogo') });
  const [componentes, setComponentes] = useState(false);
  useEffect(() => { if (!modeloId && todos.data?.length) elegir(todos.data[0].modeloId); }, [todos.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (todos.isLoading) return <Cargando />;
  if (todos.isError) return <ErrorCarga error={todos.error} />;
  const conReceta = new Set(todos.data!.map((m) => m.modeloId));
  const sinReceta = (modelos.data ?? []).filter((m) => !conReceta.has(m.id));
  const porActualizar = todos.data!.reduce((s, m) => s + m.variantes.filter((v) => v.cambia && !v.pendientes.length).length, 0);
  return (
    <>
      <Encabezado titulo="Recetas y costeo" sub="Qué lleva cada modelo y cuánto cuesta hacerlo. El costo de las prendas solo cambia cuando lo aplicás.">
        <button className="btn-secundario" onClick={() => setComponentes(true)}><Settings2 className="h-4 w-4" />Otros costos</button>
      </Encabezado>
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="min-w-0">
          <select className="entrada mb-2 lg:hidden" value={modeloId ?? ''} onChange={(e) => elegir(Number(e.target.value) || null)}>
            <option value="">Elegí un modelo</option>
            <optgroup label="Con receta">{todos.data!.map((m) => <option key={m.modeloId} value={m.modeloId}>{m.modelo}</option>)}</optgroup>
            {sinReceta.length > 0 && <optgroup label="Sin receta">{sinReceta.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</optgroup>}
          </select>
          <div className="tarjeta hidden max-h-[70vh] overflow-auto p-2 lg:block">
            {porActualizar > 0 && <p className="mb-2 rounded bg-dorado/20 p-2 text-xs">{porActualizar} prendas tienen un costo distinto al calculado.</p>}
            <div className="etiqueta px-2 pt-1">Con receta ({todos.data!.length})</div>
            {todos.data!.map((m) => {
              const n = m.variantes.filter((v) => v.cambia).length;
              return (
                <button key={m.modeloId} onClick={() => elegir(m.modeloId)} className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm ${m.modeloId === modeloId ? 'bg-conac text-crema' : 'hover:bg-arena/30'}`}>
                  <span className="truncate">{m.modelo}</span>{n > 0 && <span className="ml-2 h-2 w-2 shrink-0 rounded-full bg-dorado" title="El costo cargado no coincide con la receta" />}
                </button>
              );
            })}
            {sinReceta.length > 0 && <>
              <div className="etiqueta mt-3 px-2">Sin receta ({sinReceta.length})</div>
              {sinReceta.map((m) => <button key={m.id} onClick={() => elegir(m.id)} className={`block w-full truncate rounded px-2 py-1 text-left text-sm text-carbon/60 ${m.id === modeloId ? 'bg-conac text-crema' : 'hover:bg-arena/30'}`}>{m.nombre}</button>)}
            </>}
          </div>
        </div>
        <div className="min-w-0">{modeloId ? <DetalleModelo key={modeloId} modeloId={modeloId} /> : <Vacio>Elegí un modelo para ver su receta y su costo.</Vacio>}</div>
      </div>
      {componentes && <Componentes onCerrar={() => setComponentes(false)} />}
    </>
  );
}

function DetalleModelo({ modeloId }: { modeloId: number }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const costeo = useQuery({ queryKey: ['costeo', modeloId], queryFn: () => api.get<ModeloCosteo[]>(`/costeo?modeloIds=${modeloId}`) });
  const receta = useQuery({ queryKey: ['receta', modeloId], queryFn: () => api.get<LineaReceta[]>(`/recetas/${modeloId}`) });
  const modelo = useQuery({ queryKey: ['modelo', modeloId], queryFn: () => api.get<{ nombre: string; variantes: VarianteModelo[] }>(`/catalogo/modelos/${modeloId}`) });
  const [editando, setEditando] = useState(false);
  const [elegidas, setElegidas] = useState<Set<number>>(new Set());
  const [aplicar, setAplicar] = useState(false);
  const [motivo, setMotivo] = useState('');
  const c = costeo.data?.[0];
  useEffect(() => { if (c) setElegidas(new Set(c.variantes.filter((v) => v.cambia && !v.pendientes.length).map((v) => v.varianteId))); }, [c]);
  const ap = useMutation({
    mutationFn: () => api.post<{ cambiadas: number }>('/costeo/aplicar', { varianteIds: [...elegidas], motivo, previstos: Object.fromEntries(c!.variantes.filter((v) => elegidas.has(v.varianteId)).map((v) => [v.varianteId, v.totalCalculadoCentavos])) }),
    onSuccess: (r) => { avisar(`Costo actualizado en ${r.cambiadas} prendas`); setAplicar(false); setMotivo(''); ['costeo', 'modelo', 'modelos'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); }, onError: avisarError,
  });
  if (costeo.isLoading || receta.isLoading) return <Cargando />;
  if (costeo.isError) return <ErrorCarga error={costeo.error} />;
  const lineas = receta.data ?? [];
  const pendientes = [...new Set(c?.variantes.flatMap((v) => v.pendientes) ?? [])];
  const talles = [...new Set((modelo.data?.variantes ?? []).filter((v) => v.activo && v.talle).map((v) => v.talle!))];
  return (
    <div className="space-y-4">
      <div className="tarjeta p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{modelo.data?.nombre ?? c?.modelo}</h2>
          {puede('materiales', 'modificar') && !editando && <button className="btn-secundario btn-chico" onClick={() => setEditando(true)}>{lineas.length ? 'Editar receta' : 'Armar receta'}</button>}
        </div>
        {editando ? <EditorReceta modeloId={modeloId} inicial={lineas} talles={talles} onListo={() => setEditando(false)} /> : !lineas.length ? (
          <p className="text-sm text-carbon/55">Este modelo todavía no tiene receta.</p>
        ) : (
          <div className="overflow-x-auto"><table className="tabla text-sm">
            <thead><tr><th>Material</th><th className="num">Cantidad</th><th>Talles</th><th className="num">Costo</th></tr></thead>
            <tbody>{lineas.map((l) => (
              <tr key={l.id}><td>{l.material}</td><td className="num">{cant(l.cantidadMil)} {l.unidad}</td><td>{l.talles ? `Solo ${l.talles.join(', ')} (agregado)` : 'Todos'}</td>
                <td className="num">{l.costoUnidadCentavos === undefined ? '—' : l.costoUnidadCentavos === null ? <Pendiente /> : pesos(Math.round((l.costoUnidadCentavos * l.cantidadMil) / 1000))}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      {c && c.variantes.length > 0 && lineas.length > 0 && !editando && (
        <div className="tarjeta p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold">Costo por prenda</h3>
            {puede('costos', 'modificar') && <button className="btn-primario btn-chico" disabled={!elegidas.size || pendientes.length > 0} onClick={() => setAplicar(true)}><Calculator className="h-3 w-3" />Aplicar a {elegidas.size} prendas</button>}
          </div>
          {pendientes.length > 0 && <Aviso tono="atencion">Falta el costo de: {pendientes.join(', ')}. Cargalo en Materiales para poder aplicar.</Aviso>}
          <div className="overflow-x-auto">
            <table className="tabla text-sm">
              <thead><tr><th /><th>Talle</th><th className="num">Materiales</th><th className="num">Mano de obra</th><th className="num">Otros</th><th className="num">Calculado</th><th className="num">Cargado hoy</th><th className="num">Diferencia</th></tr></thead>
              <tbody>{agrupar(c.variantes).map(({ v, ids }) => {
                const dif = v.totalActualCentavos === null ? null : v.totalCalculadoCentavos - v.totalActualCentavos;
                const todas = ids.every((id) => elegidas.has(id));
                return (
                  <tr key={ids.join('-')}>
                    <td><input type="checkbox" aria-label={`Elegir talle ${v.talle ?? v.sku}`} checked={todas} disabled={!v.cambia || !!v.pendientes.length} onChange={(e) => { const s = new Set(elegidas); ids.forEach((id) => (e.target.checked ? s.add(id) : s.delete(id))); setElegidas(s); }} /></td>
                    <td><span className="font-medium">{v.talle ? `Talle ${v.talle}` : v.sku}</span>{ids.length > 1 && <div className="text-xs text-carbon/55">{ids.length} colores</div>}
                      {v.agregados.length > 0 && <div className="text-xs text-carbon/55">con agregado</div>}</td>
                    <td className="num">{pesos(v.materialesCentavos)}</td><td className="num">{pesos(v.manoObraCentavos)}</td>
                    <td className="num" title={v.componentes.map((x) => `${x.nombre}: ${pesos(x.centavos)}`).join('\n')}>{pesos(v.adicionalCentavos)}</td>
                    <td className="num font-semibold">{pesos(v.totalCalculadoCentavos)}</td>
                    <td className="num">{v.totalActualCentavos === null ? <Pendiente texto="Sin costo" /> : pesos(v.totalActualCentavos)}</td>
                    <td className={`num ${dif && dif > 0 ? 'text-bordo' : ''}`}>{dif === null ? '—' : dif === 0 ? '=' : `${dif > 0 ? '+' : ''}${pesos(dif)}`}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-carbon/55">"Otros" son los costos que se suman a todas las prendas (packaging, merma, etc.). Se configuran en "Otros costos". El costo de envío cargado en cada prenda se mantiene.</p>
        </div>
      )}
      {aplicar && (
        <Confirmar titulo="Aplicar costos" textoBoton="Aplicar" ocupado={ap.isPending} onCerrar={() => setAplicar(false)} onConfirmar={() => ap.mutate()}>
          <p className="mb-3 text-sm">Se actualiza el costo de {elegidas.size} prendas. Queda en el historial de cada una. Los precios no cambian.</p>
          <Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: aumento del cuero" autoFocus /></Campo>
        </Confirmar>
      )}
    </div>
  );
}

function EditorReceta({ modeloId, inicial, talles, onListo }: { modeloId: number; inicial: LineaReceta[]; talles: string[]; onListo: () => void }) {
  const qc = useQueryClient();
  const mats = useMateriales();
  const [filas, setFilas] = useState(() => inicial.map((l) => ({ materialId: l.materialId as number | null, cantidad: cant(l.cantidadMil), talles: l.talles ?? [] })));
  const g = useMutation({
    mutationFn: () => {
      const lineas = filas.filter((f) => f.materialId).map((f) => {
        const n = leerCant(f.cantidad);
        if (!(n > 0)) throw new Error('Revisá las cantidades: tienen que ser mayores a cero');
        return { materialId: f.materialId!, cantidadMil: n, talles: f.talles.length ? f.talles : null };
      });
      return api.put(`/recetas/${modeloId}`, { lineas });
    },
    onSuccess: () => { avisar('Receta guardada'); ['receta', 'costeo', 'materiales'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); onListo(); }, onError: avisarError,
  });
  const activos = (mats.data ?? []).filter((m) => m.activo);
  const fijar = (i: number, cambio: Partial<(typeof filas)[number]>) => setFilas(filas.map((f, j) => (j === i ? { ...f, ...cambio } : f)));
  return (
    <form onSubmit={(e) => { e.preventDefault(); g.mutate(); }} className="space-y-3">
      {filas.map((f, i) => {
        const m = activos.find((x) => x.id === f.materialId);
        return (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_6rem_auto] items-start gap-2 rounded border border-arena/50 p-2 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,12rem)_auto]">
            <select className="entrada" value={f.materialId ?? ''} onChange={(e) => fijar(i, { materialId: Number(e.target.value) || null })} aria-label="Material">
              <option value="">Elegí material</option>{activos.map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nombre}</option>)}
            </select>
            <div className="relative"><input className="entrada pr-9 text-right" inputMode="decimal" value={f.cantidad} onChange={(e) => fijar(i, { cantidad: e.target.value })} aria-label="Cantidad" /><span className="pointer-events-none absolute right-2 top-2 text-xs text-carbon/45">{m?.unidad}</span></div>
            <div className="col-span-2 flex flex-wrap items-center gap-1 sm:col-span-1">
              <span className="text-xs text-carbon/55">Talles:</span>
              {talles.length ? talles.map((t) => (
                <label key={t} className={`cursor-pointer rounded border px-1.5 py-0.5 text-xs ${f.talles.includes(t) ? 'border-conac bg-conac text-crema' : 'border-arena'}`}>
                  <input type="checkbox" className="sr-only" checked={f.talles.includes(t)} onChange={(e) => fijar(i, { talles: e.target.checked ? [...f.talles, t] : f.talles.filter((x) => x !== t) })} />{t}
                </label>
              )) : <span className="text-xs text-carbon/45">el modelo no tiene talles</span>}
              {!f.talles.length && talles.length > 0 && <span className="text-xs text-carbon/45">(todos)</span>}
            </div>
            <button type="button" className="btn-secundario btn-chico row-start-1 self-center sm:row-auto" onClick={() => setFilas(filas.filter((_, j) => j !== i))} aria-label="Quitar"><Trash2 className="h-3 w-3" /></button>
          </div>
        );
      })}
      <button type="button" className="btn-secundario btn-chico" onClick={() => setFilas([...filas, { materialId: null, cantidad: '', talles: [] }])}><Plus className="h-3 w-3" />Agregar material</button>
      <p className="text-xs text-carbon/55">Para el cuero extra de los talles grandes, agregá otra línea de cuero con la cantidad extra y marcá solo esos talles.</p>
      <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={onListo}>Cancelar</button><button className="btn-primario" disabled={g.isPending}>Guardar receta</button></div>
    </form>
  );
}

function Componentes({ onCerrar }: { onCerrar: () => void }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const actual = useQuery({ queryKey: ['componentes-costo'], queryFn: () => api.get<Componente[]>('/costeo/componentes') });
  const aux = useQuery({ queryKey: ['aux'], queryFn: () => api.get<Aux>('/catalogo/aux') });
  const [lista, setLista] = useState<Componente[] | null>(null);
  useEffect(() => { if (actual.data && !lista) setLista(actual.data); }, [actual.data, lista]);
  const edita = puede('costos', 'aprobar');
  const g = useMutation({
    mutationFn: () => api.put('/costeo/componentes', { componentes: lista }),
    onSuccess: () => { avisar('Guardado. Revisá el costeo para aplicarlo a las prendas.'); ['componentes-costo', 'costeo', 'precios-sugeridos'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); onCerrar(); }, onError: avisarError,
  });
  const cats = useMemo(() => (aux.data?.categorias ?? []).filter((c) => !c.padreId), [aux.data]);
  const fijar = (i: number, c: Partial<Componente>) => setLista(lista!.map((x, j) => (j === i ? { ...x, ...c } : x)));
  return (
    <Modal titulo="Otros costos" onCerrar={onCerrar} ancho="max-w-2xl">
      {!lista ? <Cargando /> : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); g.mutate(); }}>
          <p className="text-sm text-carbon/70">Costos que no están en la receta: packaging, etiquetas, merma, impuestos sobre la venta. Los "% sobre el precio" no suman al costo: se usan para calcular el precio sugerido.</p>
          {!lista.length && <p className="text-sm text-carbon/50">No hay ninguno cargado.</p>}
          {lista.map((c, i) => (
            <div key={c.id} className="grid gap-2 rounded border border-arena/50 p-2 sm:grid-cols-[minmax(0,1fr)_12rem_8rem]">
              <input className="entrada" value={c.nombre} onChange={(e) => fijar(i, { nombre: e.target.value })} placeholder="Nombre" disabled={!edita} required />
              <select className="entrada" value={c.tipo} onChange={(e) => fijar(i, { tipo: e.target.value as Componente['tipo'], valor: 0 })} disabled={!edita}>{Object.entries(TIPOS_COMPONENTE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              {c.tipo === 'fijo' ? <Importe valor={c.valor} onCambio={(v) => fijar(i, { valor: v ?? 0 })} disabled={!edita} /> : (
                <div className="relative"><input className="entrada pr-6 text-right" inputMode="decimal" defaultValue={(c.valor / 100).toString().replace('.', ',')} disabled={!edita} onChange={(e) => { const n = Number(e.target.value.replace(',', '.')); if (!Number.isNaN(n)) fijar(i, { valor: Math.round(n * 100) }); }} /><span className="absolute right-2 top-2 text-sm text-carbon/45">%</span></div>
              )}
              <select className="entrada sm:col-span-2" value={c.categoriaId ?? ''} onChange={(e) => fijar(i, { categoriaId: Number(e.target.value) || null })} disabled={!edita}><option value="">Para todas las categorías</option>{cats.map((x) => <option key={x.id} value={x.id}>Solo {x.nombre}</option>)}</select>
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={c.activo} onChange={(e) => fijar(i, { activo: e.target.checked })} disabled={!edita} />Activo</label>
                {edita && <button type="button" className="btn-secundario btn-chico" onClick={() => setLista(lista.filter((_, j) => j !== i))} aria-label="Quitar"><Trash2 className="h-3 w-3" /></button>}
              </div>
            </div>
          ))}
          {lista.some((c) => c.tipo !== 'fijo') && <p className="text-xs text-carbon/55">Ejemplo: {lista.filter((c) => c.tipo !== 'fijo').map((c) => `${c.nombre} ${pct(c.valor)}`).join(', ')}.</p>}
          {edita && <button type="button" className="btn-secundario btn-chico" onClick={() => setLista([...lista, { id: `c${Date.now()}`, nombre: '', tipo: 'fijo', valor: 0, categoriaId: null, activo: true }])}><Plus className="h-3 w-3" />Agregar</button>}
          <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={onCerrar}>Cerrar</button>{edita && <button className="btn-primario" disabled={g.isPending}>Guardar</button>}</div>
        </form>
      )}
    </Modal>
  );
}
