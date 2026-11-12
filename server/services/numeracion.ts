import { sql } from 'drizzle-orm';
import { numeradores } from '../db/schema.js';
import type { DB } from '../db/index.js';

/** Próximo número correlativo para un tipo de documento (dentro de la transacción en curso). */
export function siguienteNumero(db: DB, clave: string): number {
  return db.insert(numeradores).values({ clave, ultimo: 1 })
    .onConflictDoUpdate({ target: numeradores.clave, set: { ultimo: sql`${numeradores.ultimo} + 1` } })
    .returning().get().ultimo;
}
