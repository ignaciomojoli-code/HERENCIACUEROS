/**
 * Módulos, acciones y roles por defecto. Los roles se guardan en la base y se pueden editar;
 * estos valores solo se usan para crear los roles la primera vez.
 */
export const ACCIONES = ['ver', 'crear', 'modificar', 'aprobar', 'anular', 'exportar'] as const;
export type Accion = (typeof ACCIONES)[number];

export const MODULOS = {
  panel: 'Panel',
  catalogo: 'Catálogo de productos',
  costos: 'Costos (ver costos y ganancias)',
  precios: 'Listas de precios',
  proveedores: 'Proveedores',
  stock: 'Stock, ajustes y conteos',
  compras: 'Compras y recepciones',
  importacion: 'Importación de datos',
  usuarios: 'Usuarios y roles',
  configuracion: 'Configuración',
  auditoria: 'Auditoría',
  backups: 'Backups',
} as const;
export type Modulo = keyof typeof MODULOS;

export type MapaPermisos = Partial<Record<Modulo, Accion[]>>;

const todo = (): Accion[] => [...ACCIONES];
const lectura: Accion[] = ['ver'];

function completo(): MapaPermisos {
  return Object.fromEntries(Object.keys(MODULOS).map((m) => [m, todo()])) as MapaPermisos;
}

export const ROLES_POR_DEFECTO: { nombre: string; descripcion: string; permisos: MapaPermisos }[] = [
  { nombre: 'Administrador', descripcion: 'Acceso total, incluidos usuarios, configuración y backups', permisos: completo() },
  {
    nombre: 'Gerencia',
    descripcion: 'Todo lo operativo y los reportes; aprueba precios y anulaciones',
    permisos: {
      panel: todo(), catalogo: todo(), costos: todo(), precios: todo(), proveedores: todo(), stock: todo(), compras: todo(),
      importacion: todo(), auditoria: ['ver', 'exportar'], configuracion: ['ver'], backups: ['ver'],
    },
  },
  {
    nombre: 'Administración',
    descripcion: 'Caja, gastos, pagos y cuentas corrientes; no cambia precios',
    permisos: { panel: lectura, catalogo: ['ver', 'exportar'], costos: ['ver'], precios: ['ver', 'exportar'], proveedores: ['ver', 'crear', 'modificar', 'exportar'], stock: ['ver', 'exportar'], compras: ['ver', 'exportar'] },
  },
  {
    nombre: 'Ventas',
    descripcion: 'Registra ventas y cobros; ve precios y stock, no ve costos ni ganancia',
    permisos: { catalogo: ['ver'], precios: ['ver'], stock: ['ver'] },
  },
  {
    nombre: 'Depósito',
    descripcion: 'Recepciones, entregas del taller, ajustes y conteos; no ve plata',
    permisos: { catalogo: ['ver', 'crear', 'modificar'], proveedores: ['ver'], stock: ['ver', 'crear', 'modificar', 'exportar'], compras: ['ver', 'crear'] },
  },
  {
    nombre: 'Compras',
    descripcion: 'Proveedores, órdenes de compra, facturas y costos',
    permisos: { catalogo: ['ver', 'crear', 'modificar', 'exportar'], costos: ['ver', 'modificar'], precios: ['ver'], proveedores: todo(), stock: ['ver', 'exportar'], compras: todo(), importacion: ['ver', 'crear'] },
  },
  { nombre: 'Consulta', descripcion: 'Solo lectura', permisos: { panel: lectura, catalogo: lectura, precios: lectura, proveedores: lectura, stock: lectura, compras: lectura } },
];

/**
 * Módulos que se agregaron después de la primera versión. Al actualizar el sistema, los roles por defecto
 * reciben los permisos de estos módulos (los roles creados a mano no se tocan).
 */
export const MODULOS_POR_VERSION: Record<number, Modulo[]> = { 2: ['stock', 'compras'] };
export const VERSION_PERMISOS = 2;

export function tienePermiso(permisos: MapaPermisos | Record<string, string[]>, modulo: Modulo, accion: Accion): boolean {
  const acc = (permisos as Record<string, string[]>)[modulo];
  return Array.isArray(acc) && acc.includes(accion);
}

/** Valida y normaliza un mapa de permisos que llega de la interfaz. */
export function normalizarPermisos(entrada: Record<string, unknown>): MapaPermisos {
  const salida: MapaPermisos = {};
  for (const [m, acciones] of Object.entries(entrada)) {
    if (!(m in MODULOS) || !Array.isArray(acciones)) continue;
    const validas = acciones.filter((a): a is Accion => (ACCIONES as readonly string[]).includes(a as string));
    if (validas.length) salida[m as Modulo] = [...new Set(validas)];
  }
  return salida;
}
