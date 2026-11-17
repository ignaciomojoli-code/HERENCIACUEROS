import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import { api } from '../api';
import { useSesion } from '../sesion';
import { Aviso, Campo, Confirmar, Encabezado, avisar, avisarError } from '../componentes/ui';
import { Importe } from '../componentes/Importe';
import { pesos } from '../formato';
import { fechaCorta } from '../plata';
import { Paso } from './Importar';

interface Hoja { nombre: string; filas: number; filaEncabezado: number; encabezados: string[]; muestra: string[][]; sugerida: Record<string, number> }
interface Analisis { id: string; nombre: string; campos: Record<string, string>; hojas: Hoja[] }
interface Linea {
  fila: number; incluir: boolean; fecha: string; proveedor: string; proveedorId: number | null; comprobante: string;
  codigo: string; descripcion: string; cantidad: string; costoUnitarioCentavos: number | null; notas: string;
}
interface LineaR extends Linea { item: { tipo: 'variante' | 'material'; id: number; nombre: string; unidad: string } | null; tipoCompra: string | null; errores: string[]; avisos: string[]; duplicado: string | null }
interface Revision {
  lineas: LineaR[];
  pedidos: { grupo: string; proveedor: string; tipo: string; fecha: string; comprobante: string; lineas: number[]; totalCentavos: number; duplicado: string | null }[];
  resumen: { total: number; incluidas: number; conError: number; duplicadas: number; pedidos: number; totalCentavos: number };
}
interface Lote { id: number; fecha: string; archivo: string; creadas: number; omitidas: number; detalle: { modo?: string } | null; compras: { id: number; numero: number; estado: string; proveedor: string }[] }
const TIPOS: Record<string, string> = { reventa: 'Reventa', confeccion: 'Confección', materiales: 'Materiales' };
const OBLIG = ['fecha', 'proveedor', 'cantidad'];
const editable = (l: LineaR): Linea => ({ fila: l.fila, incluir: l.incluir, fecha: l.fecha, proveedor: l.proveedor, proveedorId: l.proveedorId, comprobante: l.comprobante, codigo: l.codigo, descripcion: l.descripcion, cantidad: l.cantidad, costoUnitarioCentavos: l.costoUnitarioCentavos, notas: l.notas });

/** Importar compras desde Excel/CSV: columnas → revisión editable (con duplicados) → pedidos, todo como un lote anulable. */
export function PaginaImportarCompras() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [hojaNombre, setHojaNombre] = useState('');
  const [filaEnc, setFilaEnc] = useState(0);
  const [asoc, setAsoc] = useState<Record<string, number>>({});
  const [rev, setRev] = useState<Revision | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [filtro, setFiltro] = useState<'todas' | 'error' | 'duplicado' | 'fuera'>('todas');
  const [modo, setModo] = useState<'pedido' | 'recibido'>('pedido');
  const [confirmar, setConfirmar] = useState(false);
  const [resultado, setResultado] = useState<{ pedidos: number[]; omitidas: number } | null>(null);
  const [anularLote, setAnularLote] = useState<Lote | null>(null);
  const [motivo, setMotivo] = useState('');
  const provs = useQuery({ queryKey: ['proveedores'], queryFn: () => api.get<{ id: number; nombre: string; activo: boolean }[]>('/proveedores') });
  const lotes = useQuery({ queryKey: ['lotes-compras'], queryFn: () => api.get<Lote[]>('/importar-compras/lotes') });

  const hoja = analisis?.hojas.find((h) => h.nombre === hojaNombre);
  const elegirHoja = (a: Analisis, nombre: string) => { const h = a.hojas.find((x) => x.nombre === nombre)!; setHojaNombre(nombre); setFilaEnc(h.filaEncabezado); setAsoc(h.sugerida); setRev(null); };
  const subir = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append('archivo', f); return api.post<Analisis>('/importar-compras/analizar', fd); },
    onSuccess: (a) => { setAnalisis(a); setResultado(null); const mejor = [...a.hojas].sort((x, y) => Object.keys(y.sugerida).length - Object.keys(x.sugerida).length)[0]; elegirHoja(a, mejor.nombre); },
    onError: avisarError,
  });
  const leer = useMutation({
    mutationFn: () => api.post<Revision>('/importar-compras/leer', { id: analisis!.id, hoja: hojaNombre, filaEncabezado: filaEnc, asociacion: asoc }),
    onSuccess: (r) => { setRev(r); setLineas(r.lineas.map(editable)); setFiltro(r.resumen.conError ? 'error' : 'todas'); }, onError: avisarError,
  });
  const revisar = useMutation({ mutationFn: (ls: Linea[]) => api.post<Revision>('/importar-compras/revisar', { lineas: ls }), onSuccess: setRev, onError: avisarError });
  // Cada corrección se vuelve a revisar en el servidor (proveedor, producto, duplicados, pedidos que se arman).
  const pendiente = useRef<number | undefined>(undefined);
  const cambiar = (fila: number, cambio: Partial<Linea>) => {
    const ls = lineas.map((l) => (l.fila === fila ? { ...l, ...cambio } : l));
    setLineas(ls);
    window.clearTimeout(pendiente.current);
    pendiente.current = window.setTimeout(() => revisar.mutate(ls), 350);
  };
  useEffect(() => () => window.clearTimeout(pendiente.current), []);
  const confirmarImp = useMutation({
    mutationFn: () => api.post<{ pedidos: number[]; omitidas: number }>('/importar-compras/confirmar', { id: analisis!.id, modo, lineas }),
    onSuccess: (r) => { setResultado(r); setConfirmar(false); setAnalisis(null); setRev(null); qc.invalidateQueries(); },
    onError: (e) => { avisarError(e); setConfirmar(false); },
  });
  const anular = useMutation({
    mutationFn: () => api.post(`/importar-compras/lotes/${anularLote!.id}/anular`, { motivo }),
    onSuccess: () => { avisar('Importación anulada: sus pedidos (y recepciones) quedaron anulados'); setAnularLote(null); setMotivo(''); qc.invalidateQueries(); }, onError: avisarError,
  });

  const encabezados = hoja ? (filaEnc === hoja.filaEncabezado ? hoja.encabezados : []) : [];
  const faltan = OBLIG.filter((c) => asoc[c] === undefined).concat(asoc.codigo === undefined && asoc.descripcion === undefined ? ['codigo'] : []).concat(asoc.costo === undefined && asoc.total === undefined ? ['costo'] : []);
  const visibles = useMemo(() => (rev?.lineas ?? []).filter((l) => (filtro === 'error' ? l.incluir && l.errores.length : filtro === 'duplicado' ? !!l.duplicado : filtro === 'fuera' ? !l.incluir : true)), [rev, filtro]);
  const listo = rev && !revisar.isPending && rev.resumen.conError === 0 && rev.resumen.pedidos > 0;
  const hayConfeccion = rev?.pedidos.some((p) => p.tipo === 'confeccion');

  if (resultado) {
    return (
      <>
        <Encabezado titulo="Importar compras" />
        <div className="tarjeta mx-auto max-w-lg p-8 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-dorado" />
          <h2 className="mt-3 text-xl font-bold">Importación terminada</h2>
          <p className="mt-2 text-sm text-carbon/70">Se crearon {resultado.pedidos.length} pedidos ({resultado.pedidos.map((n) => `P-${n}`).join(', ')}). {resultado.omitidas} líneas quedaron afuera.</p>
          <div className="mt-6 flex justify-center gap-2"><Link className="btn-primario" to="/compras">Ver pedidos</Link><button className="btn-secundario" onClick={() => setResultado(null)}>Importar otro</button></div>
        </div>
      </>
    );
  }

  return (
    <>
      <Encabezado titulo="Importar compras" sub="Subí un Excel o CSV con compras (una fila por producto o material). Revisás y corregís todo en pantalla antes de guardar." />
      <Paso n={1} titulo="Archivo" hecho={!!analisis}>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-arena bg-crema-50 px-4 py-8 text-center hover:border-dorado">
          {subir.isPending ? <span className="text-sm">Leyendo archivo…</span> : analisis ? (
            <span className="flex items-center gap-2 text-sm"><FileSpreadsheet className="h-5 w-5 text-dorado" /><b>{analisis.nombre}</b> · tocá para cambiarlo</span>
          ) : (<><Upload className="h-6 w-6 text-dorado" /><span className="text-sm">Elegí el archivo</span><span className="text-xs text-carbon/50">Columnas: fecha, proveedor, comprobante, código o descripción, cantidad y costo (o total)</span></>)}
          <input type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && subir.mutate(e.target.files[0])} />
        </label>
      </Paso>

      {analisis && hoja && (
        <Paso n={2} titulo="Columnas" hecho={!!rev}>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            {analisis.hojas.length > 1 && <Campo etiqueta="Hoja"><select className="entrada" value={hojaNombre} onChange={(e) => elegirHoja(analisis, e.target.value)}>{analisis.hojas.map((h) => <option key={h.nombre}>{h.nombre}</option>)}</select></Campo>}
            <Campo etiqueta="Fila de títulos" ayuda={`Detectada: ${hoja.filaEncabezado + 1}`}><input className="entrada" type="number" min={1} value={filaEnc + 1} onChange={(e) => { setFilaEnc(Math.max(0, Number(e.target.value) - 1)); setRev(null); }} /></Campo>
          </div>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(analisis.campos).map(([clave, texto]) => (
              <Campo key={clave} etiqueta={texto + (OBLIG.includes(clave) ? ' *' : '')}>
                <select className="entrada" value={asoc[clave] ?? ''} onChange={(e) => { const n = { ...asoc }; if (e.target.value === '') delete n[clave]; else n[clave] = Number(e.target.value); setAsoc(n); setRev(null); }}>
                  <option value="">— No importar —</option>
                  {(encabezados.length ? encabezados : hoja.muestra[0] ?? []).map((_, i) => <option key={i} value={i}>{`Col. ${i + 1}${encabezados[i] ? ': ' + encabezados[i] : ''}`}</option>)}
                </select>
              </Campo>
            ))}
          </div>
          {faltan.length > 0 && <p className="mt-2 text-xs text-bordo">Faltan: {faltan.map((c) => analisis.campos[c]?.split(' (')[0] ?? c).join(', ')}.</p>}
          <div className="mt-4 flex justify-end"><button className="btn-primario" disabled={leer.isPending || faltan.length > 0} onClick={() => leer.mutate()}>{leer.isPending ? 'Leyendo…' : 'Revisar líneas'}</button></div>
        </Paso>
      )}

      {rev && (
        <Paso n={3} titulo="Revisión" hecho={false}>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            {([['todas', `Todas ${rev.resumen.total}`], ['error', `Con error ${rev.resumen.conError}`], ['duplicado', `Posibles duplicados ${rev.resumen.duplicadas}`], ['fuera', `Sin tildar ${rev.resumen.total - rev.resumen.incluidas}`]] as const).map(([k, t]) => (
              <button key={k} onClick={() => setFiltro(k)} className={`rounded-full border px-3 py-1 ${filtro === k ? 'border-carbon bg-carbon text-marfil' : 'border-arena'}`}>{t}</button>
            ))}
            {revisar.isPending && <span className="text-xs text-carbon/50">Revisando…</span>}
          </div>
          {rev.resumen.duplicadas > 0 && <Aviso tono="atencion">Hay líneas que parecen ya cargadas: arrancan sin tildar. Tildalas solo si de verdad son otra compra.</Aviso>}
          <div className="tarjeta mt-3 max-h-[60vh] overflow-auto">
            <table className="tabla text-sm">
              <thead><tr><th /><th>Fila</th><th>Fecha</th><th>Proveedor</th><th>Comprobante</th><th>Código</th><th>Cantidad</th><th className="num">Costo unit.</th><th>Producto / material y avisos</th></tr></thead>
              <tbody>
                {visibles.slice(0, 400).map((l) => {
                  const e = lineas.find((x) => x.fila === l.fila)!;
                  return (
                    <tr key={l.fila} className={!e.incluir ? 'text-carbon/45' : l.errores.length ? 'bg-bordo-claro/40' : ''}>
                      <td><input type="checkbox" checked={e.incluir} onChange={(ev) => cambiar(l.fila, { incluir: ev.target.checked })} aria-label={`Incluir fila ${l.fila}`} /></td>
                      <td className="num">{l.fila}</td>
                      <td><input className="entrada w-[8.5rem] px-2 py-1" type="date" value={/^\d{4}-\d{2}-\d{2}$/.test(e.fecha) ? e.fecha : ''} onChange={(ev) => cambiar(l.fila, { fecha: ev.target.value })} /></td>
                      <td>
                        <select className="entrada w-36 px-2 py-1" value={e.proveedorId ?? ''} onChange={(ev) => cambiar(l.fila, { proveedorId: ev.target.value ? Number(ev.target.value) : null })}>
                          <option value="">{e.proveedor ? `"${e.proveedor}"?` : 'Elegí…'}</option>
                          {provs.data?.filter((p) => p.activo || p.id === e.proveedorId).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </select>
                      </td>
                      <td><input className="entrada w-24 px-2 py-1" value={e.comprobante} onChange={(ev) => cambiar(l.fila, { comprobante: ev.target.value })} /></td>
                      <td><input className="entrada w-24 px-2 py-1" value={e.codigo} placeholder={e.descripcion ? '(por nombre)' : ''} onChange={(ev) => cambiar(l.fila, { codigo: ev.target.value })} /></td>
                      <td><input className="entrada w-16 px-2 py-1" inputMode="decimal" value={e.cantidad} onChange={(ev) => cambiar(l.fila, { cantidad: ev.target.value })} /></td>
                      <td className="num"><Importe className="w-28 py-1 text-right" valor={e.costoUnitarioCentavos} onCambio={(v) => cambiar(l.fila, { costoUnitarioCentavos: v })} /></td>
                      <td className="min-w-[13rem] text-xs">
                        {l.item ? <div className="font-medium text-carbon">{l.item.nombre}{l.item.tipo === 'material' && ` (${l.item.unidad})`}{l.tipoCompra && <span className="ml-1 text-carbon/50">· {TIPOS[l.tipoCompra]}</span>}</div> : l.descripcion && <div className="text-carbon/60">{l.descripcion}</div>}
                        {e.incluir && l.errores.map((x, i) => <div key={i} className="text-bordo">{x}</div>)}
                        {l.duplicado && <div className="text-conac">{l.duplicado}</div>}
                        {l.avisos.map((x, i) => <div key={i} className="text-carbon/60">{x}</div>)}
                      </td>
                    </tr>
                  );
                })}
                {!visibles.length && <tr><td colSpan={9} className="py-6 text-center text-carbon/50">Nada para mostrar con este filtro.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="tarjeta p-4">
              <div className="etiqueta mb-2">Pedidos que se van a crear ({rev.pedidos.length})</div>
              {!rev.pedidos.length ? <p className="text-sm text-carbon/50">Ninguno todavía.</p> : (
                <table className="tabla text-sm"><tbody>
                  {rev.pedidos.map((p) => (
                    <tr key={p.grupo}><td>{p.proveedor}<div className="text-xs text-carbon/55">{TIPOS[p.tipo]} · {fechaCorta(p.fecha)}{p.comprobante && ` · ${p.comprobante}`} · {p.lineas.length} líneas</div>{p.duplicado && <div className="text-xs text-conac">Incluye un posible duplicado</div>}</td><td className="num font-medium">{pesos(p.totalCentavos)}</td></tr>
                  ))}
                  <tr><td className="font-medium">Total</td><td className="num font-bold">{pesos(rev.resumen.totalCentavos)}</td></tr>
                </tbody></table>
              )}
            </div>
            <div className="tarjeta space-y-3 p-4 text-sm">
              <div className="etiqueta">¿Cómo se cargan?</div>
              <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={modo === 'pedido'} onChange={() => setModo('pedido')} /><span><b>Como pedidos pendientes de recibir.</b> No mueve stock ni genera deuda hasta que registres la recepción.</span></label>
              <label className="flex items-start gap-2"><input type="radio" className="mt-1" checked={modo === 'recibido'} onChange={() => setModo('recibido')} /><span><b>Como compras ya recibidas</b> (en la fecha de cada una): entra el stock o los materiales, se actualiza el costo y queda la deuda con el proveedor.</span></label>
              {modo === 'recibido' && hayConfeccion && <Aviso tono="atencion">Hay pedidos de confección: al recibirlos se descuentan los materiales según la receta.</Aviso>}
              <div className="flex justify-end"><button className="btn-primario" disabled={!listo} onClick={() => setConfirmar(true)}>Importar {rev.pedidos.length} pedidos</button></div>
              {rev.resumen.conError > 0 && <p className="text-right text-xs text-bordo">Corregí o destildá las {rev.resumen.conError} líneas con error para poder importar.</p>}
            </div>
          </div>
        </Paso>
      )}

      {!!lotes.data?.length && (
        <section className="mt-8">
          <div className="etiqueta mb-2">Importaciones anteriores</div>
          <div className="tarjeta overflow-x-auto">
            <table className="tabla text-sm">
              <thead><tr><th>Fecha</th><th>Archivo</th><th>Pedidos</th><th /></tr></thead>
              <tbody>
                {lotes.data.map((l) => {
                  const vivos = l.compras.filter((c) => c.estado !== 'anulada');
                  return (
                    <tr key={l.id}>
                      <td className="whitespace-nowrap">{fechaCorta(l.fecha.slice(0, 10))}</td>
                      <td>{l.archivo}<div className="text-xs text-carbon/55">{l.detalle?.modo === 'recibido' ? 'Cargadas como recibidas' : 'Cargadas como pedidos'}</div></td>
                      <td>{l.compras.map((c) => <Link key={c.id} to={`/compras/${c.id}`} className={`mr-2 ${c.estado === 'anulada' ? 'text-carbon/40 line-through' : 'underline'}`}>P-{c.numero}</Link>)}</td>
                      <td className="text-right">{vivos.length > 0 && puede('compras', 'anular') && <button className="btn-secundario btn-chico" onClick={() => setAnularLote(l)}>Anular importación</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {confirmar && rev && (
        <Confirmar titulo="Confirmar importación" textoBoton="Importar" ocupado={confirmarImp.isPending} onCerrar={() => setConfirmar(false)} onConfirmar={() => confirmarImp.mutate()}>
          <p>Se crean <b>{rev.pedidos.length}</b> pedidos por <b>{pesos(rev.resumen.totalCentavos)}</b> {modo === 'recibido' ? 'ya recibidos (mueve stock y deja la deuda)' : 'pendientes de recibir'}. Se guarda todo junto: si algo falla, no se guarda nada.</p>
          <p className="text-carbon/60">No se modifica ningún pedido existente. Si te equivocaste, después podés anular la importación entera.</p>
        </Confirmar>
      )}
      {anularLote && (
        <Confirmar titulo={`Anular importación ${anularLote.archivo}`} textoBoton="Anular" peligro ocupado={anular.isPending} onCerrar={() => { setAnularLote(null); setMotivo(''); }} onConfirmar={() => anular.mutate()}>
          <p>Se anulan sus pedidos {anularLote.compras.filter((c) => c.estado !== 'anulada').map((c) => `P-${c.numero}`).join(', ')} y, si tenían recepciones, también esas recepciones (sale el stock que entró). Nada se borra.</p>
          <Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
        </Confirmar>
      )}
    </>
  );
}
