import { useState } from 'react';

/**
 * Barras verticales de una sola serie (ventas por día o por mes). Color coñac de la marca sobre el fondo
 * claro (contraste validado), extremos redondeados, grilla tenue y detalle al pasar el mouse o tocar.
 */
export function GraficoBarras({ datos, formato, alto = 180, etiqueta }: {
  datos: { clave: string; texto: string; valor: number; detalle?: string }[];
  formato: (v: number) => string;
  alto?: number;
  etiqueta: string;
}) {
  const [activo, setActivo] = useState<number | null>(null);
  const max = Math.max(...datos.map((d) => d.valor), 0);
  const tope = escalaRedonda(max);
  const ancho = 100 / Math.max(datos.length, 1);
  const marcas = [0, 0.5, 1].map((p) => tope * p);
  // Cada cuántas barras se escribe la fecha abajo, para que no se encimen.
  const salto = Math.ceil(datos.length / 6);
  const a = activo !== null ? datos[activo] : null;
  return (
    <div className="relative" role="img" aria-label={etiqueta}>
      <div className="flex" style={{ height: alto }}>
        <div className="relative w-14 shrink-0 text-right text-[10px] text-carbon/45">
          {marcas.map((m) => <span key={m} className="absolute right-2 -translate-y-1/2 tabular-nums" style={{ top: `${100 - (tope ? (m / tope) * 100 : 0)}%` }}>{formatoCorto(m)}</span>)}
        </div>
        <div className="relative flex-1 border-b border-carbon/20" onMouseLeave={() => setActivo(null)}>
          {marcas.slice(1).map((m) => <div key={m} className="absolute inset-x-0 border-t border-dashed border-carbon/10" style={{ top: `${100 - (m / tope) * 100}%` }} />)}
          {datos.map((d, i) => {
            const h = tope ? (d.valor / tope) * 100 : 0;
            return (
              <button key={d.clave} type="button" aria-label={`${d.texto}: ${formato(d.valor)}`}
                className="absolute bottom-0 top-0 flex items-end justify-center focus:outline-none"
                style={{ left: `${i * ancho}%`, width: `${ancho}%` }}
                onMouseEnter={() => setActivo(i)} onFocus={() => setActivo(i)} onClick={() => setActivo(i)}>
                <span className={`block rounded-t-[4px] transition-colors ${activo === i ? 'bg-carbon' : 'bg-conac'}`}
                  style={{ height: d.valor > 0 ? `max(${h}%, 2px)` : 0, width: 'calc(100% - 2px)', maxWidth: 28 }} />
              </button>
            );
          })}
          {a && activo !== null && (
            <div className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded border border-arena bg-crema-50 px-2 py-1 text-xs shadow"
              style={{ left: `${Math.min(Math.max((activo + 0.5) * ancho, 12), 88)}%`, top: 0 }}>
              <div className="text-carbon/60">{a.texto}</div>
              <div className="font-semibold tabular-nums">{formato(a.valor)}</div>
              {a.detalle && <div className="text-carbon/60">{a.detalle}</div>}
            </div>
          )}
        </div>
      </div>
      <div className="relative ml-14 h-4 text-[10px] text-carbon/45">
        {datos.map((d, i) => i % salto === 0 && <span key={d.clave} className="absolute top-0.5 -translate-x-1/2 whitespace-nowrap" style={{ left: `${(i + 0.5) * ancho}%` }}>{d.texto}</span>)}
      </div>
    </div>
  );
}

/** Tope del eje: el próximo número "redondo" (1, 2, 5 × 10ⁿ) por encima del máximo. */
function escalaRedonda(max: number) {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

/** Centavos → "$1,2 M", "$350 mil". */
export function formatoCorto(centavos: number) {
  const p = centavos / 100;
  if (p >= 1e6) return `$${(p / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`;
  if (p >= 1e3) return `$${(p / 1e3).toLocaleString('es-AR', { maximumFractionDigits: 0 })} mil`;
  return `$${p.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
}

/** Barra horizontal para desgloses (formas de pago, categorías): una sola serie; el texto va en tinta, no en color. */
export function BarraHorizontal({ titulo, valor, parte, total, sub }: { titulo: string; valor: string; parte: number; total: number; sub?: string }) {
  const ancho = total > 0 ? Math.max(0, Math.min(100, (parte / total) * 100)) : 0;
  return (
    <div className="mb-2.5" title={sub}>
      <div className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate">{titulo}</span><span className="shrink-0 font-medium tabular-nums">{valor}</span></div>
      <div className="mt-1 h-1.5 rounded bg-arena/35"><div className="h-1.5 rounded bg-conac" style={{ width: `${ancho}%` }} /></div>
      {sub && <div className="mt-0.5 text-xs text-carbon/55">{sub}</div>}
    </div>
  );
}
