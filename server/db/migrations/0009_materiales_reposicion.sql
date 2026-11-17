CREATE TABLE `compra_materiales` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`compra_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`cantidad_mil` integer NOT NULL,
	`costo_unitario_centavos` integer NOT NULL,
	`notas` text,
	FOREIGN KEY (`compra_id`) REFERENCES `compras`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materiales`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `compra_materiales_compra_idx` ON `compra_materiales` (`compra_id`);--> statement-breakpoint
CREATE TABLE `necesidades_material` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`cantidad_mil` integer,
	`hasta` text,
	`proveedor_id` integer,
	`motivo` text,
	`estado` text DEFAULT 'activa' NOT NULL,
	`compra_id` integer,
	`usuario_id` integer,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `materiales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proveedor_id`) REFERENCES `proveedores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`compra_id`) REFERENCES `compras`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `necesidades_material_idx` ON `necesidades_material` (`material_id`,`estado`);--> statement-breakpoint
CREATE TABLE `recepcion_materiales` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recepcion_id` integer NOT NULL,
	`compra_material_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`cantidad_mil` integer NOT NULL,
	`costo_unitario_centavos` integer NOT NULL,
	`movimiento_id` integer,
	FOREIGN KEY (`recepcion_id`) REFERENCES `recepciones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`compra_material_id`) REFERENCES `compra_materiales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materiales`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recepcion_materiales_rec_idx` ON `recepcion_materiales` (`recepcion_id`);