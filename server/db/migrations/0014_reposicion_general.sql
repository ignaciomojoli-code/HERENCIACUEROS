CREATE TABLE `decisiones_reposicion` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variante_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`proveedor_id` integer,
	`stock_al_descartar` integer,
	`cantidad` integer,
	`motivo` text,
	`estado` text DEFAULT 'activa' NOT NULL,
	`usuario_id` integer,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`variante_id`) REFERENCES `variantes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proveedor_id`) REFERENCES `proveedores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `decisiones_reposicion_idx` ON `decisiones_reposicion` (`variante_id`,`estado`);