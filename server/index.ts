/**
 * Punto de entrada del servidor. Variables de entorno opcionales:
 *   HERENCIA_DATOS  carpeta donde se guarda la base (por defecto ./datos)
 *   PORT            puerto (por defecto 3800)
 *   HOST            interfaz (por defecto 0.0.0.0 para poder entrar desde el celular en el mismo Wi-Fi)
 */
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { Base } from './db/index.js';
import { sembrar } from './services/semilla.js';
import { crearApp } from './http/app.js';
import { crearBackup, programarBackups } from './services/backups.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), fs.existsSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json')) ? '..' : '../..');
const carpetaDatos = path.resolve(process.env.HERENCIA_DATOS ?? path.join(raiz, 'datos'));
const archivoBase = path.join(carpetaDatos, 'herencia.db');
const puerto = Number(process.env.PORT ?? 3800);
const host = process.env.HOST ?? '0.0.0.0';

const base = new Base(archivoBase);
base.tx((db) => sembrar(db));
const app = await crearApp({ base, carpetaWeb: path.join(raiz, 'dist-web'), logger: process.env.NODE_ENV !== 'production' ? { level: 'warn' } as never : false });

const log = (m: string) => console.log(`[${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false })}] ${m}`);
// Backup al arrancar (si la base ya tiene datos) y después cada N horas según Configuración.
if (fs.statSync(archivoBase).size > 0) crearBackup(base, 'auto', null).then((b) => log(`Backup al iniciar: ${b.nombre}`)).catch((e) => log(`ERROR backup: ${e.message}`));
programarBackups(base, log);

await app.listen({ port: puerto, host });
const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i!.address);
log(`Herencia Cuero ERP funcionando.`);
log(`En esta PC:        http://localhost:${puerto}`);
for (const ip of ips) log(`Desde el celular:  http://${ip}:${puerto}`);
log(`Base de datos:     ${archivoBase}`);

const cerrar = async () => { await app.close(); base.cerrar(); process.exit(0); };
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
