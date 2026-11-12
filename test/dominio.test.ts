import { describe, expect, it } from 'vitest';
import { aplicarAjuste, parsearImporte, redondearPrecio } from '../server/domain/dinero.js';
import { analizarPrecio, calcularPrecio, margenAMarkup, markupAMargen } from '../server/domain/precios.js';
import { normalizarClave, normalizarSku } from '../server/domain/texto.js';

describe('importes', () => {
  it('lee los formatos de la planilla', () => {
    expect(parsearImporte('$27,360.00')).toBe(2736000);
    expect(parsearImporte('$215,000')).toBe(21500000);
    expect(parsearImporte('-$9,900')).toBe(-990000);
    expect(parsearImporte('1.540')).toBe(154000);
    expect(parsearImporte('1.540,50')).toBe(154050);
    expect(parsearImporte(38000)).toBe(3800000);
    expect(parsearImporte('-')).toBeNull();
    expect(parsearImporte('')).toBeNull();
  });
  it('ajusta y redondea hacia arriba', () => {
    expect(aplicarAjuste(21500000, 1000)).toBe(23650000);
    expect(redondearPrecio(23650000, 50000)).toBe(23650000);
    expect(redondearPrecio(23650001, 50000)).toBe(23700000);
    expect(redondearPrecio(3850000, 0)).toBe(3850000);
  });
});

describe('margen y markup son cosas distintas', () => {
  it('markup 100% duplica el costo; eso es margen 50%', () => {
    const r = calcularPrecio({ metodo: 'markup', costoCentavos: 10000000, markupBp: 10000 });
    expect(r.precioCentavos).toBe(20000000);
    expect(r.markupBp).toBe(10000);
    expect(r.margenBrutoBp).toBe(5000);
  });
  it('margen 50% también da precio = costo × 2, pero margen 60% no es markup 60%', () => {
    expect(calcularPrecio({ metodo: 'margen', costoCentavos: 10000000, margenBp: 5000 }).precioCentavos).toBe(20000000);
    const r = calcularPrecio({ metodo: 'margen', costoCentavos: 10000000, margenBp: 6000 });
    expect(r.precioCentavos).toBe(25000000);
    expect(r.markupBp).toBe(15000);
  });
  it('los porcentajes sobre precio (tarjeta, IIBB) se descuentan del margen neto', () => {
    const r = calcularPrecio({ metodo: 'margen', costoCentavos: 10000000, margenBp: 4000, porcentajesSobrePrecioBp: 1000 });
    expect(r.precioCentavos).toBe(20000000);
    expect(r.margenNetoBp).toBe(4000);
    expect(r.margenBrutoBp).toBe(5000);
  });
  it('conversiones', () => {
    expect(margenAMarkup(5000)).toBe(10000);
    expect(markupAMargen(10000)).toBe(5000);
  });
  it('analiza un precio real: costo 108.630, precio 215.000', () => {
    const a = analizarPrecio(21500000, 10863000);
    expect(a.gananciaBrutaCentavos).toBe(10637000);
    expect(a.margenBrutoBp).toBe(4947);
    expect(a.markupBp).toBe(9792);
  });
  it('rechaza márgenes imposibles', () => {
    expect(() => calcularPrecio({ metodo: 'margen', costoCentavos: 100, margenBp: 9000, porcentajesSobrePrecioBp: 1000 })).toThrow();
  });
});

describe('textos', () => {
  it('normaliza claves sin tocar el código', () => {
    expect(normalizarClave('  Marrón   OSCURO ')).toBe('marron oscuro');
    expect(normalizarSku('  Art 380  -  Negro ')).toBe('Art 380 - Negro');
  });
});
