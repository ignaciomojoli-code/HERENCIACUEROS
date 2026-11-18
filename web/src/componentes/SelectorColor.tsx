import { useColores } from '../costos';

/** Elegir el color de un material que va por color. "" = sin elegir; "sin" = sin color (lo anterior a controlarlo por color). */
export function SelectorColor({ valor, onCambio, permitirSinColor = true, className = 'entrada' }: { valor: number | null | undefined; onCambio: (colorId: number | null) => void; permitirSinColor?: boolean; className?: string }) {
  const colores = useColores();
  return (
    <select className={className} value={valor === undefined ? '' : valor === null ? 'sin' : String(valor)} onChange={(e) => onCambio(e.target.value === 'sin' || e.target.value === '' ? null : Number(e.target.value))} aria-label="Color">
      {valor === undefined && <option value="">Elegí el color…</option>}
      {permitirSinColor && <option value="sin">Sin color</option>}
      {colores.data?.filter((c) => c.activo || c.id === valor).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
    </select>
  );
}
