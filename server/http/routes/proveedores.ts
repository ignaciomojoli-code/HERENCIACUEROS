import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import type { Api } from '../app.js';
import { proveedores } from '../../db/schema.js';
import { auditar } from '../../services/auditoria.js';
import { ahora } from '../../services/tiempo.js';
import { ErrorNegocio, noEncontrado } from '../../services/errores.js';
import { normalizarClave } from '../../domain/texto.js';

const opt = z.string().trim().nullable().optional().transform((v) => v || null);
const esquema = z.object({
  nombre: z.string().trim().min(1), razonSocial: opt, cuit: opt, rubro: opt, contacto: opt, telefono: opt, email: opt,
  direccion: opt, condiciones: opt, plazoPagoDias: z.number().int().min(0).nullable().optional(), notas: opt,
  estado: z.enum(['activo', 'prospecto']).default('activo'), activo: z.boolean().default(true),
});

export async function rutasProveedores(app: FastifyInstance, { base, requiere }: Api) {
  app.get('/proveedores', async (req) => { requiere(req, 'proveedores'); return base.db.select().from(proveedores).orderBy(asc(proveedores.nombre)).all(); });

  app.post('/proveedores', async (req) => {
    const u = requiere(req, 'proveedores', 'crear');
    const d = esquema.parse(req.body);
    return base.tx((db) => {
      if (db.select().from(proveedores).all().some((p) => normalizarClave(p.nombre) === normalizarClave(d.nombre))) throw new ErrorNegocio('Ya existe un proveedor con ese nombre', 409);
      const t = ahora();
      const p = db.insert(proveedores).values({ ...d, plazoPagoDias: d.plazoPagoDias ?? null, creadoEn: t, actualizadoEn: t }).returning().get();
      auditar(db, { usuarioId: u.id, accion: 'crear', entidad: 'proveedor', entidadId: p.id, despues: p });
      return p;
    });
  });

  app.put('/proveedores/:id', async (req) => {
    const u = requiere(req, 'proveedores', 'modificar');
    const id = Number((req.params as { id: string }).id);
    const d = esquema.parse(req.body);
    return base.tx((db) => {
      const antes = db.select().from(proveedores).where(eq(proveedores.id, id)).get();
      if (!antes) throw noEncontrado('El proveedor');
      if (db.select().from(proveedores).all().some((p) => p.id !== id && normalizarClave(p.nombre) === normalizarClave(d.nombre))) throw new ErrorNegocio('Ya existe un proveedor con ese nombre', 409);
      const despues = db.update(proveedores).set({ ...d, plazoPagoDias: d.plazoPagoDias ?? null, actualizadoEn: ahora() }).where(eq(proveedores.id, id)).returning().get();
      auditar(db, { usuarioId: u.id, accion: 'modificar', entidad: 'proveedor', entidadId: id, antes, despues });
      return despues;
    });
  });
}
