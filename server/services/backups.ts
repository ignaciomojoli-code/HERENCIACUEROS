/**
 * Copias de seguridad de la base SQLite.
 * - Usa la API de backup en línea de SQLite: la copia es consistente aunque el sistema esté en uso.
 * - Retención: los N backups más recientes de los últimos días + 1 por mes de los últimos M meses.
 * - Restaurar guarda primero una copia del estado actual.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Base } from '../db/index.js';
import { leerConfig } from './configuracion.js';
import { auditar } from './auditoria.js';
import { ahora } from './tiempo.js';
import { ErrorNegocio } from './errores.js';

const PATRON = /^herencia-(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(\d{2})-(auto|manual|previo-restauracion)\.db$/;

export function carpetaBackups(base: Base): string {
  const conf = leerConfig(base.db, 'backups');
  return conf.carpeta?.trim() || path.join(path.dirname(base.ruta), 'backups');
}

export interface InfoBackup { nombre: string; fecha: string; tipo: string; bytes: number }

export function listarBackups(base: Base): InfoBackup[] {
  const dir = carpetaBackups(base);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((n) => ({ n, m: PATRON.exec(n) }))
    .filter((x): x is { n: string; m: RegExpExecArray } => !!x.m)
    .map(({ n, m }) => ({ nombre: n, fecha: `${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`, tipo: m[5], bytes: fs.statSync(path.join(dir, n)).size }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
}

export async function crearBackup(base: Base, tipo: 'auto' | 'manual' | 'previo-restauracion', usuarioId: number | null): Promise<InfoBackup> {
  const dir = carpetaBackups(base);
  fs.mkdirSync(dir, { recursive: true });
  const t = ahora();
  const nombre = `herencia-${t.slice(0, 10)}_${t.slice(11, 13)}${t.slice(14, 16)}${t.slice(17, 19)}-${tipo}.db`;
  const destino = path.join(dir, nombre);
  await base.sqlite.backup(destino);
  base.tx((db) => auditar(db, { usuarioId, accion: 'backup', entidad: 'base', detalle: `${tipo}: ${nombre}` }));
  aplicarRetencion(base);
  return { nombre, fecha: t, tipo, bytes: fs.statSync(destino).size };
}

/** Borra solo backups automáticos que quedaron fuera de la política de retención. Los manuales no se tocan. */
export function aplicarRetencion(base: Base) {
  const conf = leerConfig(base.db, 'backups');
  const dir = carpetaBackups(base);
  const autos = listarBackups(base).filter((b) => b.tipo === 'auto');
  const conservar = new Set<string>();
  const porDia = new Map<string, InfoBackup>();
  const porMes = new Map<string, InfoBackup>();
  for (const b of autos) {
    if (!porDia.has(b.fecha.slice(0, 10))) porDia.set(b.fecha.slice(0, 10), b);
    if (!porMes.has(b.fecha.slice(0, 7))) porMes.set(b.fecha.slice(0, 7), b);
  }
  // El día de hoy conserva todos sus backups; los días anteriores conservan el último de cada día.
  const hoy = ahora().slice(0, 10);
  autos.filter((b) => b.fecha.startsWith(hoy)).forEach((b) => conservar.add(b.nombre));
  [...porDia.values()].slice(0, conf.retenerDiarios).forEach((b) => conservar.add(b.nombre));
  [...porMes.values()].slice(0, conf.retenerMensuales).forEach((b) => conservar.add(b.nombre));
  for (const b of autos) if (!conservar.has(b.nombre)) fs.rmSync(path.join(dir, b.nombre), { force: true });
}

export async function restaurarBackup(base: Base, nombre: string, usuarioId: number | null) {
  if (!PATRON.test(nombre)) throw new ErrorNegocio('Nombre de backup inválido');
  const origen = path.join(carpetaBackups(base), nombre);
  if (!fs.existsSync(origen)) throw new ErrorNegocio('El backup no existe', 404);
  const previo = await crearBackup(base, 'previo-restauracion', usuarioId);
  base.cerrar();
  for (const suf of ['-wal', '-shm']) fs.rmSync(base.ruta + suf, { force: true });
  fs.copyFileSync(origen, base.ruta);
  base.reabrir();
  base.tx((db) => auditar(db, { usuarioId, accion: 'restaurar', entidad: 'base', detalle: `Restaurado ${nombre}. Copia previa: ${previo.nombre}` }));
  return { restaurado: nombre, copiaPrevia: previo.nombre };
}

/** Programa backups automáticos. Devuelve una función para detenerlos. */
export function programarBackups(base: Base, log: (msg: string) => void) {
  let ultimo = Date.now();
  const tick = async () => {
    const horas = leerConfig(base.db, 'backups').cadaHoras;
    if (Date.now() - ultimo >= horas * 3600_000) {
      ultimo = Date.now();
      try { const b = await crearBackup(base, 'auto', null); log(`Backup automático: ${b.nombre}`); }
      catch (e) { log(`ERROR en backup automático: ${(e as Error).message}`); }
    }
  };
  const id = setInterval(tick, 60_000);
  id.unref();
  return () => clearInterval(id);
}
