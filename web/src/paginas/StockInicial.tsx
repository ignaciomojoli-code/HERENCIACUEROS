import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import { api } from '../api';
import { Aviso, Campo, Confirmar, Encabezado, avisarError } from '../componentes/ui';

interface Hoja { nombre: string; filas: number; filaEncabezado: number; encabezados: string[]; sugerida: { sku?: number; cantidad?: number } }
interface Fila { fila: number; sku: string; cantidad: number | null; modelo?: string; estado: string; detalle?: string }
interface Val { resumen: { ok: number; unidades: number; cero: number; noExiste: number; yaTiene: number; invalidas: number; duplicadas: number }; filas: Fila[] }
const ESTADOS: Record<string, [string, string]> = {
  ok: ['Se carga', 'bg-carbon text-marfil'], cero: ['En cero', 'bg-carbon/5 text-carbon/50'], no_existe: ['No existe', 'bg-bordo-claro text-bordo'],
  ya_tiene: ['Ya tiene stock', 'bg-conac-claro text-conac'], invalida: ['Inválida', 'bg-bordo-claro text-bordo'], duplicada: ['Duplicada', 'bg-bordo-claro text-bordo'],
};

export function PaginaStockInicial() {
  const qc = useQueryClient();
  const [a, setA] = useState<{ id: string; nombre: string; hojas: Hoja[] } | null>(null);
  const [hoja, setHoja] = useState('');
  const [p, setP] = useState({ filaEncabezado: 0, colSku: -1, colCantidad: -1 });
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [v, setV] = useState<Val | null>(null);
  const [filtro, setFiltro] = useState('');
  const [conf, setConf] = useState(false);
  const [listo, setListo] = useState<{ variantes: number; unidades: number } | null>(null);
  const h = a?.hojas.find((x) => x.nombre === hoja);
  const elegir = (x: Hoja) => { setHoja(x.nombre); setP({ filaEncabezado: x.filaEncabezado, colSku: x.sugerida.sku ?? -1, colCantidad: x.sugerida.cantidad ?? -1 }); setV(null); };
  const subir = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append('archivo', f); return api.post<{ id: string; nombre: string; hojas: Hoja[] }>('/stock/inicial/analizar', fd); },
    onSuccess: (r) => { setA(r); elegir([...r.hojas].sort((x, y) => Number(y.sugerida.cantidad !== undefined) - Number(x.sugerida.cantidad !== undefined))[0]); }, onError: avisarError,
  });
  const paso = () => ({ id: a!.id, hoja, ...p });
  const validar = useMutation({ mutationFn: () => api.post<Val>('/stock/inicial/validar', paso()), onSuccess: setV, onError: avisarError });
  const confirmar = useMutation({
    mutationFn: () => api.post<{ variantes: number; unidades: number }>('/stock/inicial/confirmar', { ...paso(), fecha }),
    onSuccess: (r) => { setListo(r); setConf(false); qc.invalidateQueries(); }, onError: (e) => { avisarError(e); setConf(false); },
  });

  if (listo) return (
    <div className="tarjeta mx-auto mt-10 max-w-lg p-8 text-center">
      <CheckCircle2 className="mx-auto h-10 w-10 text-dorado" />
      <h2 className="mt-3 text-xl font-bold">Stock inicial cargado</h2>
      <p className="mt-2 text-sm text-carbon/70">{listo.unidades} unidades en {listo.variantes} variantes.</p>
      <Link className="btn-primario mt-6" to="/stock">Ver stock</Link>
    </div>
  );
  const filas = (v?.filas ?? []).filter((f) => (filtro ? f.estado === filtro : f.estado !== 'cero'));
  return (
    <>
      <Link to="/stock" className="mb-3 inline-flex items-center gap-1 text-sm text-carbon/60 hover:text-carbon"><ArrowLeft className="h-4 w-4" />Stock</Link>
      <Encabezado titulo="Stock inicial" sub="Carga de una sola vez el stock de partida desde una planilla. Solo se carga en productos que todavía no tienen ningún movimiento." />
      <label className="mb-6 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-arena bg-crema-50 px-4 py-8 text-center hover:border-dorado">
        {subir.isPending ? <span className="text-sm">Leyendo…</span> : a ? <span className="flex items-center gap-2 text-sm"><FileSpreadsheet className="h-5 w-5 text-dorado" /><b>{a.nombre}</b> · tocá para cambiarlo</span> : <><Upload className="h-6 w-6 text-dorado" /><span className="text-sm">Elegí la planilla (.xlsx o .csv)</span></>}
        <input type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && subir.mutate(e.target.files[0])} />
      </label>
      {a && h && (
        <div className="tarjeta mb-6 p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {a.hojas.length > 1 && <Campo etiqueta="Hoja"><select className="entrada" value={hoja} onChange={(e) => elegir(a.hojas.find((x) => x.nombre === e.target.value)!)}>{a.hojas.map((x) => <option key={x.nombre}>{x.nombre}</option>)}</select></Campo>}
            <Campo etiqueta="Fila de títulos"><input className="entrada" type="number" min={1} value={p.filaEncabezado + 1} onChange={(e) => { setP({ ...p, filaEncabezado: Math.max(0, Number(e.target.value) - 1) }); setV(null); }} /></Campo>
            <Campo etiqueta="Columna del código"><select className="entrada" value={p.colSku} onChange={(e) => { setP({ ...p, colSku: Number(e.target.value) }); setV(null); }}><option value={-1}>Elegí…</option>{h.encabezados.map((t, i) => <option key={i} value={i}>{`Col. ${i + 1}: ${t}`}</option>)}</select></Campo>
            <Campo etiqueta="Columna de la cantidad"><select className="entrada" value={p.colCantidad} onChange={(e) => { setP({ ...p, colCantidad: Number(e.target.value) }); setV(null); }}><option value={-1}>Elegí…</option>{h.encabezados.map((t, i) => <option key={i} value={i}>{`Col. ${i + 1}: ${t}`}</option>)}</select></Campo>
            <Campo etiqueta="Fecha del stock" ayuda="El día al que corresponde la cantidad"><input className="entrada" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Campo>
          </div>
          <div className="mt-4 flex justify-end"><button className="btn-primario" disabled={p.colSku < 0 || p.colCantidad < 0 || validar.isPending} onClick={() => validar.mutate()}>Revisar</button></div>
        </div>
      )}
      {v && (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            {([['', 'Para revisar'], ['ok', `Se cargan ${v.resumen.ok}`], ['cero', `En cero ${v.resumen.cero}`], ['ya_tiene', `Ya tienen ${v.resumen.yaTiene}`], ['no_existe', `No existen ${v.resumen.noExiste}`], ['invalida', `Inválidas ${v.resumen.invalidas}`], ['duplicada', `Duplicadas ${v.resumen.duplicadas}`]] as const).map(([k, t]) => (
              <button key={k} onClick={() => setFiltro(k)} className={`rounded-full border px-3 py-1 ${filtro === k ? 'border-carbon bg-carbon text-marfil' : 'border-arena'}`}>{t}</button>
            ))}
          </div>
          {v.resumen.noExiste > 0 && <div className="mb-3"><Aviso tono="atencion">Hay códigos que no están en el catálogo: importá primero los productos y después el stock.</Aviso></div>}
          <div className="tarjeta max-h-[50vh] overflow-auto">
            <table className="tabla">
              <thead><tr><th>Fila</th><th>Código</th><th>Producto</th><th className="num">Cantidad</th><th>Estado</th></tr></thead>
              <tbody>{filas.slice(0, 600).map((f) => (
                <tr key={f.fila}><td className="num">{f.fila}</td><td className="font-medium">{f.sku}</td><td>{f.modelo ?? ''}</td><td className="num">{f.cantidad ?? ''}</td>
                  <td><span className={`pildora ${ESTADOS[f.estado][1]}`}>{ESTADOS[f.estado][0]}</span>{f.detalle && <div className="text-xs text-carbon/50">{f.detalle}</div>}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end"><button className="btn-primario" disabled={!v.resumen.ok} onClick={() => setConf(true)}>Cargar {v.resumen.unidades} unidades</button></div>
        </>
      )}
      {conf && v && (
        <Confirmar titulo="Cargar stock inicial" textoBoton="Cargar" ocupado={confirmar.isPending} onCerrar={() => setConf(false)} onConfirmar={() => confirmar.mutate()}>
          <p>Se cargan <b>{v.resumen.unidades}</b> unidades en <b>{v.resumen.ok}</b> productos, con fecha {new Date(fecha + 'T12:00').toLocaleDateString('es-AR')}. Queda como movimiento "Stock inicial" de cada uno.</p>
        </Confirmar>
      )}
    </>
  );
}
