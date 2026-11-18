CREATE TABLE `reservas_material` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`compra_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`color_id` integer,
	`cantidad_mil` integer NOT NULL,
	`estado` text DEFAULT 'activa' NOT NULL,
	`motivo` text,
	`usuario_id` integer,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`compra_id`) REFERENCES `compras`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materiales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`color_id`) REFERENCES `colores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reservas_material_compra_idx` ON `reservas_material` (`compra_id`,`estado`);--> statement-breakpoint
ALTER TABLE `compra_materiales` ADD `color_id` integer REFERENCES colores(id);--> statement-breakpoint
ALTER TABLE `materiales` ADD `por_color` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `movimientos_material` ADD `color_id` integer REFERENCES colores(id);--> statement-breakpoint
ALTER TABLE `necesidades_material` ADD `color_id` integer REFERENCES colores(id);--> statement-breakpoint
ALTER TABLE `recepcion_materiales` ADD `color_id` integer REFERENCES colores(id);