import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, History, Pencil, Plus, Power } from 'lucide-react';
import { api } from '../api';
import { useSesion } from '../sesion';
import type { Aux, Modelo, Variante } from '../tipos';
import { Aviso, Campo, Cargando, Confirmar, Demo, Encabezado, ErrorCarga, Estado, Modal, Pendiente, avisar, avisarError } from '../componentes/ui';
import { Importe } from '../componentes/Importe';
import { aproxUsd, fechaHora, pct, pesos } from '../formato';
import { FormModelo, type DatosModeloForm } from './ModeloNuevo';
import { ModalKardex } from '../componentes/StockModales';

/** Margen y markup se calculan y muestran por separado (nunca se mezclan). */
export function analisis(precio: number | null | undefined, costo: number | null | undefined) {
  if (!precio || costo == null) return null;
  const ganancia = precio - costo;
  return { ganancia, margenBp: Math.round((ganancia / precio) * 10000), markupBp: costo > 0 ? Math.round((ganancia / costo) * 10000) : null };
}

export function PaginaModelo() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { puede, cotizUsd } = useSesion();
  const modelo = useQuery({ queryKey: ['modelo', id], queryFn: () => api.get<Modelo>(`/catalogo/modelos/${id}`) });
  const aux = useQuery({ queryKey: ['aux'], queryFn: () => api.get<Aux>('/catalogo/aux') });
  const [editarModelo, setEditarModelo] = useState(false);
  const [variante, setVariante] = useState<Partial<Variante> | null>(null);
  const [duplicar, setDuplicar] = useState(false);
  const [estado, setEstado] = useState<{ tipo: 'modelo' | 'variante'; id: number; activo: boolean } | null>(null);
  const [vista, setVista] = useState<'lista' | 'grilla' | 'historial'>('lista');
  const [kardex, setKardex] = useState<number | null>(null);
  const refrescar = () => { qc.invalidateQueries({ queryKey: ['modelo', id] }); qc.invalidateQueries({ queryKey: ['modelos'] }); };

  const guardarModelo = useMutation({
    mutationFn: (d: DatosModeloForm) => api.put(`/catalogo/modelos/${id}`, d),
    onSuccess: () => { avisar('Producto actualizado'); setEditarModelo(false); refrescar(); qc.invalidateQueries({ queryKey: ['aux'] }); },
    onError: avisarError,
  });
  const cambiarEstado = useMutation({
    mutationFn: (e: NonNullable<typeof estado>) => api.post(e.tipo === 'modelo' ? `/catalogo/modelos/${e.id}/estado` : `/catalogo/variantes/${e.id}/estado`, { activo: e.activo }),
    onSuccess: () => { avisar('Listo'); setEstado(null); refrescar(); },
    onError: avisarError,
  });

  if (modelo.isLoading || aux.isLoading) return <Cargando />;
  if (modelo.isError) return <ErrorCarga error={modelo.error} />;
  const m = modelo.data!;
  const a = aux.data!;
  const listas = a.listasPrecio.filter((l) => l.activo);
  const verCostos = puede('costos');
  const verStock = puede('stock');
  const cat = a.categorias.find((c) => c.id === m.categoriaId)?.nombre;
  const sub = a.categorias.find((c) => c.id === m.subcategoriaId)?.nombre;
  const prov = a.proveedores.find((p) => p.id === m.proveedorId)?.nombre;

  return (
    <>
      <Link to="/catalogo" className="mb-3 inline-flex items-center gap-1 text-sm text-carbon/60 hover:text-carbon"><ArrowLeft className="h-4 w-4" />Catálogo</Link>
      <Encabezado titulo={m.nombre} sub={<>{[cat, sub, m.genero, prov].filter(Boolean).join(' · ')} {m.esDemo && <Demo />} {!m.activo && <Estado activo={false} />}</>}>
        {puede('catalogo', 'modificar') && <button className="btn-secundario" onClick={() => setEditarModelo(true)}><Pencil className="h-4 w-4" />Editar</button>}
        {puede('catalogo', 'crear') && <button className="btn-secundario" onClick={() => setDuplicar(true)}><Copy className="h-4 w-4" />Duplicar</button>}
        {puede('catalogo', 'anular') && <button className="btn-secundario" onClick={() => setEstado({ tipo: 'modelo', id: m.id, activo: !m.activo })}><Power className="h-4 w-4" />{m.activo ? 'Desactivar' : 'Reactivar'}</button>}
      </Encabezado>
      {m.notas && <p className="mb-4 text-sm text-carbon/70">{m.notas}</p>}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-arena p-0.5 text-sm">
          {(['lista', 'grilla', 'historial'] as const).map((v) => (
            <button key={v} onClick={() => setVista(v)} className={`rounded px-3 py-1 ${vista === v ? 'bg-carbon text-marfil' : 'text-carbon/70'}`}>
              {v === 'lista' ? 'Variantes' : v === 'grilla' ? 'Color × talle' : 'Historial'}
            </button>
          ))}
        </div>
        {puede('catalogo', 'crear') && m.activo && <button className="btn-primario btn-chico" onClick={() => setVariante({})}><Plus className="h-4 w-4" />Agregar variante</button>}
      </div>

      {vista === 'lista' && (
        <div className="space-y-2 sm:hidden">
          {m.variantes.map((v) => {
            const costoTotal = v.costoCentavos == null ? null : v.costoCentavos + (v.costoLogisticoCentavos ?? 0) + (v.costoAdicionalCentavos ?? 0);
            return (
              <button key={v.id} disabled={!puede('catalogo', 'modificar')} onClick={() => setVariante(v)} className={`tarjeta block w-full p-3 text-left ${v.activo ? '' : 'opacity-50'}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{v.sku} {v.esDemo && <Demo />}</span>
                  <span className="text-sm text-carbon/60">{[v.color, v.talle && `talle ${v.talle}`].filter(Boolean).join(' · ')}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {listas.map((l) => <span key={l.id}><span className="text-xs text-carbon/50">{l.nombre}: </span><b className="font-titulo">{pesos(v.precios[l.id])}</b></span>)}
                  {verStock && <span><span className="text-xs text-carbon/50">Stock: </span><b>{v.stock ?? 0}</b></span>}
                  {verCostos && <span><span className="text-xs text-carbon/50">Costo: </span>{costoTotal == null ? <Pendiente /> : pesos(costoTotal)}</span>}
                </div>
                {!v.activo && <div className="mt-1"><Estado activo={false} /></div>}
              </button>
            );
          })}
        </div>
      )}
      {vista === 'lista' && (
        <div className="tarjeta hidden overflow-x-auto sm:block">
          <table className="tabla">
            <thead><tr>
              <th>Código</th><th>Color</th><th>Talle</th>
              {verStock && <th className="num">Stock</th>}
              {verCostos && <th className="num">Costo</th>}
              {listas.map((l) => <th key={l.id} className="num">{l.nombre}</th>)}
              <th>Estado</th><th />
            </tr></thead>
            <tbody>
              {m.variantes.map((v) => {
                const costoTotal = v.costoCentavos == null ? null : v.costoCentavos + (v.costoLogisticoCentavos ?? 0) + (v.costoAdicionalCentavos ?? 0);
                return (
                  <tr key={v.id} className={v.activo ? '' : 'opacity-50'}>
                    <td className="font-medium">{v.sku} {v.esDemo && <Demo />}</td>
                    <td>{v.color ?? '—'}</td><td>{v.talle ?? '—'}</td>
                    {verStock && <td className="num"><button className={`font-titulo font-bold hover:underline ${(v.stock ?? 0) <= 0 ? 'text-carbon/35' : ''}`} onClick={() => setKardex(v.id)}>{v.stock ?? 0}</button></td>}
                    {verCostos && <td className="num">{costoTotal == null ? <Pendiente /> : pesos(costoTotal)}</td>}
                    {listas.map((l) => {
                      const p = v.precios[l.id];
                      const an = verCostos ? analisis(p, costoTotal) : null;
                      return (
                        <td key={l.id} className="num">
                          {p != null ? <span className="font-titulo font-bold">{pesos(p)}</span> : <span className="text-carbon/30">—</span>}
                          {p != null && aproxUsd(p, cotizUsd) && <div className="text-[11px] text-carbon/45">{aproxUsd(p, cotizUsd)}</div>}
                          {an && <div className={`text-[11px] ${an.ganancia <= 0 ? 'text-bordo' : 'text-carbon/50'}`}>margen {pct(an.margenBp)} · markup {pct(an.markupBp)}</div>}
                        </td>
                      );
                    })}
                    <td><Estado activo={v.activo} /></td>
                    <td className="whitespace-nowrap text-right">
                      {puede('catalogo', 'modificar') && <button className="btn-secundario btn-chico" onClick={() => setVariante(v)}>Editar</button>}
                      {puede('catalogo', 'anular') && <button className="btn-secundario btn-chico ml-1" onClick={() => setEstado({ tipo: 'variante', id: v.id, activo: !v.activo })}>{v.activo ? 'Desactivar' : 'Reactivar'}</button>}
                    </td>
                  </tr>
                );
              })}
              {!m.variantes.length && <tr><td colSpan={99} className="py-8 text-center text-carbon/50">Este producto todavía no tiene variantes.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {vista === 'grilla' && <Grilla m={m} aux={a} onElegir={(v) => puede('catalogo', v.id ? 'modificar' : 'crear') && setVariante(v)} />}
      {vista === 'historial' && <Historial m={m} aux={a} />}

      {editarModelo && (
        <Modal titulo="Editar producto" onCerrar={() => setEditarModelo(false)} ancho="max-w-2xl">
          <FormModelo inicial={m} aux={a} ocupado={guardarModelo.isPending} onGuardar={(d) => guardarModelo.mutate(d)} onCancelar={() => setEditarModelo(false)} />
        </Modal>
      )}
      {kardex && <ModalKardex varianteId={kardex} onCerrar={() => { setKardex(null); refrescar(); }} />}
      {variante && <ModalVariante modelo={m} aux={a} inicial={variante} onCerrar={() => setVariante(null)} onGuardado={refrescar} />}
      {duplicar && <ModalDuplicar m={m} onCerrar={() => setDuplicar(false)} onListo={(nid) => { refrescar(); nav(`/catalogo/${nid}`); }} />}
      {estado && (
        <Confirmar titulo={estado.activo ? 'Reactivar' : 'Desactivar'} textoBoton={estado.activo ? 'Reactivar' : 'Desactivar'} peligro={!estado.activo}
          ocupado={cambiarEstado.isPending} onCerrar={() => setEstado(null)} onConfirmar={() => cambiarEstado.mutate(estado)}>
          {estado.activo ? <p>Vuelve a aparecer en el catálogo activo.</p> : (
            <p>No se borra nada: queda guardado con su historial y se puede reactivar cuando quieras.{estado.tipo === 'modelo' && ' También se desactivan todas sus variantes.'}</p>
          )}
        </Confirmar>
      )}
    </>
  );
}

function Grilla({ m, aux, onElegir }: { m: Modelo; aux: Aux; onElegir: (v: Partial<Variante>) => void }) {
  const colores = useMemo(() => [...new Map(m.variantes.map((v) => [v.colorId ?? 0, v.color ?? 'Sin color'])).entries()], [m]);
  const talleIds = new Set(m.variantes.map((v) => v.talleId ?? 0));
  const talles = [...aux.talles.filter((t) => talleIds.has(t.id)), ...(talleIds.has(0) ? [{ id: 0, nombre: 'Único', orden: 999, activo: true }] : [])];
  const primeraLista = aux.listasPrecio[0];
  if (!m.variantes.length) return <div className="tarjeta p-8 text-center text-sm text-carbon/50">Sin variantes.</div>;
  return (
    <div className="tarjeta overflow-x-auto p-1">
      <table className="tabla">
        <thead><tr><th>Color \ Talle</th>{talles.map((t) => <th key={t.id} className="text-center">{t.nombre}</th>)}</tr></thead>
        <tbody>
          {colores.map(([cid, cnombre]) => (
            <tr key={cid}>
              <td className="font-medium">{cnombre}</td>
              {talles.map((t) => {
                const v = m.variantes.find((x) => (x.colorId ?? 0) === cid && (x.talleId ?? 0) === t.id);
                return (
                  <td key={t.id} className="p-1 text-center">
                    {v ? (
                      <button onClick={() => onElegir(v)} className={`w-full rounded border px-2 py-1.5 text-xs ${v.activo ? 'border-dorado/60 bg-marfil hover:border-carbon' : 'border-arena text-carbon/40'}`}>
                        <div className="font-medium">{v.sku}{v.stock !== undefined && <span className={`ml-1 ${v.stock > 0 ? 'text-carbon' : 'text-carbon/35'}`}>· {v.stock}</span>}</div>
                        {primeraLista && v.precios[primeraLista.id] != null && <div className="text-carbon/60">{pesos(v.precios[primeraLista.id])}</div>}
                      </button>
                    ) : m.activo ? (
                      <button onClick={() => onElegir({ colorId: cid || null, talleId: t.id || null })} className="w-full rounded border border-dashed border-arena py-2 text-xs text-carbon/30 hover:text-carbon">+</button>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Historial({ m, aux }: { m: Modelo; aux: Aux }) {
  const sku = (vid: number) => m.variantes.find((v) => v.id === vid)?.sku ?? vid;
  const lista = (lid: number) => aux.listasPrecio.find((l) => l.id === lid)?.nombre ?? lid;
  const filas = [
    ...(m.historialCostos ?? []).map((h) => ({ ...h, que: 'Costo' })),
    ...m.historialPrecios.map((h) => ({ ...h, que: `Precio ${lista(h.listaId)}` })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));
  if (!filas.length) return <div className="tarjeta p-8 text-center text-sm text-carbon/50">Sin cambios registrados.</div>;
  return (
    <div className="tarjeta overflow-x-auto">
      <table className="tabla">
        <thead><tr><th>Fecha</th><th>Código</th><th>Qué</th><th className="num">Antes</th><th className="num">Después</th><th>Origen</th><th>Motivo</th></tr></thead>
        <tbody>
          {filas.map((h) => (
            <tr key={h.que + h.id}>
              <td className="whitespace-nowrap">{fechaHora(h.fecha)}</td><td>{sku(h.varianteId)}</td><td>{h.que}</td>
              <td className="num">{pesos(h.anteriorCentavos)}</td><td className="num">{pesos(h.nuevoCentavos)}</td>
              <td>{h.origen}</td><td className="text-carbon/70">{h.motivo ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-carbon/50"><History className="h-3.5 w-3.5" />El detalle completo de quién hizo cada cambio está en Auditoría.</div>
    </div>
  );
}

function ModalVariante({ modelo, aux, inicial, onCerrar, onGuardado }: { modelo: Modelo; aux: Aux; inicial: Partial<Variante>; onCerrar: () => void; onGuardado: () => void }) {
  const { puede } = useSesion();
  const nueva = !inicial.id;
  const editaCostos = puede('costos', 'modificar');
  const verCostos = puede('costos');
  const editaPrecios = puede('precios', 'modificar');
  const listas = aux.listasPrecio.filter((l) => l.activo);
  const [d, setD] = useState({
    sku: inicial.sku ?? '', codigoBarras: inicial.codigoBarras ?? '', colorId: inicial.colorId ?? null, talleId: inicial.talleId ?? null,
    costoCentavos: inicial.costoCentavos ?? null, costoLogisticoCentavos: inicial.costoLogisticoCentavos ?? 0, costoAdicionalCentavos: inicial.costoAdicionalCentavos ?? 0,
    stockMinimo: inicial.stockMinimo ?? null, stockMaximo: inicial.stockMaximo ?? null, notas: inicial.notas ?? '',
    precios: { ...(inicial.precios ?? {}) } as Record<string, number | null>, motivo: '',
  });
  const costoTotal = d.costoCentavos == null ? null : d.costoCentavos + d.costoLogisticoCentavos + d.costoAdicionalCentavos;
  const cambiaronPrecios = listas.some((l) => (d.precios[l.id] ?? null) !== (inicial.precios?.[l.id] ?? null));
  const cambioCosto = d.costoCentavos !== (inicial.costoCentavos ?? null);

  const guardar = useMutation({
    mutationFn: () => {
      const cuerpo: Record<string, unknown> = {
        sku: d.sku, codigoBarras: d.codigoBarras || null, colorId: d.colorId, talleId: d.talleId,
        stockMinimo: d.stockMinimo, stockMaximo: d.stockMaximo, notas: d.notas || null,
      };
      if (editaCostos) Object.assign(cuerpo, { costoCentavos: d.costoCentavos, costoLogisticoCentavos: d.costoLogisticoCentavos, costoAdicionalCentavos: d.costoAdicionalCentavos });
      if (editaPrecios) {
        const ps = Object.fromEntries(listas.filter((l) => d.precios[l.id] != null && d.precios[l.id] !== (inicial.precios?.[l.id] ?? null)).map((l) => [l.id, d.precios[l.id]]));
        if (Object.keys(ps).length) cuerpo.precios = ps;
      }
      if (nueva) return api.post(`/catalogo/modelos/${modelo.id}/variantes`, cuerpo, true);
      return api.put(`/catalogo/variantes/${inicial.id}`, { ...cuerpo, motivo: d.motivo || undefined });
    },
    onSuccess: () => { avisar(nueva ? 'Variante creada' : 'Variante guardada'); onGuardado(); onCerrar(); },
    onError: avisarError,
  });

  return (
    <Modal titulo={nueva ? 'Nueva variante' : `Variante ${inicial.sku}`} onCerrar={onCerrar} ancho="max-w-2xl">
      <form onSubmit={(e) => { e.preventDefault(); guardar.mutate(); }} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Código (SKU)" ayuda="Se guarda tal cual lo escribís"><input className="entrada" value={d.sku} onChange={(e) => setD({ ...d, sku: e.target.value })} required /></Campo>
          <Campo etiqueta="Código de barras"><input className="entrada" value={d.codigoBarras} onChange={(e) => setD({ ...d, codigoBarras: e.target.value })} /></Campo>
          <Campo etiqueta="Color">
            <select className="entrada" value={d.colorId ?? ''} onChange={(e) => setD({ ...d, colorId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Sin color</option>{aux.colores.filter((c) => c.activo || c.id === d.colorId).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Talle">
            <select className="entrada" value={d.talleId ?? ''} onChange={(e) => setD({ ...d, talleId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Talle único</option>{aux.talles.filter((t) => t.activo || t.id === d.talleId).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </Campo>
        </div>

        {verCostos && (
          <div>
            <div className="etiqueta mb-2 border-b border-dorado/40 pb-1">Costo</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo etiqueta="Costo del producto" ayuda={d.costoCentavos == null ? 'Vacío = pendiente' : undefined}><Importe valor={d.costoCentavos} onCambio={(c) => setD({ ...d, costoCentavos: c })} disabled={!editaCostos} /></Campo>
              <Campo etiqueta="Logística / flete"><Importe valor={d.costoLogisticoCentavos} onCambio={(c) => setD({ ...d, costoLogisticoCentavos: c ?? 0 })} disabled={!editaCostos} /></Campo>
              <Campo etiqueta="Otros costos"><Importe valor={d.costoAdicionalCentavos} onCambio={(c) => setD({ ...d, costoAdicionalCentavos: c ?? 0 })} disabled={!editaCostos} /></Campo>
            </div>
            {costoTotal != null && <p className="mt-2 text-xs text-carbon/60">Costo total por unidad: <b>{pesos(costoTotal)}</b></p>}
          </div>
        )}

        <div>
          <div className="etiqueta mb-2 border-b border-dorado/40 pb-1">Precios</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {listas.map((l) => {
              const an = verCostos ? analisis(d.precios[l.id], costoTotal) : null;
              return (
                <Campo key={l.id} etiqueta={l.nombre}>
                  <Importe valor={d.precios[l.id]} onCambio={(c) => setD({ ...d, precios: { ...d.precios, [l.id]: c } })} disabled={!editaPrecios} />
                  {an && (
                    <span className={`mt-1 block text-xs ${an.ganancia <= 0 ? 'text-bordo' : 'text-carbon/60'}`}>
                      Ganancia {pesos(an.ganancia)} · margen {pct(an.margenBp)} · markup {pct(an.markupBp)}
                    </span>
                  )}
                </Campo>
              );
            })}
          </div>
          {!editaPrecios && <p className="mt-2 text-xs text-carbon/50">Tu rol no puede cambiar precios.</p>}
          <p className="mt-2 text-xs text-carbon/50">Margen = ganancia ÷ precio. Markup = ganancia ÷ costo. Todavía no descuenta comisiones de tarjeta ni impuestos: eso llega con el módulo de costos.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Campo etiqueta="Stock mínimo"><input className="entrada" type="number" min={0} value={d.stockMinimo ?? ''} onChange={(e) => setD({ ...d, stockMinimo: e.target.value === '' ? null : Number(e.target.value) })} /></Campo>
          <Campo etiqueta="Stock máximo"><input className="entrada" type="number" min={0} value={d.stockMaximo ?? ''} onChange={(e) => setD({ ...d, stockMaximo: e.target.value === '' ? null : Number(e.target.value) })} /></Campo>
          <Campo etiqueta="Notas"><input className="entrada" value={d.notas} onChange={(e) => setD({ ...d, notas: e.target.value })} /></Campo>
        </div>
        {!nueva && (cambiaronPrecios || cambioCosto) && (
          <Campo etiqueta="Motivo del cambio" ayuda="Queda en el historial"><input className="entrada" value={d.motivo} onChange={(e) => setD({ ...d, motivo: e.target.value })} placeholder="Ej: aumento del proveedor" /></Campo>
        )}
        {cambiaronPrecios && listas.some((l) => { const an = analisis(d.precios[l.id], costoTotal); return an && an.ganancia <= 0; }) && (
          <Aviso tono="critico">Hay un precio igual o menor al costo.</Aviso>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn-primario" disabled={guardar.isPending || !d.sku.trim()}>{guardar.isPending ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ModalDuplicar({ m, onCerrar, onListo }: { m: Modelo; onCerrar: () => void; onListo: (id: number) => void }) {
  const prefijo = m.variantes[0]?.sku.replace(/[\d\s-]+$/, '') ?? '';
  const [d, setD] = useState({ nombre: `${m.nombre} (copia)`, skuDe: prefijo, skuA: '', sufijo: '-COPIA' });
  const dup = useMutation({
    mutationFn: () => api.post<{ id: number }>(`/catalogo/modelos/${m.id}/duplicar`, d.skuA ? { nombre: d.nombre, skuDe: d.skuDe, skuA: d.skuA } : { nombre: d.nombre, sufijo: d.sufijo }, true),
    onSuccess: (r) => { avisar('Producto duplicado'); onCerrar(); onListo(r.id); },
    onError: avisarError,
  });
  return (
    <Modal titulo="Duplicar producto" onCerrar={onCerrar}>
      <div className="space-y-4">
        <p className="text-sm text-carbon/70">Copia el producto con todas sus variantes, costos y precios. Los códigos tienen que ser distintos.</p>
        <Campo etiqueta="Nombre del nuevo producto"><input className="entrada" value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="En los códigos, cambiar"><input className="entrada" value={d.skuDe} onChange={(e) => setD({ ...d, skuDe: e.target.value })} /></Campo>
          <Campo etiqueta="por"><input className="entrada" value={d.skuA} onChange={(e) => setD({ ...d, skuA: e.target.value })} placeholder="Ej: CSUB" /></Campo>
        </div>
        {!d.skuA && <Campo etiqueta="Si no, agregar al final"><input className="entrada" value={d.sufijo} onChange={(e) => setD({ ...d, sufijo: e.target.value })} /></Campo>}
        <div className="flex justify-end gap-2">
          <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn-primario" disabled={dup.isPending || !d.nombre.trim()} onClick={() => dup.mutate()}>{dup.isPending ? 'Duplicando…' : 'Duplicar'}</button>
        </div>
      </div>
    </Modal>
  );
}
