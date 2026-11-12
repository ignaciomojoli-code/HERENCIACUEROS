import type { FastifyRequest } from 'fastify';
import { tienePermiso } from '../domain/permisos.js';

/**
 * Quita de una respuesta los campos de costo si el rol no puede verlos (se quitan en el servidor,
 * no solo se ocultan en pantalla). `extra` agrega otros campos a quitar (ej. importes de compras).
 */
export function filtrarCostos<T>(req: FastifyRequest, data: T, extra?: RegExp): T {
  if (tienePermiso(req.usuario!.permisos, 'costos', 'ver')) return data;
  const quitar = (k: string) => /^costo|historialCostos|sinCosto/i.test(k) || (extra?.test(k) ?? false);
  const limpiar = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(limpiar);
    if (o && typeof o === 'object') {
      const r: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) if (!quitar(k)) r[k] = limpiar(v);
      return r;
    }
    return o;
  };
  return limpiar(data) as T;
}
