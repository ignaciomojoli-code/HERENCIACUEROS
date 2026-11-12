/**
 * Configuración general: todos los valores comerciales que pueden cambiar viven acá, no en el código.
 * Cada clave tiene un valor por defecto; lo que el usuario guarda pisa el valor por defecto.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { configuracion } from '../db/schema.js';
import type { DB } from '../db/index.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';

export const esquemasConfig = {
  empresa: z.object({
    nombreFantasia: z.string().min(1),
    razonSocial: z.string().nullable(),
    cuit: z.string().nullable(),
    condicionIva: z.string().nullable(),
    direccion: z.string().nullable(),
    telefono: z.string().nullable(),
    email: z.string().nullable(),
    horario: z.string().nullable(),
    slogan: z.string().nullable(),
    sloganEn: z.string().nullable(),
  }),
  marca: z.object({
    colorPrincipal: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    colorAcento: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    colorSegundoAcento: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    colorOferta: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    logoTexto: z.string().min(1),
    logoSubtexto: z.string(),
  }),
  regional: z.object({
    moneda: z.string().min(3).max(3),
    formatoFecha: z.enum(['dd/mm/aaaa', 'aaaa-mm-dd']),
    zonaHoraria: z.string(),
  }),
  cotizaciones: z.object({
    /** Pesos por cada USD, en centavos. */
    usdCentavos: z.number().int().nonnegative().nullable(),
    brlCentavos: z.number().int().nonnegative().nullable(),
    actualizadaEn: z.string().nullable(),
  }),
  precios: z.object({
    metodoPorDefecto: z.enum(['markup', 'margen', 'precio_objetivo']),
    margenObjetivoBp: z.number().int(),
    markupObjetivoBp: z.number().int(),
    /** Redondeo de precios sugeridos, en centavos (ej. 50000 = a $500). */
    redondeoCentavos: z.number().int().nonnegative(),
  }),
  inventario: z.object({
    stockMinimoPorDefecto: z.number().int().nonnegative(),
    permitirVentaSinStock: z.boolean(),
  }),
  backups: z.object({
    carpeta: z.string().nullable(),
    cadaHoras: z.number().int().min(1).max(24),
    retenerDiarios: z.number().int().min(1),
    retenerMensuales: z.number().int().min(0),
  }),
} as const;

export type ClaveConfig = keyof typeof esquemasConfig;
export type ValorConfig<K extends ClaveConfig> = z.infer<(typeof esquemasConfig)[K]>;

/** Valores por defecto. Los datos del negocio salen del Manual de marca 2026 y de la planilla; lo desconocido queda en null (pendiente). */
export const CONFIG_POR_DEFECTO: { [K in ClaveConfig]: ValorConfig<K> } = {
  empresa: {
    nombreFantasia: 'Herencia Cuero',
    razonSocial: null,
    cuit: null,
    condicionIva: 'Monotributo',
    direccion: 'Malabia 48, Villa Crespo, Buenos Aires',
    telefono: '+54 9 11 7153-9052',
    email: null,
    horario: 'Lunes a sábado 10:30 a 18:30',
    slogan: 'Cuero genuino · hecho para heredarse',
    sloganEn: 'Genuine leather · made to be inherited',
  },
  marca: {
    colorPrincipal: '#15120F',
    colorAcento: '#6B1E28',
    colorSegundoAcento: '#A65A2E',
    colorOferta: '#B8261C',
    logoTexto: 'HERENCIA',
    logoSubtexto: 'CUERO',
  },
  regional: { moneda: 'ARS', formatoFecha: 'dd/mm/aaaa', zonaHoraria: 'America/Argentina/Buenos_Aires' },
  cotizaciones: { usdCentavos: null, brlCentavos: null, actualizadaEn: null },
  precios: { metodoPorDefecto: 'margen', margenObjetivoBp: 5000, markupObjetivoBp: 10000, redondeoCentavos: 50000 },
  inventario: { stockMinimoPorDefecto: 1, permitirVentaSinStock: false },
  backups: { carpeta: null, cadaHoras: 4, retenerDiarios: 30, retenerMensuales: 12 },
};

export function leerConfig<K extends ClaveConfig>(db: DB, clave: K): ValorConfig<K> {
  const fila = db.select().from(configuracion).where(eq(configuracion.clave, clave)).get();
  const base = CONFIG_POR_DEFECTO[clave];
  if (!fila) return base;
  // Mezcla con los valores por defecto por si se agregaron campos nuevos en una versión posterior.
  const mezclado = { ...base, ...(fila.valor as object) };
  const r = esquemasConfig[clave].safeParse(mezclado);
  return (r.success ? r.data : base) as ValorConfig<K>;
}

export function leerTodaLaConfig(db: DB) {
  return Object.fromEntries((Object.keys(esquemasConfig) as ClaveConfig[]).map((k) => [k, leerConfig(db, k)]));
}

export function guardarConfig<K extends ClaveConfig>(db: DB, clave: K, valor: unknown, usuarioId: number | null): ValorConfig<K> {
  const parsed = esquemasConfig[clave].parse(valor) as ValorConfig<K>;
  const antes = leerConfig(db, clave);
  const t = ahora();
  db.insert(configuracion)
    .values({ clave, valor: parsed, actualizadoEn: t, actualizadoPor: usuarioId })
    .onConflictDoUpdate({ target: configuracion.clave, set: { valor: parsed, actualizadoEn: t, actualizadoPor: usuarioId } })
    .run();
  auditar(db, { usuarioId, accion: 'modificar', entidad: 'configuracion', entidadId: clave, antes, despues: parsed });
  return parsed;
}
