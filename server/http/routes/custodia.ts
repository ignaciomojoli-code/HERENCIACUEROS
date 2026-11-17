/** Custodia de materiales y producción: dónde está cada material, entregas entre lugares y pedidos al taller en curso. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Api } from '../app.js';
import * as cu from '../../services/custodia.js';
import { ErrorNegocio } from '../../services/errores.js';

const idDe = (req: FastifyRequest) => {
  const n = Number((req.params as { id: string }).id);
  if (!Number.isInteger(n) || n <= 0) throw new ErrorNegocio('Identificador inválido');
  return n;
};
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Fecha inválida');

export async function rutasCustodia(app: FastifyInstance, { base, requiere, conIdempotencia }: Api) {
  const ctx = (req: FastifyRequest, db = base.db) => ({ db, usuarioId: req.usuario!.id });
  app.get('/custodia', async (req) => { requiere(req, 'materiales'); return cu.resumenCustodia(base.db); });
  app.get('/custodia/lugares', async (req) => { requiere(req, 'materiales'); return cu.lugares(base.db); });
  app.get('/custodia/produccion', async (req) => { requiere(req, 'materiales'); return cu.produccionEnCurso(base.db); });
  app.get('/custodia/pedidos/:id', async (req) => { requiere(req, 'materiales'); return cu.materialesDePedido(base.db, idDe(req)); });
  app.get('/traslados', async (req) => {
    requiere(req, 'materiales');
    const q = z.object({ compraId: z.coerce.number().int().optional(), lugar: z.string().optional() }).parse(req.query);
    return cu.listarTraslados(base.db, { compraId: q.compraId, lugar: q.lugar === undefined || q.lugar === '' ? undefined : q.lugar === 'local' ? null : Number(q.lugar) });
  });
  app.post('/traslados', async (req, reply) => {
    requiere(req, 'materiales', 'modificar');
    const d = z.object({
      fecha, origenProveedorId: z.number().int().nullable(), destinoProveedorId: z.number().int().nullable(), compraId: z.number().int().nullable().optional(),
      notas: z.string().nullable().optional(), items: z.array(z.object({ materialId: z.number().int(), cantidadMil: z.number().int() })),
    }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => cu.crearTraslado(ctx(req, db), d));
  });
  app.post('/traslados/:id/anular', async (req) => {
    requiere(req, 'materiales', 'anular');
    const { motivo } = z.object({ motivo: z.string() }).parse(req.body);
    return base.tx((db) => cu.anularTraslado(ctx(req, db), idDe(req), motivo));
  });
}
