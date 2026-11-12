import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export function Logo({ claro = false, chico = false }: { claro?: boolean; chico?: boolean }) {
  const color = claro ? 'text-marfil' : 'text-carbon';
  return (
    <div className={`inline-flex flex-col items-center leading-none ${color}`}>
      <span className={`font-titulo font-extrabold tracking-[0.06em] ${chico ? 'text-xl' : 'text-4xl'}`}>HERENCIA</span>
      <span className="mt-1 flex w-full items-center gap-2">
        <span className="h-px flex-1 bg-dorado" />
        <span className={`font-sans font-medium tracking-[0.4em] ${chico ? 'text-[9px]' : 'text-xs'} text-dorado`}>CUERO</span>
        <span className="h-px flex-1 bg-dorado" />
      </span>
    </div>
  );
}

export function Encabezado({ titulo, sub, children }: { titulo: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-dorado/50 pb-4">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{titulo}</h1>
        {sub && <p className="mt-1 text-sm text-carbon/60">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Campo({ etiqueta, children, ayuda, error, className = '' }: { etiqueta: string; children: ReactNode; ayuda?: ReactNode; error?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="etiqueta mb-1 block">{etiqueta}</span>
      {children}
      {ayuda && !error && <span className="mt-1 block text-xs text-carbon/50">{ayuda}</span>}
      {error && <span className="mt-1 block text-xs text-bordo">{error}</span>}
    </label>
  );
}

type TonoAviso = 'info' | 'ok' | 'atencion' | 'critico';
const tonos: Record<TonoAviso, string> = {
  info: 'border-dorado/60 bg-marfil text-carbon',
  ok: 'border-carbon/20 bg-marfil text-carbon',
  atencion: 'border-conac/50 bg-conac-claro text-carbon',
  critico: 'border-bordo/50 bg-bordo-claro text-bordo',
};
export function Aviso({ tono = 'info', children }: { tono?: TonoAviso; children: ReactNode }) {
  const Icono = tono === 'ok' ? CheckCircle2 : tono === 'info' ? Info : AlertTriangle;
  return (
    <div className={`flex gap-3 rounded-md border px-4 py-3 text-sm ${tonos[tono]}`}>
      <Icono className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Pendiente({ texto = 'Pendiente' }: { texto?: string }) {
  return <span className="pildora border border-dashed border-conac/60 text-conac">{texto}</span>;
}
export function Estado({ activo }: { activo: boolean }) {
  return activo ? <span className="pildora bg-carbon/5 text-carbon/70">Activo</span> : <span className="pildora bg-arena/50 text-carbon/60">Inactivo</span>;
}
export const Demo = () => <span className="pildora bg-dorado/30 text-carbon">DEMO</span>;

export function Modal({ titulo, children, onCerrar, ancho = 'max-w-lg' }: { titulo: string; children: ReactNode; onCerrar: () => void; ancho?: string }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onCerrar]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-carbon/50 p-0 sm:items-center sm:p-4" onMouseDown={onCerrar}>
      <div className={`max-h-[92vh] w-full ${ancho} overflow-y-auto rounded-t-xl bg-crema shadow-xl sm:rounded-xl`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-dorado/50 bg-crema px-5 py-3">
          <h2 className="text-lg font-bold">{titulo}</h2>
          <button className="rounded p-1 hover:bg-carbon/5" onClick={onCerrar} aria-label="Cerrar"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** Mensajes flotantes simples. */
type Toast = { id: number; texto: string; tono: 'ok' | 'error' };
let empujar: (t: Omit<Toast, 'id'>) => void = () => {};
export const avisar = (texto: string) => empujar({ texto, tono: 'ok' });
export const avisarError = (e: unknown) => empujar({ texto: e instanceof Error ? e.message : String(e), tono: 'error' });
export function Toasts() {
  const [lista, setLista] = useState<Toast[]>([]);
  useEffect(() => {
    let n = 0;
    empujar = (t) => {
      const id = ++n;
      setLista((l) => [...l, { ...t, id }]);
      setTimeout(() => setLista((l) => l.filter((x) => x.id !== id)), t.tono === 'error' ? 7000 : 3500);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex max-w-sm flex-col gap-2">
      {lista.map((t) => (
        <div key={t.id} className={`pointer-events-auto rounded-md px-4 py-3 text-sm shadow-lg ${t.tono === 'ok' ? 'bg-carbon text-marfil' : 'bg-bordo text-marfil'}`}>{t.texto}</div>
      ))}
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return <div className="py-12 text-center text-sm text-carbon/50">{texto}</div>;
}
export function Vacio({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-arena py-12 text-center text-sm text-carbon/60">{children}</div>;
}
export function ErrorCarga({ error }: { error: unknown }) {
  return <Aviso tono="critico">{error instanceof Error ? error.message : 'No se pudo cargar'}</Aviso>;
}

/** Confirmación con texto, para acciones importantes. */
export function Confirmar({ titulo, children, textoBoton, peligro, onConfirmar, onCerrar, ocupado }: {
  titulo: string; children: ReactNode; textoBoton: string; peligro?: boolean; onConfirmar: () => void; onCerrar: () => void; ocupado?: boolean;
}) {
  return (
    <Modal titulo={titulo} onCerrar={onCerrar}>
      <div className="space-y-4 text-sm">{children}</div>
      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
        <button className={peligro ? 'btn-peligro' : 'btn-primario'} disabled={ocupado} onClick={onConfirmar}>{ocupado ? 'Guardando…' : textoBoton}</button>
      </div>
    </Modal>
  );
}
