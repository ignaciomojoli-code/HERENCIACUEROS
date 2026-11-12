/**
 * Datos iniciales que necesita el sistema para funcionar (no son datos del negocio inventados):
 * roles por defecto, unidades de medida y las listas de precio que ya usa el local.
 */
import { count } from 'drizzle-orm';
import { roles, unidades, listasPrecio } from '../db/schema.js';
import type { DB } from '../db/index.js';
import { ROLES_POR_DEFECTO } from '../domain/permisos.js';
import { ahora } from './tiempo.js';

export function sembrar(db: DB) {
  const t = ahora();
  if ((db.select({ n: count() }).from(roles).get()?.n ?? 0) === 0) {
    for (const r of ROLES_POR_DEFECTO) {
      db.insert(roles).values({ nombre: r.nombre, descripcion: r.descripcion, permisos: r.permisos, esSistema: r.nombre === 'Administrador', creadoEn: t, actualizadoEn: t }).run();
    }
  }
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
