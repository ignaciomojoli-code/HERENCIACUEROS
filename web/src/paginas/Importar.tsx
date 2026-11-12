import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import { api } from '../api';
import { useSesion } from '../sesion';
import { Aviso, Campo, Confirmar, Encabezado, avisarError } from '../componentes/ui';

interface Hoja { nombre: string; filas: number; filaEncabezado: number; encabezados: string[]; muestra: string[][]; sugerida: Record<string, number> }
interface Analisis { id: string; nombre: string; campos: Record<string, string>; listas: { id: number; nombre: string }[]; hojas: Hoja[] }
interface FilaV { fila: number; estado: 'nuevo' | 'actualiza' | 'sin_cambios' | 'vacia' | 'duplicada' | 'error'; sku: string; modelo: string; errores: string[]; avisos: string[]; cambios: { campo: string; antes: string; despues: string }[] }
interface Validacion { resumen: { total: number; nuevos: number; actualiza: number; sinCambios: number; vacias: number; duplicadas: number; errores: number }; filas: FilaV[] }

const ESTADOS: Record<FilaV['estado'], { texto: string; clase: string }> = {
  nuevo: { texto: 'Nuevo', clase: 'bg-carbon text-marfil' },
  actualiza: { texto: 'Cambia', clase: 'bg-conac-claro text-conac' },
  sin_cambios: { texto: 'Igual', clase: 'bg-carbon/5 text-carbon/60' },
  vacia: { texto: 'Se omite', clase: 'bg-arena/40 text-carbon/60' },
  duplicada: { texto: 'Duplicada', clase: 'bg-bordo-claro text-bordo' },
  error: { texto: 'Error', clase: 'bg-bordo-claro text-bordo' },
};

export function PaginaImportar() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [hojaNombre, setHojaNombre] = useState('');
  const [filaEnc, setFilaEnc] = useState(0);
  const [asoc, setAsoc] = useState<Record<string, number>>({});
  const [validacion, setValidacion] = useState<Validacion | null>(null);
  const [filtro, setFiltro] = useState<string>('');
  const [actualizar, setActualizar] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [resultado, setResultado] = useState<{ creadas: number; actualizadas: number; omitidas: number; modelosCreados: number } | null>(null);

  const hoja = analisis?.hojas.find((h) => h.nombre === hojaNombre);
  const elegirHoja = (a: Analisis, nombre: string) => {
    const h = a.hojas.find((x) => x.nombre === nombre)!;
    setHojaNombre(nombre); setFilaEnc(h.filaEncabezado); setAsoc(h.sugerida); setValidacion(null);
  };

  const subir = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append('archivo', f); return api.post<Analisis>('/importar/analizar', fd); },
    onSuccess: (a) => { setAnalisis(a); setResultado(null); const mejor = [...a.hojas].sort((x, y) => Object.keys(y.sugerida).length - Object.keys(x.sugerida).length)[0]; elegirHoja(a, mejor.nombre); },
    onError: avisarError,
  });
  const paso = () => ({ id: analisis!.id, hoja: hojaNombre, filaEncabezado: filaEnc, asociacion: asoc });
  const validar = useMutation({ mutationFn: () => api.post<Validacion>('/importar/validar', paso()), onSuccess: (v) => { setValidacion(v); setFiltro(''); }, onError: avisarError });
  const confirmarImp = useMutation({
    mutationFn: () => api.post<NonNullable<typeof resultado>>('/importar/confirmar', { ...paso(), actualizarExistentes: actualizar }),
    onSuccess: (r) => { setResultado(r); setConfirmar(false); setAnalisis(null); setValidacion(null); qc.invalidateQueries(); },
    onError: (e) => { avisarError(e); setConfirmar(false); },
  });

  const campos = analisis ? [...Object.entries(analisis.campos), ...analisis.listas.map((l) => [`precio:${l.id}`, `Precio ${l.nombre}`] as [string, string])] : [];
  const encabezados = hoja ? (filaEnc === hoja.filaEncabezado ? hoja.encabezados : []) : [];
  const filasVisibles = useMemo(() => (validacion?.filas ?? []).filter((f) => (filtro ? f.estado === filtro : f.estado !== 'vacia' && f.estado !== 'sin_cambios')), [validacion, filtro]);
  const aImportar = validacion ? validacion.resumen.nuevos + (actualizar ? validacion.resumen.actualiza : 0) : 0;
  const faltanObligatorios = ['sku', 'modelo', 'categoria'].filter((c) => asoc[c] === undefined);

  if (resultado) {
    return (
      <>
        <Encabezado titulo="Importar planilla" />
        <div className="tarjeta mx-auto max-w-lg p-8 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-dorado" />
          <h2 className="mt-3 text-xl font-bold">Importación terminada</h2>
          <p className="mt-2 text-sm text-carbon/70">{resultado.creadas} variantes nuevas ({resultado.modelosCreados} productos nuevos), {resultado.actualizadas} actualizadas, {resultado.omitidas} filas omitidas.</p>
          <div className="mt-6 flex justify-center gap-2"><Link className="btn-primario" to="/catalogo">Ver catálogo</Link><button className="btn-secundario" onClick={() => setResultado(null)}>Importar otra</button></div>
        </div>
      </>
    );
  }

  return (
    <>
      <Encabezado titulo="Importar planilla" sub="Subí un Excel (.xlsx) o CSV con productos. Primero ves qué va a pasar y recién después se guarda." />

      <Paso n={1} titulo="Archivo" hecho={!!analisis}>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-arena bg-crema-50 px-4 py-8 text-center hover:border-dorado">
          {subir.isPending ? <span className="text-sm">Leyendo archivo…</span> : analisis ? (
            <span className="flex items-center gap-2 text-sm"><FileSpreadsheet className="h-5 w-5 text-dorado" /><b>{analisis.nombre}</b> · tocá para cambiarlo</span>
          ) : (<><Upload className="h-6 w-6 text-dorado" /><span className="text-sm">Elegí el archivo</span><span className="text-xs text-carbon/50">.xlsx o .csv, hasta 20 MB</span></>)}
          <input type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && subir.mutate(e.target.files[0])} />
        </label>
      </Paso>

      {analisis && hoja && (
        <Paso n={2} titulo="Columnas" hecho={!!validacion}>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            {analisis.hojas.length > 1 && (
              <Campo etiqueta="Hoja"><select className="entrada" value={hojaNombre} onChange={(e) => elegirHoja(analisis, e.target.value)}>{analisis.hojas.map((h) => <option key={h.nombre}>{h.nombre}</option>)}</select></Campo>
            )}
            <Campo etiqueta="Fila de títulos" ayuda={`Detectada: ${hoja.filaEncabezado + 1}`}>
              <input className="entrada" type="number" min={1} value={filaEnc + 1} onChange={(e) => { setFilaEnc(Math.max(0, Number(e.target.value) - 1)); setValidacion(null); }} />
            </Campo>
          </div>
          {filaEnc !== hoja.filaEncabezado && <Aviso tono="atencion">Cambiaste la fila de títulos: asociá las columnas por número.</Aviso>}
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {campos.map(([clave, texto]) => (
              <Campo key={clave} etiqueta={texto.split(' (')[0] + (['sku', 'modelo', 'categoria'].includes(clave) ? ' *' : '')}>
                <select className="entrada" value={asoc[clave] ?? ''} onChange={(e) => { const n = { ...asoc }; if (e.target.value === '') delete n[clave]; else n[clave] = Number(e.target.value); setAsoc(n); setValidacion(null); }}>
                  <option value="">— No importar —</option>
                  {(encabezados.length ? encabezados : hoja.muestra[0] ?? []).map((h, i) => <option key={i} value={i}>{`Col. ${i + 1}${encabezados[i] ? ': ' + encabezados[i] : ''}`}</option>)}
                </select>
              </Campo>
            ))}
          </div>
          <p className="mt-3 text-xs text-carbon/50">Las columnas de stock, ventas y ganancias de la planilla no se importan acá: el stock se carga con su propio módulo (próxima entrega) para que quede con su movimiento de origen.</p>
          <div className="mt-4 flex justify-end">
            <button className="btn-primario" disabled={validar.isPending || faltanObligatorios.length > 0} onClick={() => validar.mutate()}>{validar.isPending ? 'Revisando…' : 'Revisar filas'}</button>
          </div>
        </Paso>
      )}

      {validacion && (
        <Paso n={3} titulo="Revisión" hecho={false}>
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            {([['', 'Para revisar'], ['nuevo', `Nuevas ${validacion.resumen.nuevos}`], ['actualiza', `Cambian ${validacion.resumen.actualiza}`], ['sin_cambios', `Iguales ${validacion.resumen.sinCambios}`], ['vacia', `Omitidas ${validacion.resumen.vacias}`], ['duplicada', `Duplicadas ${validacion.resumen.duplicadas}`], ['error', `Errores ${validacion.resumen.errores}`]] as const).map(([k, t]) => (
              <button key={k} onClick={() => setFiltro(k)} className={`rounded-full border px-3 py-1 ${filtro === k ? 'border-carbon bg-carbon text-marfil' : 'border-arena'}`}>{t}</button>
            ))}
          </div>
          {validacion.resumen.errores + validacion.resumen.duplicadas > 0 && <Aviso tono="critico">Las filas con error o duplicadas no se importan. Corregilas en la planilla y volvé a subirla, o seguí sin ellas.</Aviso>}
          <div className="tarjeta mt-3 max-h-[50vh] overflow-auto">
            <table className="tabla">
              <thead><tr><th>Fila</th><th>Estado</th><th>Código</th><th>Producto</th><th>Detalle</th></tr></thead>
              <tbody>
                {filasVisibles.slice(0, 500).map((f) => (
                  <tr key={f.fila}>
                    <td className="num">{f.fila}</td>
                    <td><span className={`pildora ${ESTADOS[f.estado].clase}`}>{ESTADOS[f.estado].texto}</span></td>
                    <td>{f.sku}</td><td>{f.modelo}</td>
                    <td className="text-xs">
                      {f.errores.map((e, i) => <div key={i} className="text-bordo">{e}</div>)}
                      {f.avisos.map((e, i) => <div key={i} className="text-conac">{e}</div>)}
                      {f.cambios.map((c, i) => <div key={i}>{c.campo}: <s className="text-carbon/40">{c.antes || '—'}</s> → <b>{c.despues || '—'}</b></div>)}
                    </td>
                  </tr>
                ))}
                {!filasVisibles.length && <tr><td colSpan={5} className="py-6 text-center text-carbon/50">Nada para mostrar con este filtro.</td></tr>}
              </tbody>
            </table>
            {filasVisibles.length > 500 && <div className="p-2 text-center text-xs text-carbon/50">Se muestran las primeras 500.</div>}
          </div>
          {validacion.resumen.actualiza > 0 && (
            <label className="mt-4 flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={actualizar} onChange={(e) => setActualizar(e.target.checked)} disabled={!puede('catalogo', 'modificar')} />
              <span>También actualizar los <b>{validacion.resumen.actualiza}</b> productos que ya existen con los datos de la planilla (incluye costos y precios). Si no lo tildás, solo se agregan los nuevos.</span>
            </label>
          )}
          <div className="mt-4 flex justify-end">
            <button className="btn-primario" disabled={!aImportar} onClick={() => setConfirmar(true)}>Importar {aImportar} filas</button>
          </div>
        </Paso>
      )}

      {confirmar && validacion && (
        <Confirmar titulo="Confirmar importación" textoBoton="Importar" ocupado={confirmarImp.isPending} onCerrar={() => setConfirmar(false)} onConfirmar={() => confirmarImp.mutate()}>
          <p>Se van a crear <b>{validacion.resumen.nuevos}</b> variantes{actualizar && <> y actualizar <b>{validacion.resumen.actualiza}</b></>}. Se hace todo junto: si algo falla, no se guarda nada.</p>
          <p className="text-carbon/60">Antes de importar conviene tener una copia de seguridad reciente.</p>
        </Confirmar>
      )}
    </>
  );
}

function Paso({ n, titulo, hecho, children }: { n: number; titulo: string; hecho: boolean; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center gap-3">
        <span className={`flex h-7 w-7 items-center justify-center rounded-full font-titulo text-sm font-bold ${hecho ? 'bg-dorado text-carbon' : 'bg-carbon text-marfil'}`}>{n}</span>
        <h2 className="text-lg font-bold">{titulo}</h2>
      </div>
      {children}
    </section>
  );
}
