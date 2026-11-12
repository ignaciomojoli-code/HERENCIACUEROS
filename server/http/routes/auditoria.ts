import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, gte, like, lte, sql } from 'drizzle-orm';
import type { Api } from '../app.js';
import { auditoria, usuarios } from '../../db/schema.js';

export async function rutasAuditoria(app: FastifyInstance, { base, requiere }: Api) {
  app.get('/auditoria', async (req) => {
    requiere(req, 'auditoria');
    const q = z.object({
      entidad: z.string().optional(), entidadId: z.string().optional(), usuarioId: z.coerce.number().optional(),
      desde: z.string().optional(), hasta: z.string().optional(), texto: z.string().optional(),
      pagina: z.coerce.number().int().min(1).default(1), porPagina: z.coerce.number().int().min(10).max(200).default(50),
    }).parse(req.query);
    const conds = [];
    if (q.entidad) conds.push(eq(auditoria.entidad, q.entidad));
    if (q.entidadId) conds.push(eq(auditoria.entidadId, q.entidadId));
    if (q.usuarioId) conds.push(eq(auditoria.usuarioId, q.usuarioId));
    if (q.desde) conds.push(gte(auditoria.fecha, q.desde));
    if (q.hasta) conds.push(lte(auditoria.fecha, q.hasta + 'T23:59:59.999Z'));
    if (q.texto) conds.push(like(sql`coalesce(${auditoria.detalle},'') || ' ' || coalesce(${auditoria.despues},'')`, `%${q.texto}%`));
    const where = conds.length ? and(...conds) : undefined;
    const total = base.db.select({ n: sql<number>`count(*)` }).from(auditoria).where(where).get()?.n ?? 0;
    const filas = base.db.select({ a: auditoria, usuario: usuarios.nombre }).from(auditoria).leftJoin(usuarios, eq(usuarios.id, auditoria.usuarioId))
      .where(where).orderBy(desc(auditoria.id)).limit(q.porPagina).offset((q.pagina - 1) * q.porPagina).all();
    return { total, filas: filas.map((f) => ({ ...f.a, usuario: f.usuario })) };
  });
}
