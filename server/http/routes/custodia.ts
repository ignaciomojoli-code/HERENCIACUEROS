/** Custodia de materiales y producción: dónde está cada material, entregas entre lugares y pedidos al taller en curso. */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Api } from '../app.js';
import * as cu from '../../services/custodia.js';
import * as ab from '../../services/abastecimiento.js';
import { aXlsx } from '../../services/exportar.js';
import { filtrarCostos } from '../filtros.js';
import { tienePermiso } from '../../domain/permisos.js';
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
      notas: z.string().nullable().optional(), items: z.array(z.object({ materialId: z.number().int(), colorId: z.number().int().nullable().optional(), cantidadMil: z.number().int() })),
    }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => cu.crearTraslado(ctx(req, db), d));
  });
  app.post('/traslados/:id/anular', async (req) => {
    requiere(req, 'materiales', 'anular');
    const { motivo } = z.object({ motivo: z.string() }).parse(req.body);
    return base.tx((db) => cu.anularTraslado(ctx(req, db), idDe(req), motivo));
  });

  // ── Abastecimiento de un pedido de confección: necesidades, reservas, entregas y sugerencias de compra ──
  const linea = z.object({ materialId: z.number().int(), colorId: z.number().int().nullable().optional(), cantidadMil: z.number().int().min(0) });
  app.get('/abastecimiento/:id', async (req) => { requiere(req, 'materiales'); return filtrarCostos(req, ab.abastecimiento(base.db, idDe(req))); });
  app.get('/abastecimiento/:id/excel', async (req, reply) => {
    requiere(req, 'materiales');
    const { a, filas } = ab.planillaAbastecimiento(base.db, idDe(req));
    const cols = [
      { clave: 'seccion', titulo: 'Sección', tipo: 'texto' as const }, { clave: 'material', titulo: 'Material', tipo: 'texto' as const }, { clave: 'unidad', titulo: 'Unidad', tipo: 'texto' as const },
      { clave: 'cantidad', titulo: 'Cantidad', tipo: 'numero' as const }, { clave: 'detalle', titulo: 'Detalle', tipo: 'texto' as const },
      { clave: 'necesita', titulo: 'Necesita (lo que falta hacer)', tipo: 'numero' as const }, { clave: 'taller', titulo: 'Ya lo tiene el taller', tipo: 'numero' as const }, { clave: 'falta', titulo: 'Falta entregar', tipo: 'numero' as const },
    ];
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition', `attachment; filename="abastecimiento-P-${a.numero}.xlsx"`);
    return aXlsx(`Abastecimiento P-${a.numero}`, cols, filas);
  });
  app.post('/abastecimiento/:id/reservas', async (req) => {
    requiere(req, 'materiales', 'modificar');
    const d = z.object({ lineas: z.array(linea), motivo: z.string().nullable().optional() }).parse(req.body);
    return base.tx((db) => ab.reservar(ctx(req, db), idDe(req), d.lineas, d.motivo));
  });
  app.post('/abastecimiento/:id/reservar-disponible', async (req) => { requiere(req, 'materiales', 'modificar'); return base.tx((db) => ab.reservarDisponible(ctx(req, db), idDe(req))); });
  app.post('/abastecimiento/:id/liberar', async (req) => {
    requiere(req, 'materiales', 'modificar');
    const d = z.object({ motivo: z.string().nullable().optional() }).parse(req.body ?? {});
    return base.tx((db) => ab.liberarReservas(ctx(req, db), idDe(req), d.motivo));
  });
  app.post('/abastecimiento/:id/entregar', async (req, reply) => {
    requiere(req, 'materiales', 'modificar');
    const d = z.object({ fecha: fecha.optional(), notas: z.string().nullable().optional(), items: z.array(linea).optional() }).parse(req.body ?? {});
    return conIdempotencia(base, req, reply, (db) => ab.entregarReservado(ctx(req, db), idDe(req), d));
  });
  app.post('/abastecimiento/:id/armar-compras', async (req, reply) => {
    requiere(req, 'compras', 'crear');
    if (!tienePermiso(req.usuario!.permisos, 'costos', 'ver')) throw new ErrorNegocio('Armar un pedido requiere ver costos: pedíselo a alguien de compras', 403);
    const d = z.object({ grupos: z.array(z.object({ proveedorId: z.number().int(), lineas: z.array(linea.extend({ costoUnitarioCentavos: z.number().int().nullable().optional() })) })) }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => ab.armarCompras(ctx(req, db), idDe(req), d.grupos));
  });
}
