/**
 * Esquema de la base de datos (SQLite vía Drizzle).
 *
 * Convenciones:
 * - Importes de dinero: enteros en CENTAVOS (sufijo `Centavos`). Nunca float.
 * - Porcentajes: enteros en puntos básicos (1% = 100) (sufijo `Bp`).
 * - Fechas: texto ISO 8601 (UTC) generado por la aplicación.
 * - Nada se borra físicamente: las entidades tienen `activo` y las operaciones `estado`.
 * - `esDemo` marca datos de demostración, que se pueden borrar sin tocar los reales.
 */
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

const id = () => integer('id').primaryKey({ autoIncrement: true });
const creadoEn = () => text('creado_en').notNull();
const actualizadoEn = () => text('actualizado_en').notNull();
const activo = () => integer('activo', { mode: 'boolean' }).notNull().default(true);
const esDemo = () => integer('es_demo', { mode: 'boolean' }).notNull().default(false);

// ───────────────────────── Sistema ─────────────────────────

export const roles = sqliteTable('roles', {
  id: id(),
  nombre: text('nombre').notNull().unique(),
  descripcion: text('descripcion').notNull().default(''),
  /** JSON: { [modulo]: Accion[] } */
  permisos: text('permisos', { mode: 'json' }).$type<Record<string, string[]>>().notNull(),
  esSistema: integer('es_sistema', { mode: 'boolean' }).notNull().default(false),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
});

export const usuarios = sqliteTable('usuarios', {
  id: id(),
  usuario: text('usuario').notNull().unique(),
  nombre: text('nombre').notNull(),
  passwordHash: text('password_hash').notNull(),
  rolId: integer('rol_id').notNull().references(() => roles.id),
  activo: activo(),
  debeCambiarPassword: integer('debe_cambiar_password', { mode: 'boolean' }).notNull().default(false),
  ultimoLogin: text('ultimo_login'),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
});

export const sesiones = sqliteTable('sesiones', {
  /** SHA-256 del token; el token en claro solo vive en la cookie. */
  tokenHash: text('token_hash').primaryKey(),
  usuarioId: integer('usuario_id').notNull().references(() => usuarios.id),
  creadaEn: text('creada_en').notNull(),
  expiraEn: text('expira_en').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
});

export const auditoria = sqliteTable('auditoria', {
  id: id(),
  fecha: text('fecha').notNull(),
  usuarioId: integer('usuario_id').references(() => usuarios.id),
  accion: text('accion').notNull(),
  entidad: text('entidad').notNull(),
  entidadId: text('entidad_id'),
  antes: text('antes', { mode: 'json' }),
  despues: text('despues', { mode: 'json' }),
  detalle: text('detalle'),
}, (t) => [index('auditoria_entidad_idx').on(t.entidad, t.entidadId), index('auditoria_fecha_idx').on(t.fecha)]);

export const configuracion = sqliteTable('configuracion', {
  clave: text('clave').primaryKey(),
  valor: text('valor', { mode: 'json' }).notNull(),
  actualizadoEn: actualizadoEn(),
  actualizadoPor: integer('actualizado_por').references(() => usuarios.id),
});

export const numeradores = sqliteTable('numeradores', {
  clave: text('clave').primaryKey(),
  ultimo: integer('ultimo').notNull().default(0),
});

export const idempotencia = sqliteTable('idempotencia', {
  clave: text('clave').primaryKey(),
  usuarioId: integer('usuario_id').references(() => usuarios.id),
  ruta: text('ruta').notNull(),
  respuesta: text('respuesta', { mode: 'json' }).notNull(),
  creadoEn: creadoEn(),
});

export const importaciones = sqliteTable('importaciones', {
  id: id(),
  fecha: text('fecha').notNull(),
  usuarioId: integer('usuario_id').references(() => usuarios.id),
  tipo: text('tipo').notNull(),
  archivo: text('archivo').notNull(),
  filasTotal: integer('filas_total').notNull(),
  creadas: integer('creadas').notNull(),
  actualizadas: integer('actualizadas').notNull(),
  omitidas: integer('omitidas').notNull(),
  detalle: text('detalle', { mode: 'json' }),
});

// ───────────────────────── Catálogo ─────────────────────────

export const categorias = sqliteTable('categorias', {
  id: id(),
  nombre: text('nombre').notNull(),
  /** null = categoría; con valor = subcategoría de esa categoría */
  padreId: integer('padre_id'),
  orden: integer('orden').notNull().default(0),
  activo: activo(),
  creadoEn: creadoEn(),
}, (t) => [uniqueIndex('categorias_nombre_padre_uq').on(t.nombre, t.padreId)]);

export const colores = sqliteTable('colores', {
  id: id(),
  nombre: text('nombre').notNull().unique(),
  activo: activo(),
});

export const talles = sqliteTable('talles', {
  id: id(),
  nombre: text('nombre').notNull().unique(),
  orden: integer('orden').notNull().default(0),
  activo: activo(),
});

export const unidades = sqliteTable('unidades', {
  id: id(),
  codigo: text('codigo').notNull().unique(),
  nombre: text('nombre').notNull(),
  activo: activo(),
});

export const proveedores = sqliteTable('proveedores', {
  id: id(),
  nombre: text('nombre').notNull().unique(),
  razonSocial: text('razon_social'),
  cuit: text('cuit'),
  rubro: text('rubro'),
  contacto: text('contacto'),
  telefono: text('telefono'),
  email: text('email'),
  direccion: text('direccion'),
  condiciones: text('condiciones'),
  plazoPagoDias: integer('plazo_pago_dias'),
  notas: text('notas'),
  /** 'prospecto' = relevado pero sin compras todavía */
  estado: text('estado', { enum: ['activo', 'prospecto'] }).notNull().default('activo'),
  activo: activo(),
  esDemo: esDemo(),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
});

export const modelos = sqliteTable('modelos', {
  id: id(),
  nombre: text('nombre').notNull(),
  descripcion: text('descripcion'),
  categoriaId: integer('categoria_id').notNull().references(() => categorias.id),
  subcategoriaId: integer('subcategoria_id').references(() => categorias.id),
  genero: text('genero', { enum: ['Hombre', 'Mujer', 'Unisex'] }),
  marca: text('marca'),
  unidadId: integer('unidad_id').references(() => unidades.id),
  proveedorId: integer('proveedor_id').references(() => proveedores.id),
  /** Alícuota de impuesto aplicable, en puntos básicos (2100 = 21%). null = no aplica / pendiente. */
  impuestoBp: integer('impuesto_bp'),
  imagen: text('imagen'),
  notas: text('notas'),
  activo: activo(),
  esDemo: esDemo(),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
}, (t) => [uniqueIndex('modelos_nombre_cat_uq').on(t.nombre, t.categoriaId)]);

export const variantes = sqliteTable('variantes', {
  id: id(),
  modeloId: integer('modelo_id').notNull().references(() => modelos.id),
  /** Código interno / SKU: el código que ya usa el negocio (ej. CSEN8). */
  sku: text('sku').notNull(),
  codigoBarras: text('codigo_barras').unique(),
  colorId: integer('color_id').references(() => colores.id),
  talleId: integer('talle_id').references(() => talles.id),
  /** Costo unitario vigente en centavos. null = pendiente de cargar. */
  costoCentavos: integer('costo_centavos'),
  costoLogisticoCentavos: integer('costo_logistico_centavos').notNull().default(0),
  costoAdicionalCentavos: integer('costo_adicional_centavos').notNull().default(0),
  stockMinimo: integer('stock_minimo'),
  stockMaximo: integer('stock_maximo'),
  notas: text('notas'),
  activo: activo(),
  esDemo: esDemo(),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
}, (t) => [
  index('variantes_modelo_idx').on(t.modeloId),
  // El SKU es único sin distinguir mayúsculas: "acc-003" y "ACC-003" son el mismo producto.
  uniqueIndex('variantes_sku_uq').on(sql`lower(${t.sku})`),
]);

export const historialCostos = sqliteTable('historial_costos', {
  id: id(),
  varianteId: integer('variante_id').notNull().references(() => variantes.id),
  anteriorCentavos: integer('anterior_centavos'),
  nuevoCentavos: integer('nuevo_centavos'),
  fecha: text('fecha').notNull(),
  usuarioId: integer('usuario_id').references(() => usuarios.id),
  origen: text('origen').notNull(),
  motivo: text('motivo'),
}, (t) => [index('historial_costos_variante_idx').on(t.varianteId)]);

// ───────────────────────── Precios ─────────────────────────

export const listasPrecio = sqliteTable('listas_precio', {
  id: id(),
  nombre: text('nombre').notNull().unique(),
  descripcion: text('descripcion').notNull().default(''),
  moneda: text('moneda').notNull().default('ARS'),
  /** Si se define, el precio sugerido de esta lista se deriva de otra lista con un ajuste porcentual. */
  baseListaId: integer('base_lista_id'),
  ajusteBp: integer('ajuste_bp'),
  vigenteDesde: text('vigente_desde'),
  vigenteHasta: text('vigente_hasta'),
  orden: integer('orden').notNull().default(0),
  activo: activo(),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
});

export const precios = sqliteTable('precios', {
  id: id(),
  listaId: integer('lista_id').notNull().references(() => listasPrecio.id),
  varianteId: integer('variante_id').notNull().references(() => variantes.id),
  precioCentavos: integer('precio_centavos').notNull(),
  actualizadoEn: actualizadoEn(),
}, (t) => [uniqueIndex('precios_lista_variante_uq').on(t.listaId, t.varianteId)]);

export const historialPrecios = sqliteTable('historial_precios', {
  id: id(),
  listaId: integer('lista_id').notNull().references(() => listasPrecio.id),
  varianteId: integer('variante_id').notNull().references(() => variantes.id),
  anteriorCentavos: integer('anterior_centavos'),
  nuevoCentavos: integer('nuevo_centavos'),
  fecha: text('fecha').notNull(),
  usuarioId: integer('usuario_id').references(() => usuarios.id),
  origen: text('origen').notNull(),
  motivo: text('motivo'),
}, (t) => [index('historial_precios_variante_idx').on(t.varianteId)]);
