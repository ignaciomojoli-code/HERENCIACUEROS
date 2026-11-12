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
  /** Documento que originó el cambio (ej. 'recepcion', 12), para poder revertirlo al anular. */
  refTipo: text('ref_tipo'),
  refId: integer('ref_id'),
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

// ───────────────────────── Stock ─────────────────────────

/**
 * Libro de movimientos de stock. Solo se agregan filas: nunca se modifican ni se borran.
 * El stock de una variante es la suma de sus movimientos. Anular algo agrega el movimiento contrario.
 */
export const movimientosStock = sqliteTable('movimientos_stock', {
  id: id(),
  fecha: text('fecha').notNull(),
  varianteId: integer('variante_id').notNull().references(() => variantes.id),
  /** Positivo entra, negativo sale. */
  cantidad: integer('cantidad').notNull(),
  tipo: text('tipo', { enum: ['inicial', 'compra', 'ajuste', 'conteo', 'venta', 'devolucion', 'produccion', 'anulacion'] }).notNull(),
  /** Costo unitario al momento del movimiento (para valorizar). */
  costoUnitarioCentavos: integer('costo_unitario_centavos'),
  refTipo: text('ref_tipo'),
  refId: integer('ref_id'),
  /** Si este movimiento compensa a otro (anulación), cuál. */
  anulaId: integer('anula_id'),
  motivo: text('motivo'),
  usuarioId: integer('usuario_id').references(() => usuarios.id),
  creadoEn: creadoEn(),
}, (t) => [index('mov_stock_variante_idx').on(t.varianteId), index('mov_stock_fecha_idx').on(t.fecha), index('mov_stock_ref_idx').on(t.refTipo, t.refId)]);

/** Conteo físico de inventario: se carga lo contado y al aplicarlo se generan los ajustes. */
export const conteos = sqliteTable('conteos', {
  id: id(),
  numero: integer('numero').notNull().unique(),
  fecha: text('fecha').notNull(),
  categoriaId: integer('categoria_id').references(() => categorias.id),
  estado: text('estado', { enum: ['abierto', 'aplicado', 'descartado'] }).notNull().default('abierto'),
  notas: text('notas'),
  usuarioId: integer('usuario_id').references(() => usuarios.id),
  aplicadoEn: text('aplicado_en'),
  aplicadoPor: integer('aplicado_por').references(() => usuarios.id),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
});
export const conteoItems = sqliteTable('conteo_items', {
  id: id(),
  conteoId: integer('conteo_id').notNull().references(() => conteos.id),
  varianteId: integer('variante_id').notNull().references(() => variantes.id),
  contado: integer('contado').notNull(),
  /** Stock del sistema al aplicar (se guarda para que la diferencia quede documentada). */
  esperado: integer('esperado'),
  actualizadoEn: actualizadoEn(),
}, (t) => [uniqueIndex('conteo_items_uq').on(t.conteoId, t.varianteId)]);

// ───────────────────────── Compras ─────────────────────────

/**
 * Pedido a un proveedor o taller. 'reventa' = se compra el producto terminado (su costo actualiza el costo promedio).
 * 'confeccion' = se paga la mano de obra a un taller (ej. Laura): entra stock, pero el costo del producto
 * sale de materiales + confección (módulo de producción), así que no pisa el costo.
 */
export const compras = sqliteTable('compras', {
  id: id(),
  numero: integer('numero').notNull().unique(),
  proveedorId: integer('proveedor_id').notNull().references(() => proveedores.id),
  tipo: text('tipo', { enum: ['reventa', 'confeccion'] }).notNull().default('reventa'),
  fecha: text('fecha').notNull(),
  fechaEsperada: text('fecha_esperada'),
  estado: text('estado', { enum: ['borrador', 'confirmada', 'cerrada', 'anulada'] }).notNull().default('borrador'),
  notas: text('notas'),
  usuarioId: integer('usuario_id').references(() => usuarios.id),
  esDemo: esDemo(),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
}, (t) => [index('compras_proveedor_idx').on(t.proveedorId)]);
export const compraItems = sqliteTable('compra_items', {
  id: id(),
  compraId: integer('compra_id').notNull().references(() => compras.id),
  varianteId: integer('variante_id').notNull().references(() => variantes.id),
  cantidad: integer('cantidad').notNull(),
  costoUnitarioCentavos: integer('costo_unitario_centavos').notNull(),
  notas: text('notas'),
}, (t) => [index('compra_items_compra_idx').on(t.compraId)]);

/** Lo que efectivamente entregó el proveedor (puede ser una parte del pedido). Suma stock. */
export const recepciones = sqliteTable('recepciones', {
  id: id(),
  numero: integer('numero').notNull().unique(),
  compraId: integer('compra_id').notNull().references(() => compras.id),
  fecha: text('fecha').notNull(),
  comprobante: text('comprobante'),
  notas: text('notas'),
  estado: text('estado', { enum: ['activa', 'anulada'] }).notNull().default('activa'),
  motivoAnulacion: text('motivo_anulacion'),
  usuarioId: integer('usuario_id').references(() => usuarios.id),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
});
export const recepcionItems = sqliteTable('recepcion_items', {
  id: id(),
  recepcionId: integer('recepcion_id').notNull().references(() => recepciones.id),
  compraItemId: integer('compra_item_id').notNull().references(() => compraItems.id),
  varianteId: integer('variante_id').notNull().references(() => variantes.id),
  cantidad: integer('cantidad').notNull(),
  costoUnitarioCentavos: integer('costo_unitario_centavos').notNull(),
}, (t) => [index('recepcion_items_rec_idx').on(t.recepcionId)]);

// ───────────────────────── Plata: cuentas y caja ─────────────────────────

/**
 * Dónde está la plata: efectivo, Mercado Pago, Cuenta DNI, tarjetas a liquidar, dólares.
 * 'a_liquidar' = lo cobrado con tarjeta que todavía no llegó; 'externa' = pagos que hace alguien de afuera
 * (ej. el inversor externo): todo lo que se paga desde ahí entra antes como aporte, así que su saldo es siempre 0.
 */
export const cuentas = sqliteTable('cuentas', {
  id: id(),
  nombre: text('nombre').notNull().unique(),
  tipo: text('tipo', { enum: ['efectivo', 'banco', 'billetera', 'a_liquidar', 'externa'] }).notNull(),
  moneda: text('moneda', { enum: ['ARS', 'USD'] }).notNull().default('ARS'),
  orden: integer('orden').notNull().default(0),
  activo: activo(),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
});

/** Formas de cobro (efectivo, transferencia, débito, crédito en cuotas…): a qué cuenta entra la plata, con qué lista de precios y qué comisión se estima. */
export const formasPago = sqliteTable('formas_pago', {
  id: id(),
  nombre: text('nombre').notNull().unique(),
  cuentaId: integer('cuenta_id').notNull().references(() => cuentas.id),
  listaPrecioId: integer('lista_precio_id').references(() => listasPrecio.id),
  /** Comisión + IVA + retenciones estimadas, en puntos básicos. */
  comisionBp: integer('comision_bp').notNull().default(0),
  orden: integer('orden').notNull().default(0),
  activo: activo(),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
});

/**
 * Libro de caja: cada entrada o salida de plata de una cuenta. Solo se agregan filas.
 * El saldo de una cuenta es la suma de sus movimientos; anular agrega el movimiento contrario.
 * `importeCentavos` va en la moneda de la cuenta; `importeArsCentavos` es su equivalente en pesos.
 */
export const movimientosCaja = sqliteTable('movimientos_caja', {
  id: id(),
  fecha: text('fecha').notNull(),
  cuentaId: integer('cuenta_id').notNull().references(() => cuentas.id),
  importeCentavos: integer('importe_centavos').notNull(),
  importeArsCentavos: integer('importe_ars_centavos').notNull(),
  tipo: text('tipo', {
    enum: ['saldo_inicial', 'venta', 'comision', 'gasto', 'pago_proveedor', 'pase', 'liquidacion', 'aporte', 'retiro', 'ajuste', 'anulacion'],
  }).notNull(),
  concepto: text('concepto').notNull(),
  refTipo: text('ref_tipo'),
  refId: integer('ref_id'),
  /** Agrupa los movimientos de una misma operación (ej. las dos patas de un pase). */
  grupo: text('grupo'),
  anulaId: integer('anula_id'),
  usuarioId: integer('usuario_id').references(() => usuarios.id),
  esDemo: esDemo(),
  creadoEn: creadoEn(),
}, (t) => [index('mov_caja_cuenta_idx').on(t.cuentaId), index('mov_caja_fecha_idx').on(t.fecha), index('mov_caja_ref_idx').on(t.refTipo, t.refId), index('mov_caja_grupo_idx').on(t.grupo)]);

/** Arqueo: lo que se contó en una cuenta contra lo que dice el sistema. La diferencia queda como ajuste. */
export const arqueos = sqliteTable('arqueos', {
  id: id(),
  fecha: text('fecha').notNull(),
  cuentaId: integer('cuenta_id').notNull().references(() => cuentas.id),
  saldoSistemaCentavos: integer('saldo_sistema_centavos').notNull(),
  saldoRealCentavos: integer('saldo_real_centavos').notNull(),
  notas: text('notas'),
  usuarioId: integer('usuario_id').references(() => usuarios.id),
  creadoEn: creadoEn(),
});

// ───────────────────────── Ventas ─────────────────────────

export const ventas = sqliteTable('ventas', {
  id: id(),
  numero: integer('numero').notNull().unique(),
  fecha: text('fecha').notNull(),
  cliente: text('cliente'),
  /** Lista con la que se armaron los precios (efectivo o tarjeta). */
  listaPrecioId: integer('lista_precio_id').references(() => listasPrecio.id),
  estado: text('estado', { enum: ['confirmada', 'anulada'] }).notNull().default('confirmada'),
  notas: text('notas'),
  motivoAnulacion: text('motivo_anulacion'),
  usuarioId: integer('usuario_id').references(() => usuarios.id),
  esDemo: esDemo(),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
}, (t) => [index('ventas_fecha_idx').on(t.fecha)]);

export const ventaItems = sqliteTable('venta_items', {
  id: id(),
  ventaId: integer('venta_id').notNull().references(() => ventas.id),
  varianteId: integer('variante_id').notNull().references(() => variantes.id),
  cantidad: integer('cantidad').notNull(),
  /** Precio de lista al momento de vender (para medir descuentos). null = no tenía precio cargado. */
  precioListaCentavos: integer('precio_lista_centavos'),
  /** Lo que se cobró por unidad. */
  precioCentavos: integer('precio_centavos').notNull(),
  /** Costo unitario al momento de vender (foto, para la ganancia). null = costo pendiente. */
  costoUnitarioCentavos: integer('costo_unitario_centavos'),
}, (t) => [index('venta_items_venta_idx').on(t.ventaId), index('venta_items_variante_idx').on(t.varianteId)]);

/** Cobros de una venta: puede pagarse con más de una forma (ej. parte efectivo y parte tarjeta). */
export const ventaPagos = sqliteTable('venta_pagos', {
  id: id(),
  ventaId: integer('venta_id').notNull().references(() => ventas.id),
  formaPagoId: integer('forma_pago_id').notNull().references(() => formasPago.id),
  cuentaId: integer('cuenta_id').notNull().references(() => cuentas.id),
  /** Equivalente en pesos (lo que cancela de la venta). */
  importeCentavos: integer('importe_centavos').notNull(),
  /** Si se cobró en otra moneda: el importe en esa moneda (centavos de USD). */
  importeMonedaCentavos: integer('importe_moneda_centavos'),
  comisionEstimadaCentavos: integer('comision_estimada_centavos').notNull().default(0),
  /** Comisión real, si se conoce (ej. al ver la liquidación). null = se usa la estimada. */
  comisionRealCentavos: integer('comision_real_centavos'),
}, (t) => [index('venta_pagos_venta_idx').on(t.ventaId)]);

// ───────────────────────── Gastos ─────────────────────────

/** Categorías de gastos con subcategorías (padreId). */
export const categoriasGasto = sqliteTable('categorias_gasto', {
  id: id(),
  nombre: text('nombre').notNull(),
  padreId: integer('padre_id'),
  orden: integer('orden').notNull().default(0),
  activo: activo(),
  creadoEn: creadoEn(),
}, (t) => [uniqueIndex('categorias_gasto_nombre_padre_uq').on(t.nombre, sql`coalesce(${t.padreId}, 0)`)]);

export const gastos = sqliteTable('gastos', {
  id: id(),
  numero: integer('numero').notNull().unique(),
  fecha: text('fecha').notNull(),
  concepto: text('concepto').notNull(),
  categoriaId: integer('categoria_id').notNull().references(() => categoriasGasto.id),
  subcategoriaId: integer('subcategoria_id').references(() => categoriasGasto.id),
  importeCentavos: integer('importe_centavos').notNull(),
  cuentaId: integer('cuenta_id').notNull().references(() => cuentas.id),
  proveedorId: integer('proveedor_id').references(() => proveedores.id),
  comprobante: text('comprobante'),
  notas: text('notas'),
  estado: text('estado', { enum: ['activo', 'anulado'] }).notNull().default('activo'),
  motivoAnulacion: text('motivo_anulacion'),
  usuarioId: integer('usuario_id').references(() => usuarios.id),
  esDemo: esDemo(),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
}, (t) => [index('gastos_fecha_idx').on(t.fecha), index('gastos_categoria_idx').on(t.categoriaId)]);

// ───────────────────────── Pagos a proveedores ─────────────────────────

export const pagosProveedor = sqliteTable('pagos_proveedor', {
  id: id(),
  numero: integer('numero').notNull().unique(),
  fecha: text('fecha').notNull(),
  proveedorId: integer('proveedor_id').notNull().references(() => proveedores.id),
  compraId: integer('compra_id').references(() => compras.id),
  cuentaId: integer('cuenta_id').notNull().references(() => cuentas.id),
  importeCentavos: integer('importe_centavos').notNull(),
  comprobante: text('comprobante'),
  notas: text('notas'),
  estado: text('estado', { enum: ['activo', 'anulado'] }).notNull().default('activo'),
  motivoAnulacion: text('motivo_anulacion'),
  usuarioId: integer('usuario_id').references(() => usuarios.id),
  esDemo: esDemo(),
  creadoEn: creadoEn(),
  actualizadoEn: actualizadoEn(),
}, (t) => [index('pagos_proveedor_prov_idx').on(t.proveedorId)]);
