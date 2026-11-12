import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Api } from '../app.js';
import { COOKIE_SESION } from '../app.js';
import { cambiarPassword, cerrarSesion, crearAdministradorInicial, hayUsuarios, iniciarSesion } from '../../services/auth.js';
import { leerConfig } from '../../services/configuracion.js';

export async function rutasAuth(app: FastifyInstance, { base, requiere }: Api) {
  /** Estado público mínimo: si falta la configuración inicial y datos de marca para la pantalla de login. */
  app.get('/estado', async () => ({
    configurado: hayUsuarios(base.db),
    empresa: leerConfig(base.db, 'empresa').nombreFantasia,
    marca: leerConfig(base.db, 'marca'),
  }));

  app.post('/setup', async (req) => {
    const d = z.object({ usuario: z.string().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, 'solo letras, números, punto o guion'), nombre: z.string().min(1), password: z.string() }).parse(req.body);
    // El hash es asíncrono: se calcula fuera de la transacción y se inserta adentro.
    const u = await crearAdministradorInicial(base.db, d);
    return { ok: true, usuario: u.usuario };
  });

  app.post('/login', async (req, reply) => {
    const d = z.object({ usuario: z.string(), password: z.string() }).parse(req.body);
    const s = await iniciarSesion(base.db, d.usuario, d.password, { ip: req.ip, userAgent: req.headers['user-agent'] });
    reply.setCookie(COOKIE_SESION, s.token, { path: '/', httpOnly: true, sameSite: 'strict', expires: new Date(s.expira) });
    return { ok: true };
  });

  app.post('/logout', async (req, reply) => {
    cerrarSesion(base.db, req.cookies[COOKIE_SESION], req.usuario?.id ?? null);
    reply.clearCookie(COOKIE_SESION, { path: '/' });
    return { ok: true };
  });

  app.get('/yo', async (req) => requiere(req));

  app.post('/yo/password', async (req) => {
    const u = requiere(req);
    const d = z.object({ actual: z.string(), nueva: z.string() }).parse(req.body);
    await cambiarPassword(base.db, u.id, d.actual, d.nueva);
    return { ok: true };
  });
}
