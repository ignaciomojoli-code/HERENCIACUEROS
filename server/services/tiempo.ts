/** Fecha y hora actual en ISO (UTC). Centralizado para poder fijarlo en los tests. */
let ahoraFijo: string | null = null;
export function ahora(): string { return ahoraFijo ?? new Date().toISOString(); }
export function fijarAhora(iso: string | null) { ahoraFijo = iso; }
