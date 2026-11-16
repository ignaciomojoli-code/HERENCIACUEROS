CREATE TABLE `clientes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`telefono` text,
	`email` text,
	`documento` text,
	`notas` text,
	`activo` integer DEFAULT true NOT NULL,
	`es_demo` integer DEFAULT false NOT NULL,
	`creado_en` text NOT NULL,
	`actualizado_en` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `clientes_nombre_idx` ON `clientes` (`nombre`);--> statement-breakpoint
CREATE TABLE `venta_versiones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`venta_id` integer NOT NULL,
	`version` integer NOT NULL,
	`datos` text NOT NULL,
	`motivo` text NOT NULL,
	`usuario_id` integer,
	`fecha` text NOT NULL,
	FOREIGN KEY (`venta_id`) REFERENCES `ventas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `venta_versiones_venta_idx` ON `venta_versiones` (`venta_id`);--> statement-breakpoint
ALTER TABLE `venta_pagos` ADD `fecha` text;--> statement-breakpoint
ALTER TABLE `venta_pagos` ADD `estado` text DEFAULT 'activo' NOT NULL;--> statement-breakpoint
ALTER TABLE `venta_pagos` ADD `motivo_anulacion` text;--> statement-breakpoint
ALTER TABLE `venta_pagos` ADD `liquidacion` text;--> statement-breakpoint
ALTER TABLE `ventas` ADD `cliente_id` integer REFERENCES clientes(id);--> statement-breakpoint
ALTER TABLE `ventas` ADD `descuento_centavos` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ventas` ADD `motivo_descuento` text;--> statement-breakpoint
ALTER TABLE `ventas` ADD `version` integer DEFAULT 1 NOT NULL;