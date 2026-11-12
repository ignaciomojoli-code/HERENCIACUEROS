CREATE TABLE `arqueos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fecha` text NOT NULL,
	`cuenta_id` integer NOT NULL,
	`saldo_sistema_centavos` integer NOT NULL,
	`saldo_real_centavos` integer NOT NULL,
	`notas` text,
	`usuario_id` integer,
	`creado_en` text NOT NULL,
	FOREIGN KEY (`cuenta_id`) REFERENCES `cuentas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `categorias_gasto` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`padre_id` integer,
	`orden` integer DEFAULT 0 NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	`creado_en` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categorias_gasto_nombre_padre_uq` ON `categorias_gasto` (`nombre`, coalesce(`padre_id`, 0));--> statement-breakpoint
CREATE TABLE `cuentas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`tipo` text NOT NULL,
	`moneda` text DEFAULT 'ARS' NOT NULL,
	`orden` integer DEFAULT 0 NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cuentas_nombre_unique` ON `cuentas` (`nombre`);--> statement-breakpoint
CREATE TABLE `formas_pago` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`cuenta_id` integer NOT NULL,
	`lista_precio_id` integer,
	`comision_bp` integer DEFAULT 0 NOT NULL,
	`orden` integer DEFAULT 0 NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`cuenta_id`) REFERENCES `cuentas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lista_precio_id`) REFERENCES `listas_precio`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `formas_pago_nombre_unique` ON `formas_pago` (`nombre`);--> statement-breakpoint
CREATE TABLE `gastos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`numero` integer NOT NULL,
	`fecha` text NOT NULL,
	`concepto` text NOT NULL,
	`categoria_id` integer NOT NULL,
	`subcategoria_id` integer,
	`importe_centavos` integer NOT NULL,
	`cuenta_id` integer NOT NULL,
	`proveedor_id` integer,
	`comprobante` text,
	`notas` text,
	`estado` text DEFAULT 'activo' NOT NULL,
	`motivo_anulacion` text,
	`usuario_id` integer,
	`es_demo` integer DEFAULT false NOT NULL,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`categoria_id`) REFERENCES `categorias_gasto`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subcategoria_id`) REFERENCES `categorias_gasto`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cuenta_id`) REFERENCES `cuentas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proveedor_id`) REFERENCES `proveedores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gastos_numero_unique` ON `gastos` (`numero`);--> statement-breakpoint
CREATE INDEX `gastos_fecha_idx` ON `gastos` (`fecha`);--> statement-breakpoint
CREATE INDEX `gastos_categoria_idx` ON `gastos` (`categoria_id`);--> statement-breakpoint
CREATE TABLE `movimientos_caja` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fecha` text NOT NULL,
	`cuenta_id` integer NOT NULL,
	`importe_centavos` integer NOT NULL,
	`importe_ars_centavos` integer NOT NULL,
	`tipo` text NOT NULL,
	`concepto` text NOT NULL,
	`ref_tipo` text,
	`ref_id` integer,
	`grupo` text,
	`anula_id` integer,
	`usuario_id` integer,
	`es_demo` integer DEFAULT false NOT NULL,
	`creado_en` text NOT NULL,
	FOREIGN KEY (`cuenta_id`) REFERENCES `cuentas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mov_caja_cuenta_idx` ON `movimientos_caja` (`cuenta_id`);--> statement-breakpoint
CREATE INDEX `mov_caja_fecha_idx` ON `movimientos_caja` (`fecha`);--> statement-breakpoint
CREATE INDEX `mov_caja_ref_idx` ON `movimientos_caja` (`ref_tipo`,`ref_id`);--> statement-breakpoint
CREATE INDEX `mov_caja_grupo_idx` ON `movimientos_caja` (`grupo`);--> statement-breakpoint
CREATE TABLE `pagos_proveedor` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`numero` integer NOT NULL,
	`fecha` text NOT NULL,
	`proveedor_id` integer NOT NULL,
	`compra_id` integer,
	`cuenta_id` integer NOT NULL,
	`importe_centavos` integer NOT NULL,
	`comprobante` text,
	`notas` text,
	`estado` text DEFAULT 'activo' NOT NULL,
	`motivo_anulacion` text,
	`usuario_id` integer,
	`es_demo` integer DEFAULT false NOT NULL,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`proveedor_id`) REFERENCES `proveedores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`compra_id`) REFERENCES `compras`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cuenta_id`) REFERENCES `cuentas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pagos_proveedor_numero_unique` ON `pagos_proveedor` (`numero`);--> statement-breakpoint
CREATE INDEX `pagos_proveedor_prov_idx` ON `pagos_proveedor` (`proveedor_id`);--> statement-breakpoint
CREATE TABLE `venta_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`venta_id` integer NOT NULL,
	`variante_id` integer NOT NULL,
	`cantidad` integer NOT NULL,
	`precio_lista_centavos` integer,
	`precio_centavos` integer NOT NULL,
	`costo_unitario_centavos` integer,
	FOREIGN KEY (`venta_id`) REFERENCES `ventas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variante_id`) REFERENCES `variantes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `venta_items_venta_idx` ON `venta_items` (`venta_id`);--> statement-breakpoint
CREATE INDEX `venta_items_variante_idx` ON `venta_items` (`variante_id`);--> statement-breakpoint
CREATE TABLE `venta_pagos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`venta_id` integer NOT NULL,
	`forma_pago_id` integer NOT NULL,
	`cuenta_id` integer NOT NULL,
	`importe_centavos` integer NOT NULL,
	`importe_moneda_centavos` integer,
	`comision_estimada_centavos` integer DEFAULT 0 NOT NULL,
	`comision_real_centavos` integer,
	FOREIGN KEY (`venta_id`) REFERENCES `ventas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`forma_pago_id`) REFERENCES `formas_pago`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cuenta_id`) REFERENCES `cuentas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `venta_pagos_venta_idx` ON `venta_pagos` (`venta_id`);--> statement-breakpoint
CREATE TABLE `ventas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`numero` integer NOT NULL,
	`fecha` text NOT NULL,
	`cliente` text,
	`lista_precio_id` integer,
	`estado` text DEFAULT 'confirmada' NOT NULL,
	`notas` text,
	`motivo_anulacion` text,
	`usuario_id` integer,
	`es_demo` integer DEFAULT false NOT NULL,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`lista_precio_id`) REFERENCES `listas_precio`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ventas_numero_unique` ON `ventas` (`numero`);--> statement-breakpoint
CREATE INDEX `ventas_fecha_idx` ON `ventas` (`fecha`);