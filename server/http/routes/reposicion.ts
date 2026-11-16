/** Lista "para pedir" por proveedor. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Api } from '../app.js';
import * as rp from '../../services/reposicion.js';
import { ErrorNegocio } from '../../services/errores.js';
import { tienePermiso } from '../../domain/permisos.js';
import { filtrarCostos } from '../filtros.js';

export async function rutasReposicion(app: FastifyInstance, { base, requiere, conIdempotencia }: Api) {
  const ctx = (req: FastifyRequest, db = base.db) => ({ db, usuarioId: req.usuario!.id });
  app.get('/para-pedir', async (req) => { requiere(req, 'compras'); return filtrarCostos(req, rp.listarParaPedir(base.db)); });
  app.post('/para-pedir', async (req, reply) => {
    requiere(req, 'compras', 'crear');
    const d = z.object({ varianteId: z.number().int(), cantidad: z.number().int(), motivo: z.string().nullable().optional() }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => rp.agregarManual(ctx(req, db), d));
  });
  app.put('/para-pedir/:varianteId', async (req) => {
    requiere(req, 'compras', 'crear');
    const varianteId = Number((req.params as { varianteId: string }).varianteId);
    if (!Number.isInteger(varianteId) || varianteId <= 0) throw new ErrorNegocio('Producto inválido');
    const { cantidad } = z.object({ cantidad: z.number().int() }).parse(req.body);
    return base.tx((db) => rp.fijarCantidad(ctx(req, db), varianteId, cantidad));
  });
  app.get('/para-pedir/texto', async (req) => {
    requiere(req, 'compras');
    const { proveedorId } = z.object({ proveedorId: z.string() }).parse(req.query);
    return { texto: rp.textoPedido(base.db, proveedorId === 'ninguno' ? null : Number(proveedorId)) };
  });
  app.post('/para-pedir/armar', async (req, reply) => {
    requiere(req, 'compras', 'crear');
    if (!tienePermiso(req.usuario!.permisos, 'costos', 'ver')) throw new ErrorNegocio('Armar un pedido requiere ver costos: pedíselo a alguien de compras', 403);
    const d = z.object({ proveedorId: z.number().int(), tipo: z.enum(['reventa', 'confeccion']).optional(), varianteIds: z.array(z.number().int()).optional() }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => rp.armarPedido(ctx(req, db), d));
  });
}
