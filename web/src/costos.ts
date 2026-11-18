/** Tipos y utilidades compartidas de materiales, recetas, costeo y precios sugeridos. */
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type Unidad = 'm' | 'u' | 'par' | 'kg';
export const UNIDADES: Record<Unidad, string> = { m: 'metros', u: 'unidades', par: 'pares', kg: 'kilos' };

export interface Material {
  id: number; codigo: string; nombre: string; unidad: Unidad; tipo: 'material' | 'mano_obra'; costoCentavos?: number | null;
  proveedorId: number | null; proveedor: string | null; stockMinimoMil: number | null; notas: string | null; activo: boolean;
  stockMil: number | null; modelosQueLoUsan: number;
  clasificacion: ClasificacionMaterial | null;
  /** Se controla por color (ej. el cuero). */
  porColor: boolean;
  stockColores?: { colorId: number | null; color: string; cantidadMil: number }[];
}
export const CLASIF_MATERIAL = { materia_prima: 'Materia prima', material_produccion: 'Material de producción', insumo: 'Insumo', otro: 'Otro' } as const;
export type ClasificacionMaterial = keyof typeof CLASIF_MATERIAL;
export interface MovMaterial {
  id: number; fecha: string; tipo: 'inicial' | 'compra' | 'ajuste' | 'produccion' | 'anulacion' | 'traslado'; cantidadMil: number; costoUnitarioCentavos?: number | null;
  proveedor: string | null; comprobante: string | null; motivo: string | null; anulaId: number | null; anulado: boolean; saldoMil: number; ubicacion?: string;
  colorId?: number | null; color?: string | null;
}
export interface DetalleMaterial extends Material {
  movimientos: MovMaterial[];
  ubicaciones?: { ubicacionProveedorId: number | null; ubicacion: string; cantidadMil: number }[];
  stockColores?: { colorId: number | null; color: string; ubicacionProveedorId: number | null; ubicacion: string; cantidadMil: number }[];
  historial?: { id: number; anteriorCentavos: number | null; nuevoCentavos: number | null; fecha: string; origen: string; motivo: string | null }[];
  usadoEn: { modeloId: number; modelo: string; cantidadMil: number; talles: string[] | null }[];
}
export interface LineaReceta { id?: number; materialId: number; cantidadMil: number; talles: string[] | null; notas?: string | null; codigo?: string; material?: string; unidad?: Unidad; tipoMaterial?: string; costoUnidadCentavos?: number | null }
export interface FilaCosteo {
  varianteId: number; sku: string; talle: string | null; materialesCentavos: number; manoObraCentavos: number; adicionalCentavos: number; componentes: { nombre: string; centavos: number }[];
  calculadoCentavos: number; totalCalculadoCentavos: number; actualCentavos: number | null; actualAdicionalCentavos: number; totalActualCentavos: number | null;
  pendientes: string[]; agregados: string[]; cambia: boolean;
}
export interface ModeloCosteo { modeloId: number; modelo: string; categoria: string; lineasReceta: number; variantes: FilaCosteo[] }
export interface Componente { id: string; nombre: string; tipo: 'fijo' | 'porcentaje_costo' | 'porcentaje_precio'; valor: number; categoriaId: number | null; activo: boolean }
export const TIPOS_COMPONENTE: Record<Componente['tipo'], string> = { fijo: 'Monto fijo por prenda', porcentaje_costo: '% sobre el costo', porcentaje_precio: '% sobre el precio de venta' };
export const TIPOS_MOV: Record<MovMaterial['tipo'], string> = { inicial: 'Stock inicial', compra: 'Compra', ajuste: 'Ajuste', produccion: 'Producción', anulacion: 'Anulación', traslado: 'Entrega' };

/** Cantidades en milésimas → texto ("1,5"). */
export const cant = (mil: number | null | undefined) => (mil == null ? '—' : (mil / 1000).toLocaleString('es-AR', { maximumFractionDigits: 3 }));
/** Texto ("1,5") → milésimas, o NaN. */
export const leerCant = (t: string) => {
  const s = t.trim().includes(',') ? t.trim().replace(/\./g, '').replace(',', '.') : t.trim();
  return s === '' ? NaN : Math.round(Number(s) * 1000);
};

export const useMateriales = (habilitado = true) => useQuery({ queryKey: ['materiales'], queryFn: () => api.get<Material[]>('/materiales'), enabled: habilitado });

/** Colores del catálogo (los mismos de las camperas): se usan en los materiales que van por color. */
export const useColores = () => useQuery({ queryKey: ['aux'], queryFn: () => api.get<{ colores: { id: number; nombre: string; activo: boolean }[] }>('/catalogo/aux'), staleTime: 60_000, select: (a) => a.colores });

/** Nombre de un material con su color, si va por color. */
export const conColor = (nombre: string, color?: string | null) => (color ? `${nombre} · ${color}` : nombre);
