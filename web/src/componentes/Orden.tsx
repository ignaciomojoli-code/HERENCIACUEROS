import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

type Valor = string | number | boolean | null | undefined;
export type Accesores<T> = Record<string, (f: T) => Valor>;

export interface Orden {
  col: string;
  dir: 'asc' | 'desc';
  cambiar: (col: string) => void;
}

const comparar = new Intl.Collator('es', { numeric: true, sensitivity: 'base' }).compare;

/** Orden por columna en el navegador: un clic ordena, otro invierte. Lo vacío queda siempre al final. */
export function useOrden<T>(filas: T[] | undefined, accesores: Accesores<T>, inicial: { col: string; dir?: 'asc' | 'desc' }) {
  const [col, setCol] = useState(inicial.col);
  const [dir, setDir] = useState<'asc' | 'desc'>(inicial.dir ?? 'asc');
  const ordenadas = useMemo(() => {
    const acc = accesores[col];
    if (!filas || !acc) return filas ?? [];
    const signo = dir === 'asc' ? 1 : -1;
    return [...filas].sort((a, b) => {
      const x = acc(a), y = acc(b);
      const vx = x === null || x === undefined || x === '', vy = y === null || y === undefined || y === '';
      if (vx || vy) return vx === vy ? 0 : vx ? 1 : -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * signo;
      if (typeof x === 'boolean' && typeof y === 'boolean') return (Number(x) - Number(y)) * signo;
      return comparar(String(x), String(y)) * signo;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, col, dir]);
  const orden: Orden = {
    col, dir,
    cambiar: (c) => { if (c === col) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setCol(c); setDir('asc'); } },
  };
  return { filas: ordenadas, orden };
}

/** Encabezado de columna que ordena al tocarlo. */
export function Th({ col, orden, children, className = '' }: { col: string; orden: Orden; children: ReactNode; className?: string }) {
  const activo = orden.col === col;
  const Icono = !activo ? ArrowUpDown : orden.dir === 'asc' ? ArrowUp : ArrowDown;
  const derecha = className.includes('num');
  return (
    <th className={className} aria-sort={activo ? (orden.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => orden.cambiar(col)}
        className={`inline-flex items-center gap-1 uppercase hover:text-carbon ${derecha ? 'flex-row-reverse' : ''} ${activo ? 'text-carbon' : ''}`}>
        {children}<Icono className={`h-3 w-3 shrink-0 ${activo ? '' : 'opacity-30'}`} />
      </button>
    </th>
  );
}

/** Busca un texto en varios campos, sin importar mayúsculas ni acentos. */
export function coincide(q: string, ...campos: Valor[]) {
  const n = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const t = n(q.trim());
  if (!t) return true;
  return campos.some((c) => c !== null && c !== undefined && n(String(c)).includes(t));
}
