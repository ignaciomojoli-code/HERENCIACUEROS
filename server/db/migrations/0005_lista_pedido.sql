CREATE TABLE `lista_pedido` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`variante_id` integer NOT NULL,
	`cantidad` integer NOT NULL,
	`origen` text NOT NULL,
	`venta_id` integer,
	`estado` text DEFAULT 'pendiente' NOT NULL,
	`compra_id` integer,
	`motivo` text,
	`usuario_id` integer,
	`es_demo` integer DEFAULT false NOT NULL,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL,
	FOREIGN KEY (`variante_id`) REFERENCES `variantes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`venta_id`) REFERENCES `ventas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`compra_id`) REFERENCES `compras`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lista_pedido_estado_idx` ON `lista_pedido` (`estado`);--> statement-breakpoint
CREATE INDEX `lista_pedido_variante_idx` ON `lista_pedido` (`variante_id`);