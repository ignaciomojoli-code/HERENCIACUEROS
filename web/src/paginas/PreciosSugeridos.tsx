import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useSesion } from '../sesion';
import type { Aux } from '../tipos';
import { Aviso, Campo, Confirmar, Encabezado, Vacio, avisar, avisarError } from '../componentes/ui';
import { Importe } from '../componentes/Importe';
import { pct, pesos } from '../formato';

interface Analisis { precioCentavos: number; gananciaNetaCentavos: number; margenNetoBp: number | null; markupBp: number | null }
interface Fila {
  varianteId: number; sku: string; modelo: string; talle: string | null; costo: number | null; actual: number | null; porcentajesSobrePrecioBp: number;
  sugeridoCentavos: number | null; sugeridoAnalisis: Analisis | null; actualAnalisis: Analisis | null; debajoObjetivo: boolean;
}
/** Colores del mismo talle con igual costo y precio van en una sola fila. */
function agrupar(fs: Fila[]) {
  const g = new Map<string, Fila & { ids: number[] }>();
  for (const f of fs) {
    const k = [f.modelo, f.talle ?? f.sku, f.costo, f.actual].join('|');
    const x = g.get(k);
    if (x) x.ids.push(f.varianteId); else g.set(k, { ...f, ids: [f.varianteId] });
  }
  return [...g.values()];
}
const REDONDEOS = [0, 100, 1000, 10000, 50000, 100000, 500000];

export function PaginaPreciosSugeridos() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const aux = useQuery({ queryKey: ['aux'], queryFn: () => api.get<Aux>('/catalogo/aux') });
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get<Record<string, any>>('/config') }); // eslint-disable-line @typescript-eslint/no-explicit-any
  const cp = config.data?.precios;
  const [d, setD] = useState({ listaId: 0, categoriaId: 0, metodo: '' as '' | 'margen' | 'markup', valor: '', redondeo: -1, soloDebajo: false });
  const [vista, setVista] = useState<{ filas: Fila[]; listaId: number } | null>(null);
  const [elegidos, setElegidos] = useState<Record<number, number>>({});
  const [confirmar, setConfirmar] = useState(false);
  const [motivo, setMotivo] = useState('');
  const listas = aux.data?.listasPrecio.filter((l) => l.activo) ?? [];
  const listaId = d.listaId || listas[0]?.id;
  const metodo = d.metodo || (cp?.metodoPorDefecto === 'markup' ? 'markup' : 'margen');
  const valorTexto = d.valor || (cp ? String(((metodo === 'markup' ? cp.markupObjetivoBp : cp.margenObjetivoBp) ?? 0) / 100) : '');
  const redondeo = d.redondeo >= 0 ? d.redondeo : (cp?.redondeoCentavos ?? 0);
  const calcular = useMutation({
    mutationFn: () => {
      const valorBp = Math.round(Number(valorTexto.replace(',', '.')) * 100);
      if (!Number.isFinite(valorBp) || valorBp <= 0) throw new Error(`Indicá el ${metodo} buscado`);
      if (metodo === 'margen' && valorBp >= 10000) throw new Error('El margen tiene que ser menor a 100%');
      return api.post<Fila[]>('/precios-sugeridos', { listaId, metodo, valorBp, categoriaId: d.categoriaId || undefined, redondeoCentavos: redondeo, soloConCosto: true });
    },
    onSuccess: (filas) => { setVista({ filas, listaId: listaId! }); setElegidos({}); }, onError: avisarError,
  });
  const aplicar = useMutation({
    mutationFn: () => api.post<{ cambiados: number }>('/precios-sugeridos/aplicar', {
      listaId: vista!.listaId, motivo,
      cambios: Object.entries(elegidos).map(([id, precio]) => ({ varianteId: Number(id), precioCentavos: precio, actualPrevisto: vista!.filas.find((f) => f.varianteId === Number(id))!.actual })),
    }),
    onSuccess: (r) => { avisar(`${r.cambiados} precios publicados`); setConfirmar(false); setMotivo(''); setVista(null); setElegidos({}); ['modelos', 'modelo', 'ventas-precios'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
    onError: avisarError,
  });
  const filas = agrupar((vista?.filas ?? []).filter((f) => !d.soloDebajo || f.debajoObjetivo));
  const lista = listas.find((l) => l.id === vista?.listaId);
  const aprueba = puede('precios', 'aprobar');
  const nElegidos = Object.keys(elegidos).length;
  return (
    <>
      <Encabezado titulo="Precios sugeridos" sub={<>Qué precio deja la ganancia buscada con el costo actual de cada prenda. No cambia nada hasta que elegís y publicás. <Link className="underline" to="/precios">Cambio masivo de precios</Link></>} />
      <div className="tarjeta mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Campo etiqueta="Lista de precios"><select className="entrada" value={listaId ?? ''} onChange={(e) => setD({ ...d, listaId: Number(e.target.value) })}>{listas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Categoría"><select className="entrada" value={d.categoriaId} onChange={(e) => setD({ ...d, categoriaId: Number(e.target.value) })}><option value={0}>Todas</option>{aux.data?.categorias.filter((c) => !c.padreId).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Calcular por" ayuda={metodo === 'margen' ? 'Margen: qué parte del precio es ganancia.' : 'Markup: cuánto se suma sobre el costo.'}>
          <select className="entrada" value={metodo} onChange={(e) => setD({ ...d, metodo: e.target.value as 'margen', valor: '' })}><option value="margen">Margen</option><option value="markup">Markup</option></select>
        </Campo>
        <Campo etiqueta={metodo === 'margen' ? 'Margen buscado (%)' : 'Markup (%)'}><input className="entrada text-right" inputMode="decimal" value={valorTexto} onChange={(e) => setD({ ...d, valor: e.target.value })} /></Campo>
        <Campo etiqueta="Redondear a"><select className="entrada" value={redondeo} onChange={(e) => setD({ ...d, redondeo: Number(e.target.value) })}>{REDONDEOS.map((r) => <option key={r} value={r}>{r ? pesos(r) : 'Sin redondeo'}</option>)}</select></Campo>
        <div className="flex items-end sm:col-span-2 lg:col-span-5"><button className="btn-primario" onClick={() => calcular.mutate()} disabled={calcular.isPending || !listaId}>Calcular</button></div>
      </div>
      {vista && (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.soloDebajo} onChange={(e) => setD({ ...d, soloDebajo: e.target.checked })} />Solo los que hoy dejan menos de lo buscado ({vista.filas.filter((f) => f.debajoObjetivo).length})</label>
            {aprueba && <button className="btn-primario btn-chico" disabled={!nElegidos} onClick={() => setConfirmar(true)}>Publicar {nElegidos} precios</button>}
          </div>
          {!aprueba && <Aviso tono="info">Podés ver los precios sugeridos. Publicarlos lo hace alguien con permiso para aprobar precios.</Aviso>}
          {!filas.length ? <Vacio>No hay prendas con costo cargado {d.soloDebajo ? 'debajo del objetivo' : 'para este filtro'}.</Vacio> : (
            <div className="tarjeta overflow-x-auto">
              <table className="tabla text-sm">
                <thead><tr>{aprueba && <th />}<th>Prenda</th><th className="num">Costo</th><th className="num">Precio hoy</th><th className="num">Margen hoy</th><th className="num">Sugerido</th><th className="num">Margen</th></tr></thead>
                <tbody>{filas.map((f) => {
                  const elegido = elegidos[f.varianteId];
                  const fijar = (v: number | null) => { const n = { ...elegidos }; f.ids.forEach((id) => (v === null ? delete n[id] : (n[id] = v))); setElegidos(n); };
                  return (
                    <tr key={f.ids.join('-')}>
                      {aprueba && <td><input type="checkbox" aria-label={`Elegir ${f.sku}`} checked={elegido !== undefined} disabled={f.sugeridoCentavos === null || f.sugeridoCentavos === f.actual}
                        onChange={(e) => fijar(e.target.checked ? f.sugeridoCentavos! : null)} /></td>}
                      <td><div className="font-medium">{f.modelo}{f.talle ? ` · talle ${f.talle}` : ''}</div><div className="text-xs text-carbon/50">{f.ids.length > 1 ? `${f.ids.length} colores` : <span className="font-mono">{f.sku}</span>}</div></td>
                      <td className="num">{pesos(f.costo)}</td>
                      <td className="num">{f.actual === null ? '—' : pesos(f.actual)}</td>
                      <td className={`num ${f.debajoObjetivo ? 'font-semibold text-bordo' : ''}`}>{f.actualAnalisis ? pct(f.actualAnalisis.margenNetoBp) : '—'}</td>
                      <td className="num">{elegido !== undefined ? <Importe className="ml-auto w-32" valor={elegido} onCambio={(v) => v && fijar(v)} /> : <b>{pesos(f.sugeridoCentavos)}</b>}</td>
                      <td className="num">{f.sugeridoAnalisis ? pct(f.sugeridoAnalisis.margenNetoBp) : '—'}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-carbon/55">El margen descuenta los costos que son % del precio (configurados en Recetas y costeo, "Otros costos"). El costo incluye envío y otros costos cargados en cada prenda.</p>
        </>
      )}
      {confirmar && (
        <Confirmar titulo="Publicar precios" textoBoton="Publicar" ocupado={aplicar.isPending} onCerrar={() => setConfirmar(false)} onConfirmar={() => aplicar.mutate()}>
          <p className="mb-3 text-sm">Se cambian {nElegidos} precios de la lista {lista?.nombre}. Queda registrado quién y por qué.</p>
          <Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus placeholder="Ej: actualización por aumento del cuero" /></Campo>
        </Confirmar>
      )}
    </>
  );
}
