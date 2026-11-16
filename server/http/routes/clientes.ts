import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Api } from '../app.js';
import * as cl from '../../services/clientes.js';

const opt = z.string().trim().nullable().optional();
const esquema = z.object({ nombre: z.string(), telefono: opt, email: opt, documento: opt, notas: opt, activo: z.boolean().optional() });
const idDe = (req: FastifyRequest) => Number((req.params as { id: string }).id);

export async function rutasClientes(app: FastifyInstance, { base, requiere }: Api) {
  const ctx = (req: FastifyRequest, db = base.db) => ({ db, usuarioId: req.usuario!.id });
  app.get('/clientes', async (req) => { requiere(req, 'ventas'); return cl.listarClientes(base.db); });
  app.get('/clientes/:id', async (req) => { requiere(req, 'ventas'); return cl.obtenerCliente(base.db, idDe(req)); });
  app.post('/clientes', async (req) => { requiere(req, 'ventas', 'crear'); const d = esquema.parse(req.body); return base.tx((db) => cl.guardarCliente(ctx(req, db), null, d)); });
  app.put('/clientes/:id', async (req) => { requiere(req, 'ventas', 'modificar'); const d = esquema.parse(req.body); return base.tx((db) => cl.guardarCliente(ctx(req, db), idDe(req), d)); });
}
