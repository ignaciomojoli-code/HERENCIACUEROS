CREATE TABLE `historial_costos_material` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer NOT NULL,
	`anterior_centavos` integer,
	`nuevo_centavos` integer,
	`fecha` text NOT NULL,
	`usuario_id` integer,
	`origen` text NOT NULL,
	`motivo` text,
	`ref_tipo` text,
	`ref_id` integer,
	FOREIGN KEY (`material_id`) REFERENCES `materiales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `hist_costo_material_idx` ON `historial_costos_material` (`material_id`);--> statement-breakpoint
CREATE TABLE `materiales` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`codigo` text NOT NULL,
	`nombre` text NOT NULL,
	`unidad` text DEFAULT 'u' NOT NULL,
	`tipo` text DEFAULT 'material' NOT NULL,
	`costo_centavos` integer,
	`proveedor_id` integer,
	`stock_minimo_mil` integer,
	`notas` text,
	`activo` integer DEFAULT true NOT NULL,
	`es_demo` integer DEFAULT false NOT NULL,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`proveedor_id`) REFERENCES `proveedores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `materiales_codigo_unique` ON `materiales` (`codigo`);--> statement-breakpoint
CREATE TABLE `movimientos_material` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fecha` text NOT NULL,
	`material_id` integer NOT NULL,
	`cantidad_mil` integer NOT NULL,
	`tipo` text NOT NULL,
	`costo_unitario_centavos` integer,
	`proveedor_id` integer,
	`comprobante` text,
	`ref_tipo` text,
	`ref_id` integer,
	`anula_id` integer,
	`motivo` text,
	`usuario_id` integer,
	`creado_en` text NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `materiales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proveedor_id`) REFERENCES `proveedores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mov_material_idx` ON `movimientos_material` (`material_id`);--> statement-breakpoint
CREATE INDEX `mov_material_ref_idx` ON `movimientos_material` (`ref_tipo`,`ref_id`);--> statement-breakpoint
CREATE TABLE `receta_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`modelo_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`cantidad_mil` integer NOT NULL,
	`talles` text,
	`notas` text,
	`orden` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`modelo_id`) REFERENCES `modelos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materiales`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `receta_modelo_idx` ON `receta_items` (`modelo_id`);