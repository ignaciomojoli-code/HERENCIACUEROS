import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Api } from '../app.js';
import * as cb from '../../services/comprobantes.js';
import { ErrorNegocio } from '../../services/errores.js';
import type { Modulo } from '../../domain/permisos.js';

/** Qué permiso hace falta para ver o adjuntar en cada tipo de documento. */
const MODULO: Record<cb.EntidadAdjunto, Modulo> = { compra: 'compras', recepcion: 'compras', pago_proveedor: 'caja', gasto: 'gastos' };
const entidad = z.enum(cb.ENTIDADES_ADJUNTO);
const idDe = (req: FastifyRequest) => {
  const n = Number((req.params as { id: string }).id);
  if (!Number.isInteger(n) || n <= 0) throw new ErrorNegocio('Identificador inválido');
  return n;
};

export async function rutasAdjuntos(app: FastifyInstance, { base, requiere }: Api) {
  const ctx = (req: FastifyRequest, db = base.db) => ({ db, usuarioId: req.usuario!.id });
  app.get('/adjuntos', async (req) => {
    const q = z.object({ entidad, entidadId: z.coerce.number().int() }).parse(req.query);
    requiere(req, MODULO[q.entidad]);
    return cb.listarAdjuntos(base.db, q.entidad, q.entidadId);
  });
  app.post('/adjuntos/:entidad/:id', async (req) => {
    const e = entidad.parse((req.params as { entidad: string }).entidad);
    requiere(req, MODULO[e], 'crear');
    const archivo = await req.file();
    if (!archivo) throw new ErrorNegocio('No llegó ningún archivo');
    const datos = await archivo.toBuffer();
    return base.tx((db) => cb.subirAdjunto(ctx(req, db), { entidad: e, entidadId: idDe(req), nombre: archivo.filename, tipo: archivo.mimetype, datos }));
  });
  app.get('/adjuntos/:id', async (req, reply) => {
    const a = cb.obtenerAdjunto(base.db, idDe(req));
    requiere(req, MODULO[a.entidad as cb.EntidadAdjunto]);
    const nombre = encodeURIComponent(a.nombre);
    reply.header('content-type', a.tipo).header('content-disposition', `inline; filename*=UTF-8''${nombre}`).header('cache-control', 'private, max-age=3600');
    return reply.send(a.datos);
  });
  app.post('/adjuntos/:id/quitar', async (req) => {
    const a = cb.obtenerAdjunto(base.db, idDe(req));
    requiere(req, MODULO[a.entidad as cb.EntidadAdjunto], 'anular');
    const { motivo } = z.object({ motivo: z.string() }).parse(req.body);
    return base.tx((db) => cb.quitarAdjunto(ctx(req, db), a.id, motivo));
  });
}
