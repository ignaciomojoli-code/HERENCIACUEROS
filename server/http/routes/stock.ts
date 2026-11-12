import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, eq, or, sql } from 'drizzle-orm';
import type { Api } from '../app.js';
import { colores, modelos, talles, variantes } from '../../db/schema.js';
import * as st from '../../services/stock.js';
import * as cnt from '../../services/conteos.js';
import { auditar } from '../../services/auditoria.js';
import { ErrorNegocio } from '../../services/errores.js';
import { ahora } from '../../services/tiempo.js';
import { detectarEncabezado } from '../../services/planillas.js';
import { guardarPlanilla, obtenerHoja, olvidarPlanilla } from '../../services/archivos-temporales.js';
import { aCsv, aXlsx, type ColumnaExport } from '../../services/exportar.js';
import { tienePermiso } from '../../domain/permisos.js';
import { filtrarCostos } from '../filtros.js';

const idDe = (req: FastifyRequest) => {
  const n = Number((req.params as { id: string }).id);
  if (!Number.isInteger(n) || n <= 0) throw new ErrorNegocio('Identificador inválido');
  return n;
};
const filtroStock = z.object({
  q: z.string().optional(), categoriaId: z.coerce.number().int().optional(),
  filtro: z.enum(['todos', 'con_stock', 'sin_stock', 'bajo_minimo', 'negativo']).default('todos'),
});

export async function rutasStock(app: FastifyInstance, { base, requiere, conIdempotencia }: Api) {
  const ctx = (req: FastifyRequest, db = base.db) => ({ db, usuarioId: req.usuario!.id });

  app.get('/stock', async (req) => {
    requiere(req, 'stock');
    const f = filtroStock.parse(req.query);
    const filas = st.listarStock(base.db, f);
    const totales = {
      variantes: filas.length,
      unidades: filas.reduce((s, r) => s + Math.max(0, r.stock), 0),
      valorCostoCentavos: filas.reduce((s, r) => s + (r.stock > 0 && r.costoCentavos ? r.stock * r.costoCentavos : 0), 0),
      valorVentaCentavos: filas.reduce((s, r) => s + (r.stock > 0 && r.precioCentavos ? r.stock * r.precioCentavos : 0), 0),
      sinCosto: filas.filter((r) => r.stock > 0 && r.costoCentavos == null).length,
    };
    return filtrarCostos(req, { filas, totales }, /^valorCosto/);
  });

  /** Buscador de variantes para pedidos, ajustes y conteos (por código, código de barras, producto o color). */
  app.get('/stock/buscar', async (req) => {
    requiere(req, 'stock');
    const { q, categoriaId } = z.object({ q: z.string().default(''), categoriaId: z.coerce.number().int().optional() }).parse(req.query);
    const t = q.trim();
    if (!t) return [];
    const like = `%${t}%`;
    const filas = base.db.select({
      varianteId: variantes.id, sku: variantes.sku, codigoBarras: variantes.codigoBarras, modelo: modelos.nombre, color: colores.nombre, talle: talles.nombre,
      costoCentavos: variantes.costoCentavos, proveedorId: modelos.proveedorId,
      exacto: sql<number>`lower(${variantes.sku}) = lower(${t}) or ${variantes.codigoBarras} = ${t}`,
    }).from(variantes).innerJoin(modelos, eq(modelos.id, variantes.modeloId))
      .leftJoin(colores, eq(colores.id, variantes.colorId)).leftJoin(talles, eq(talles.id, variantes.talleId))
      .where(and(eq(variantes.activo, true), categoriaId ? eq(modelos.categoriaId, categoriaId) : undefined,
        or(sql`${variantes.sku} like ${like}`, sql`${variantes.codigoBarras} = ${t}`, sql`${modelos.nombre} like ${like}`, sql`(${modelos.nombre} || ' ' || coalesce(${colores.nombre}, '')) like ${like}`)))
      .orderBy(sql`(lower(${variantes.sku}) = lower(${t}) or ${variantes.codigoBarras} = ${t}) desc`, modelos.nombre, talles.orden).limit(25).all();
    const stock = st.stockDe(base.db, filas.map((f) => f.varianteId));
    return filtrarCostos(req, filas.map((f) => ({ ...f, exacto: !!f.exacto, stock: stock.get(f.varianteId) ?? 0 })));
  });

  app.get('/stock/variante/:id', async (req) => { requiere(req, 'stock'); return filtrarCostos(req, st.kardex(base.db, idDe(req))); });

  app.get('/stock/movimientos', async (req) => {
    requiere(req, 'stock');
    const q = z.object({
      desde: z.string().optional(), hasta: z.string().optional(), q: z.string().optional(),
      tipo: z.enum(['inicial', 'compra', 'ajuste', 'conteo', 'venta', 'devolucion', 'produccion', 'anulacion']).optional(),
      pagina: z.coerce.number().int().min(1).default(1),
    }).parse(req.query);
    return filtrarCostos(req, st.listarMovimientos(base.db, q));
  });

  app.post('/stock/ajustes', async (req, reply) => {
    requiere(req, 'stock', 'crear');
    const d = z.object({ varianteId: z.number().int(), cantidad: z.number().int(), motivo: z.string() }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => st.ajustarStock(ctx(req, db), d));
  });

  app.get('/stock/exportar', async (req, reply) => {
    const u = requiere(req, 'stock', 'exportar');
    const q = filtroStock.extend({ formato: z.enum(['xlsx', 'csv']).default('xlsx') }).parse(req.query);
    const costos = tienePermiso(u.permisos, 'costos', 'ver');
    const cols: ColumnaExport[] = [
      { clave: 'sku', titulo: 'Código', tipo: 'texto' }, { clave: 'categoria', titulo: 'Categoría', tipo: 'texto' }, { clave: 'modelo', titulo: 'Producto', tipo: 'texto' },
      { clave: 'color', titulo: 'Color', tipo: 'texto' }, { clave: 'talle', titulo: 'Talle', tipo: 'texto' }, { clave: 'stock', titulo: 'Stock', tipo: 'numero' },
      { clave: 'stockMinimo', titulo: 'Mínimo', tipo: 'numero' },
      ...(costos ? [{ clave: 'costoCentavos', titulo: 'Costo unitario', tipo: 'dinero' as const }, { clave: 'valorCosto', titulo: 'Valor al costo', tipo: 'dinero' as const }] : []),
      { clave: 'precioCentavos', titulo: 'Precio efectivo', tipo: 'dinero' }, { clave: 'valorVenta', titulo: 'Valor a precio efectivo', tipo: 'dinero' },
    ];
    const filas = st.listarStock(base.db, q).map((r) => ({ ...r, valorCosto: r.costoCentavos != null ? r.stock * r.costoCentavos : null, valorVenta: r.precioCentavos != null ? r.stock * r.precioCentavos : null }));
    base.tx((db) => auditar(db, { usuarioId: u.id, accion: 'exportar', entidad: 'stock', detalle: `${q.formato}, ${filas.length} filas` }));
    const fecha = ahora().slice(0, 10);
    if (q.formato === 'csv') {
      reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="stock-${fecha}.csv"`);
      return aCsv(cols, filas);
    }
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('Content-Disposition', `attachment; filename="stock-${fecha}.xlsx"`);
    return aXlsx('Stock', cols, filas);
  });

  // ── Stock inicial desde planilla ──
  app.post('/stock/inicial/analizar', async (req) => {
    const u = requiere(req, 'stock', 'aprobar');
    const archivo = await req.file();
    if (!archivo) throw new ErrorNegocio('No llegó ningún archivo');
    const { id, nombre, hojas } = await guardarPlanilla(archivo.filename, await archivo.toBuffer(), u.id);
    return {
      id, nombre,
      hojas: hojas.map((h) => {
        const enc = detectarEncabezado(h.filas);
        const titulos = h.filas[enc] ?? [];
        const buscar = (re: RegExp) => { const i = titulos.findIndex((t) => re.test(t)); return i >= 0 ? i : undefined; };
        return { nombre: h.nombre, filas: h.filas.length, filaEncabezado: enc, encabezados: titulos, sugerida: { sku: buscar(/c[oó]digo|sku/i), cantidad: buscar(/stock actual/i) ?? buscar(/^stock/i) ?? buscar(/cantidad/i) } };
      }),
    };
  });
  const pasoInicial = z.object({ id: z.string(), hoja: z.string(), filaEncabezado: z.number().int().min(0), colSku: z.number().int().min(0), colCantidad: z.number().int().min(0) });
  const filasDe = (d: z.infer<typeof pasoInicial>) => {
    const { nombre, hoja } = obtenerHoja(d.id, d.hoja);
    return { nombre, filas: hoja.filas.slice(d.filaEncabezado + 1).map((f, i) => ({ fila: d.filaEncabezado + i + 2, sku: f[d.colSku] ?? '', cantidad: f[d.colCantidad] ?? '' })) };
  };
  app.post('/stock/inicial/validar', async (req) => {
    requiere(req, 'stock', 'aprobar');
    const filas = st.validarStockInicial(base.db, filasDe(pasoInicial.parse(req.body)).filas);
    const cuenta = (e: string) => filas.filter((f) => f.estado === e).length;
    return { resumen: { ok: cuenta('ok'), unidades: filas.filter((f) => f.estado === 'ok').reduce((s, f) => s + f.cantidad!, 0), cero: cuenta('cero'), noExiste: cuenta('no_existe'), yaTiene: cuenta('ya_tiene'), invalidas: cuenta('invalida'), duplicadas: cuenta('duplicada') }, filas };
  });
  app.post('/stock/inicial/confirmar', async (req) => {
    const u = requiere(req, 'stock', 'aprobar');
    const d = pasoInicial.extend({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body);
    const { nombre, filas } = filasDe(d);
    const r = base.tx((db) => st.confirmarStockInicial({ db, usuarioId: u.id }, st.validarStockInicial(db, filas), `${d.fecha}T12:00:00.000Z`, nombre));
    olvidarPlanilla(d.id);
    return r;
  });

  // ── Conteos físicos ──
  app.get('/conteos', async (req) => { requiere(req, 'stock'); return cnt.listarConteos(base.db); });
  app.post('/conteos', async (req, reply) => {
    requiere(req, 'stock', 'crear');
    const d = z.object({ categoriaId: z.number().int().nullable().optional(), notas: z.string().nullable().optional() }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => cnt.crearConteo(ctx(req, db), d));
  });
  app.get('/conteos/:id', async (req) => { requiere(req, 'stock'); return cnt.obtenerConteo(base.db, idDe(req)); });
  app.put('/conteos/:id/items', async (req) => {
    requiere(req, 'stock', 'crear');
    const d = z.object({ items: z.array(z.object({ varianteId: z.number().int(), contado: z.number().int().nullable() })).min(1) }).parse(req.body);
    base.tx((db) => cnt.cargarConteo(ctx(req, db), idDe(req), d.items));
    return { ok: true };
  });
  app.post('/conteos/:id/aplicar', async (req) => { requiere(req, 'stock', 'aprobar'); return base.tx((db) => cnt.aplicarConteo(ctx(req, db), idDe(req))); });
  app.post('/conteos/:id/descartar', async (req) => { requiere(req, 'stock', 'anular'); base.tx((db) => cnt.descartarConteo(ctx(req, db), idDe(req))); return { ok: true }; });
}
