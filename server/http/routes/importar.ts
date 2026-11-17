import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { asc } from 'drizzle-orm';
import type { Api } from '../app.js';
import { listasPrecio } from '../../db/schema.js';
import { detectarEncabezado } from '../../services/planillas.js';
import { guardarPlanilla, obtenerHoja, obtenerHojaONombre, olvidarPlanilla } from '../../services/archivos-temporales.js';
import { CAMPOS_PRODUCTO, confirmarImportacion, sugerirAsociacion, validarFilas, type Asociacion } from '../../services/importar-productos.js';
import { ErrorNegocio } from '../../services/errores.js';
import * as ic from '../../services/importar-compras.js';
import { tienePermiso, type MapaPermisos } from '../../domain/permisos.js';

/** Importar costos o precios exige los mismos permisos que cargarlos a mano. */
function validarPermisosColumnas(permisos: MapaPermisos, asoc: Record<string, number>, actualizar: boolean) {
  if (asoc.costo !== undefined && !tienePermiso(permisos, 'costos', 'modificar')) throw new ErrorNegocio('Tu rol no puede cargar costos: sacá la columna de costo', 403);
  if (Object.keys(asoc).some((k) => k.startsWith('precio:')) && !tienePermiso(permisos, 'precios', 'modificar')) throw new ErrorNegocio('Tu rol no puede cargar precios: sacá las columnas de precio', 403);
  if (actualizar && !tienePermiso(permisos, 'catalogo', 'modificar')) throw new ErrorNegocio('Tu rol no puede modificar productos existentes', 403);
}


export async function rutasImportar(app: FastifyInstance, { base, requiere }: Api) {
  app.post('/importar/analizar', async (req) => {
    const u = requiere(req, 'importacion', 'crear');
    const archivo = await req.file();
    if (!archivo) throw new ErrorNegocio('No llegó ningún archivo');
    const { id, nombre, hojas } = await guardarPlanilla(archivo.filename, await archivo.toBuffer(), u.id);
    const listas = base.db.select().from(listasPrecio).orderBy(asc(listasPrecio.orden)).all();
    return {
      id, nombre,
      campos: CAMPOS_PRODUCTO,
      listas: listas.map((l) => ({ id: l.id, nombre: l.nombre })),
      hojas: hojas.map((h) => {
        const enc = detectarEncabezado(h.filas);
        return { nombre: h.nombre, filas: h.filas.length, filaEncabezado: enc, encabezados: h.filas[enc] ?? [], muestra: h.filas.slice(enc + 1, enc + 11), sugerida: sugerirAsociacion(h.filas[enc] ?? [], listas) };
      }),
    };
  });

  const esquemaPaso = z.object({ id: z.string(), hoja: z.string(), filaEncabezado: z.number().int().min(0), asociacion: z.record(z.string(), z.number().int().min(0)) });

  app.post('/importar/validar', async (req) => {
    const u = requiere(req, 'importacion', 'crear');
    const d = esquemaPaso.parse(req.body);
    validarPermisosColumnas(u.permisos, d.asociacion, false);
    const { hoja } = obtenerHoja(d.id, d.hoja);
    const filas = validarFilas(base.db, hoja.filas, d.filaEncabezado, d.asociacion as Asociacion);
    const cuenta = (e: string) => filas.filter((f) => f.estado === e).length;
    return {
      resumen: { total: filas.length, nuevos: cuenta('nuevo'), actualiza: cuenta('actualiza'), sinCambios: cuenta('sin_cambios'), vacias: cuenta('vacia'), duplicadas: cuenta('duplicada'), errores: cuenta('error') },
      filas: filas.map(({ datos: _d, ...r }) => r),
    };
  });

  app.post('/importar/confirmar', async (req) => {
    const u = requiere(req, 'importacion', 'crear');
    const d = esquemaPaso.extend({ actualizarExistentes: z.boolean().default(false) }).parse(req.body);
    validarPermisosColumnas(u.permisos, d.asociacion, d.actualizarExistentes);
    const { nombre: nombreArchivo, hoja } = obtenerHoja(d.id, d.hoja);
    // Se valida de nuevo adentro de la transacción: la base pudo cambiar desde la vista previa.
    const r = base.tx((db) => {
      const filas = validarFilas(db, hoja.filas, d.filaEncabezado, d.asociacion as Asociacion);
      return confirmarImportacion({ db, usuarioId: u.id }, nombreArchivo, filas, { actualizarExistentes: d.actualizarExistentes });
    });
    olvidarPlanilla(d.id);
    return r;
  });

  // ───────────── Compras desde Excel ─────────────
  // Importar compras crea pedidos (y, si se elige, sus recepciones): pide permiso de importación y de compras.
  const permisosCompras = (req: Parameters<typeof requiere>[0]) => { const u = requiere(req, 'importacion', 'crear'); requiere(req, 'compras', 'crear'); return u; };

  app.post('/importar-compras/analizar', async (req) => {
    const u = permisosCompras(req);
    const archivo = await req.file();
    if (!archivo) throw new ErrorNegocio('No llegó ningún archivo');
    const { id, nombre, hojas } = await guardarPlanilla(archivo.filename, await archivo.toBuffer(), u.id);
    return {
      id, nombre, campos: ic.CAMPOS_COMPRA,
      hojas: hojas.map((h) => {
        const enc = detectarEncabezado(h.filas);
        return { nombre: h.nombre, filas: h.filas.length, filaEncabezado: enc, encabezados: h.filas[enc] ?? [], muestra: h.filas.slice(enc + 1, enc + 6), sugerida: ic.sugerirAsociacionCompra(h.filas[enc] ?? []) };
      }),
    };
  });

  app.post('/importar-compras/leer', async (req) => {
    permisosCompras(req);
    const d = esquemaPaso.parse(req.body);
    const { hoja } = obtenerHoja(d.id, d.hoja);
    return ic.revisarInicial(base.db, ic.leerLineas(base.db, hoja.filas, d.filaEncabezado, d.asociacion as ic.AsociacionCompra));
  });

  const linea = z.object({
    fila: z.number().int(), incluir: z.boolean(), fecha: z.string(), proveedor: z.string(), proveedorId: z.number().int().nullable(), comprobante: z.string(),
    codigo: z.string(), descripcion: z.string(), cantidad: z.string(), costoUnitarioCentavos: z.number().int().nullable(), notas: z.string(),
  });
  const lineas = z.object({ lineas: z.array(linea).max(5000) });

  app.post('/importar-compras/revisar', async (req) => { permisosCompras(req); return ic.revisar(base.db, lineas.parse(req.body).lineas); });

  app.post('/importar-compras/confirmar', async (req) => {
    const u = permisosCompras(req);
    const d = lineas.extend({ id: z.string(), modo: z.enum(['pedido', 'recibido']) }).parse(req.body);
    const { nombre } = obtenerHojaONombre(d.id);
    const r = base.tx((db) => ic.confirmarImportacionCompras({ db, usuarioId: u.id }, nombre, d.lineas, d.modo));
    olvidarPlanilla(d.id);
    return r;
  });

  app.get('/importar-compras/lotes', async (req) => { requiere(req, 'compras'); return ic.listarLotesCompras(base.db); });
  app.post('/importar-compras/lotes/:id/anular', async (req) => {
    const u = requiere(req, 'compras', 'anular');
    const id = Number((req.params as { id: string }).id);
    const { motivo } = z.object({ motivo: z.string() }).parse(req.body);
    return base.tx((db) => ic.anularLoteCompras({ db, usuarioId: u.id }, id, motivo));
  });
}
