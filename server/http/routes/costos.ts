import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Api } from '../app.js';
import * as co from '../../services/costos.js';
import { guardarConfig, leerConfig } from '../../services/configuracion.js';
import { auditar } from '../../services/auditoria.js';
import { ErrorNegocio } from '../../services/errores.js';
import { tienePermiso } from '../../domain/permisos.js';
import { filtrarCostos } from '../filtros.js';
import { enviarExport } from './plata.js';

const idDe = (req: FastifyRequest, clave = 'id') => {
  const n = Number((req.params as Record<string, string>)[clave]);
  if (!Number.isInteger(n) || n <= 0) throw new ErrorNegocio('Identificador inválido');
  return n;
};
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');
const entero = z.number().int();
const opt = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional();
/** En materiales, todo importe es un costo. */
const IMPORTES = /Centavos$|^historial$|^importe/;

export async function rutasCostos(app: FastifyInstance, { base, requiere, conIdempotencia }: Api) {
  const ctx = (req: FastifyRequest, db = base.db) => ({ db, usuarioId: req.usuario!.id });
  const puede = (req: FastifyRequest, m: Parameters<typeof tienePermiso>[1], a: Parameters<typeof tienePermiso>[2] = 'ver') => tienePermiso(req.usuario!.permisos, m, a);

  // ───────────── Materiales ─────────────

  app.get('/materiales', async (req) => { requiere(req, 'materiales'); return filtrarCostos(req, co.listarMateriales(base.db), IMPORTES); });
  app.get('/materiales/:id', async (req) => { requiere(req, 'materiales'); return filtrarCostos(req, co.detalleMaterial(base.db, idDe(req)), IMPORTES); });
  const esquemaMaterial = z.object({
    codigo: z.string(), nombre: z.string(), unidad: z.enum(['m', 'u', 'par', 'kg']), tipo: z.enum(['material', 'mano_obra']),
    costoCentavos: entero.min(0).nullable(), proveedorId: entero.nullable(), stockMinimoMil: opt(entero.min(0)), notas: opt(z.string()), activo: z.boolean().optional(),
    motivo: z.string().optional(),
  });
  app.post('/materiales', async (req) => {
    requiere(req, 'materiales', 'crear');
    const d = esquemaMaterial.parse(req.body);
    if (d.costoCentavos !== null && !puede(req, 'costos', 'modificar')) throw new ErrorNegocio('Tu rol no puede cargar costos', 403);
    return base.tx((db) => co.guardarMaterial(ctx(req, db), null, d));
  });
  app.put('/materiales/:id', async (req) => {
    requiere(req, 'materiales', 'modificar');
    const id = idDe(req);
    const d = esquemaMaterial.partial({ costoCentavos: true }).parse(req.body);
    return base.tx((db) => {
      const antes = co.materialOError(db, id);
      // Sin permiso de costos, el costo no se toca (ni se ve): se conserva el que tenía.
      const costo = puede(req, 'costos', 'modificar') && d.costoCentavos !== undefined ? d.costoCentavos : antes.costoCentavos;
      return co.guardarMaterial(ctx(req, db), id, { ...d, costoCentavos: costo }, d.motivo);
    });
  });
  app.post('/materiales/:id/ingresos', async (req, reply) => {
    requiere(req, 'materiales', 'crear');
    if (!puede(req, 'costos')) throw new ErrorNegocio('Cargar una compra de material requiere ver costos', 403);
    const d = z.object({ fecha, cantidadMil: entero.positive(), costoUnitarioCentavos: entero.min(0), proveedorId: opt(entero), comprobante: opt(z.string()), notas: opt(z.string()) }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => co.ingresarMaterial(ctx(req, db), { ...d, materialId: idDe(req) }));
  });
  app.post('/materiales/:id/ajustes', async (req, reply) => {
    requiere(req, 'materiales', 'modificar');
    const d = z.object({ fecha, cantidadMil: entero, motivo: z.string(), tipo: z.enum(['ajuste', 'inicial']).optional() }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => filtrarCostos(req, co.ajustarMaterial(ctx(req, db), { ...d, materialId: idDe(req) }), IMPORTES));
  });
  app.post('/materiales/movimientos/:id/anular', async (req) => {
    requiere(req, 'materiales', 'anular');
    const { motivo } = z.object({ motivo: z.string() }).parse(req.body);
    return base.tx((db) => co.anularMovimientoMaterial(ctx(req, db), idDe(req), motivo));
  });
  app.get('/materiales/exportar', async (req, reply) => {
    requiere(req, 'materiales', 'exportar');
    const { formato } = z.object({ formato: z.enum(['xlsx', 'csv']).default('xlsx') }).parse(req.query);
    const filas = co.listarMateriales(base.db).map((m) => ({ ...m, stock: m.stockMil === null ? null : m.stockMil / 1000, tipoNombre: m.tipo === 'mano_obra' ? 'Mano de obra' : 'Material' }));
    base.tx((db) => auditar(db, { usuarioId: req.usuario!.id, accion: 'exportar', entidad: 'materiales', detalle: `${filas.length} filas` }));
    const conCostos = puede(req, 'costos');
    return enviarExport(reply, formato, 'materiales', [
      { clave: 'codigo', titulo: 'Código', tipo: 'texto' }, { clave: 'nombre', titulo: 'Material', tipo: 'texto' }, { clave: 'tipoNombre', titulo: 'Tipo', tipo: 'texto' },
      { clave: 'unidad', titulo: 'Unidad', tipo: 'texto' }, { clave: 'stock', titulo: 'Stock', tipo: 'texto' }, { clave: 'proveedor', titulo: 'Proveedor', tipo: 'texto' },
      ...(conCostos ? [{ clave: 'costoCentavos', titulo: 'Costo por unidad', tipo: 'dinero' as const }] : []),
    ], filas);
  });

  // ───────────── Recetas ─────────────

  app.get('/recetas/:modeloId', async (req) => { requiere(req, 'materiales'); return filtrarCostos(req, co.obtenerReceta(base.db, idDe(req, 'modeloId')), IMPORTES); });
  app.put('/recetas/:modeloId', async (req) => {
    requiere(req, 'materiales', 'modificar');
    const { lineas } = z.object({ lineas: z.array(z.object({ materialId: entero, cantidadMil: entero.positive(), talles: opt(z.array(z.string())), notas: opt(z.string()) })) }).parse(req.body);
    return base.tx((db) => filtrarCostos(req, co.guardarReceta(ctx(req, db), idDe(req, 'modeloId'), lineas), IMPORTES));
  });

  // ───────────── Costeo y precios sugeridos ─────────────

  const ids = z.string().optional().transform((s) => (s ? s.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0) : undefined));
  app.get('/costeo', async (req) => {
    requiere(req, 'costos');
    const q = z.object({ modeloIds: ids }).parse(req.query);
    return co.costear(base.db, q.modeloIds);
  });
  app.post('/costeo/aplicar', async (req) => {
    requiere(req, 'costos', 'modificar');
    const d = z.object({ varianteIds: z.array(entero).min(1), motivo: z.string(), previstos: z.record(z.string(), entero).optional() }).parse(req.body);
    return base.tx((db) => co.aplicarCostos(ctx(req, db), d.varianteIds, d.motivo, d.previstos));
  });
  app.get('/costeo/componentes', async (req) => { requiere(req, 'costos'); return leerConfig(base.db, 'costos').componentes; });
  app.put('/costeo/componentes', async (req) => {
    requiere(req, 'costos', 'aprobar');
    const { componentes } = z.object({ componentes: z.array(z.unknown()) }).parse(req.body);
    return base.tx((db) => guardarConfig(db, 'costos', { componentes }, req.usuario!.id).componentes);
  });
  const paramsSugeridos = z.object({
    listaId: entero, metodo: z.enum(['margen', 'markup']), valorBp: entero.min(0).max(1_000_000), categoriaId: entero.optional(), modeloIds: z.array(entero).optional(),
    redondeoCentavos: entero.min(0).optional(), soloConCosto: z.boolean().optional(),
  });
  app.post('/precios-sugeridos', async (req) => {
    requiere(req, 'precios'); requiere(req, 'costos');
    return co.preciosSugeridos(base.db, paramsSugeridos.parse(req.body));
  });
  app.post('/precios-sugeridos/aplicar', async (req) => {
    requiere(req, 'precios', 'aprobar');
    const d = z.object({ listaId: entero, motivo: z.string(), cambios: z.array(z.object({ varianteId: entero, precioCentavos: entero.positive(), actualPrevisto: entero.nullable().optional() })).min(1) }).parse(req.body);
    return base.tx((db) => {
      // Si alguien cambió un precio desde que se armó la vista, no se pisa.
      const actuales = new Map(co.preciosActuales(db, d.listaId, d.cambios.map((c) => c.varianteId)));
      if (d.cambios.some((c) => c.actualPrevisto !== undefined && (actuales.get(c.varianteId) ?? null) !== c.actualPrevisto)) {
        throw new ErrorNegocio('Algún precio cambió desde que lo viste. Volvé a calcular antes de aplicar.', 409);
      }
      return co.aplicarPrecios(ctx(req, db), d.listaId, d.cambios, d.motivo);
    });
  });
}
