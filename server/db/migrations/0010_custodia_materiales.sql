CREATE TABLE `traslados_material` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`numero` integer NOT NULL,
	`fecha` text NOT NULL,
	`origen_proveedor_id` integer,
	`destino_proveedor_id` integer,
	`compra_id` integer,
	`notas` text,
	`estado` text DEFAULT 'activo' NOT NULL,
	`motivo_anulacion` text,
	`usuario_id` integer,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`origen_proveedor_id`) REFERENCES `proveedores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`destino_proveedor_id`) REFERENCES `proveedores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`compra_id`) REFERENCES `compras`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `traslados_material_numero_unique` ON `traslados_material` (`numero`);--> statement-breakpoint
CREATE INDEX `traslados_compra_idx` ON `traslados_material` (`compra_id`);--> statement-breakpoint
ALTER TABLE `movimientos_material` ADD `ubicacion_proveedor_id` integer REFERENCES proveedores(id);--> statement-breakpoint
CREATE INDEX `mov_material_ubic_idx` ON `movimientos_material` (`ubicacion_proveedor_id`);