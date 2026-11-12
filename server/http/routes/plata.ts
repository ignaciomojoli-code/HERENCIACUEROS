/** Rutas de ventas, caja (cuentas, formas de pago, operaciones), gastos y pagos a proveedores. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Api } from '../app.js';
import * as cj from '../../services/caja.js';
import * as vt from '../../services/ventas.js';
import * as gs from '../../services/gastos.js';
import { ErrorNegocio } from '../../services/errores.js';
import { auditar } from '../../services/auditoria.js';
import { aCsv, aXlsx, type ColumnaExport } from '../../services/exportar.js';
import { tienePermiso } from '../../domain/permisos.js';
import { filtrarCostos } from '../filtros.js';

const idDe = (req: FastifyRequest) => {
  const n = Number((req.params as { id: string }).id);
  if (!Number.isInteger(n) || n <= 0) throw new ErrorNegocio('Identificador inválido');
  return n;
};
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');
const entero = z.number().int();
const opt = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional();
const motivo = z.object({ motivo: z.string() });
/** Ganancia y costo de mercadería: solo para quien ve costos. */
const GANANCIA = /^ganancia|^costoMercaderia/;

async function enviarExport(reply: FastifyReply, formato: 'xlsx' | 'csv', nombre: string, columnas: ColumnaExport[], filas: Record<string, unknown>[]) {
  if (formato === 'csv') {
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${nombre}.csv"`);
    return aCsv(columnas, filas);
  }
  reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', `attachment; filename="${nombre}.xlsx"`);
  return aXlsx(nombre, columnas, filas);
}

export async function rutasPlata(app: FastifyInstance, { base, requiere, conIdempotencia }: Api) {
  const ctx = (req: FastifyRequest, db = base.db) => ({ db, usuarioId: req.usuario!.id });
  const puede = (req: FastifyRequest, m: Parameters<typeof tienePermiso>[1], a: Parameters<typeof tienePermiso>[2] = 'ver') => tienePermiso(req.usuario!.permisos, m, a);
  const exportar = (req: FastifyRequest, modulo: 'ventas' | 'caja' | 'gastos', que: string, n: number) =>
    base.tx((db) => auditar(db, { usuarioId: req.usuario!.id, accion: 'exportar', entidad: modulo, detalle: `${que}: ${n} filas` }));

  // ───────────── Cuentas y formas de pago ─────────────

  app.get('/cuentas', async (req) => {
    requiere(req);
    const lista = cj.listarCuentas(base.db);
    // Quien solo vende ve las cuentas (para cobrar) pero no los saldos.
    if (!puede(req, 'caja')) return lista.map(({ saldoCentavos: _s, saldoArsCentavos: _a, movimientos: _m, ...c }) => c);
    return lista;
  });
  const esquemaCuenta = z.object({ nombre: z.string(), tipo: z.enum(['efectivo', 'banco', 'billetera', 'a_liquidar', 'externa']), moneda: z.enum(['ARS', 'USD']), orden: entero.optional(), activo: z.boolean().optional() });
  app.post('/cuentas', async (req) => { requiere(req, 'caja', 'aprobar'); const d = esquemaCuenta.parse(req.body); return base.tx((db) => cj.guardarCuenta(ctx(req, db), null, d)); });
  app.put('/cuentas/:id', async (req) => { requiere(req, 'caja', 'aprobar'); const d = esquemaCuenta.parse(req.body); return base.tx((db) => cj.guardarCuenta(ctx(req, db), idDe(req), d)); });

  app.get('/formas-pago', async (req) => { requiere(req); return cj.listarFormasPago(base.db); });
  const esquemaForma = z.object({ nombre: z.string(), cuentaId: entero, listaPrecioId: entero.nullable(), comisionBp: entero, orden: entero.optional(), activo: z.boolean().optional() });
  app.post('/formas-pago', async (req) => { requiere(req, 'caja', 'aprobar'); const d = esquemaForma.parse(req.body); return base.tx((db) => cj.guardarFormaPago(ctx(req, db), null, d)); });
  app.put('/formas-pago/:id', async (req) => { requiere(req, 'caja', 'aprobar'); const d = esquemaForma.parse(req.body); return base.tx((db) => cj.guardarFormaPago(ctx(req, db), idDe(req), d)); });

  // ───────────── Caja ─────────────

  const filtroCaja = z.object({
    cuentaId: z.coerce.number().int().optional(), desde: fecha.optional(), hasta: fecha.optional(), q: z.string().optional(),
    tipo: z.enum(['saldo_inicial', 'venta', 'comision', 'gasto', 'pago_proveedor', 'pase', 'liquidacion', 'aporte', 'retiro', 'ajuste', 'anulacion']).optional(),
    pagina: z.coerce.number().int().min(1).default(1),
  });
  app.get('/caja/movimientos', async (req) => { requiere(req, 'caja'); return cj.listarMovimientosCaja(base.db, filtroCaja.parse(req.query)); });
  app.get('/caja/resumen', async (req) => {
    requiere(req, 'caja');
    const { desde, hasta } = z.object({ desde: fecha.optional(), hasta: fecha.optional() }).parse(req.query);
    return { porTipo: cj.resumenCaja(base.db, desde, hasta), aportes: gs.aportesPorCuenta(base.db, desde, hasta) };
  });
  app.post('/caja/saldo-inicial', async (req, reply) => {
    requiere(req, 'caja', 'aprobar');
    const d = z.object({ cuentaId: entero, fecha, importeCentavos: entero }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => cj.cargarSaldoInicial(ctx(req, db), d));
  });
  app.post('/caja/pases', async (req, reply) => {
    requiere(req, 'caja', 'crear');
    const d = z.object({ fecha, origenId: entero, destinoId: entero, importeCentavos: entero, importeDestinoCentavos: opt(entero), concepto: opt(z.string()) }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => cj.pase(ctx(req, db), d));
  });
  app.post('/caja/liquidaciones', async (req, reply) => {
    requiere(req, 'caja', 'crear');
    const d = z.object({ fecha, origenId: entero, destinoId: entero, brutoCentavos: entero, netoCentavos: entero, concepto: opt(z.string()) }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => cj.liquidar(ctx(req, db), d));
  });
  app.post('/caja/aportes', async (req, reply) => {
    requiere(req, 'caja', 'crear');
    const d = z.object({ fecha, cuentaId: entero, importeCentavos: entero, aportante: z.string(), concepto: opt(z.string()) }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => cj.aporte(ctx(req, db), d));
  });
  app.post('/caja/retiros', async (req, reply) => {
    requiere(req, 'caja', 'crear');
    const d = z.object({ fecha, cuentaId: entero, importeCentavos: entero, concepto: z.string() }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => cj.retiro(ctx(req, db), d));
  });
  app.get('/caja/arqueos', async (req) => { requiere(req, 'caja'); const { cuentaId } = z.object({ cuentaId: z.coerce.number().int().optional() }).parse(req.query); return cj.listarArqueos(base.db, cuentaId); });
  app.post('/caja/arqueos', async (req, reply) => {
    requiere(req, 'caja', 'aprobar');
    const d = z.object({ fecha, cuentaId: entero, saldoRealCentavos: entero, notas: opt(z.string()) }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => cj.arquear(ctx(req, db), d));
  });
  app.post('/caja/operaciones/:grupo/anular', async (req) => {
    requiere(req, 'caja', 'anular');
    const { grupo } = z.object({ grupo: z.string().min(1) }).parse(req.params);
    return base.tx((db) => cj.anularOperacion(ctx(req, db), grupo, motivo.parse(req.body).motivo));
  });
  app.get('/caja/exportar', async (req, reply) => {
    requiere(req, 'caja', 'exportar');
    const f = filtroCaja.extend({ formato: z.enum(['xlsx', 'csv']).default('xlsx') }).parse(req.query);
    const { filas } = cj.listarMovimientosCaja(base.db, { ...f, pagina: 1, porPagina: 100000 });
    exportar(req, 'caja', 'movimientos de caja', filas.length);
    return enviarExport(reply, f.formato, 'caja', [
      { clave: 'fecha', titulo: 'Fecha', tipo: 'texto' }, { clave: 'cuenta', titulo: 'Cuenta', tipo: 'texto' }, { clave: 'tipoNombre', titulo: 'Tipo', tipo: 'texto' },
      { clave: 'concepto', titulo: 'Concepto', tipo: 'texto' }, { clave: 'moneda', titulo: 'Moneda', tipo: 'texto' }, { clave: 'importeCentavos', titulo: 'Importe', tipo: 'dinero' },
      { clave: 'importeArsCentavos', titulo: 'Importe en pesos', tipo: 'dinero' }, ...(f.cuentaId ? [{ clave: 'saldoCentavos', titulo: 'Saldo', tipo: 'dinero' as const }] : []),
    ], filas.reverse().map((m) => ({ ...m, tipoNombre: cj.NOMBRE_TIPO_CAJA[m.tipo] })));
  });

  // ───────────── Ventas ─────────────

  const filtroVentas = z.object({
    desde: fecha.optional(), hasta: fecha.optional(), q: z.string().optional(), formaPagoId: z.coerce.number().int().optional(),
    estado: z.enum(['confirmada', 'anulada']).optional(), pagina: z.coerce.number().int().min(1).default(1),
  });
  app.get('/ventas', async (req) => { requiere(req, 'ventas'); return filtrarCostos(req, vt.listarVentas(base.db, filtroVentas.parse(req.query)), GANANCIA); });
  app.get('/ventas/:id', async (req) => { requiere(req, 'ventas'); return filtrarCostos(req, vt.obtenerVenta(base.db, idDe(req)), GANANCIA); });
  app.get('/ventas/precios', async (req) => {
    requiere(req, 'ventas', 'crear');
    const { listaId, ids } = z.object({ listaId: z.coerce.number().int(), ids: z.string() }).parse(req.query);
    return vt.preciosDeLista(base.db, listaId, ids.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0));
  });
  app.post('/ventas', async (req, reply) => {
    requiere(req, 'ventas', 'crear');
    const d = z.object({
      fecha, cliente: opt(z.string()), listaPrecioId: opt(entero), notas: opt(z.string()),
      items: z.array(z.object({ varianteId: entero, cantidad: entero, precioCentavos: entero })),
      pagos: z.array(z.object({ formaPagoId: entero, importeCentavos: entero, importeMonedaCentavos: opt(entero), comisionRealCentavos: opt(entero) })),
    }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => vt.crearVenta(ctx(req, db), d));
  });
  app.post('/ventas/:id/anular', async (req) => {
    requiere(req, 'ventas', 'anular');
    return base.tx((db) => vt.anularVenta(ctx(req, db), idDe(req), motivo.parse(req.body).motivo));
  });
  app.put('/ventas/pagos/:id/comision', async (req) => {
    requiere(req, 'ventas', 'modificar');
    const { comisionRealCentavos } = z.object({ comisionRealCentavos: entero.nullable() }).parse(req.body);
    return base.tx((db) => vt.cargarComisionReal(ctx(req, db), idDe(req), comisionRealCentavos));
  });
  app.get('/ventas/exportar', async (req, reply) => {
    requiere(req, 'ventas', 'exportar');
    const f = filtroVentas.extend({ formato: z.enum(['xlsx', 'csv']).default('xlsx') }).parse(req.query);
    const { filas } = vt.listarVentas(base.db, { ...f, pagina: 1, porPagina: 100000 });
    exportar(req, 'ventas', 'ventas', filas.length);
    const costos = puede(req, 'costos');
    return enviarExport(reply, f.formato, 'ventas', [
      { clave: 'numero', titulo: 'N°', tipo: 'numero' }, { clave: 'fecha', titulo: 'Fecha', tipo: 'texto' }, { clave: 'skus', titulo: 'Códigos', tipo: 'texto' },
      { clave: 'productos', titulo: 'Productos', tipo: 'texto' }, { clave: 'unidades', titulo: 'Unidades', tipo: 'numero' }, { clave: 'formas', titulo: 'Forma de pago', tipo: 'texto' },
      { clave: 'listaCentavos', titulo: 'Precio de lista', tipo: 'dinero' }, { clave: 'totalCentavos', titulo: 'Total cobrado', tipo: 'dinero' },
      { clave: 'diferenciaListaCentavos', titulo: 'Diferencia vs lista', tipo: 'dinero' }, { clave: 'comisionCentavos', titulo: 'Comisión', tipo: 'dinero' },
      ...(costos ? [{ clave: 'costoMercaderiaCentavos', titulo: 'Costo mercadería', tipo: 'dinero' as const }, { clave: 'gananciaCentavos', titulo: 'Ganancia', tipo: 'dinero' as const }] : []),
      { clave: 'cliente', titulo: 'Cliente', tipo: 'texto' }, { clave: 'estado', titulo: 'Estado', tipo: 'texto' }, { clave: 'notas', titulo: 'Notas', tipo: 'texto' },
    ], filas.reverse());
  });

  // ───────────── Gastos ─────────────

  app.get('/gastos/categorias', async (req) => { requiere(req, 'gastos'); return gs.listarCategoriasGasto(base.db); });
  const esquemaCat = z.object({ nombre: z.string(), padreId: opt(entero), orden: entero.optional(), activo: z.boolean().optional() });
  app.post('/gastos/categorias', async (req) => { requiere(req, 'gastos', 'modificar'); const d = esquemaCat.parse(req.body); return base.tx((db) => gs.guardarCategoriaGasto(ctx(req, db), null, d)); });
  app.put('/gastos/categorias/:id', async (req) => { requiere(req, 'gastos', 'modificar'); const d = esquemaCat.parse(req.body); return base.tx((db) => gs.guardarCategoriaGasto(ctx(req, db), idDe(req), d)); });

  const filtroGastos = z.object({
    desde: fecha.optional(), hasta: fecha.optional(), categoriaId: z.coerce.number().int().optional(), subcategoriaId: z.coerce.number().int().optional(),
    cuentaId: z.coerce.number().int().optional(), q: z.string().optional(), estado: z.enum(['activo', 'anulado', 'todos']).default('activo'),
  });
  app.get('/gastos', async (req) => { requiere(req, 'gastos'); return gs.listarGastos(base.db, filtroGastos.parse(req.query)); });
  const datosGasto = z.object({ concepto: z.string(), categoriaId: entero, subcategoriaId: opt(entero), proveedorId: opt(entero), comprobante: opt(z.string()), notas: opt(z.string()) });
  app.post('/gastos', async (req, reply) => {
    requiere(req, 'gastos', 'crear');
    const d = datosGasto.extend({ fecha, importeCentavos: entero, cuentaId: entero }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => gs.crearGasto(ctx(req, db), d));
  });
  app.put('/gastos/:id', async (req) => { requiere(req, 'gastos', 'modificar'); const d = datosGasto.parse(req.body); return base.tx((db) => gs.editarGasto(ctx(req, db), idDe(req), d)); });
  app.post('/gastos/:id/anular', async (req) => { requiere(req, 'gastos', 'anular'); return base.tx((db) => gs.anularGasto(ctx(req, db), idDe(req), motivo.parse(req.body).motivo)); });
  app.get('/gastos/exportar', async (req, reply) => {
    requiere(req, 'gastos', 'exportar');
    const f = filtroGastos.extend({ formato: z.enum(['xlsx', 'csv']).default('xlsx') }).parse(req.query);
    const { filas } = gs.listarGastos(base.db, f);
    exportar(req, 'gastos', 'gastos', filas.length);
    return enviarExport(reply, f.formato, 'gastos', [
      { clave: 'numero', titulo: 'N°', tipo: 'numero' }, { clave: 'fecha', titulo: 'Fecha', tipo: 'texto' }, { clave: 'concepto', titulo: 'Concepto', tipo: 'texto' },
      { clave: 'categoria', titulo: 'Categoría', tipo: 'texto' }, { clave: 'subcategoria', titulo: 'Subcategoría', tipo: 'texto' }, { clave: 'importeCentavos', titulo: 'Importe', tipo: 'dinero' },
      { clave: 'cuenta', titulo: 'Pagado con', tipo: 'texto' }, { clave: 'proveedor', titulo: 'Proveedor', tipo: 'texto' }, { clave: 'comprobante', titulo: 'Comprobante', tipo: 'texto' },
      { clave: 'estado', titulo: 'Estado', tipo: 'texto' }, { clave: 'notas', titulo: 'Notas', tipo: 'texto' },
    ], filas.reverse());
  });

  // ───────────── Pagos a proveedores ─────────────

  app.get('/pagos-proveedores', async (req) => {
    requiere(req, 'caja');
    const f = z.object({ proveedorId: z.coerce.number().int().optional(), desde: fecha.optional(), hasta: fecha.optional(), estado: z.enum(['activo', 'anulado', 'todos']).default('activo') }).parse(req.query);
    return gs.listarPagos(base.db, f);
  });
  app.post('/pagos-proveedores', async (req, reply) => {
    requiere(req, 'caja', 'crear');
    const d = z.object({ fecha, proveedorId: entero, compraId: opt(entero), cuentaId: entero, importeCentavos: entero, comprobante: opt(z.string()), notas: opt(z.string()) }).parse(req.body);
    return conIdempotencia(base, req, reply, (db) => gs.crearPago(ctx(req, db), d));
  });
  app.post('/pagos-proveedores/:id/anular', async (req) => { requiere(req, 'caja', 'anular'); return base.tx((db) => gs.anularPago(ctx(req, db), idDe(req), motivo.parse(req.body).motivo)); });
  /** Cuenta corriente: recibido valorizado (es un costo) menos pagos. Requiere ver caja y costos. */
  app.get('/proveedores/:id/cuenta-corriente', async (req) => {
    requiere(req, 'caja');
    if (!puede(req, 'costos')) throw new ErrorNegocio('La cuenta corriente muestra costos: tu rol no los puede ver', 403);
    return gs.cuentaCorrienteProveedor(base.db, idDe(req));
  });
  app.get('/proveedores/saldos', async (req) => {
    requiere(req, 'caja');
    if (!puede(req, 'costos')) return {};
    return Object.fromEntries(gs.saldosProveedores(base.db));
  });
}
