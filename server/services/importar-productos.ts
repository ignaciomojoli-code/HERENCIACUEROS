/**
 * Importación masiva de productos desde Excel/CSV, en tres pasos:
 *   1. analizar: lee el archivo y sugiere qué columna es cada campo.
 *   2. validar: con la asociación de columnas elegida, clasifica cada fila (nueva, actualiza, sin cambios,
 *      vacía, duplicada en el archivo, con error) SIN guardar nada.
 *   3. confirmar: guarda dentro de una transacción. Solo actualiza productos existentes si el usuario lo autoriza.
 */
import { eq, sql } from 'drizzle-orm';
import { modelos, variantes, precios, listasPrecio, importaciones } from '../db/schema.js';
import type { DB } from '../db/index.js';
import { parsearImporte } from '../domain/dinero.js';
import { normalizarClave, normalizarSku, prolijo } from '../domain/texto.js';
import {
  buscarCategoria, crearModelo, crearVariante, actualizarVariante, obtenerOCrearCategoria,
  obtenerOCrearColor, obtenerOCrearProveedor, obtenerOCrearTalle,
} from './catalogo.js';
import { auditar } from './auditoria.js';
import { ahora } from './tiempo.js';
import { ErrorNegocio } from './errores.js';

export const CAMPOS_PRODUCTO = {
  sku: 'Código / SKU',
  categoria: 'Categoría',
  subcategoria: 'Subcategoría',
  modelo: 'Producto / modelo',
  genero: 'Género',
  generoTipo: 'Género o tipo (separa solo: Hombre/Mujer → género; el resto → subcategoría)',
  color: 'Color',
  talle: 'Talle',
  proveedor: 'Proveedor principal',
  costo: 'Costo',
  codigoBarras: 'Código de barras',
  descripcion: 'Descripción',
  notas: 'Notas',
} as const;
export type CampoProducto = keyof typeof CAMPOS_PRODUCTO;

/** Asociación: campo → índice de columna. Para precios: `precio:<listaId>` → índice. */
export type Asociacion = Partial<Record<CampoProducto, number>> & Record<`precio:${number}`, number>;

const SINONIMOS: Record<CampoProducto, string[]> = {
  sku: ['codigo', 'sku', 'cod', 'articulo'],
  categoria: ['categoria', 'rubro'],
  subcategoria: ['subcategoria', 'tipo'],
  modelo: ['producto', 'modelo', 'nombre', 'descripcion del producto'],
  genero: ['genero', 'sexo'],
  generoTipo: ['genero / tipo', 'genero/tipo'],
  color: ['color'],
  talle: ['talle', 'talla', 'medida'],
  proveedor: ['proveedor'],
  costo: ['costo', 'costo ($)', 'costo unitario'],
  codigoBarras: ['codigo de barras', 'ean', 'barras'],
  descripcion: ['descripcion'],
  notas: ['notas', 'observaciones', 'nota'],
};

const limpiarEncabezado = (h: string) => normalizarClave(h.replace(/[✍️🟨⬜]/gu, '').replace(/\(.*?\)/g, (m) => (m.includes('$') ? '' : m)));

export function sugerirAsociacion(encabezados: string[], listas: { id: number; nombre: string }[]): Asociacion {
  const asoc: Record<string, number> = {};
  const usados = new Set<number>();
  const hs = encabezados.map(limpiarEncabezado);
  // Primero coincidencias exactas, después "empieza con"
  for (const modo of ['exacta', 'prefijo'] as const) {
    for (const [campo, sins] of Object.entries(SINONIMOS)) {
      if (asoc[campo] !== undefined) continue;
      const i = hs.findIndex((h, idx) => !usados.has(idx) && sins.some((s) => (modo === 'exacta' ? h === s : h.startsWith(s))));
      if (i >= 0) { asoc[campo] = i; usados.add(i); }
    }
  }
  // Si hay "Género / tipo" no usar también "género"
  if (asoc.generoTipo !== undefined && asoc.genero === asoc.generoTipo) delete asoc.genero;
  for (const l of listas) {
    const clave = normalizarClave(l.nombre).split(/[ /]/)[0]; // "efectivo", "tarjeta"
    const i = hs.findIndex((h, idx) => !usados.has(idx) && h.includes('precio') && h.includes(clave));
    if (i >= 0) { asoc[`precio:${l.id}`] = i; usados.add(i); }
  }
  return asoc as Asociacion;
}

export type EstadoFila = 'nuevo' | 'actualiza' | 'sin_cambios' | 'vacia' | 'duplicada' | 'error';

export interface FilaValidada {
  fila: number; // número de fila en el archivo (1 = primera)
  estado: EstadoFila;
  sku: string;
  modelo: string;
  errores: string[];
  avisos: string[];
  cambios: { campo: string; antes: string; despues: string }[];
  datos?: DatosFila;
}

interface DatosFila {
  sku: string;
  categoria: string;
  subcategoria: string | null;
  modelo: string;
  genero: 'Hombre' | 'Mujer' | 'Unisex' | null;
  color: string | null;
  talle: string | null;
  proveedor: string | null;
  costo: number | null;
  codigoBarras: string | null;
  descripcion: string | null;
  notas: string | null;
  precios: Record<number, number>;
}

const GENEROS: Record<string, 'Hombre' | 'Mujer' | 'Unisex'> = { hombre: 'Hombre', mujer: 'Mujer', unisex: 'Unisex', dama: 'Mujer', caballero: 'Hombre' };

export function validarFilas(db: DB, filas: string[][], filaEncabezado: number, asoc: Asociacion): FilaValidada[] {
  const listas = db.select().from(listasPrecio).all();
  const listasAsoc = Object.entries(asoc).filter(([k]) => k.startsWith('precio:')).map(([k, col]) => ({ listaId: Number(k.split(':')[1]), col: col as number }));
  for (const l of listasAsoc) if (!listas.some((x) => x.id === l.listaId)) throw new ErrorNegocio('Una columna de precio apunta a una lista que no existe');
  if (asoc.sku === undefined) throw new ErrorNegocio('Falta indicar la columna del código (SKU)');
  if (asoc.modelo === undefined) throw new ErrorNegocio('Falta indicar la columna del nombre del producto');
  if (asoc.categoria === undefined) throw new ErrorNegocio('Falta indicar la columna de la categoría');

  const col = (fila: string[], campo: CampoProducto) => (asoc[campo] === undefined ? '' : (fila[asoc[campo]!] ?? '').trim());
  const vistos = new Map<string, number>();
  const resultado: FilaValidada[] = [];

  // Datos actuales para comparar
  const existentes = new Map(
    db.select({ v: variantes, modelo: modelos.nombre }).from(variantes).innerJoin(modelos, eq(modelos.id, variantes.modeloId)).all()
      .map((x) => [x.v.sku.toLowerCase(), x]),
  );
  const preciosActuales = db.select().from(precios).all();

  for (let i = filaEncabezado + 1; i < filas.length; i++) {
    const f = filas[i] ?? [];
    if (f.every((c) => !c?.trim())) continue;
    const r: FilaValidada = { fila: i + 1, estado: 'nuevo', sku: normalizarSku(col(f, 'sku')), modelo: col(f, 'modelo'), errores: [], avisos: [], cambios: [] };
    resultado.push(r);

    // Fila con código pero sin nombre ni datos: código reservado vacío (ej. ACC-042 a ACC-300 en la planilla).
    const otrosDatos = [col(f, 'modelo'), col(f, 'color'), col(f, 'talle'), col(f, 'costo'), ...listasAsoc.map((l) => f[l.col] ?? '')].some((c) => c && c !== '-');
    if (!otrosDatos) { r.estado = 'vacia'; r.avisos.push('Fila sin datos (código reservado): se omite'); continue; }

    if (!r.sku) r.errores.push('Falta el código');
    if (!r.modelo) r.errores.push('Falta el nombre del producto');
    const categoria = col(f, 'categoria');
    if (!categoria) r.errores.push('Falta la categoría');

    let genero: DatosFila['genero'] = null;
    let subcategoria: string | null = col(f, 'subcategoria') || null;
    const gRaw = col(f, 'genero');
    if (gRaw) { genero = GENEROS[normalizarClave(gRaw)] ?? null; if (!genero) r.avisos.push(`Género "${gRaw}" no reconocido: se deja vacío`); }
    const gt = col(f, 'generoTipo');
    if (gt) {
      const g = GENEROS[normalizarClave(gt)];
      if (g) genero = g; else if (!subcategoria) subcategoria = prolijo(gt);
    }

    const costoTxt = col(f, 'costo');
    const costo = parsearImporte(costoTxt);
    if (costoTxt && costoTxt !== '-' && costo === null) r.errores.push(`Costo inválido: "${costoTxt}"`);
    if (costo !== null && costo < 0) r.errores.push('El costo no puede ser negativo');
    if (costo === null) r.avisos.push('Sin costo: queda pendiente de cargar');

    const ps: Record<number, number> = {};
    for (const l of listasAsoc) {
      const txt = (f[l.col] ?? '').trim();
      const p = parsearImporte(txt);
      const nombre = listas.find((x) => x.id === l.listaId)!.nombre;
      if (txt && txt !== '-' && p === null) r.errores.push(`Precio "${nombre}" inválido: "${txt}"`);
      else if (p !== null) {
        if (p <= 0) r.errores.push(`Precio "${nombre}" debe ser mayor a cero`);
        else ps[l.listaId] = p;
        if (costo !== null && p > 0 && p <= costo) r.avisos.push(`Precio "${nombre}" menor o igual al costo`);
      }
    }

    if (r.sku) {
      const k = r.sku.toLowerCase();
      if (vistos.has(k)) { r.estado = 'duplicada'; r.errores.push(`Código repetido en el archivo (también en la fila ${vistos.get(k)})`); continue; }
      vistos.set(k, r.fila);
    }
    if (r.errores.length) { r.estado = 'error'; continue; }

    r.datos = {
      sku: r.sku, categoria, subcategoria, modelo: r.modelo, genero,
      color: col(f, 'color') || null, talle: col(f, 'talle') || null, proveedor: col(f, 'proveedor') || null,
      costo, codigoBarras: col(f, 'codigoBarras') || null, descripcion: col(f, 'descripcion') || null, notas: col(f, 'notas') || null,
      precios: ps,
    };

    const ex = existentes.get(r.sku.toLowerCase());
    if (ex) {
      if (normalizarClave(ex.modelo) !== normalizarClave(r.modelo)) r.avisos.push(`El código ya existe en el modelo "${ex.modelo}"; el modelo no se cambia`);
      if (costo !== null && costo !== ex.v.costoCentavos) r.cambios.push({ campo: 'Costo', antes: String(ex.v.costoCentavos ?? '—'), despues: String(costo) });
      for (const [lid, p] of Object.entries(ps)) {
        const act = preciosActuales.find((x) => x.varianteId === ex.v.id && x.listaId === Number(lid));
        if (act?.precioCentavos !== p) r.cambios.push({ campo: `Precio ${listas.find((x) => x.id === Number(lid))!.nombre}`, antes: String(act?.precioCentavos ?? '—'), despues: String(p) });
      }
      r.estado = r.cambios.length ? 'actualiza' : 'sin_cambios';
    }
  }
  return resultado;
}

export interface ResumenImportacion {
  creadas: number;
  actualizadas: number;
  omitidas: number;
  modelosCreados: number;
  importacionId: number;
}

/**
 * Guarda las filas válidas. `actualizarExistentes` debe venir en true explícitamente para tocar productos
 * que ya existen (nunca se sobrescribe sin autorización). Debe llamarse dentro de una transacción.
 */
export function confirmarImportacion(
  ctx: { db: DB; usuarioId: number | null }, archivo: string, filas: FilaValidada[], opciones: { actualizarExistentes: boolean },
): ResumenImportacion {
  const { db } = ctx;
  let creadas = 0, actualizadas = 0, omitidas = 0, modelosCreados = 0;
  const origen = `importacion:${archivo}`;
  for (const r of filas) {
    if (!r.datos || r.estado === 'sin_cambios' || (r.estado === 'actualiza' && !opciones.actualizarExistentes)) { omitidas++; continue; }
    const d = r.datos;
    if (r.estado === 'actualiza') {
      const v = db.select().from(variantes).where(sql`lower(${variantes.sku}) = lower(${d.sku})`).get()!;
      actualizarVariante(ctx, v.id, { costoCentavos: d.costo ?? v.costoCentavos, precios: d.precios }, origen, `Importación ${archivo}`);
      actualizadas++;
      continue;
    }
    const cat = obtenerOCrearCategoria(ctx, d.categoria);
    const sub = d.subcategoria ? obtenerOCrearCategoria(ctx, d.subcategoria, cat.id) : null;
    const prov = d.proveedor ? obtenerOCrearProveedor(ctx, d.proveedor) : null;
    const clave = normalizarClave(d.modelo);
    let m = db.select().from(modelos).where(eq(modelos.categoriaId, cat.id)).all().find((x) => normalizarClave(x.nombre) === clave);
    if (!m) {
      m = crearModelo(ctx, { nombre: d.modelo, categoriaId: cat.id, subcategoriaId: sub?.id ?? null, genero: d.genero, proveedorId: prov?.id ?? null, descripcion: d.descripcion });
      modelosCreados++;
    }
    crearVariante(ctx, m.id, {
      sku: d.sku, codigoBarras: d.codigoBarras,
      colorId: d.color ? obtenerOCrearColor(ctx, d.color).id : null,
      talleId: d.talle ? obtenerOCrearTalle(ctx, d.talle).id : null,
      costoCentavos: d.costo, notas: d.notas, precios: d.precios,
    }, origen);
    creadas++;
  }
  const imp = db.insert(importaciones).values({
    fecha: ahora(), usuarioId: ctx.usuarioId, tipo: 'productos', archivo, filasTotal: filas.length, creadas, actualizadas, omitidas,
    detalle: { errores: filas.filter((f) => f.estado === 'error' || f.estado === 'duplicada').map((f) => ({ fila: f.fila, sku: f.sku, errores: f.errores })) },
  }).returning().get();
  auditar(db, { usuarioId: ctx.usuarioId, accion: 'importar', entidad: 'productos', entidadId: imp.id, despues: { archivo, creadas, actualizadas, omitidas, modelosCreados } });
  return { creadas, actualizadas, omitidas, modelosCreados, importacionId: imp.id };
}

export { buscarCategoria };
