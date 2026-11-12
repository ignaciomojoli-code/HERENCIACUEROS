import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { asc } from 'drizzle-orm';
import type { Api } from '../app.js';
import { listasPrecio } from '../../db/schema.js';
import { detectarEncabezado, leerCsv, leerXlsx, type HojaLeida } from '../../services/planillas.js';
import { CAMPOS_PRODUCTO, confirmarImportacion, sugerirAsociacion, validarFilas, type Asociacion } from '../../services/importar-productos.js';
import { ErrorNegocio } from '../../services/errores.js';
import { tienePermiso, type MapaPermisos } from '../../domain/permisos.js';

/** Importar costos o precios exige los mismos permisos que cargarlos a mano. */
function validarPermisosColumnas(permisos: MapaPermisos, asoc: Record<string, number>, actualizar: boolean) {
  if (asoc.costo !== undefined && !tienePermiso(permisos, 'costos', 'modificar')) throw new ErrorNegocio('Tu rol no puede cargar costos: sacá la columna de costo', 403);
  if (Object.keys(asoc).some((k) => k.startsWith('precio:')) && !tienePermiso(permisos, 'precios', 'modificar')) throw new ErrorNegocio('Tu rol no puede cargar precios: sacá las columnas de precio', 403);
  if (actualizar && !tienePermiso(permisos, 'catalogo', 'modificar')) throw new ErrorNegocio('Tu rol no puede modificar productos existentes', 403);
}

/** Archivos analizados en memoria, para no tener que subirlos de nuevo en cada paso (expiran a la hora). */
const archivos = new Map<string, { nombre: string; hojas: HojaLeida[]; usuarioId: number; creado: number }>();
const limpiar = () => { const lim = Date.now() - 3600_000; for (const [k, v] of archivos) if (v.creado < lim) archivos.delete(k); };

export async function rutasImportar(app: FastifyInstance, { base, requiere }: Api) {
  app.post('/importar/analizar', async (req) => {
    const u = requiere(req, 'importacion', 'crear');
    limpiar();
    const archivo = await req.file();
    if (!archivo) throw new ErrorNegocio('No llegó ningún archivo');
    const buf = await archivo.toBuffer();
    const nombre = archivo.filename;
    let hojas: HojaLeida[];
    if (/\.xlsx$/i.test(nombre)) hojas = await leerXlsx(buf);
    else if (/\.(csv|txt)$/i.test(nombre)) hojas = leerCsv(buf.toString('utf8'), nombre);
    else throw new ErrorNegocio('Formato no soportado: subí un .xlsx o .csv');
    const id = randomUUID();
    archivos.set(id, { nombre, hojas, usuarioId: u.id, creado: Date.now() });
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
    const a = archivos.get(d.id);
    if (!a) throw new ErrorNegocio('El archivo expiró: volvé a subirlo', 410);
    const hoja = a.hojas.find((h) => h.nombre === d.hoja);
    if (!hoja) throw new ErrorNegocio('Hoja inexistente');
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
    const a = archivos.get(d.id);
    if (!a) throw new ErrorNegocio('El archivo expiró: volvé a subirlo', 410);
    const hoja = a.hojas.find((h) => h.nombre === d.hoja);
    if (!hoja) throw new ErrorNegocio('Hoja inexistente');
    // Se valida de nuevo adentro de la transacción: la base pudo cambiar desde la vista previa.
    const r = base.tx((db) => {
      const filas = validarFilas(db, hoja.filas, d.filaEncabezado, d.asociacion as Asociacion);
      return confirmarImportacion({ db, usuarioId: u.id }, a.nombre, filas, { actualizarExistentes: d.actualizarExistentes });
    });
    archivos.delete(d.id);
    return r;
  });
}
