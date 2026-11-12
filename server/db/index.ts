import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import * as schema from './schema.js';

export type DB = BetterSQLite3Database<typeof schema>;

const aqui = path.dirname(fileURLToPath(import.meta.url));

/** Carpeta de migraciones: junto al código fuente (dev) o copiada al lado del build. */
export function carpetaMigraciones(): string {
  const candidatos = [path.join(aqui, 'migrations'), path.resolve(aqui, '../../../server/db/migrations')];
  const c = candidatos.find((p) => fs.existsSync(path.join(p, 'meta', '_journal.json')));
  if (!c) throw new Error('No se encontraron las migraciones de la base de datos');
  return c;
}

export interface Conexion {
  sqlite: Database.Database;
  db: DB;
  archivo: string;
}

/** Abre (o crea) la base, aplica pragmas de seguridad y corre las migraciones pendientes. */
export function abrirBase(archivo: string): Conexion {
  if (archivo !== ':memory:') fs.mkdirSync(path.dirname(archivo), { recursive: true });
  const sqlite = new Database(archivo);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: carpetaMigraciones() });
  return { sqlite, db, archivo };
}

/**
 * Contenedor de la conexión activa. Se usa un contenedor (y no una variable global fija)
 * porque restaurar un backup reemplaza el archivo y reabre la conexión.
 */
export class Base {
  private actual: Conexion;
  constructor(private readonly archivo: string) {
    this.actual = abrirBase(archivo);
  }
  get db(): DB { return this.actual.db; }
  get sqlite(): Database.Database { return this.actual.sqlite; }
  get ruta(): string { return this.archivo; }
  /** Ejecuta fn dentro de una transacción: todo o nada. */
  tx<T>(fn: (db: DB) => T): T {
    return this.actual.sqlite.transaction(() => fn(this.actual.db))();
  }
  cerrar() { this.actual.sqlite.close(); }
  reabrir() { this.actual = abrirBase(this.archivo); }
}
