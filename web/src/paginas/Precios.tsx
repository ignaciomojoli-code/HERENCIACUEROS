import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useSesion } from '../sesion';
import type { Aux } from '../tipos';
import { Aviso, Campo, Cargando, Confirmar, Encabezado, avisar, avisarError } from '../componentes/ui';
import { Importe } from '../componentes/Importe';
import { pct, pesos } from '../formato';

type Fila = { varianteId: number; sku: string; modelo: string; costo?: number | null; actual: number | null; nuevo: number | null; bajoCosto?: boolean };
const REDONDEOS = [0, 100, 1000, 10000, 50000, 100000, 500000];

export function PaginaPrecios() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const aux = useQuery({ queryKey: ['aux'], queryFn: () => api.get<Aux>('/catalogo/aux') });
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get<Record<string, any>>('/config') });
  const [d, setD] = useState({ listaId: 0, categoriaId: 0, tipo: 'porcentaje' as 'porcentaje' | 'fijo' | 'desde_lista', porcentaje: '', fijo: null as number | null, listaBaseId: 0, redondeo: -1, motivo: '' });
  const [vista, setVista] = useState<{ filas: Fila[]; pedido: Record<string, unknown> } | null>(null);
  const [confirmar, setConfirmar] = useState(false);

  const listas = aux.data?.listasPrecio.filter((l) => l.activo) ?? [];
  const listaId = d.listaId || listas[0]?.id;
  const redondeo = d.redondeo >= 0 ? d.redondeo : (config.data?.precios?.redondeoCentavos ?? 0);
  const valorBp = Math.round(Number((d.porcentaje || '0').replace(',', '.')) * 100);
  const pedido = () => ({
    listaId, categoriaId: d.categoriaId || undefined, tipo: d.tipo,
    valor: d.tipo === 'fijo' ? d.fijo ?? 0 : valorBp,
    listaBaseId: d.tipo === 'desde_lista' ? d.listaBaseId || listas.find((l) => l.id !== listaId)?.id : undefined,
    redondeoCentavos: redondeo || undefined,
  });

  const previsualizar = useMutation({
    mutationFn: () => { const p = pedido(); return api.post<Fila[]>('/catalogo/precios/previsualizar', p).then((filas) => ({ filas, pedido: p })); },
    onSuccess: setVista, onError: avisarError,
  });
  const aplicar = useMutation({
    mutationFn: () => api.post<{ cambiados: number }>('/catalogo/precios/aplicar', {
      ...vista!.pedido, motivo: d.motivo, previstos: Object.fromEntries(vista!.filas.map((f) => [f.varianteId, f.nuevo])),
    }, true),
    onSuccess: (r) => { avisar(`Listo: ${r.cambiados} precios actualizados`); setConfirmar(false); setVista(null); qc.invalidateQueries({ queryKey: ['modelos'] }); qc.invalidateQueries({ queryKey: ['modelo'] }); },
    onError: (e) => { avisarError(e); setConfirmar(false); },
  });

  if (aux.isLoading) return <Cargando />;
  const cambian = vista?.filas.filter((f) => f.nuevo !== null && f.nuevo !== f.actual) ?? [];
  const sinPrecio = vista?.filas.filter((f) => f.nuevo === null).length ?? 0;
  const bajoCosto = vista?.filas.filter((f) => f.bajoCosto).length ?? 0;
  const nombreLista = listas.find((l) => l.id === listaId)?.nombre;
  const cambiarCampo = (n: Partial<typeof d>) => { setD({ ...d, ...n }); setVista(null); };

  return (
    <>
      <Encabezado titulo="Precios" sub="Cambios de precio masivos, con vista previa antes de aplicar. Para cambiar un precio puntual, entrá a la ficha del producto." />
      <div className="tarjeta p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo etiqueta="Lista a modificar">
            <select className="entrada" value={listaId} onChange={(e) => cambiarCampo({ listaId: Number(e.target.value) })}>{listas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</select>
          </Campo>
          <Campo etiqueta="Productos">
            <select className="entrada" value={d.categoriaId} onChange={(e) => cambiarCampo({ categoriaId: Number(e.target.value) })}>
              <option value={0}>Todos los activos</option>{aux.data!.categorias.filter((c) => !c.padreId).map((c) => <option key={c.id} value={c.id}>Solo {c.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Tipo de cambio">
            <select className="entrada" value={d.tipo} onChange={(e) => cambiarCampo({ tipo: e.target.value as typeof d.tipo })}>
              <option value="porcentaje">Aumentar / bajar un %</option>
              <option value="desde_lista">Calcular desde otra lista</option>
              <option value="fijo">Mismo precio para todos</option>
            </select>
          </Campo>
          {d.tipo === 'fijo' ? (
            <Campo etiqueta="Precio"><Importe valor={d.fijo} onCambio={(c) => cambiarCampo({ fijo: c })} /></Campo>
          ) : (
            <Campo etiqueta={d.tipo === 'porcentaje' ? 'Porcentaje' : 'Ajuste sobre la lista base'} ayuda="Negativo para bajar. Ej: 10 o -5">
              <div className="relative"><input className="entrada pr-7 text-right" inputMode="decimal" value={d.porcentaje} onChange={(e) => cambiarCampo({ porcentaje: e.target.value })} /><span className="absolute right-3 top-2 text-sm text-carbon/40">%</span></div>
            </Campo>
          )}
          {d.tipo === 'desde_lista' && (
            <Campo etiqueta="Lista base">
              <select className="entrada" value={d.listaBaseId || listas.find((l) => l.id !== listaId)?.id} onChange={(e) => cambiarCampo({ listaBaseId: Number(e.target.value) })}>
                {listas.filter((l) => l.id !== listaId).map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
              </select>
            </Campo>
          )}
          <Campo etiqueta="Redondeo hacia arriba">
            <select className="entrada" value={redondeo} onChange={(e) => cambiarCampo({ redondeo: Number(e.target.value) })}>
              {REDONDEOS.map((r) => <option key={r} value={r}>{r ? `a ${pesos(r)}` : 'Sin redondeo'}</option>)}
            </select>
          </Campo>
        </div>
        <div className="mt-4 flex justify-end">
          <button className="btn-primario" disabled={previsualizar.isPending || (d.tipo !== 'fijo' && !valorBp && d.tipo === 'porcentaje') || (d.tipo === 'fijo' && !d.fijo)} onClick={() => previsualizar.mutate()}>
            {previsualizar.isPending ? 'Calculando…' : 'Ver vista previa'}
          </button>
        </div>
      </div>

      {vista && (
        <div className="mt-6">
          <div className="mb-3 space-y-2">
            <Aviso>
              {d.tipo === 'porcentaje' && <>Ajuste de <b>{pct(valorBp)}</b> sobre <b>{nombreLista}</b>. </>}
              Cambian <b>{cambian.length}</b> de {vista.filas.length} variantes.
              {sinPrecio > 0 && <> {sinPrecio} quedan igual porque no tienen precio de partida.</>}
              {' '}<b>Todavía no se aplicó nada.</b>
            </Aviso>
            {bajoCosto > 0 && <Aviso tono="critico">{bajoCosto} variantes quedarían con precio igual o menor al costo (marcadas en la tabla).</Aviso>}
          </div>
          <div className="tarjeta max-h-[55vh] overflow-auto">
            <table className="tabla">
              <thead><tr><th>Código</th><th>Producto</th>{puede('costos') && <th className="num">Costo</th>}<th className="num">Actual</th><th className="num">Nuevo</th><th className="num">Dif.</th></tr></thead>
              <tbody>
                {vista.filas.map((f) => (
                  <tr key={f.varianteId} className={f.bajoCosto ? 'bg-bordo-claro' : f.nuevo === null || f.nuevo === f.actual ? 'text-carbon/40' : ''}>
                    <td>{f.sku}</td><td>{f.modelo}</td>
                    {puede('costos') && <td className="num">{pesos(f.costo)}</td>}
                    <td className="num">{pesos(f.actual)}</td>
                    <td className="num font-titulo font-bold">{pesos(f.nuevo)}</td>
                    <td className="num text-xs">{f.actual && f.nuevo ? pct(Math.round(((f.nuevo - f.actual) / f.actual) * 10000)) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {puede('precios', 'aprobar') ? (
            <div className="mt-4 flex flex-wrap items-end justify-end gap-3">
              <Campo etiqueta="Motivo (obligatorio)" className="min-w-[260px] flex-1 sm:flex-none"><input className="entrada" value={d.motivo} onChange={(e) => setD({ ...d, motivo: e.target.value })} placeholder="Ej: aumento noviembre" /></Campo>
              <button className="btn-secundario" onClick={() => setVista(null)}>Descartar</button>
              <button className="btn-primario" disabled={!cambian.length || !d.motivo.trim()} onClick={() => setConfirmar(true)}>Aplicar {cambian.length} cambios</button>
            </div>
          ) : (
            <Aviso tono="atencion">Tu rol puede ver la vista previa pero no aprobar cambios de precio. Pedile a alguien con permiso de aprobación que lo aplique.</Aviso>
          )}
        </div>
      )}
      {confirmar && (
        <Confirmar titulo="Aplicar cambio de precios" textoBoton={`Sí, cambiar ${cambian.length} precios`} ocupado={aplicar.isPending} onCerrar={() => setConfirmar(false)} onConfirmar={() => aplicar.mutate()}>
          <p>Se van a modificar <b>{cambian.length}</b> precios de la lista <b>{nombreLista}</b>. Cada cambio queda en el historial con el motivo "{d.motivo}".</p>
          {bajoCosto > 0 && <Aviso tono="critico">{bajoCosto} quedarían por debajo del costo.</Aviso>}
        </Confirmar>
      )}
      <p className="mt-6 text-xs text-carbon/50">Las listas de precio se administran en <Link className="underline" to="/tablas">Categorías, colores y talles</Link>.</p>
    </>
  );
}
