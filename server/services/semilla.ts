/**
 * Datos iniciales que necesita el sistema para funcionar (no son datos del negocio inventados):
 * roles por defecto, unidades de medida y las listas de precio que ya usa el local.
 */
import { count, eq } from 'drizzle-orm';
import { roles, unidades, listasPrecio, numeradores, cuentas, formasPago, categoriasGasto } from '../db/schema.js';
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
  sembrarPlata(db, t);
}

/**
 * Cuentas, formas de pago y categorías de gastos que ya usa el local (pestañas Comisiones y Gastos de la planilla).
 * Solo se crean si no hay ninguna; después se editan desde la pantalla.
 */
function sembrarPlata(db: DB, t: string) {
  if ((db.select({ n: count() }).from(cuentas).get()?.n ?? 0) === 0) {
    db.insert(cuentas).values([
      { nombre: 'Efectivo', tipo: 'efectivo', moneda: 'ARS', orden: 1 },
      { nombre: 'Mercado Pago', tipo: 'billetera', moneda: 'ARS', orden: 2 },
      { nombre: 'Cuenta DNI', tipo: 'banco', moneda: 'ARS', orden: 3 },
      { nombre: 'Tarjetas a liquidar', tipo: 'a_liquidar', moneda: 'ARS', orden: 4 },
      { nombre: 'Dólares', tipo: 'efectivo', moneda: 'USD', orden: 5 },
      { nombre: 'Inversor externo', tipo: 'externa', moneda: 'ARS', orden: 6 },
    ].map((c) => ({ ...c, tipo: c.tipo as 'efectivo', moneda: c.moneda as 'ARS', creadoEn: t, actualizadoEn: t }))).run();
  }
  if ((db.select({ n: count() }).from(formasPago).get()?.n ?? 0) === 0) {
    const cta = (n: string) => db.select().from(cuentas).where(eq(cuentas.nombre, n)).get()?.id;
    const lista = (n: string) => db.select().from(listasPrecio).where(eq(listasPrecio.nombre, n)).get()?.id ?? null;
    const efe = lista('Efectivo / transferencia');
    const tar = lista('Tarjeta');
    // % de comisión: el "% que se usa" de la pestaña Comisiones al 12/11/2026 (se ajusta desde la pantalla).
    const formas: [string, number | undefined, number | null, number][] = [
      ['Efectivo', cta('Efectivo'), efe, 0],
      ['Transferencia a Mercado Pago', cta('Mercado Pago'), efe, 0],
      ['Transferencia a Cuenta DNI', cta('Cuenta DNI'), efe, 0],
      ['Mercado Pago (dinero en cuenta / QR)', cta('Mercado Pago'), efe, 720],
      ['Dólares (efectivo)', cta('Dólares'), efe, 160],
      ['Débito · Mercado Pago', cta('Tarjetas a liquidar'), tar, 240],
      ['Crédito 1 pago · Mercado Pago', cta('Tarjetas a liquidar'), tar, 900],
      ['Crédito 3 cuotas · Mercado Pago', cta('Tarjetas a liquidar'), tar, 910],
      ['Crédito 6 cuotas · Mercado Pago', cta('Tarjetas a liquidar'), tar, 1750],
      ['Débito · Payway', cta('Tarjetas a liquidar'), tar, 330],
      ['Crédito 1 pago · Payway', cta('Tarjetas a liquidar'), tar, 1000],
      ['Crédito 3 cuotas · Payway', cta('Tarjetas a liquidar'), tar, 1740],
      ['Crédito 6 cuotas · Payway', cta('Tarjetas a liquidar'), tar, 1770],
    ];
    const validas = formas.filter((f) => f[1] !== undefined);
    if (validas.length) db.insert(formasPago).values(validas.map(([nombre, cuentaId, listaPrecioId, comisionBp], i) => ({ nombre, cuentaId: cuentaId!, listaPrecioId, comisionBp, orden: i + 1, creadoEn: t, actualizadoEn: t }))).run();
  }
  if ((db.select({ n: count() }).from(categoriasGasto).get()?.n ?? 0) === 0) {
    // Categorías de la pestaña Gastos + los gastos fijos que paga el inversor (luz, ABL, AySA, internet, alarma, sueldo).
    const arbol: [string, string[]][] = [
      ['Alquiler', []], ['Servicios', ['Luz', 'ABL', 'AySA', 'Internet', 'Alarma']], ['Sueldos', []], ['Impuestos', ['Monotributo']],
      ['Comida', []], ['Limpieza', []], ['Librería', []], ['Otros', []],
    ];
    arbol.forEach(([nombre, subs], i) => {
      const c = db.insert(categoriasGasto).values({ nombre, orden: i + 1, creadoEn: t }).returning().get();
      subs.forEach((s, j) => db.insert(categoriasGasto).values({ nombre: s, padreId: c.id, orden: j + 1, creadoEn: t }).run());
    });
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
