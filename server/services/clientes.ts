/** Clientes y lo que deben (ventas con saldo pendiente). */
import { and, asc, eq, sql } from 'drizzle-orm';
import { clientes, ventas } from '../db/schema.js';
import type { DB } from '../db/index.js';
import type { Ctx } from './stock.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import { saldoSql } from './ventas.js';
import { normalizarClave } from '../domain/texto.js';

export interface DatosCliente { nombre: string; telefono?: string | null; email?: string | null; documento?: string | null; notas?: string | null; activo?: boolean }

const limpio = (s?: string | null) => s?.trim() || null;

export function guardarCliente(ctx: Ctx, id: number | null, d: DatosCliente) {
  const nombre = d.nombre?.trim();
  if (!nombre) throw new ErrorNegocio('Indicá el nombre del cliente');
  const repetido = ctx.db.select({ id: clientes.id, nombre: clientes.nombre }).from(clientes).all().find((c) => c.id !== id && normalizarClave(c.nombre) === normalizarClave(nombre));
  if (repetido) throw new ErrorNegocio(`Ya existe el cliente ${repetido.nombre}`, 409);
  const t = ahora();
  const valores = { nombre, telefono: limpio(d.telefono), email: limpio(d.email), documento: limpio(d.documento), notas: limpio(d.notas), actualizadoEn: t };
  if (id === null) {
    const c = ctx.db.insert(clientes).values({ ...valores, creadoEn: t }).returning().get();
    auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'crear', entidad: 'cliente', entidadId: c.id, despues: c });
    return c;
  }
  const antes = ctx.db.select().from(clientes).where(eq(clientes.id, id)).get();
  if (!antes) throw noEncontrado('El cliente');
  const c = ctx.db.update(clientes).set({ ...valores, activo: d.activo ?? antes.activo }).where(eq(clientes.id, id)).returning().get();
  // Las ventas guardan el nombre: si cambia, se actualiza en sus ventas para que la búsqueda lo encuentre.
  if (antes.nombre !== nombre) ctx.db.update(ventas).set({ cliente: nombre }).where(eq(ventas.clienteId, id)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'modificar', entidad: 'cliente', entidadId: id, antes, despues: c });
  return c;
}

/** Clientes con cuántas compras hicieron, cuánto compraron y cuánto deben. */
export function listarClientes(db: DB) {
  const deuda = db.select({ clienteId: ventas.clienteId, saldo: sql<number>`sum(case when ${saldoSql} > 0 then ${saldoSql} else 0 end)`, ventas: sql<number>`count(*)`, ultima: sql<string>`max(${ventas.fecha})` })
    .from(ventas).where(and(eq(ventas.estado, 'confirmada'), sql`${ventas.clienteId} is not null`)).groupBy(ventas.clienteId).all();
  return db.select().from(clientes).orderBy(asc(clientes.nombre)).all().map((c) => {
    const d = deuda.find((x) => x.clienteId === c.id);
    return { ...c, saldoCentavos: Number(d?.saldo ?? 0), ventas: Number(d?.ventas ?? 0), ultimaCompra: d?.ultima ?? null };
  });
}

export function obtenerCliente(db: DB, id: number) {
  const c = listarClientes(db).find((x) => x.id === id);
  if (!c) throw noEncontrado('El cliente');
  return c;
}
