CREATE TABLE `precios_proveedor` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`proveedor_id` integer NOT NULL,
	`material_id` integer,
	`color_id` integer,
	`variante_id` integer,
	`precio_centavos` integer NOT NULL,
	`fecha` text NOT NULL,
	`origen` text NOT NULL,
	`compra_id` integer,
	`motivo` text,
	`estado` text DEFAULT 'activo' NOT NULL,
	`usuario_id` integer,
	`creado_en` text NOT NULL,
	FOREIGN KEY (`proveedor_id`) REFERENCES `proveedores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materiales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`color_id`) REFERENCES `colores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variante_id`) REFERENCES `variantes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`compra_id`) REFERENCES `compras`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `precios_proveedor_idx` ON `precios_proveedor` (`proveedor_id`,`material_id`,`variante_id`);--> statement-breakpoint
ALTER TABLE `compra_items` ADD `cantidad_solicitada` integer;--> statement-breakpoint
ALTER TABLE `compra_items` ADD `costo_estimado_centavos` integer;--> statement-breakpoint
ALTER TABLE `compra_items` ADD `cantidad_facturada` integer;--> statement-breakpoint
ALTER TABLE `compra_materiales` ADD `cantidad_solicitada_mil` integer;--> statement-breakpoint
ALTER TABLE `compra_materiales` ADD `costo_estimado_centavos` integer;--> statement-breakpoint
ALTER TABLE `compra_materiales` ADD `cantidad_facturada_mil` integer;--> statement-breakpoint
ALTER TABLE `compras` ADD `importe_facturado_centavos` integer;--> statement-breakpoint
ALTER TABLE `compras` ADD `ajuste_precio_centavos` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ventas` ADD `efectivo_recibido_centavos` integer;