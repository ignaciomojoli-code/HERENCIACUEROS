/** Lista "para pedir" por proveedor. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Api } from '../app.js';
import * as rp from '../../services/reposicion.js';
import * as rm from '../../services/reposicionMateriales.js';
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

  // ───── Reposición de materiales por receta ─────
  const idDe = (req: FastifyRequest) => {
    const n = Number((req.params as { id: string }).id);
    if (!Number.isInteger(n) || n <= 0) throw new ErrorNegocio('Identificador inválido');
    return n;
  };
  const motivo = z.string().nullable().optional();
  app.get('/reposicion-materiales', async (req) => {
    requiere(req, 'compras');
    base.tx((db) => rm.cerrarDecisionesVencidas(ctx(req, db)));
    return filtrarCostos(req, rm.reposicionPorProveedor(base.db));
  });
  app.get('/reposicion-materiales/texto', async (req) => {
    requiere(req, 'compras');
    const { proveedorId } = z.object({ proveedorId: z.string() }).parse(req.query);
    return { texto: rm.textoPedidoMateriales(base.db, proveedorId === 'ninguno' ? null : Number(proveedorId)) };
  });
  app.post('/reposicion-materiales/posponer', async (req) => {
    requiere(req, 'compras', 'crear');
    const d = z.object({ materialId: z.number().int(), hasta: z.string(), motivo }).parse(req.body);
    return base.tx((db) => rm.posponer(ctx(req, db), d));
  });
  app.post('/reposicion-materiales/descartar', async (req) => {
    requiere(req, 'compras', 'crear');
    const d = z.object({ materialId: z.number().int(), cantidadMil: z.number().int().optional(), motivo: z.string() }).parse(req.body);
    return base.tx((db) => rm.descartar(ctx(req, db), d));
  });
  app.post('/reposicion-materiales/proveedor', async (req) => {
    requiere(req, 'compras', 'crear');
    const d = z.object({ materialId: z.number().int(), proveedorId: z.number().int(), motivo }).parse(req.body);
    return base.tx((db) => rm.cambiarProveedor(ctx(req, db), d));
  });
  app.post('/reposicion-materiales/decisiones/:id/anular', async (req) => {
    requiere(req, 'compras', 'crear');
    return base.tx((db) => rm.anularDecision(ctx(req, db), idDe(req)));
  });
  app.post('/reposicion-materiales/armar', async (req, reply) => {
    requiere(req, 'compras', 'crear');
    if (!tienePermiso(req.usuario!.permisos, 'costos', 'ver')) throw new ErrorNegocio('Armar un pedido requiere ver costos: pedíselo a alguien de compras', 403);
    const d = z.object({ proveedorId: z.number().int(), notas: z.string().nullable().optional(), lineas: z.array(z.object({ materialId: z.number().int(), cantidadMil: z.number().int(), costoUnitarioCentavos: z.number().int().nullable().optional() })) }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => rm.armarPedidoMateriales(ctx(req, db), d));
  });
}
