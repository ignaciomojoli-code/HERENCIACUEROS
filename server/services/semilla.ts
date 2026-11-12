/**
 * Datos iniciales que necesita el sistema para funcionar (no son datos del negocio inventados):
 * roles por defecto, unidades de medida y las listas de precio que ya usa el local.
 */
import { count, eq } from 'drizzle-orm';
import { roles, unidades, listasPrecio, numeradores } from '../db/schema.js';
import type { DB } from '../db/index.js';
import { MODULOS_POR_VERSION, ROLES_POR_DEFECTO, VERSION_PERMISOS, type MapaPermisos } from '../domain/permisos.js';
import { ahora } from './tiempo.js';

export function sembrar(db: DB) {
  const t = ahora();
  if ((db.select({ n: count() }).from(roles).get()?.n ?? 0) === 0) {
    for (const r of ROLES_POR_DEFECTO) {
      db.insert(roles).values({ nombre: r.nombre, descripcion: r.descripcion, permisos: r.permisos, esSistema: r.nombre === 'Administrador', creadoEn: t, actualizadoEn: t }).run();
    }
  }
  actualizarPermisos(db);
  if ((db.select({ n: count() }).from(unidades).get()?.n ?? 0) === 0) {
    db.insert(unidades).values([
      { codigo: 'u', nombre: 'Unidad' },
      { codigo: 'm', nombre: 'Metro' },
      { codigo: 'par', nombre: 'Par' },
    ]).run();
  }
  if ((db.select({ n: count() }).from(listasPrecio).get()?.n ?? 0) === 0) {
    // Las dos listas que el local ya usa (planilla: "Precio efectivo / transf." y "Precio tarjeta").
    db.insert(listasPrecio).values([
      { nombre: 'Efectivo / transferencia', descripcion: 'Mejor precio, sin recargos', orden: 1, creadoEn: t, actualizadoEn: t },
      { nombre: 'Tarjeta', descripcion: 'Precio de lista para débito y crédito en 1, 3 o 6 cuotas', orden: 2, creadoEn: t, actualizadoEn: t },
    ]).run();
  }
}

/** Suma a los roles por defecto los permisos de módulos nuevos (una sola vez por versión). */
function actualizarPermisos(db: DB) {
  const fila = db.select().from(numeradores).where(eq(numeradores.clave, 'version_permisos')).get();
  const actual = fila?.ultimo ?? (db.select({ n: count() }).from(roles).get()!.n > 0 ? 1 : VERSION_PERMISOS);
  if (actual < VERSION_PERMISOS) {
    for (const r of db.select().from(roles).all()) {
      const def = ROLES_POR_DEFECTO.find((d) => d.nombre === r.nombre);
      if (!def) continue;
      const permisos = { ...(r.permisos as MapaPermisos) };
      for (let v = actual + 1; v <= VERSION_PERMISOS; v++) {
        for (const m of MODULOS_POR_VERSION[v] ?? []) if (!permisos[m] && def.permisos[m]) permisos[m] = def.permisos[m];
      }
      db.update(roles).set({ permisos, actualizadoEn: ahora() }).where(eq(roles.id, r.id)).run();
    }
  }
  db.insert(numeradores).values({ clave: 'version_permisos', ultimo: VERSION_PERMISOS })
    .onConflictDoUpdate({ target: numeradores.clave, set: { ultimo: VERSION_PERMISOS } }).run();
}
