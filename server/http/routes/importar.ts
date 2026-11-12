import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { asc } from 'drizzle-orm';
import type { Api } from '../app.js';
import { listasPrecio } from '../../db/schema.js';
import { detectarEncabezado } from '../../services/planillas.js';
import { guardarPlanilla, obtenerHoja, olvidarPlanilla } from '../../services/archivos-temporales.js';
import { CAMPOS_PRODUCTO, confirmarImportacion, sugerirAsociacion, validarFilas, type Asociacion } from '../../services/importar-productos.js';
import { ErrorNegocio } from '../../services/errores.js';
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
}
