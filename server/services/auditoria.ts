import { auditoria } from '../db/schema.js';
import type { DB } from '../db/index.js';
import { ahora } from './tiempo.js';

export interface EventoAuditoria {
  usuarioId: number | null;
  accion: string; // crear, modificar, baja, alta, login, logout, exportar, importar, restaurar, ...
  entidad: string;
  entidadId?: string | number | null;
  antes?: unknown;
  despues?: unknown;
  detalle?: string;
}

/** Registra un evento. Debe llamarse dentro de la misma transacción que el cambio que describe. */
export function auditar(db: DB, e: EventoAuditoria) {
  db.insert(auditoria).values({
    fecha: ahora(),
    usuarioId: e.usuarioId,
    accion: e.accion,
    entidad: e.entidad,
    entidadId: e.entidadId === undefined || e.entidadId === null ? null : String(e.entidadId),
    antes: e.antes === undefined ? null : soloCambios(e.antes, e.despues).antes,
    despues: e.despues === undefined ? null : soloCambios(e.antes, e.despues).despues,
    detalle: e.detalle ?? null,
  }).run();
}

/** Para modificaciones guarda solo los campos que cambiaron (más legible en el historial). */
function soloCambios(antes: unknown, despues: unknown): { antes: unknown; despues: unknown } {
  if (!esObjeto(antes) || !esObjeto(despues)) return { antes: antes ?? null, despues: despues ?? null };
  const a: Record<string, unknown> = {};
  const d: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(antes), ...Object.keys(despues)])) {
    if (k === 'actualizadoEn' || k === 'passwordHash') continue;
    if (JSON.stringify(antes[k]) !== JSON.stringify(despues[k])) { a[k] = antes[k]; d[k] = despues[k]; }
  }
  return { antes: a, despues: d };
}

function esObjeto(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
