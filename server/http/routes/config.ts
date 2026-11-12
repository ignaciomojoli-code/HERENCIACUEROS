import type { FastifyInstance } from 'fastify';
import type { Api } from '../app.js';
import { esquemasConfig, guardarConfig, leerTodaLaConfig, type ClaveConfig } from '../../services/configuracion.js';
import { ErrorNegocio } from '../../services/errores.js';

export async function rutasConfig(app: FastifyInstance, { base, requiere }: Api) {
  app.get('/config', async (req) => { requiere(req); return leerTodaLaConfig(base.db); });
  app.put('/config/:clave', async (req) => {
    const u = requiere(req, 'configuracion', 'modificar');
    const clave = (req.params as { clave: string }).clave;
    if (!(clave in esquemasConfig)) throw new ErrorNegocio('Configuración inexistente', 404);
    return base.tx((db) => guardarConfig(db, clave as ClaveConfig, req.body, u.id));
  });
}
