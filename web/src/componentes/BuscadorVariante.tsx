import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScanLine, Search } from 'lucide-react';
import { api, qs } from '../api';
import { describirVariante, type VarianteBuscada } from '../tipos';

/**
 * Busca una variante por código, código de barras, producto o color. Con lector de códigos de barras:
 * el lector "escribe" el código y Enter, y si hay coincidencia exacta se elige sola.
 */
export function BuscadorVariante({ onElegir, categoriaId, placeholder = 'Código, código de barras o producto…', autoFocus, mantenerFoco }: {
  onElegir: (v: VarianteBuscada) => void; categoriaId?: number | null; placeholder?: string; autoFocus?: boolean; mantenerFoco?: boolean;
}) {
  const [texto, setTexto] = useState('');
  const [debounced, setDebounced] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [marcado, setMarcado] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(texto), 180); return () => clearTimeout(t); }, [texto]);
  const res = useQuery({ queryKey: ['buscar-variante', debounced, categoriaId], queryFn: () => api.get<VarianteBuscada[]>('/stock/buscar' + qs({ q: debounced, categoriaId })), enabled: debounced.trim().length > 0 });
  const lista = debounced === texto ? res.data ?? [] : [];
  const elegir = (v: VarianteBuscada) => { onElegir(v); setTexto(''); setDebounced(''); setAbierto(false); setMarcado(0); if (mantenerFoco) ref.current?.focus(); };

  const enter = async () => {
    const t = texto.trim();
    if (!t) return;
    // Si todavía no llegó la búsqueda (lector rápido), se consulta directo.
    const datos = debounced === texto && res.data ? res.data : await api.get<VarianteBuscada[]>('/stock/buscar' + qs({ q: t, categoriaId }));
    const exacta = datos.find((d) => d.exacto);
    if (exacta) return elegir(exacta);
    if (datos[marcado]) return elegir(datos[marcado]);
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-carbon/40" />
      <input ref={ref} className="entrada pl-9 pr-9" value={texto} autoFocus={autoFocus} placeholder={placeholder}
        onChange={(e) => { setTexto(e.target.value); setAbierto(true); setMarcado(0); }}
        onFocus={() => setAbierto(true)} onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void enter(); }
          if (e.key === 'ArrowDown') { e.preventDefault(); setMarcado((m) => Math.min(m + 1, lista.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setMarcado((m) => Math.max(m - 1, 0)); }
          if (e.key === 'Escape') setAbierto(false);
        }} />
      <ScanLine className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-dorado" />
      {abierto && texto.trim() && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-arena bg-crema-50 shadow-lg">
          {res.isFetching && !lista.length && <div className="px-3 py-2 text-sm text-carbon/50">Buscando…</div>}
          {!res.isFetching && debounced === texto && !lista.length && <div className="px-3 py-2 text-sm text-carbon/50">Sin resultados</div>}
          {lista.map((v, i) => (
            <button key={v.varianteId} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(v)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${i === marcado ? 'bg-marfil' : 'hover:bg-marfil/60'}`}>
              <span className="min-w-0"><b>{v.sku}</b> <span className="text-carbon/60">{describirVariante(v)}</span></span>
              <span className={`shrink-0 text-xs ${v.stock > 0 ? 'text-carbon/60' : 'text-carbon/35'}`}>stock {v.stock}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
