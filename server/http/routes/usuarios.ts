import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, ne } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import type { Api } from '../app.js';
import { roles, usuarios } from '../../db/schema.js';
import { cerrarSesionesDe, hashPassword, validarPassword } from '../../services/auth.js';
import { auditar } from '../../services/auditoria.js';
import { ahora } from '../../services/tiempo.js';
import { ErrorNegocio, noEncontrado } from '../../services/errores.js';
import { ACCIONES, MODULOS, normalizarPermisos } from '../../domain/permisos.js';

const sinHash = <T extends { passwordHash?: string }>(u: T) => { const { passwordHash: _, ...resto } = u; return resto; };

export async function rutasUsuarios(app: FastifyInstance, { base, requiere }: Api) {
  app.get('/permisos/catalogo', async (req) => { requiere(req); return { modulos: MODULOS, acciones: ACCIONES }; });

  app.get('/usuarios', async (req) => {
    requiere(req, 'usuarios');
    return base.db.select({ u: usuarios, rol: roles.nombre }).from(usuarios).innerJoin(roles, eq(roles.id, usuarios.rolId)).orderBy(asc(usuarios.nombre)).all()
      .map((x) => ({ ...sinHash(x.u), rol: x.rol }));
  });

  app.post('/usuarios', async (req) => {
    const yo = requiere(req, 'usuarios', 'crear');
    const d = z.object({ usuario: z.string().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/), nombre: z.string().min(1), rolId: z.number().int(), password: z.string() }).parse(req.body);
    validarPassword(d.password);
    const ph = await hashPassword(d.password);
    return base.tx((db) => {
      if (!db.select().from(roles).where(eq(roles.id, d.rolId)).get()) throw noEncontrado('El rol');
      if (db.select().from(usuarios).where(eq(usuarios.usuario, d.usuario.toLowerCase())).get()) throw new ErrorNegocio('Ese nombre de usuario ya existe', 409);
      const t = ahora();
      const u = db.insert(usuarios).values({ usuario: d.usuario.toLowerCase(), nombre: d.nombre.trim(), rolId: d.rolId, passwordHash: ph, debeCambiarPassword: true, creadoEn: t, actualizadoEn: t }).returning().get();
      auditar(db, { usuarioId: yo.id, accion: 'crear', entidad: 'usuario', entidadId: u.id, despues: sinHash(u) });
      return sinHash(u);
    });
  });

  app.put('/usuarios/:id', async (req) => {
    const yo = requiere(req, 'usuarios', 'modificar');
    const id = Number((req.params as { id: string }).id);
    const d = z.object({ nombre: z.string().min(1), rolId: z.number().int(), activo: z.boolean() }).parse(req.body);
    return base.tx((db) => {
      const antes = db.select().from(usuarios).where(eq(usuarios.id, id)).get();
      if (!antes) throw noEncontrado('El usuario');
      if (id === yo.id && (!d.activo || d.rolId !== antes.rolId)) throw new ErrorNegocio('No podés desactivarte ni cambiarte el rol a vos mismo');
      validarQueQuedeAdmin(db, id, d.rolId, d.activo);
      const despues = db.update(usuarios).set({ ...d, actualizadoEn: ahora() }).where(eq(usuarios.id, id)).returning().get();
      if (!d.activo) cerrarSesionesDe(db, id);
      auditar(db, { usuarioId: yo.id, accion: 'modificar', entidad: 'usuario', entidadId: id, antes: sinHash(antes), despues: sinHash(despues) });
      return sinHash(despues);
    });
  });

  app.post('/usuarios/:id/password', async (req) => {
    const yo = requiere(req, 'usuarios', 'modificar');
    const id = Number((req.params as { id: string }).id);
    const { password } = z.object({ password: z.string() }).parse(req.body);
    validarPassword(password);
    const ph = await hashPassword(password);
    base.tx((db) => {
      if (!db.select().from(usuarios).where(eq(usuarios.id, id)).get()) throw noEncontrado('El usuario');
      db.update(usuarios).set({ passwordHash: ph, debeCambiarPassword: true, actualizadoEn: ahora() }).where(eq(usuarios.id, id)).run();
      cerrarSesionesDe(db, id);
      auditar(db, { usuarioId: yo.id, accion: 'resetear_password', entidad: 'usuario', entidadId: id });
    });
    return { ok: true };
  });

  app.get('/roles', async (req) => { requiere(req, 'usuarios'); return base.db.select().from(roles).orderBy(asc(roles.id)).all(); });

  const esquemaRol = z.object({ nombre: z.string().min(1), descripcion: z.string().default(''), permisos: z.record(z.string(), z.array(z.string())) });

  app.post('/roles', async (req) => {
    const yo = requiere(req, 'usuarios', 'crear');
    const d = esquemaRol.parse(req.body);
    return base.tx((db) => {
      if (db.select().from(roles).where(eq(roles.nombre, d.nombre.trim())).get()) throw new ErrorNegocio('Ya existe un rol con ese nombre', 409);
      const t = ahora();
      const r = db.insert(roles).values({ nombre: d.nombre.trim(), descripcion: d.descripcion, permisos: normalizarPermisos(d.permisos), creadoEn: t, actualizadoEn: t }).returning().get();
      auditar(db, { usuarioId: yo.id, accion: 'crear', entidad: 'rol', entidadId: r.id, despues: r });
      return r;
    });
  });

  app.put('/roles/:id', async (req) => {
    const yo = requiere(req, 'usuarios', 'modificar');
    const id = Number((req.params as { id: string }).id);
    const d = esquemaRol.parse(req.body);
    return base.tx((db) => {
      const antes = db.select().from(roles).where(eq(roles.id, id)).get();
      if (!antes) throw noEncontrado('El rol');
      if (antes.esSistema) throw new ErrorNegocio('El rol Administrador no se puede modificar: siempre tiene acceso total');
      const despues = db.update(roles).set({ nombre: d.nombre.trim(), descripcion: d.descripcion, permisos: normalizarPermisos(d.permisos), actualizadoEn: ahora() }).where(eq(roles.id, id)).returning().get();
      auditar(db, { usuarioId: yo.id, accion: 'modificar', entidad: 'rol', entidadId: id, antes, despues });
      return despues;
    });
  });
}

/** Siempre tiene que quedar al menos un administrador activo. */
function validarQueQuedeAdmin(db: DB, usuarioId: number, nuevoRolId: number, activo: boolean) {
  const admin = db.select().from(roles).where(eq(roles.esSistema, true)).get();
  if (!admin) return;
  const otros = db.select().from(usuarios).where(and(eq(usuarios.rolId, admin.id), eq(usuarios.activo, true), ne(usuarios.id, usuarioId))).all();
  if (otros.length === 0 && (nuevoRolId !== admin.id || !activo)) throw new ErrorNegocio('Tiene que quedar al menos un Administrador activo');
}
