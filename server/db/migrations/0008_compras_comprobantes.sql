CREATE TABLE `adjuntos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entidad` text NOT NULL,
	`entidad_id` integer NOT NULL,
	`nombre` text NOT NULL,
	`tipo` text NOT NULL,
	`tamano` integer NOT NULL,
	`datos` blob NOT NULL,
	`estado` text DEFAULT 'activo' NOT NULL,
	`motivo` text,
	`usuario_id` integer,
	`creado_en` text NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `adjuntos_entidad_idx` ON `adjuntos` (`entidad`,`entidad_id`);--> statement-breakpoint
CREATE TABLE `imputaciones_pago` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pago_id` integer NOT NULL,
	`compra_id` integer NOT NULL,
	`importe_centavos` integer NOT NULL,
	`estado` text DEFAULT 'activa' NOT NULL,
	`usuario_id` integer,
	`creado_en` text NOT NULL,
	FOREIGN KEY (`pago_id`) REFERENCES `pagos_proveedor`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`compra_id`) REFERENCES `compras`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `imputaciones_pago_idx` ON `imputaciones_pago` (`pago_id`);--> statement-breakpoint
CREATE INDEX `imputaciones_compra_idx` ON `imputaciones_pago` (`compra_id`);--> statement-breakpoint
ALTER TABLE `compras` ADD `comprobante` text;--> statement-breakpoint
ALTER TABLE `compras` ADD `fecha_comprobante` text;--> statement-breakpoint
ALTER TABLE `compras` ADD `descuento_centavos` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `compras` ADD `impuestos_centavos` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `compras` ADD `condicion_pago` text;--> statement-breakpoint
ALTER TABLE `compras` ADD `plazo_pago_dias` integer;--> statement-breakpoint
ALTER TABLE `compras` ADD `vencimiento` text;--> statement-breakpoint
INSERT INTO `imputaciones_pago` (`pago_id`, `compra_id`, `importe_centavos`, `estado`, `usuario_id`, `creado_en`)
SELECT `id`, `compra_id`, `importe_centavos`, CASE WHEN `estado` = 'activo' THEN 'activa' ELSE 'anulada' END, `usuario_id`, `creado_en` FROM `pagos_proveedor` WHERE `compra_id` IS NOT NULL;