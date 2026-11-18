import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Api } from '../app.js';
import * as rp from '../../services/reportes.js';
import * as est from '../../services/estadisticas.js';
import { leerConfig } from '../../services/configuracion.js';
import { listarBackups } from '../../services/backups.js';
import { auditar } from '../../services/auditoria.js';
import { hoyLocal } from '../../services/caja.js';
import { ErrorNegocio } from '../../services/errores.js';
import { tienePermiso } from '../../domain/permisos.js';
import { filtrarCostos } from '../filtros.js';
import { enviarExport } from './plata.js';
import type { ColumnaExport } from '../../services/exportar.js';
import * as ac from '../../services/acreditaciones.js';

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');
const mes = z.string().regex(/^\d{4}-\d{2}$/, 'Mes inválido (AAAA-MM)');
/** Sin permiso de costos no se ve nada que derive del costo. */
const DERIVADOS_COSTO = /^ganancia|^margen|^resultado|^ventasSinCosto|^unidadesSinCosto|^sinCosto/;
const GASTOS = /^gastos/;

export async function rutasReportes(app: FastifyInstance, { base, requiere }: Api) {
  const puede = (req: FastifyRequest, m: Parameters<typeof tienePermiso>[1], a: Parameters<typeof tienePermiso>[2] = 'ver') => tienePermiso(req.usuario!.permisos, m, a);
  const rango = (req: FastifyRequest) => {
    const hoy = hoyLocal();
    const q = z.object({ desde: fecha.optional(), hasta: fecha.optional() }).parse(req.query);
    const r = { desde: q.desde ?? `${hoy.slice(0, 7)}-01`, hasta: q.hasta ?? hoy };
    if (r.desde > r.hasta) throw new ErrorNegocio('La fecha "desde" es posterior a "hasta"');
    if (rp.diasEntre(r.desde, r.hasta) > 366 * 3) throw new ErrorNegocio('Elegí un período de hasta 3 años');
    return r;
  };
  const sinGastos = <T>(req: FastifyRequest, d: T): T => {
    if (puede(req, 'gastos')) return d;
    const limpiar = (o: unknown): unknown => Array.isArray(o) ? o.map(limpiar) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([k]) => !GASTOS.test(k)).map(([k, v]) => [k, limpiar(v)])) : o;
    return limpiar(d) as T;
  };
  const auditarExport = (req: FastifyRequest, que: string, filas: number) => base.tx((db) => auditar(db, { usuarioId: req.usuario!.id, accion: 'exportar', entidad: 'reportes', detalle: `${que}: ${filas} filas` }));

  app.get('/panel', async (req) => {
    requiere(req, 'panel');
    if (!puede(req, 'ventas')) throw new ErrorNegocio('El panel muestra ventas: tu rol no las puede ver', 403);
    const { desde, hasta } = rango(req);
    return sinGastos(req, filtrarCostos(req, rp.panel(base.db, desde, hasta), DERIVADOS_COSTO));
  });

  // ── Estadísticas (etapa 7) ──
  // Facturado vs cobrado vs plata disponible: necesita ver ventas y caja.
  app.get('/estadisticas/plata', async (req) => {
    requiere(req, 'panel'); requiere(req, 'ventas'); requiere(req, 'caja');
    const { desde, hasta } = rango(req);
    return est.plata(base.db, desde, hasta);
  });
  // Foto de hoy. Sin permiso de costos no se ven valores a costo; sin caja, no se ven deudas.
  app.get('/estadisticas/situacion', async (req) => {
    requiere(req, 'panel');
    const s = filtrarCostos(req, est.situacion(base.db), /^valor/);
    return puede(req, 'caja') ? s : { ...s, deudas: null };
  });

  app.get('/alertas', async (req) => {
    const u = requiere(req);
    const ultimoBackup = tienePermiso(u.permisos, 'backups', 'ver') ? (listarBackups(base)[0]?.fecha ?? null) : undefined;
    return rp.alertas(base.db, u.permisos, { ultimoBackup });
  });

  // ── Estado de resultados (requiere ver costos: la ganancia depende del costo) ──
  const meses = (req: FastifyRequest) => {
    const hoy = hoyLocal();
    const q = z.object({ desde: mes.optional(), hasta: mes.optional() }).parse(req.query);
    const hasta = q.hasta ?? hoy.slice(0, 7);
    const [a, m] = hasta.split('-').map(Number);
    const desde = q.desde ?? (m >= 6 ? `${a}-${String(m - 5).padStart(2, '0')}` : `${a - 1}-${String(m + 7).padStart(2, '0')}`);
    if (desde > hasta) throw new ErrorNegocio('El mes "desde" es posterior a "hasta"');
    return { desde, hasta };
  };
  app.get('/reportes/resultados', async (req) => {
    requiere(req, 'panel'); requiere(req, 'costos'); requiere(req, 'gastos');
    const { desde, hasta } = meses(req);
    return rp.estadoResultados(base.db, desde, hasta);
  });
  app.get('/reportes/resultados/exportar', async (req, reply) => {
    requiere(req, 'panel', 'exportar'); requiere(req, 'costos'); requiere(req, 'gastos');
    const { desde, hasta } = meses(req);
    const { formato } = z.object({ formato: z.enum(['xlsx', 'csv']).default('xlsx') }).parse(req.query);
    const r = rp.estadoResultados(base.db, desde, hasta);
    // Una fila por concepto y una columna por mes, como se lee un estado de resultados.
    const concepto = (titulo: string, f: (x: (typeof r.filas)[number]) => number) => ({ concepto: titulo, ...Object.fromEntries(r.filas.map((x) => [x.mes, f(x)])), total: r.filas.reduce((s, x) => s + f(x), 0) });
    const filas = [
      concepto('Ventas', (x) => x.ventasCentavos), concepto('Costo de mercadería', (x) => -x.costoCentavos), concepto('Comisiones', (x) => -x.comisionesCentavos),
      concepto('Ventas de productos sin costo (no suman ganancia)', (x) => -x.ventasSinCostoCentavos), concepto('Ganancia bruta', (x) => x.gananciaBrutaCentavos),
      ...r.categoriasGasto.map((c) => concepto(`Gastos: ${c}`, (x) => -(x.gastos[c] ?? 0))),
      concepto('Resultado', (x) => x.resultadoCentavos), concepto('Retiros personales', (x) => -x.retirosCentavos), concepto('Aportes', (x) => x.aportesCentavos),
    ];
    const columnas: ColumnaExport[] = [{ clave: 'concepto', titulo: 'Concepto', tipo: 'texto' }, ...r.meses.map((m) => ({ clave: m, titulo: m.split('-').reverse().join('/'), tipo: 'dinero' as const })), { clave: 'total', titulo: 'Total', tipo: 'dinero' }];
    auditarExport(req, 'estado de resultados', filas.length);
    return enviarExport(reply, formato, `resultados-${desde}-a-${hasta}`, columnas, filas);
  });

  // ── Productos ──
  app.get('/reportes/productos', async (req) => {
    requiere(req, 'panel'); requiere(req, 'ventas');
    const { desde, hasta } = rango(req);
    return filtrarCostos(req, rp.rankingProductos(base.db, desde, hasta), DERIVADOS_COSTO);
  });
  app.get('/reportes/sin-movimiento', async (req) => {
    requiere(req, 'panel'); requiere(req, 'stock');
    const { dias } = z.object({ dias: z.coerce.number().int().min(7).max(3650).optional() }).parse(req.query);
    return filtrarCostos(req, rp.sinMovimiento(base.db, dias ?? leerConfig(base.db, 'alertas').diasSinVenta), /^valor/);
  });
  app.get('/reportes/productos/exportar', async (req, reply) => {
    requiere(req, 'panel', 'exportar'); requiere(req, 'ventas');
    const { desde, hasta } = rango(req);
    const { formato } = z.object({ formato: z.enum(['xlsx', 'csv']).default('xlsx') }).parse(req.query);
    const filas = rp.rankingProductos(base.db, desde, hasta).map((f) => ({ ...f, margen: f.margenBrutoBp === null ? '' : `${(f.margenBrutoBp / 100).toFixed(1)}%` }));
    const conCostos = puede(req, 'costos');
    auditarExport(req, 'ventas por producto', filas.length);
    return enviarExport(reply, formato, `productos-${desde}-a-${hasta}`, [
      { clave: 'modelo', titulo: 'Producto', tipo: 'texto' }, { clave: 'categoria', titulo: 'Categoría', tipo: 'texto' }, { clave: 'unidades', titulo: 'Unidades', tipo: 'numero' },
      { clave: 'totalCentavos', titulo: 'Ventas', tipo: 'dinero' },
      ...(conCostos ? [{ clave: 'costoCentavos', titulo: 'Costo', tipo: 'dinero' as const }, { clave: 'gananciaBrutaCentavos', titulo: 'Ganancia bruta', tipo: 'dinero' as const }, { clave: 'margen', titulo: 'Margen', tipo: 'texto' as const }] : []),
      { clave: 'stock', titulo: 'Stock actual', tipo: 'numero' },
    ], filas);
  });

  // ── Cobros, comisiones y acreditaciones ──
  const filtroCobros = (req: FastifyRequest) => {
    const r = rango(req);
    const q = z.object({
      formaPagoId: z.coerce.number().int().optional(), medio: z.string().optional(), procesador: z.string().optional(), cuotas: z.coerce.number().int().optional(),
      estado: z.enum(['pendiente', 'acreditado']).optional(), ventaNumero: z.coerce.number().int().optional(), comisionBp: z.coerce.number().int().optional(),
      importeMin: z.coerce.number().int().optional(), importeMax: z.coerce.number().int().optional(), conDiferencia: z.coerce.boolean().optional(),
    }).parse(req.query);
    return { ...r, ...Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) } as ac.FiltroCobros;
  };
  app.get('/reportes/cobros', async (req) => { requiere(req, 'panel'); requiere(req, 'caja'); return ac.reporteCobros(base.db, filtroCobros(req)); });
  app.get('/reportes/cobros/exportar', async (req, reply) => {
    requiere(req, 'panel', 'exportar'); requiere(req, 'caja');
    const f = filtroCobros(req);
    const { formato } = z.object({ formato: z.enum(['xlsx', 'csv']).default('xlsx') }).parse(req.query);
    const filas = ac.listarCobros(base.db, f).map((c) => ({
      ...c, venta: `V-${c.ventaNumero}`, porcentaje: `${(c.comisionBp / 100).toFixed(2)}%`, estadoTexto: c.estado === 'acreditado' ? 'Acreditado' : 'Pendiente',
      cuotasTexto: c.cuotas ?? '', procesadorTexto: c.procesador ?? '', fechaAcreditacionTexto: c.fechaAcreditacion ?? '',
    }));
    auditarExport(req, 'cobros y comisiones', filas.length);
    return enviarExport(reply, formato, `cobros-${f.desde}-a-${f.hasta}`, [
      { clave: 'fecha', titulo: 'Fecha', tipo: 'texto' }, { clave: 'venta', titulo: 'Venta', tipo: 'texto' }, { clave: 'forma', titulo: 'Medio de pago', tipo: 'texto' },
      { clave: 'procesadorTexto', titulo: 'Plataforma', tipo: 'texto' }, { clave: 'cuotasTexto', titulo: 'Cuotas', tipo: 'texto' },
      { clave: 'brutoCentavos', titulo: 'Bruto cobrado', tipo: 'dinero' }, { clave: 'porcentaje', titulo: 'Comisión %', tipo: 'texto' },
      { clave: 'comisionCentavos', titulo: 'Comisión', tipo: 'dinero' }, { clave: 'netoEsperadoCentavos', titulo: 'Neto esperado', tipo: 'dinero' },
      { clave: 'netoAcreditadoCentavos', titulo: 'Neto acreditado', tipo: 'dinero' }, { clave: 'diferenciaCentavos', titulo: 'Diferencia', tipo: 'dinero' },
      { clave: 'estadoTexto', titulo: 'Estado', tipo: 'texto' }, { clave: 'fechaAcreditacionTexto', titulo: 'Fecha de acreditación', tipo: 'texto' },
    ], filas);
  });
  app.get('/caja/acreditaciones', async (req) => { requiere(req, 'caja'); const r = rango(req); return ac.resumenAcreditaciones(base.db, r.desde, r.hasta); });
  app.post('/cobros/acreditar', async (req) => {
    requiere(req, 'caja', 'crear');
    const d = z.object({ cobroIds: z.array(z.number().int()).min(1), fecha, destinoId: z.number().int(), netoCentavos: z.number().int(), concepto: z.string().nullable().optional() }).parse(req.body);
    return base.tx((db) => ac.acreditarCobros({ db, usuarioId: req.usuario!.id }, d));
  });
}
