import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, gte, inArray, like, lte, notInArray, sql } from 'drizzle-orm';
import type { Api } from '../app.js';
import { auditoria, usuarios } from '../../db/schema.js';

/** Qué es cada "entidad" de la auditoría, en palabras, y a qué módulo pertenece (para filtrar). */
const ENTIDADES: Record<string, [string, string]> = {
  venta: ['Venta', 'ventas'], cobro: ['Cobro', 'ventas'], cliente: ['Cliente', 'ventas'],
  caja: ['Caja', 'caja'], cuenta: ['Cuenta', 'caja'], forma_pago: ['Forma de pago', 'caja'], pago_proveedor: ['Pago a proveedor', 'caja'],
  ajuste_proveedor: ['Ajuste de cuenta corriente', 'caja'],
  precio_proveedor: ['Precio de proveedor', 'proveedores'],
  gasto: ['Gasto', 'gastos'], gasto_personal: ['Gasto personal', 'gastos'], categoria_gasto: ['Categoría de gasto', 'gastos'],
  compra: ['Pedido', 'compras'], compras: ['Compras', 'compras'], recepcion: ['Recepción', 'compras'], lista_pedido: ['Para pedir', 'compras'],
  necesidad_material: ['Reposición de materiales', 'compras'], proveedor: ['Proveedor', 'compras'], adjunto: ['Adjunto', 'compras'],
  stock: ['Stock', 'stock'], conteo: ['Conteo', 'stock'],
  modelo: ['Producto', 'catalogo'], variante: ['Variante', 'catalogo'], precio: ['Precio', 'catalogo'], lista_precio: ['Lista de precios', 'catalogo'],
  categoria: ['Categoría', 'catalogo'], color: ['Color', 'catalogo'], talle: ['Talle', 'catalogo'], catalogo: ['Catálogo', 'catalogo'],
  productos: ['Productos', 'catalogo'], importacion: ['Importación', 'catalogo'],
  material: ['Material', 'produccion'], materiales: ['Materiales', 'produccion'], mov_material: ['Movimiento de material', 'produccion'],
  traslado_material: ['Entrega de material', 'produccion'], receta: ['Receta', 'produccion'], costos: ['Costos', 'produccion'],
  usuario: ['Usuario', 'sistema'], rol: ['Rol', 'sistema'], sesion: ['Sesión', 'sistema'], configuracion: ['Configuración', 'sistema'],
  backup: ['Copia de seguridad', 'sistema'], base: ['Base de datos', 'sistema'], reportes: ['Reportes', 'sistema'],
};
const MODULOS: Record<string, string> = {
  ventas: 'Ventas y clientes', caja: 'Caja y pagos', gastos: 'Gastos', compras: 'Compras y proveedores', stock: 'Stock',
  catalogo: 'Catálogo y precios', produccion: 'Materiales y producción', sistema: 'Usuarios y sistema', otros: 'Otros',
};
const conocidas = Object.keys(ENTIDADES);
const delModulo = (m: string) => conocidas.filter((e) => ENTIDADES[e][1] === m);

export async function rutasAuditoria(app: FastifyInstance, { base, requiere }: Api) {
  app.get('/auditoria', async (req) => {
    requiere(req, 'auditoria');
    const q = z.object({
      entidad: z.string().optional(), entidadId: z.string().optional(), usuarioId: z.coerce.number().optional(), modulo: z.string().optional(), accion: z.string().optional(),
      desde: z.string().optional(), hasta: z.string().optional(), texto: z.string().optional(),
      pagina: z.coerce.number().int().min(1).default(1), porPagina: z.coerce.number().int().min(10).max(200).default(50),
    }).parse(req.query);
    const conds = [];
    if (q.entidad) conds.push(eq(auditoria.entidad, q.entidad));
    if (q.entidadId) conds.push(eq(auditoria.entidadId, q.entidadId));
    if (q.usuarioId) conds.push(eq(auditoria.usuarioId, q.usuarioId));
    if (q.accion) conds.push(eq(auditoria.accion, q.accion));
    if (q.modulo) conds.push(q.modulo === 'otros' ? notInArray(auditoria.entidad, conocidas) : inArray(auditoria.entidad, delModulo(q.modulo).length ? delModulo(q.modulo) : ['-']));
    // La fecha se guarda en UTC; el día elegido es de Buenos Aires (UTC−3).
    if (q.desde) conds.push(gte(auditoria.fecha, q.desde + 'T03:00:00.000Z'));
    if (q.hasta) conds.push(lte(auditoria.fecha, new Date(Date.parse(q.hasta + 'T03:00:00.000Z') + 86400000 - 1).toISOString()));
    if (q.texto) conds.push(like(sql`coalesce(${auditoria.detalle},'') || ' ' || coalesce(${auditoria.despues},'') || ' ' || coalesce(${auditoria.antes},'') || ' ' || coalesce(${auditoria.entidadId},'')`, `%${q.texto}%`));
    const where = conds.length ? and(...conds) : undefined;
    const total = base.db.select({ n: sql<number>`count(*)` }).from(auditoria).where(where).get()?.n ?? 0;
    const filas = base.db.select({ a: auditoria, usuario: usuarios.nombre }).from(auditoria).leftJoin(usuarios, eq(usuarios.id, auditoria.usuarioId))
      .where(where).orderBy(desc(auditoria.id)).limit(q.porPagina).offset((q.pagina - 1) * q.porPagina).all();
    return { total, filas: filas.map((f) => ({ ...f.a, usuario: f.usuario, entidadTexto: ENTIDADES[f.a.entidad]?.[0] ?? f.a.entidad })) };
  });

  /** Opciones para los filtros: quién hizo cambios, qué acciones y módulos hay registrados. */
  app.get('/auditoria/opciones', async (req) => {
    requiere(req, 'auditoria');
    const us = base.db.select({ id: usuarios.id, nombre: usuarios.nombre }).from(usuarios).orderBy(asc(usuarios.nombre)).all();
    const acciones = base.db.selectDistinct({ a: auditoria.accion }).from(auditoria).orderBy(asc(auditoria.accion)).all().map((x) => x.a);
    const entidades = base.db.selectDistinct({ e: auditoria.entidad }).from(auditoria).all().map((x) => x.e);
    const usados = new Set(entidades.map((e) => ENTIDADES[e]?.[1] ?? 'otros'));
    return { usuarios: us, acciones, modulos: Object.entries(MODULOS).filter(([k]) => usados.has(k)).map(([clave, nombre]) => ({ clave, nombre })) };
  });
}
