/** Formatos de pantalla. La plata viaja en centavos y los porcentajes en puntos básicos (1% = 100). */
const ars = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const ars2 = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
const usd = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const pesos = (c: number | null | undefined, decimales = false) => (c == null ? '—' : (decimales ? ars2 : ars).format(c / 100));
export const pct = (bp: number | null | undefined) => (bp == null ? '—' : `${(bp / 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`);
/** "≈ USD" al lado del precio en pesos, como pide el manual. Si no hay cotización cargada, no se muestra. */
export const aproxUsd = (c: number | null | undefined, cotizUsdCentavos: number | null | undefined) =>
  c == null || !cotizUsdCentavos ? null : `≈ ${usd.format(c / cotizUsdCentavos)}`;

/** Lee un importe escrito a mano ("215.000", "215000", "1.540,50") y lo pasa a centavos. */
export function leerPesos(texto: string): number | null {
  const t = texto.replace(/[$\sARS]/g, '').trim();
  if (!t) return null;
  let n = t;
  if (n.includes(',')) n = n.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(n)) n = n.replace(/\./g, '');
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) : NaN;
}
export const centavosATexto = (c: number | null | undefined) => (c == null ? '' : (c / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 }));

export const fechaHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const fecha = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('es-AR') : '—');
export const bytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
