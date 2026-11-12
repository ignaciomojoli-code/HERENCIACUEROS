import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import type { Base, DB } from '../db/index.js';
import { usuarioDeToken, type UsuarioSesion } from '../services/auth.js';
import { ErrorNegocio } from '../services/errores.js';
import { tienePermiso, type Accion, type Modulo } from '../domain/permisos.js';
import { idempotencia } from '../db/schema.js';
import { ahora } from '../services/tiempo.js';
import { rutasAuth } from './routes/auth.js';
import { rutasUsuarios } from './routes/usuarios.js';
import { rutasConfig } from './routes/config.js';
import { rutasCatalogo } from './routes/catalogo.js';
import { rutasImportar } from './routes/importar.js';
import { rutasBackups } from './routes/backups.js';
import { rutasAuditoria } from './routes/auditoria.js';
import { rutasProveedores } from './routes/proveedores.js';

export const COOKIE_SESION = 'hc_sesion';

declare module 'fastify' {
  interface FastifyRequest { usuario: UsuarioSesion | null }
}

export interface OpcionesApp { base: Base; carpetaWeb?: string; logger?: boolean }

export async function crearApp({ base, carpetaWeb, logger = false }: OpcionesApp) {
  const app = Fastify({ logger, bodyLimit: 5 * 1024 * 1024, trustProxy: false });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

  app.decorateRequest('usuario', null);
  app.addHook('onRequest', async (req) => {
    req.usuario = usuarioDeToken(base.db, req.cookies[COOKIE_SESION]);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ErrorNegocio) return reply.status(err.status).send({ error: err.message, detalles: err.detalles });
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'Datos inválidos: ' + err.issues.map((i) => `${i.path.join('.') || 'dato'}: ${i.message}`).join('; ') });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Ocurrió un error inesperado. No se guardó ningún cambio.' });
  });

  const api = { base, requiere, conIdempotencia };
  await app.register(async (r) => {
    await rutasAuth(r, api);
    await rutasUsuarios(r, api);
    await rutasConfig(r, api);
    await rutasCatalogo(r, api);
    await rutasProveedores(r, api);
    await rutasImportar(r, api);
    await rutasBackups(r, api);
    await rutasAuditoria(r, api);
  }, { prefix: '/api' });

  app.all('/api/*', async (_req, reply) => reply.status(404).send({ error: 'Ruta inexistente' }));

  if (carpetaWeb && fs.existsSync(path.join(carpetaWeb, 'index.html'))) {
    await app.register(fastifyStatic, { root: carpetaWeb, wildcard: false });
    // Aplicación de una sola página: cualquier ruta que no sea de la API devuelve index.html
    app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html'));
  }
  return app;
}

/** Corta la petición si no hay sesión o si el rol no tiene el permiso. */
export function requiere(req: FastifyRequest, modulo?: Modulo, accion: Accion = 'ver'): UsuarioSesion {
  const u = req.usuario;
  if (!u) throw new ErrorNegocio('Tenés que iniciar sesión', 401);
  if (modulo && !tienePermiso(u.permisos, modulo, accion)) {
    throw new ErrorNegocio(`Tu rol (${u.rol}) no tiene permiso para ${accion} en ${modulo}`, 403);
  }
  return u;
}

/**
 * Evita registrar dos veces la misma operación (doble clic, reintento por corte de red):
 * si la petición trae el encabezado Idempotency-Key ya procesado, devuelve la respuesta guardada.
 * La operación y el registro de la clave van en la misma transacción.
 */
export function conIdempotencia<T>(base: Base, req: FastifyRequest, reply: FastifyReply, fn: (db: DB) => T): T {
  const clave = req.headers['idempotency-key'];
  if (typeof clave !== 'string' || !clave) return base.tx(fn);
  const previa = base.db.select().from(idempotencia).where(eq(idempotencia.clave, clave)).get();
  if (previa) { reply.header('Idempotent-Replay', 'true'); return previa.respuesta as T; }
  return base.tx((db) => {
    const r = fn(db);
    db.insert(idempotencia).values({ clave, usuarioId: req.usuario?.id ?? null, ruta: req.url, respuesta: (r ?? null) as never, creadoEn: ahora() }).run();
    return r;
  });
}

export type Api = { base: Base; requiere: typeof requiere; conIdempotencia: typeof conIdempotencia };
