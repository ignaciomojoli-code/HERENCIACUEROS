CREATE TABLE `compra_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`compra_id` integer NOT NULL,
	`variante_id` integer NOT NULL,
	`cantidad` integer NOT NULL,
	`costo_unitario_centavos` integer NOT NULL,
	`notas` text,
	FOREIGN KEY (`compra_id`) REFERENCES `compras`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variante_id`) REFERENCES `variantes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `compra_items_compra_idx` ON `compra_items` (`compra_id`);--> statement-breakpoint
CREATE TABLE `compras` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`numero` integer NOT NULL,
	`proveedor_id` integer NOT NULL,
	`tipo` text DEFAULT 'reventa' NOT NULL,
	`fecha` text NOT NULL,
	`fecha_esperada` text,
	`estado` text DEFAULT 'borrador' NOT NULL,
	`notas` text,
	`usuario_id` integer,
	`es_demo` integer DEFAULT false NOT NULL,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`proveedor_id`) REFERENCES `proveedores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `compras_numero_unique` ON `compras` (`numero`);--> statement-breakpoint
CREATE INDEX `compras_proveedor_idx` ON `compras` (`proveedor_id`);--> statement-breakpoint
CREATE TABLE `conteo_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conteo_id` integer NOT NULL,
	`variante_id` integer NOT NULL,
	`contado` integer NOT NULL,
	`esperado` integer,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`conteo_id`) REFERENCES `conteos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variante_id`) REFERENCES `variantes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conteo_items_uq` ON `conteo_items` (`conteo_id`,`variante_id`);--> statement-breakpoint
CREATE TABLE `conteos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`numero` integer NOT NULL,
	`fecha` text NOT NULL,
	`categoria_id` integer,
	`estado` text DEFAULT 'abierto' NOT NULL,
	`notas` text,
	`usuario_id` integer,
	`aplicado_en` text,
	`aplicado_por` integer,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`categoria_id`) REFERENCES `categorias`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`aplicado_por`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conteos_numero_unique` ON `conteos` (`numero`);--> statement-breakpoint
CREATE TABLE `movimientos_stock` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fecha` text NOT NULL,
	`variante_id` integer NOT NULL,
	`cantidad` integer NOT NULL,
	`tipo` text NOT NULL,
	`costo_unitario_centavos` integer,
	`ref_tipo` text,
	`ref_id` integer,
	`anula_id` integer,
	`motivo` text,
	`usuario_id` integer,
	`creado_en` text NOT NULL,
	FOREIGN KEY (`variante_id`) REFERENCES `variantes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mov_stock_variante_idx` ON `movimientos_stock` (`variante_id`);--> statement-breakpoint
CREATE INDEX `mov_stock_fecha_idx` ON `movimientos_stock` (`fecha`);--> statement-breakpoint
CREATE INDEX `mov_stock_ref_idx` ON `movimientos_stock` (`ref_tipo`,`ref_id`);--> statement-breakpoint
CREATE TABLE `recepcion_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recepcion_id` integer NOT NULL,
	`compra_item_id` integer NOT NULL,
	`variante_id` integer NOT NULL,
	`cantidad` integer NOT NULL,
	`costo_unitario_centavos` integer NOT NULL,
	FOREIGN KEY (`recepcion_id`) REFERENCES `recepciones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`compra_item_id`) REFERENCES `compra_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variante_id`) REFERENCES `variantes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recepcion_items_rec_idx` ON `recepcion_items` (`recepcion_id`);--> statement-breakpoint
CREATE TABLE `recepciones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`numero` integer NOT NULL,
	`compra_id` integer NOT NULL,
	`fecha` text NOT NULL,
	`comprobante` text,
	`notas` text,
	`estado` text DEFAULT 'activa' NOT NULL,
	`motivo_anulacion` text,
	`usuario_id` integer,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`compra_id`) REFERENCES `compras`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recepciones_numero_unique` ON `recepciones` (`numero`);--> statement-breakpoint
ALTER TABLE `historial_costos` ADD `ref_tipo` text;--> statement-breakpoint
ALTER TABLE `historial_costos` ADD `ref_id` integer;