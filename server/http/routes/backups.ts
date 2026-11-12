import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Api } from '../app.js';
import fs from 'node:fs';
import path from 'node:path';
import { ErrorNegocio } from '../../services/errores.js';
import { auditar } from '../../services/auditoria.js';
import { carpetaBackups, crearBackup, listarBackups, restaurarBackup } from '../../services/backups.js';

export async function rutasBackups(app: FastifyInstance, { base, requiere }: Api) {
  app.get('/backups', async (req) => { requiere(req, 'backups'); return { carpeta: carpetaBackups(base), backups: listarBackups(base) }; });
  app.post('/backups', async (req) => { const u = requiere(req, 'backups', 'crear'); return crearBackup(base, 'manual', u.id); });
  app.post('/backups/restaurar', async (req) => {
    const u = requiere(req, 'backups', 'aprobar');
    const { nombre, confirmacion } = z.object({ nombre: z.string(), confirmacion: z.literal('RESTAURAR') }).parse(req.body);
    void confirmacion;
    return restaurarBackup(base, nombre, u.id);
  });
  app.get('/backups/:nombre/descargar', async (req, reply) => {
    const u = requiere(req, 'backups', 'exportar');
    const { nombre } = req.params as { nombre: string };
    // Solo se puede bajar un archivo que esté en la lista (evita leer cualquier ruta del disco).
    if (!listarBackups(base).some((b) => b.nombre === nombre)) throw new ErrorNegocio('Copia inexistente', 404);
    base.tx((db) => auditar(db, { usuarioId: u.id, accion: 'exportar', entidad: 'backup', entidadId: nombre }));
    reply.header('Content-Type', 'application/octet-stream').header('Content-Disposition', `attachment; filename="${nombre}"`);
    return reply.send(fs.createReadStream(path.join(carpetaBackups(base), nombre)));
  });
}
