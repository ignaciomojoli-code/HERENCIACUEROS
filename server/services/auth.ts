import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { and, count, eq, gt, lt } from 'drizzle-orm';
import { roles, sesiones, usuarios } from '../db/schema.js';
import type { DB } from '../db/index.js';
import { ahora } from './tiempo.js';
import { auditar } from './auditoria.js';
import { ErrorNegocio } from './errores.js';
import type { MapaPermisos } from '../domain/permisos.js';

const DURACION_SESION_HORAS = 12;

export const hashPassword = (p: string) => hash(p, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

export function validarPassword(p: string) {
  if (p.length < 8) throw new ErrorNegocio('La contraseña debe tener al menos 8 caracteres');
}

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

export interface UsuarioSesion {
  id: number;
  usuario: string;
  nombre: string;
  rolId: number;
  rol: string;
  permisos: MapaPermisos;
  debeCambiarPassword: boolean;
}

export function hayUsuarios(db: DB): boolean {
  return (db.select({ n: count() }).from(usuarios).get()?.n ?? 0) > 0;
}

/** Primer arranque: crea el usuario administrador. Solo funciona si no existe ningún usuario. */
export async function crearAdministradorInicial(db: DB, datos: { usuario: string; nombre: string; password: string }) {
  if (hayUsuarios(db)) throw new ErrorNegocio('El sistema ya fue configurado', 409);
  validarPassword(datos.password);
  const rol = db.select().from(roles).where(eq(roles.nombre, 'Administrador')).get();
  if (!rol) throw new ErrorNegocio('Falta el rol Administrador', 500);
  const ph = await hashPassword(datos.password);
  const t = ahora();
  const u = db.insert(usuarios).values({ usuario: datos.usuario.trim().toLowerCase(), nombre: datos.nombre.trim(), passwordHash: ph, rolId: rol.id, creadoEn: t, actualizadoEn: t }).returning().get();
  auditar(db, { usuarioId: u.id, accion: 'crear', entidad: 'usuario', entidadId: u.id, despues: { usuario: u.usuario, nombre: u.nombre, rol: rol.nombre }, detalle: 'Configuración inicial' });
  return u;
}

export async function iniciarSesion(db: DB, usuario: string, password: string, meta: { ip?: string; userAgent?: string }) {
  const u = db.select().from(usuarios).where(eq(usuarios.usuario, usuario.trim().toLowerCase())).get();
  // Mismo mensaje para usuario inexistente y contraseña incorrecta.
  const ok = u && u.activo ? await verify(u.passwordHash, password) : false;
  if (!u || !ok) {
    auditar(db, { usuarioId: u?.id ?? null, accion: 'login_fallido', entidad: 'sesion', detalle: `usuario: ${usuario}` });
    throw new ErrorNegocio('Usuario o contraseña incorrectos', 401);
  }
  const token = randomBytes(32).toString('base64url');
  const t = ahora();
  const expira = new Date(Date.parse(t) + DURACION_SESION_HORAS * 3600_000).toISOString();
  db.insert(sesiones).values({ tokenHash: sha(token), usuarioId: u.id, creadaEn: t, expiraEn: expira, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null }).run();
  db.update(usuarios).set({ ultimoLogin: t }).where(eq(usuarios.id, u.id)).run();
  db.delete(sesiones).where(lt(sesiones.expiraEn, t)).run();
  auditar(db, { usuarioId: u.id, accion: 'login', entidad: 'sesion', detalle: meta.ip });
  return { token, expira };
}

export function usuarioDeToken(db: DB, token: string | undefined): UsuarioSesion | null {
  if (!token) return null;
  const fila = db
    .select({ u: usuarios, r: roles })
    .from(sesiones)
    .innerJoin(usuarios, eq(usuarios.id, sesiones.usuarioId))
    .innerJoin(roles, eq(roles.id, usuarios.rolId))
    .where(and(eq(sesiones.tokenHash, sha(token)), gt(sesiones.expiraEn, ahora())))
    .get();
  if (!fila || !fila.u.activo) return null;
  return {
    id: fila.u.id,
    usuario: fila.u.usuario,
    nombre: fila.u.nombre,
    rolId: fila.r.id,
    rol: fila.r.nombre,
    permisos: fila.r.permisos as MapaPermisos,
    debeCambiarPassword: fila.u.debeCambiarPassword,
  };
}

export function cerrarSesion(db: DB, token: string | undefined, usuarioId: number | null) {
  if (!token) return;
  db.delete(sesiones).where(eq(sesiones.tokenHash, sha(token))).run();
  auditar(db, { usuarioId, accion: 'logout', entidad: 'sesion' });
}

export async function cambiarPassword(db: DB, usuarioId: number, actual: string, nueva: string) {
  const u = db.select().from(usuarios).where(eq(usuarios.id, usuarioId)).get();
  if (!u || !(await verify(u.passwordHash, actual))) throw new ErrorNegocio('La contraseña actual no es correcta', 400);
  validarPassword(nueva);
  const ph = await hashPassword(nueva);
  db.update(usuarios).set({ passwordHash: ph, debeCambiarPassword: false, actualizadoEn: ahora() }).where(eq(usuarios.id, usuarioId)).run();
  auditar(db, { usuarioId, accion: 'cambiar_password', entidad: 'usuario', entidadId: usuarioId });
}

/** Cierra todas las sesiones de un usuario (al desactivarlo o resetear su contraseña). */
export function cerrarSesionesDe(db: DB, usuarioId: number) {
  db.delete(sesiones).where(eq(sesiones.usuarioId, usuarioId)).run();
}
