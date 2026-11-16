import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Paperclip, X } from 'lucide-react';
import { api, qs } from '../api';
import { useSesion } from '../sesion';
import { Campo, Confirmar, avisar, avisarError } from './ui';

interface Adjunto { id: number; nombre: string; tipo: string; tamano: number }
type Entidad = 'compra' | 'recepcion' | 'pago_proveedor' | 'gasto';
const MODULO: Record<Entidad, 'compras' | 'caja' | 'gastos'> = { compra: 'compras', recepcion: 'compras', pago_proveedor: 'caja', gasto: 'gastos' };

/** Achica las fotos grandes del celular antes de subirlas (máx. 1800 px, JPEG). Los PDF van tal cual. */
async function preparar(f: File): Promise<Blob> {
  if (!f.type.startsWith('image/') || f.size < 800 * 1024 || f.type === 'image/heic' || f.type === 'image/heif') return f;
  try {
    const img = await createImageBitmap(f);
    const k = Math.min(1, 1800 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const b = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return b && b.size < f.size ? b : f;
  } catch { return f; }
}

/** Fotos de factura o remito adjuntas a un documento. Quitar no borra el archivo: queda guardado y en auditoría. */
export function Adjuntos({ entidad, entidadId, compacto }: { entidad: Entidad; entidadId: number; compacto?: boolean }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const clave = ['adjuntos', entidad, entidadId];
  const lista = useQuery({ queryKey: clave, queryFn: () => api.get<Adjunto[]>('/adjuntos' + qs({ entidad, entidadId })) });
  const [quitar, setQuitar] = useState<Adjunto | null>(null);
  const [motivo, setMotivo] = useState('');
  const subir = useMutation({
    mutationFn: async (f: File) => {
      const b = await preparar(f);
      const fd = new FormData();
      fd.append('archivo', b, b === f ? f.name : f.name.replace(/\.[^.]+$/, '') + '.jpg');
      return api.post(`/adjuntos/${entidad}/${entidadId}`, fd);
    },
    onSuccess: () => { avisar('Archivo adjuntado'); qc.invalidateQueries({ queryKey: clave }); }, onError: avisarError,
  });
  const q = useMutation({
    mutationFn: () => api.post(`/adjuntos/${quitar!.id}/quitar`, { motivo }),
    onSuccess: () => { avisar('Adjunto quitado'); setQuitar(null); setMotivo(''); qc.invalidateQueries({ queryKey: clave }); }, onError: avisarError,
  });
  const archivos = lista.data ?? [];
  const puedeSubir = puede(MODULO[entidad], 'crear');
  if (compacto && !archivos.length && !puedeSubir) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {archivos.map((a) => (
        <span key={a.id} className="inline-flex items-center gap-1 rounded-md border border-arena/70 bg-marfil/60 py-0.5 pl-1 pr-1 text-xs">
          <a href={`/api/adjuntos/${a.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline" title={a.nombre}>
            {a.tipo.startsWith('image/') && a.tipo !== 'image/heic' ? <img src={`/api/adjuntos/${a.id}`} alt="" className="h-8 w-8 rounded object-cover" /> : <FileText className="h-4 w-4" />}
            <span className="max-w-32 truncate">{a.nombre}</span>
          </a>
          {puede(MODULO[entidad], 'anular') && <button className="p-0.5 text-carbon/40 hover:text-bordo" aria-label="Quitar adjunto" onClick={() => setQuitar(a)}><X className="h-3 w-3" /></button>}
        </span>
      ))}
      {puedeSubir && <>
        <button type="button" className="btn-secundario btn-chico" disabled={subir.isPending} onClick={() => input.current?.click()}><Paperclip className="h-3.5 w-3.5" />{subir.isPending ? 'Subiendo…' : 'Adjuntar foto o PDF'}</button>
        <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) subir.mutate(f); e.target.value = ''; }} />
      </>}
      {quitar && (
        <Confirmar titulo="Quitar adjunto" textoBoton="Quitar" peligro ocupado={q.isPending} onCerrar={() => { setQuitar(null); setMotivo(''); }} onConfirmar={() => q.mutate()}>
          <p>Deja de verse acá, pero el archivo queda guardado.</p>
          <Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: era de otro pedido" /></Campo>
        </Confirmar>
      )}
    </div>
  );
}
