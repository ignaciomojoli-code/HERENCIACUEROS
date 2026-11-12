/** Normalización de textos para comparar nombres y códigos sin duplicar por mayúsculas o espacios. */
export function normalizarClave(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Nombre prolijo: espacios colapsados y primera letra en mayúscula. */
export function prolijo(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** Códigos SKU: se respetan tal cual los usa el negocio, sin espacios sobrantes.
 *  La comparación entre códigos no distingue mayúsculas (acc-003 = ACC-003). */
export function normalizarSku(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}
