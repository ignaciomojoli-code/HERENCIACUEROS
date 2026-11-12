/**
 * Cálculo de precios y rentabilidad.
 *
 * IMPORTANTE — margen y markup NO son lo mismo:
 *   markup (recargo sobre costo) = (precio − costo) / costo
 *   margen (sobre precio)        = (precio − costo) / precio
 * Con 50%: markup sobre $100.000 → $150.000; margen sobre $100.000 → $200.000.
 *
 * Los porcentajes se expresan en puntos básicos (bp): 1% = 100 bp.
 */
import { redondear, type Centavos } from './dinero.js';

export type MetodoPrecio = 'markup' | 'margen' | 'precio_objetivo';

export interface ParametrosPrecio {
  metodo: MetodoPrecio;
  /** Costo unitario total (sin los % sobre precio). */
  costoCentavos: Centavos;
  /** markup en bp (para metodo 'markup') */
  markupBp?: number;
  /** margen objetivo en bp (para metodo 'margen') */
  margenBp?: number;
  /** precio fijado a mano (para metodo 'precio_objetivo') */
  precioObjetivoCentavos?: Centavos;
  /** Suma de costos expresados como % del precio de venta (comisión de tarjeta, IIBB, financiero), en bp. */
  porcentajesSobrePrecioBp?: number;
}

export interface ResultadoPrecio {
  precioCentavos: Centavos;
  /** Ganancia bruta = precio − costo (sin % sobre precio) */
  gananciaBrutaCentavos: Centavos;
  /** Ganancia neta estimada = precio − costo − % sobre precio */
  gananciaNetaCentavos: Centavos;
  margenBrutoBp: number | null;
  margenNetoBp: number | null;
  markupBp: number | null;
}

export class ErrorPrecio extends Error {}

/** Precio que resulta de aplicar el método elegido. */
export function calcularPrecio(p: ParametrosPrecio): ResultadoPrecio {
  const costo = p.costoCentavos;
  if (!Number.isInteger(costo) || costo < 0) throw new ErrorPrecio('El costo debe ser un importe válido y no negativo');
  const pctPrecio = p.porcentajesSobrePrecioBp ?? 0;
  let precio: number;
  switch (p.metodo) {
    case 'markup': {
      if (p.markupBp === undefined) throw new ErrorPrecio('Falta el markup');
      // Precio tal que, después de descontar los % sobre precio, quede costo × (1 + markup).
      const neto = (costo * (10000 + p.markupBp)) / 10000;
      if (pctPrecio >= 10000) throw new ErrorPrecio('Los porcentajes sobre precio no pueden sumar 100% o más');
      precio = (neto * 10000) / (10000 - pctPrecio);
      break;
    }
    case 'margen': {
      if (p.margenBp === undefined) throw new ErrorPrecio('Falta el margen objetivo');
      const divisor = 10000 - p.margenBp - pctPrecio;
      if (divisor <= 0) throw new ErrorPrecio('Margen + porcentajes sobre precio deben sumar menos de 100%');
      precio = (costo * 10000) / divisor;
      break;
    }
    case 'precio_objetivo': {
      if (p.precioObjetivoCentavos === undefined) throw new ErrorPrecio('Falta el precio objetivo');
      precio = p.precioObjetivoCentavos;
      break;
    }
    default:
      throw new ErrorPrecio('Método de precio desconocido');
  }
  return analizarPrecio(redondear(precio), costo, pctPrecio);
}

/** Rentabilidad de un precio dado. */
export function analizarPrecio(precioCentavos: Centavos, costoCentavos: Centavos, porcentajesSobrePrecioBp = 0): ResultadoPrecio {
  const bruta = precioCentavos - costoCentavos;
  const descuentos = redondear((precioCentavos * porcentajesSobrePrecioBp) / 10000);
  const neta = bruta - descuentos;
  return {
    precioCentavos,
    gananciaBrutaCentavos: bruta,
    gananciaNetaCentavos: neta,
    margenBrutoBp: precioCentavos > 0 ? redondear((bruta * 10000) / precioCentavos) : null,
    margenNetoBp: precioCentavos > 0 ? redondear((neta * 10000) / precioCentavos) : null,
    markupBp: costoCentavos > 0 ? redondear((bruta * 10000) / costoCentavos) : null,
  };
}

/** Conversión exacta entre margen y markup (en bp). */
export function margenAMarkup(margenBp: number): number {
  if (margenBp >= 10000) throw new ErrorPrecio('Un margen de 100% o más no tiene markup equivalente');
  return redondear((margenBp * 10000) / (10000 - margenBp));
}
export function markupAMargen(markupBp: number): number {
  if (markupBp <= -10000) throw new ErrorPrecio('Markup inválido');
  return redondear((markupBp * 10000) / (10000 + markupBp));
}
