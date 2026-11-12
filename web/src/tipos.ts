export type Accion = 'ver' | 'crear' | 'modificar' | 'aprobar' | 'anular' | 'exportar';
export type Permisos = Record<string, Accion[]>;
export interface Usuario { id: number; usuario: string; nombre: string; rolId: number; rol: string; permisos: Permisos; debeCambiarPassword: boolean }
export interface Lista { id: number; nombre: string; descripcion: string; orden: number; activo: boolean }
export interface Aux {
  categorias: { id: number; nombre: string; padreId: number | null; orden: number; activo: boolean }[];
  colores: { id: number; nombre: string; activo: boolean }[];
  talles: { id: number; nombre: string; orden: number; activo: boolean }[];
  unidades: { id: number; codigo: string; nombre: string }[];
  proveedores: { id: number; nombre: string; activo: boolean; estado: string }[];
  listasPrecio: Lista[];
}
export interface ModeloResumen {
  id: number; nombre: string; activo: boolean; genero: string | null; esDemo: boolean; categoriaId: number; categoria: string;
  subcategoriaId: number | null; proveedor: string | null; variantes: number; costoMin?: number | null; costoMax?: number | null; sinCosto?: number; stock?: number;
  precios: { listaId: number; min: number; max: number }[];
}
export interface Variante {
  id: number; modeloId: number; sku: string; codigoBarras: string | null; colorId: number | null; talleId: number | null;
  color: string | null; talle: string | null; costoCentavos?: number | null; costoLogisticoCentavos?: number; costoAdicionalCentavos?: number;
  stockMinimo: number | null; stockMaximo: number | null; notas: string | null; activo: boolean; esDemo: boolean; precios: Record<string, number>; stock?: number;
}
export interface Modelo {
  id: number; nombre: string; descripcion: string | null; categoriaId: number; subcategoriaId: number | null; genero: 'Hombre' | 'Mujer' | 'Unisex' | null;
  marca: string | null; unidadId: number | null; proveedorId: number | null; impuestoBp: number | null; notas: string | null; activo: boolean; esDemo: boolean;
  variantes: Variante[];
  historialCostos?: { id: number; varianteId: number; fecha: string; anteriorCentavos: number | null; nuevoCentavos: number | null; origen: string; motivo: string | null }[];
  historialPrecios: { id: number; varianteId: number; listaId: number; fecha: string; anteriorCentavos: number | null; nuevoCentavos: number | null; origen: string; motivo: string | null }[];
}

export interface VarianteBuscada { varianteId: number; sku: string; codigoBarras: string | null; modelo: string; color: string | null; talle: string | null; costoCentavos?: number | null; proveedorId: number | null; exacto: boolean; stock: number }
export interface FilaStock { varianteId: number; sku: string; modeloId: number; modelo: string; categoria: string; color: string | null; talle: string | null; stock: number; stockMinimo: number | null; stockMaximo: number | null; costoCentavos?: number | null; precioCentavos: number | null }
export interface Movimiento { id: number; fecha: string; varianteId: number; cantidad: number; tipo: string; costoUnitarioCentavos?: number | null; refTipo: string | null; refId: number | null; anulaId: number | null; motivo: string | null; usuarioId: number | null; saldo?: number; sku?: string; modelo?: string; modeloId?: number }
export const NOMBRE_MOVIMIENTO: Record<string, string> = {
  inicial: 'Stock inicial', compra: 'Recepción de compra', ajuste: 'Ajuste', conteo: 'Conteo físico', venta: 'Venta',
  devolucion: 'Devolución', produccion: 'Producción', anulacion: 'Anulación',
};
export const describirVariante = (v: { modelo?: string; color?: string | null; talle?: string | null }) =>
  [v.modelo, v.color, v.talle && `talle ${v.talle}`].filter(Boolean).join(' · ');
