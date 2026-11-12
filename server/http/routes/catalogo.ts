import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { Api } from '../app.js';
import { categorias, colores, talles, listasPrecio } from '../../db/schema.js';
import * as cat from '../../services/catalogo.js';
import { auditar } from '../../services/auditoria.js';
import { ahora } from '../../services/tiempo.js';
import { ErrorNegocio, noEncontrado } from '../../services/errores.js';
import { tienePermiso } from '../../domain/permisos.js';
import { filtrarCostos } from '../filtros.js';
import { normalizarClave, prolijo } from '../../domain/texto.js';
import { aCsv, aXlsx, columnasCatalogo, filasCatalogo } from '../../services/exportar.js';

const idParam = (req: FastifyRequest) => {
  const n = Number((req.params as { id: string }).id);
  if (!Number.isInteger(n) || n <= 0) throw new ErrorNegocio('Identificador inválido');
  return n;
};
const centavos = z.number().int().min(0);
const textoOpc = z.string().trim().nullable().optional().transform((v) => v || null);

const esquemaModelo = z.object({
  nombre: z.string().trim().min(1),
  descripcion: textoOpc,
  categoriaId: z.number().int(),
  subcategoriaId: z.number().int().nullable().optional(),
  genero: z.enum(['Hombre', 'Mujer', 'Unisex']).nullable().optional(),
  marca: textoOpc,
  unidadId: z.number().int().nullable().optional(),
  proveedorId: z.number().int().nullable().optional(),
  impuestoBp: z.number().int().min(0).max(10000).nullable().optional(),
  notas: textoOpc,
});

const esquemaVariante = z.object({
  sku: z.string().trim().min(1),
  codigoBarras: textoOpc,
  colorId: z.number().int().nullable().optional(),
  talleId: z.number().int().nullable().optional(),
  costoCentavos: centavos.nullable().optional(),
  costoLogisticoCentavos: centavos.optional(),
  costoAdicionalCentavos: centavos.optional(),
  stockMinimo: z.number().int().min(0).nullable().optional(),
  stockMaximo: z.number().int().min(0).nullable().optional(),
  notas: textoOpc,
  precios: z.record(z.string(), centavos.nullable()).optional(),
});

type ConCostos = { costoCentavos?: unknown; costoLogisticoCentavos?: unknown; costoAdicionalCentavos?: unknown };

/** El stock se muestra solo a quien tiene permiso de ver stock. */
function sinStock<T>(req: FastifyRequest, data: T): T {
  if (tienePermiso(req.usuario!.permisos, 'stock', 'ver')) return data;
  const limpiar = (o: unknown): unknown => Array.isArray(o) ? o.map(limpiar) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'stock').map(([k, v]) => [k, limpiar(v)])) : o;
  return limpiar(data) as T;
}

export async function rutasCatalogo(app: FastifyInstance, { base, requiere, conIdempotencia }: Api) {
  const ctx = (req: FastifyRequest, db = base.db) => ({ db, usuarioId: req.usuario!.id });

  app.get('/catalogo/aux', async (req) => { requiere(req, 'catalogo'); return cat.listarAuxiliares(base.db); });

  // ── Categorías, colores y talles ──
  app.post('/catalogo/categorias', async (req) => {
    const u = requiere(req, 'catalogo', 'crear');
    const d = z.object({ nombre: z.string().trim().min(1), padreId: z.number().int().nullable().default(null) }).parse(req.body);
    return base.tx((db) => {
      if (cat.buscarCategoria(db, d.nombre, d.padreId)) throw new ErrorNegocio('Ya existe con ese nombre', 409);
      if (d.padreId) { const p = db.select().from(categorias).where(eq(categorias.id, d.padreId)).get(); if (!p || p.padreId) throw new ErrorNegocio('Categoría padre inválida'); }
      return cat.obtenerOCrearCategoria({ db, usuarioId: u.id }, d.nombre, d.padreId);
    });
  });
  app.put('/catalogo/categorias/:id', async (req) => {
    const u = requiere(req, 'catalogo', 'modificar');
    const id = idParam(req);
    const d = z.object({ nombre: z.string().trim().min(1), orden: z.number().int().default(0), activo: z.boolean() }).parse(req.body);
    return base.tx((db) => {
      const antes = db.select().from(categorias).where(eq(categorias.id, id)).get();
      if (!antes) throw noEncontrado('La categoría');
      const otra = cat.buscarCategoria(db, d.nombre, antes.padreId);
      if (otra && otra.id !== id) throw new ErrorNegocio('Ya existe con ese nombre', 409);
      const despues = db.update(categorias).set({ nombre: prolijo(d.nombre), orden: d.orden, activo: d.activo }).where(eq(categorias.id, id)).returning().get();
      auditar(db, { usuarioId: u.id, accion: 'modificar', entidad: 'categoria', entidadId: id, antes, despues });
      return despues;
    });
  });
  for (const [ruta, tabla, entidad] of [['colores', colores, 'color'], ['talles', talles, 'talle']] as const) {
    app.post(`/catalogo/${ruta}`, async (req) => {
      const u = requiere(req, 'catalogo', 'crear');
      const { nombre } = z.object({ nombre: z.string().trim().min(1) }).parse(req.body);
      return base.tx((db) => {
        if (db.select().from(tabla).all().some((x) => normalizarClave(x.nombre) === normalizarClave(nombre))) throw new ErrorNegocio('Ya existe', 409);
        return entidad === 'color' ? cat.obtenerOCrearColor({ db, usuarioId: u.id }, nombre) : cat.obtenerOCrearTalle({ db, usuarioId: u.id }, nombre);
      });
    });
    app.put(`/catalogo/${ruta}/:id`, async (req) => {
      const u = requiere(req, 'catalogo', 'modificar');
      const id = idParam(req);
      const d = z.object({ nombre: z.string().trim().min(1), activo: z.boolean(), orden: z.number().int().optional() }).parse(req.body);
      return base.tx((db) => {
        const antes = db.select().from(tabla).where(eq(tabla.id, id)).get();
        if (!antes) throw noEncontrado(entidad);
        if (db.select().from(tabla).all().some((x) => x.id !== id && normalizarClave(x.nombre) === normalizarClave(d.nombre))) throw new ErrorNegocio('Ya existe', 409);
        const valores = entidad === 'talle' ? { nombre: d.nombre, activo: d.activo, ...(d.orden !== undefined ? { orden: d.orden } : {}) } : { nombre: prolijo(d.nombre), activo: d.activo };
        const despues = db.update(tabla).set(valores as never).where(eq(tabla.id, id)).returning().get();
        auditar(db, { usuarioId: u.id, accion: 'modificar', entidad, entidadId: id, antes, despues });
        return despues;
      });
    });
  }

  // ── Listas de precio ──
  app.post('/catalogo/listas', async (req) => {
    const u = requiere(req, 'precios', 'crear');
    const d = z.object({ nombre: z.string().trim().min(1), descripcion: z.string().default(''), orden: z.number().int().default(10) }).parse(req.body);
    return base.tx((db) => {
      if (db.select().from(listasPrecio).all().some((l) => normalizarClave(l.nombre) === normalizarClave(d.nombre))) throw new ErrorNegocio('Ya existe una lista con ese nombre', 409);
      const t = ahora();
      const l = db.insert(listasPrecio).values({ ...d, creadoEn: t, actualizadoEn: t }).returning().get();
      auditar(db, { usuarioId: u.id, accion: 'crear', entidad: 'lista_precio', entidadId: l.id, despues: l });
      return l;
    });
  });

  // ── Modelos ──
  app.get('/catalogo/modelos', async (req) => {
    requiere(req, 'catalogo');
    const q = z.object({ q: z.string().optional(), categoriaId: z.coerce.number().int().optional(), estado: z.enum(['activos', 'inactivos', 'todos']).default('activos') }).parse(req.query);
    return sinStock(req, filtrarCostos(req, cat.listarModelos(base.db, q)));
  });
  app.get('/catalogo/modelos/:id', async (req) => { requiere(req, 'catalogo'); return sinStock(req, filtrarCostos(req, cat.obtenerModelo(base.db, idParam(req)))); });

  app.post('/catalogo/modelos', async (req, reply) => {
    requiere(req, 'catalogo', 'crear');
    const d = z.object({ modelo: esquemaModelo, variantes: z.array(esquemaVariante).default([]) }).parse(req.body);
    validarPermisosVariantes(req, d.variantes);
    return conIdempotencia(base, req, reply, (db) => {
      const m = cat.crearModelo(ctx(req, db), d.modelo, d.variantes.map(convertirVariante));
      return { id: m.id };
    });
  });
  app.put('/catalogo/modelos/:id', async (req) => {
    requiere(req, 'catalogo', 'modificar');
    const d = esquemaModelo.parse(req.body);
    return base.tx((db) => cat.actualizarModelo(ctx(req, db), idParam(req), d));
  });
  app.post('/catalogo/modelos/:id/estado', async (req) => {
    requiere(req, 'catalogo', 'anular');
    const d = z.object({ activo: z.boolean(), motivo: z.string().optional() }).parse(req.body);
    base.tx((db) => cat.cambiarEstadoModelo(ctx(req, db), idParam(req), d.activo, d.motivo));
    return { ok: true };
  });
  app.post('/catalogo/modelos/:id/duplicar', async (req, reply) => {
    requiere(req, 'catalogo', 'crear');
    const d = z.object({ nombre: z.string().trim().min(1), skuDe: z.string().optional(), skuA: z.string().optional(), sufijo: z.string().optional() }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => ({ id: cat.duplicarModelo(ctx(req, db), idParam(req), d).id }));
  });

  // ── Variantes ──
  app.post('/catalogo/modelos/:id/variantes', async (req, reply) => {
    requiere(req, 'catalogo', 'crear');
    const d = esquemaVariante.parse(req.body);
    validarPermisosVariantes(req, [d]);
    return conIdempotencia(base, req, reply, (db) => cat.crearVariante(ctx(req, db), idParam(req), convertirVariante(d)));
  });
  app.put('/catalogo/variantes/:id', async (req) => {
    requiere(req, 'catalogo', 'modificar');
    const d = esquemaVariante.partial().extend({ motivo: z.string().optional() }).parse(req.body);
    validarPermisosVariantes(req, [d]);
    return base.tx((db) => cat.actualizarVariante(ctx(req, db), idParam(req), convertirVariante(d), 'edicion', d.motivo));
  });
  app.post('/catalogo/variantes/:id/estado', async (req) => {
    requiere(req, 'catalogo', 'anular');
    const d = z.object({ activo: z.boolean(), motivo: z.string().optional() }).parse(req.body);
    base.tx((db) => cat.cambiarEstadoVariante(ctx(req, db), idParam(req), d.activo, d.motivo));
    return { ok: true };
  });

  // ── Precios masivos: previsualizar (ver) y aplicar (aprobar) ──
  const esquemaMasivo = z.object({
    listaId: z.number().int(), modeloIds: z.array(z.number().int()).optional(), categoriaId: z.number().int().optional(),
    tipo: z.enum(['porcentaje', 'fijo', 'desde_lista']), valor: z.number().int(), listaBaseId: z.number().int().optional(),
    redondeoCentavos: z.number().int().min(0).optional(), motivo: z.string().optional(),
  });
  app.post('/catalogo/precios/previsualizar', async (req) => {
    requiere(req, 'precios', 'ver');
    return filtrarCostos(req, cat.previsualizarCambioMasivo(base.db, esquemaMasivo.parse(req.body)));
  });
  app.post('/catalogo/precios/aplicar', async (req, reply) => {
    requiere(req, 'precios', 'aprobar');
    const d = esquemaMasivo.extend({ previstos: z.record(z.string(), z.number().int().nullable()).optional() }).parse(req.body);
    if (!d.motivo?.trim()) throw new ErrorNegocio('Indicá el motivo del cambio de precios');
    return conIdempotencia(base, req, reply, (db) => {
      // Lo que se aplica tiene que ser exactamente lo que se vio en la vista previa.
      if (d.previstos) {
        const ahoraCalc = cat.previsualizarCambioMasivo(db, d);
        const distinto = ahoraCalc.length !== Object.keys(d.previstos).length || ahoraCalc.some((f) => d.previstos![f.varianteId] !== f.nuevo);
        if (distinto) throw new ErrorNegocio('Los precios cambiaron desde la vista previa. Volvé a previsualizar antes de aplicar.', 409);
      }
      return cat.aplicarCambioMasivo(ctx(req, db), d);
    });
  });

  // ── Exportación ──
  app.get('/catalogo/exportar', async (req, reply) => {
    const u = requiere(req, 'catalogo', 'exportar');
    const q = z.object({ formato: z.enum(['xlsx', 'csv']).default('xlsx'), columnas: z.string().optional(), inactivos: z.coerce.boolean().default(false), categoriaId: z.coerce.number().int().optional() }).parse(req.query);
    const puedeCostos = tienePermiso(u.permisos, 'costos', 'ver');
    let cols = columnasCatalogo(base.db).filter((c) => !c.requiereCostos || puedeCostos);
    if (q.columnas) { const pedidas = q.columnas.split(','); cols = cols.filter((c) => pedidas.includes(c.clave)); }
    const filas = filasCatalogo(base.db, { incluirInactivos: q.inactivos, categoriaId: q.categoriaId });
    base.tx((db) => auditar(db, { usuarioId: u.id, accion: 'exportar', entidad: 'catalogo', detalle: `${q.formato}, ${filas.length} filas` }));
    const fecha = ahora().slice(0, 10);
    if (q.formato === 'csv') {
      reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="catalogo-${fecha}.csv"`);
      return aCsv(cols, filas);
    }
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition', `attachment; filename="catalogo-${fecha}.xlsx"`);
    return aXlsx('Catálogo', cols, filas);
  });
  app.get('/catalogo/exportar/columnas', async (req) => {
    const u = requiere(req, 'catalogo', 'exportar');
    return columnasCatalogo(base.db).filter((c) => !c.requiereCostos || tienePermiso(u.permisos, 'costos', 'ver'));
  });
}

function validarPermisosVariantes(req: FastifyRequest, vs: (ConCostos & { precios?: unknown })[]) {
  const p = req.usuario!.permisos;
  if (vs.some((v) => v.costoCentavos !== undefined || v.costoLogisticoCentavos !== undefined || v.costoAdicionalCentavos !== undefined) && !tienePermiso(p, 'costos', 'modificar')) {
    throw new ErrorNegocio('Tu rol no puede cargar ni modificar costos', 403);
  }
  if (vs.some((v) => v.precios && Object.keys(v.precios as object).length) && !tienePermiso(p, 'precios', 'modificar')) {
    throw new ErrorNegocio('Tu rol no puede cargar ni modificar precios', 403);
  }
}

function convertirVariante<T extends { precios?: Record<string, number | null> }>(v: T) {
  const { precios, ...resto } = v;
  return { ...resto, precios: precios ? Object.fromEntries(Object.entries(precios).map(([k, x]) => [Number(k), x])) : undefined } as unknown as cat.DatosVariante;
}
