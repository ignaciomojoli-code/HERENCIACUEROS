import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Api } from '../app.js';
import * as cp from '../../services/compras.js';
import { ErrorNegocio } from '../../services/errores.js';
import { tienePermiso } from '../../domain/permisos.js';
import { filtrarCostos } from '../filtros.js';

const idDe = (req: FastifyRequest) => {
  const n = Number((req.params as { id: string }).id);
  if (!Number.isInteger(n) || n <= 0) throw new ErrorNegocio('Identificador inválido');
  return n;
};
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Fecha inválida');
const esquemaCompra = z.object({
  proveedorId: z.number().int(), tipo: z.enum(['reventa', 'confeccion']), fecha, fechaEsperada: fecha.nullable().optional(),
  notas: z.string().nullable().optional(),
  items: z.array(z.object({ varianteId: z.number().int(), cantidad: z.number().int(), costoUnitarioCentavos: z.number().int(), notas: z.string().nullable().optional() })),
});
/** Los importes de compras son costos: se quitan para los roles que no los pueden ver. */
const IMPORTES = /Centavos$/;

export async function rutasCompras(app: FastifyInstance, { base, requiere, conIdempotencia }: Api) {
  const ctx = (req: FastifyRequest, db = base.db) => ({ db, usuarioId: req.usuario!.id });
  const exigeCostos = (req: FastifyRequest) => {
    if (!tienePermiso(req.usuario!.permisos, 'costos', 'ver')) throw new ErrorNegocio('Armar un pedido requiere ver costos: pedíselo a alguien de compras', 403);
  };

  app.get('/compras', async (req) => {
    requiere(req, 'compras');
    const q = z.object({ proveedorId: z.coerce.number().int().optional(), estado: z.string().optional(), pendientes: z.coerce.boolean().optional() }).parse(req.query);
    return filtrarCostos(req, cp.listarCompras(base.db, q), IMPORTES);
  });
  app.get('/compras/:id', async (req) => { requiere(req, 'compras'); return filtrarCostos(req, cp.obtenerCompra(base.db, idDe(req)), IMPORTES); });
  app.post('/compras', async (req, reply) => {
    requiere(req, 'compras', 'crear'); exigeCostos(req);
    const d = esquemaCompra.extend({ confirmar: z.boolean().default(false) }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => ({ id: cp.crearCompra(ctx(req, db), d, d.confirmar).id }));
  });
  app.put('/compras/:id', async (req) => {
    requiere(req, 'compras', 'modificar'); exigeCostos(req);
    const d = esquemaCompra.parse(req.body);
    return base.tx((db) => cp.actualizarCompra(ctx(req, db), idDe(req), d));
  });
  app.post('/compras/:id/estado', async (req) => {
    const d = z.object({ accion: z.enum(['confirmar', 'cerrar', 'anular']), motivo: z.string().optional() }).parse(req.body);
    requiere(req, 'compras', d.accion === 'confirmar' ? 'crear' : d.accion === 'cerrar' ? 'modificar' : 'anular');
    return base.tx((db) => cp.cambiarEstadoCompra(ctx(req, db), idDe(req), d.accion, d.motivo));
  });
  app.post('/compras/:id/recepciones', async (req, reply) => {
    requiere(req, 'compras', 'crear');
    const d = z.object({
      fecha, comprobante: z.string().nullable().optional(), notas: z.string().nullable().optional(),
      items: z.array(z.object({ compraItemId: z.number().int(), cantidad: z.number().int().min(0), costoUnitarioCentavos: z.number().int().optional() })),
    }).parse(req.body);
    if (d.items.some((i) => i.costoUnitarioCentavos !== undefined) && !tienePermiso(req.usuario!.permisos, 'costos', 'modificar')) {
      throw new ErrorNegocio('Tu rol no puede cambiar el costo al recibir: se toma el del pedido', 403);
    }
    return conIdempotencia(base, req, reply, (db) => filtrarCostos(req, cp.recibir(ctx(req, db), idDe(req), d), /^cambiosCosto/));
  });
  app.post('/recepciones/:id/anular', async (req) => {
    requiere(req, 'compras', 'anular');
    const { motivo } = z.object({ motivo: z.string() }).parse(req.body);
    return base.tx((db) => cp.anularRecepcion(ctx(req, db), idDe(req), motivo));
  });
  app.get('/proveedores/:id/resumen', async (req) => {
    requiere(req, 'proveedores');
    return filtrarCostos(req, cp.resumenProveedor(base.db, idDe(req)), IMPORTES);
  });
}
