CREATE TABLE `gastos_personales` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`numero` integer NOT NULL,
	`fecha` text NOT NULL,
	`descripcion` text NOT NULL,
	`categoria_id` integer NOT NULL,
	`subcategoria_id` integer,
	`importe_centavos` integer NOT NULL,
	`cuenta_id` integer,
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
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gastos_personales_numero_unique` ON `gastos_personales` (`numero`);--> statement-breakpoint
CREATE INDEX `gastos_personales_fecha_idx` ON `gastos_personales` (`fecha`);--> statement-breakpoint
ALTER TABLE `categorias_gasto` ADD `ambito` text DEFAULT 'negocio' NOT NULL;--> statement-breakpoint
ALTER TABLE `compras` ADD `importacion_id` integer;