/**
 * Dinero en CENTAVOS enteros. Toda la aritmética monetaria del sistema pasa por acá
 * para evitar errores de punto flotante.
 */

export type Centavos = number;

/** Redondeo "half away from zero" a entero. */
export function redondear(n: number): number {
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

export function aCentavos(pesos: number): Centavos {
  return redondear(pesos * 100);
}

export function aPesos(c: Centavos): number {
  return c / 100;
}

/**
 * Interpreta importes escritos como en la planilla o a mano:
 * "$27,360.00" (formato en-US de Google Sheets), "$ 27.360,50" (formato AR),
 * "27360", "-$9,900", "USD 70.00", "1.540". Devuelve null si no hay número ("-", "", "pendiente").
 */
export function parsearImporte(entrada: unknown): Centavos | null {
  if (entrada === null || entrada === undefined) return null;
  if (typeof entrada === 'number') return Number.isFinite(entrada) ? aCentavos(entrada) : null;
  let s = String(entrada).trim();
  if (!s || s === '-' || s === '—') return null;
  const negativo = /^-|^\(.*\)$|-\s*\$/.test(s);
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;
  const ultPunto = s.lastIndexOf('.');
  const ultComa = s.lastIndexOf(',');
  let entero: string;
  let decimales = '';
  if (ultPunto >= 0 && ultComa >= 0) {
    // El separador que aparece último es el decimal.
    const sepDec = ultPunto > ultComa ? '.' : ',';
    const i = s.lastIndexOf(sepDec);
    entero = s.slice(0, i).replace(/[.,]/g, '');
    decimales = s.slice(i + 1);
  } else if (ultPunto >= 0 || ultComa >= 0) {
    const sep = ultPunto >= 0 ? '.' : ',';
    const partes = s.split(sep);
    const ult = partes[partes.length - 1];
    // Un solo separador seguido de exactamente 3 dígitos = separador de miles ("1.540", "27,360").
    if (partes.length > 2 || ult.length === 3) {
      entero = partes.join('');
    } else {
      entero = partes.slice(0, -1).join('');
      decimales = ult;
    }
  } else {
    entero = s;
  }
  if (!/^\d*$/.test(entero) || !/^\d*$/.test(decimales)) return null;
  const dec = (decimales + '00').slice(0, 2);
  const resto = decimales.length > 2 ? Number('0.' + decimales.slice(2)) : 0;
  let c = Number(entero || '0') * 100 + Number(dec) + (resto >= 0.5 ? 1 : 0);
  if (negativo) c = -c;
  return c;
}

const fmtARS = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** "$ 260.000" (sin decimales si son cero). */
export function formatearARS(c: Centavos | null | undefined): string {
  if (c === null || c === undefined) return '—';
  const signo = c < 0 ? '-' : '';
  return `${signo}$ ${fmtARS.format(Math.abs(c) / 100)}`;
}

/** Porcentaje en puntos básicos → texto "51,9 %". */
export function formatearPct(bp: number | null | undefined, decimales = 1): string {
  if (bp === null || bp === undefined || !Number.isFinite(bp)) return '—';
  return `${(bp / 100).toLocaleString('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })} %`;
}

/** Aplica un ajuste porcentual (en bp) a un importe. +1500 = +15%. */
export function aplicarAjuste(c: Centavos, ajusteBp: number): Centavos {
  return redondear((c * (10000 + ajusteBp)) / 10000);
}

/** Redondea un precio hacia arriba al múltiplo indicado (en centavos). Ej.: a $500 → 50000. */
export function redondearPrecio(c: Centavos, multiplo: Centavos): Centavos {
  if (!multiplo || multiplo <= 0) return c;
  return Math.ceil(c / multiplo) * multiplo;
}
