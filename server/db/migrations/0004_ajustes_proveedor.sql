CREATE TABLE `ajustes_proveedor` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fecha` text NOT NULL,
	`proveedor_id` integer NOT NULL,
	`importe_centavos` integer NOT NULL,
	`motivo` text NOT NULL,
	`estado` text DEFAULT 'activo' NOT NULL,
	`motivo_anulacion` text,
	`usuario_id` integer,
	`es_demo` integer DEFAULT false NOT NULL,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`proveedor_id`) REFERENCES `proveedores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ajustes_proveedor_prov_idx` ON `ajustes_proveedor` (`proveedor_id`);