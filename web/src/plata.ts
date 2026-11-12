/** Tipos y consultas compartidas de ventas, caja, gastos y pagos. */
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type TipoCuenta = 'efectivo' | 'banco' | 'billetera' | 'a_liquidar' | 'externa';
export interface Cuenta { id: number; nombre: string; tipo: TipoCuenta; moneda: 'ARS' | 'USD'; orden: number; activo: boolean; saldoCentavos?: number; saldoArsCentavos?: number; movimientos?: number }
export interface FormaPago { id: number; nombre: string; cuentaId: number; cuenta: string; tipoCuenta: TipoCuenta; moneda: 'ARS' | 'USD'; listaPrecioId: number | null; lista: string | null; comisionBp: number; orden: number; activo: boolean }
export interface CategoriaGasto { id: number; nombre: string; padreId: number | null; orden: number; activo: boolean }

export const TIPOS_CUENTA: Record<TipoCuenta, string> = {
  efectivo: 'Efectivo', banco: 'Banco', billetera: 'Billetera virtual', a_liquidar: 'Tarjetas a liquidar', externa: 'Externa (la paga otro)',
};
export const NOMBRE_TIPO_CAJA: Record<string, string> = {
  saldo_inicial: 'Saldo inicial', venta: 'Venta', comision: 'Comisión', gasto: 'Gasto', pago_proveedor: 'Pago a proveedor',
  pase: 'Pase', liquidacion: 'Liquidación', aporte: 'Aporte', retiro: 'Retiro personal', ajuste: 'Ajuste', anulacion: 'Anulación',
};

export const useCuentas = (habilitado = true) => useQuery({ queryKey: ['cuentas'], queryFn: () => api.get<Cuenta[]>('/cuentas'), enabled: habilitado });
export const useFormasPago = () => useQuery({ queryKey: ['formas-pago'], queryFn: () => api.get<FormaPago[]>('/formas-pago') });
export const useCategoriasGasto = (habilitado = true) => useQuery({ queryKey: ['categorias-gasto'], queryFn: () => api.get<CategoriaGasto[]>('/gastos/categorias'), enabled: habilitado });

/** Fecha de hoy (AAAA-MM-DD, hora local). */
export const hoy = () => new Date().toLocaleDateString('en-CA');
export const inicioMes = () => hoy().slice(0, 8) + '01';
export const fechaCorta = (f: string | null | undefined) => (f ? new Date(f.slice(0, 10) + 'T12:00').toLocaleDateString('es-AR') : '—');
const usd = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
export const dolares = (c: number | null | undefined) => (c == null ? '—' : usd.format(c / 100));
export const enMoneda = (c: number | null | undefined, moneda: 'ARS' | 'USD', pesos: (c: number | null | undefined) => string) => (moneda === 'USD' ? dolares(c) : pesos(c));

export const queriesPlata = ['cuentas', 'caja', 'ventas', 'venta', 'gastos', 'pagos', 'cuenta-corriente', 'stock', 'resumen-proveedor', 'saldos-proveedores'];
