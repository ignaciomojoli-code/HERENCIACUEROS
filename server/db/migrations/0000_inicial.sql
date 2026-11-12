CREATE TABLE `auditoria` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fecha` text NOT NULL,
	`usuario_id` integer,
	`accion` text NOT NULL,
	`entidad` text NOT NULL,
	`entidad_id` text,
	`antes` text,
	`despues` text,
	`detalle` text,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auditoria_entidad_idx` ON `auditoria` (`entidad`,`entidad_id`);--> statement-breakpoint
CREATE INDEX `auditoria_fecha_idx` ON `auditoria` (`fecha`);--> statement-breakpoint
CREATE TABLE `categorias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`padre_id` integer,
	`orden` integer DEFAULT 0 NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	`creado_en` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categorias_nombre_padre_uq` ON `categorias` (`nombre`,`padre_id`);--> statement-breakpoint
CREATE TABLE `colores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`activo` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `colores_nombre_unique` ON `colores` (`nombre`);--> statement-breakpoint
CREATE TABLE `configuracion` (
	`clave` text PRIMARY KEY NOT NULL,
	`valor` text NOT NULL,
	`actualizado_en` text NOT NULL,
	`actualizado_por` integer,
	FOREIGN KEY (`actualizado_por`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `historial_costos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variante_id` integer NOT NULL,
	`anterior_centavos` integer,
	`nuevo_centavos` integer,
	`fecha` text NOT NULL,
	`usuario_id` integer,
	`origen` text NOT NULL,
	`motivo` text,
	FOREIGN KEY (`variante_id`) REFERENCES `variantes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `historial_costos_variante_idx` ON `historial_costos` (`variante_id`);--> statement-breakpoint
CREATE TABLE `historial_precios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lista_id` integer NOT NULL,
	`variante_id` integer NOT NULL,
	`anterior_centavos` integer,
	`nuevo_centavos` integer,
	`fecha` text NOT NULL,
	`usuario_id` integer,
	`origen` text NOT NULL,
	`motivo` text,
	FOREIGN KEY (`lista_id`) REFERENCES `listas_precio`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variante_id`) REFERENCES `variantes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `historial_precios_variante_idx` ON `historial_precios` (`variante_id`);--> statement-breakpoint
CREATE TABLE `idempotencia` (
	`clave` text PRIMARY KEY NOT NULL,
	`usuario_id` integer,
	`ruta` text NOT NULL,
	`respuesta` text NOT NULL,
	`creado_en` text NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `importaciones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fecha` text NOT NULL,
	`usuario_id` integer,
	`tipo` text NOT NULL,
	`archivo` text NOT NULL,
	`filas_total` integer NOT NULL,
	`creadas` integer NOT NULL,
	`actualizadas` integer NOT NULL,
	`omitidas` integer NOT NULL,
	`detalle` text,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `listas_precio` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`descripcion` text DEFAULT '' NOT NULL,
	`moneda` text DEFAULT 'ARS' NOT NULL,
	`base_lista_id` integer,
	`ajuste_bp` integer,
	`vigente_desde` text,
	`vigente_hasta` text,
	`orden` integer DEFAULT 0 NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listas_precio_nombre_unique` ON `listas_precio` (`nombre`);--> statement-breakpoint
CREATE TABLE `modelos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`descripcion` text,
	`categoria_id` integer NOT NULL,
	`subcategoria_id` integer,
	`genero` text,
	`marca` text,
	`unidad_id` integer,
	`proveedor_id` integer,
	`impuesto_bp` integer,
	`imagen` text,
	`notas` text,
	`activo` integer DEFAULT true NOT NULL,
	`es_demo` integer DEFAULT false NOT NULL,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`categoria_id`) REFERENCES `categorias`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subcategoria_id`) REFERENCES `categorias`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unidad_id`) REFERENCES `unidades`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proveedor_id`) REFERENCES `proveedores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `modelos_nombre_cat_uq` ON `modelos` (`nombre`,`categoria_id`);--> statement-breakpoint
CREATE TABLE `numeradores` (
	`clave` text PRIMARY KEY NOT NULL,
	`ultimo` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `precios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lista_id` integer NOT NULL,
	`variante_id` integer NOT NULL,
	`precio_centavos` integer NOT NULL,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`lista_id`) REFERENCES `listas_precio`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variante_id`) REFERENCES `variantes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `precios_lista_variante_uq` ON `precios` (`lista_id`,`variante_id`);--> statement-breakpoint
CREATE TABLE `proveedores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`razon_social` text,
	`cuit` text,
	`rubro` text,
	`contacto` text,
	`telefono` text,
	`email` text,
	`direccion` text,
	`condiciones` text,
	`plazo_pago_dias` integer,
	`notas` text,
	`estado` text DEFAULT 'activo' NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	`es_demo` integer DEFAULT false NOT NULL,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proveedores_nombre_unique` ON `proveedores` (`nombre`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`descripcion` text DEFAULT '' NOT NULL,
	`permisos` text NOT NULL,
	`es_sistema` integer DEFAULT false NOT NULL,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_nombre_unique` ON `roles` (`nombre`);--> statement-breakpoint
CREATE TABLE `sesiones` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`usuario_id` integer NOT NULL,
	`creada_en` text NOT NULL,
	`expira_en` text NOT NULL,
	`ip` text,
	`user_agent` text,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `talles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`orden` integer DEFAULT 0 NOT NULL,
	`activo` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `talles_nombre_unique` ON `talles` (`nombre`);--> statement-breakpoint
CREATE TABLE `unidades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`codigo` text NOT NULL,
	`nombre` text NOT NULL,
	`activo` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unidades_codigo_unique` ON `unidades` (`codigo`);--> statement-breakpoint
CREATE TABLE `usuarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`usuario` text NOT NULL,
	`nombre` text NOT NULL,
	`password_hash` text NOT NULL,
	`rol_id` integer NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	`debe_cambiar_password` integer DEFAULT false NOT NULL,
	`ultimo_login` text,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`rol_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usuarios_usuario_unique` ON `usuarios` (`usuario`);--> statement-breakpoint
CREATE TABLE `variantes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`modelo_id` integer NOT NULL,
	`sku` text NOT NULL,
	`codigo_barras` text,
	`color_id` integer,
	`talle_id` integer,
	`costo_centavos` integer,
	`costo_logistico_centavos` integer DEFAULT 0 NOT NULL,
	`costo_adicional_centavos` integer DEFAULT 0 NOT NULL,
	`stock_minimo` integer,
	`stock_maximo` integer,
	`notas` text,
	`activo` integer DEFAULT true NOT NULL,
	`es_demo` integer DEFAULT false NOT NULL,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`modelo_id`) REFERENCES `modelos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`color_id`) REFERENCES `colores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`talle_id`) REFERENCES `talles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `variantes_codigo_barras_unique` ON `variantes` (`codigo_barras`);--> statement-breakpoint
CREATE INDEX `variantes_modelo_idx` ON `variantes` (`modelo_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `variantes_sku_uq` ON `variantes` (lower("sku"));