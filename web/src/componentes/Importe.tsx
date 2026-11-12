import { useEffect, useState } from 'react';
import { centavosATexto, leerPesos } from '../formato';

/** Entrada de un importe en pesos. Devuelve centavos (o null si queda vacío). */
export function Importe({ valor, onCambio, placeholder, disabled, className = '' }: {
  valor: number | null | undefined; onCambio: (c: number | null) => void; placeholder?: string; disabled?: boolean; className?: string;
}) {
  const [texto, setTexto] = useState(centavosATexto(valor));
  const [foco, setFoco] = useState(false);
  useEffect(() => { if (!foco) setTexto(centavosATexto(valor)); }, [valor, foco]);
  const n = leerPesos(texto);
  return (
    <div className={`relative ${className}`}>
      <span className="pointer-events-none absolute left-3 top-2 text-sm text-carbon/40">$</span>
      <input
        className={`entrada pl-6 text-right tabular-nums ${Number.isNaN(n) ? 'border-bordo' : ''}`}
        inputMode="decimal" value={texto} placeholder={placeholder} disabled={disabled}
        onFocus={() => setFoco(true)}
        onBlur={() => { setFoco(false); }}
        onChange={(e) => { setTexto(e.target.value); const v = leerPesos(e.target.value); if (!Number.isNaN(v)) onCambio(v); }}
      />
    </div>
  );
}
