/** Planillas subidas que se procesan en varios pasos (analizar → validar → confirmar). Viven en memoria una hora. */
import { randomUUID } from 'node:crypto';
import { leerCsv, leerXlsx, type HojaLeida } from './planillas.js';
import { ErrorNegocio } from './errores.js';

const archivos = new Map<string, { nombre: string; hojas: HojaLeida[]; usuarioId: number; creado: number }>();
const limpiar = () => { const lim = Date.now() - 3600_000; for (const [k, v] of archivos) if (v.creado < lim) archivos.delete(k); };

export async function guardarPlanilla(nombre: string, buf: Buffer, usuarioId: number) {
  limpiar();
  let hojas: HojaLeida[];
  if (/\.xlsx$/i.test(nombre)) hojas = await leerXlsx(buf);
  else if (/\.(csv|txt)$/i.test(nombre)) hojas = leerCsv(buf.toString('utf8'), nombre);
  else throw new ErrorNegocio('Formato no soportado: subí un .xlsx o .csv');
  const id = randomUUID();
  archivos.set(id, { nombre, hojas, usuarioId, creado: Date.now() });
  return { id, nombre, hojas };
}

export function obtenerHoja(id: string, hoja: string) {
  const a = archivos.get(id);
  if (!a) throw new ErrorNegocio('El archivo expiró: volvé a subirlo', 410);
  const h = a.hojas.find((x) => x.nombre === hoja);
  if (!h) throw new ErrorNegocio('Hoja inexistente');
  return { nombre: a.nombre, hoja: h };
}
export const olvidarPlanilla = (id: string) => archivos.delete(id);
