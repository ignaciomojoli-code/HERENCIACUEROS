ALTER TABLE `formas_pago` ADD `medio` text;--> statement-breakpoint
ALTER TABLE `formas_pago` ADD `procesador` text;--> statement-breakpoint
ALTER TABLE `formas_pago` ADD `cuotas` integer;--> statement-breakpoint
-- Se completan a partir de los nombres que ya tienen las formas de pago (se pueden editar después).
UPDATE `formas_pago` SET `medio` = CASE
  WHEN lower(`nombre`) LIKE '%débito%' OR lower(`nombre`) LIKE '%debito%' THEN 'debito'
  WHEN lower(`nombre`) LIKE '%crédito%' OR lower(`nombre`) LIKE '%credito%' THEN 'credito'
  WHEN lower(`nombre`) LIKE 'transferencia%' THEN 'transferencia'
  WHEN lower(`nombre`) LIKE '%efectivo%' THEN 'efectivo'
  WHEN lower(`nombre`) LIKE '%qr%' OR lower(`nombre`) LIKE '%dinero en cuenta%' THEN 'billetera'
  ELSE NULL END;
--> statement-breakpoint
UPDATE `formas_pago` SET `procesador` = CASE
  WHEN `medio` IN ('debito','credito','billetera') AND lower(`nombre`) LIKE '%mercado pago%' THEN 'Mercado Pago'
  WHEN `medio` IN ('debito','credito','billetera') AND lower(`nombre`) LIKE '%payway%' THEN 'Payway'
  ELSE NULL END;
--> statement-breakpoint
UPDATE `formas_pago` SET `cuotas` = CASE
  WHEN `medio` = 'credito' AND lower(`nombre`) LIKE '%1 pago%' THEN 1
  WHEN `medio` = 'credito' AND lower(`nombre`) LIKE '%3 cuotas%' THEN 3
  WHEN `medio` = 'credito' AND lower(`nombre`) LIKE '%6 cuotas%' THEN 6
  WHEN `medio` = 'credito' AND lower(`nombre`) LIKE '%12 cuotas%' THEN 12
  ELSE NULL END;
