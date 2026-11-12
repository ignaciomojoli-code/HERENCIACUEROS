/** Exportación del catálogo a Excel y CSV, con las columnas que elija el usuario. */
import ExcelJS from 'exceljs';
import { asc, eq } from 'drizzle-orm';
import { categorias, colores, listasPrecio, modelos, precios, proveedores, talles, variantes } from '../db/schema.js';
import type { DB } from '../db/index.js';

export interface ColumnaExport { clave: string; titulo: string; tipo: 'texto' | 'dinero' | 'numero'; requiereCostos?: boolean }

export function columnasCatalogo(db: DB): ColumnaExport[] {
  const listas = db.select().from(listasPrecio).orderBy(asc(listasPrecio.orden)).all();
  return [
    { clave: 'sku', titulo: 'Código', tipo: 'texto' },
    { clave: 'categoria', titulo: 'Categoría', tipo: 'texto' },
    { clave: 'subcategoria', titulo: 'Subcategoría', tipo: 'texto' },
    { clave: 'modelo', titulo: 'Producto', tipo: 'texto' },
    { clave: 'genero', titulo: 'Género', tipo: 'texto' },
    { clave: 'color', titulo: 'Color', tipo: 'texto' },
    { clave: 'talle', titulo: 'Talle', tipo: 'texto' },
    { clave: 'proveedor', titulo: 'Proveedor', tipo: 'texto' },
    { clave: 'codigoBarras', titulo: 'Código de barras', tipo: 'texto' },
    { clave: 'costo', titulo: 'Costo', tipo: 'dinero', requiereCostos: true },
    ...listas.map((l) => ({ clave: `precio:${l.id}`, titulo: `Precio ${l.nombre}`, tipo: 'dinero' as const })),
    { clave: 'estado', titulo: 'Estado', tipo: 'texto' },
    { clave: 'notas', titulo: 'Notas', tipo: 'texto' },
  ];
}

export function filasCatalogo(db: DB, opciones: { incluirInactivos: boolean; categoriaId?: number }) {
  const subcat = db.select().from(categorias).all();
  const filas = db.select({ v: variantes, m: modelos, cat: categorias.nombre, color: colores.nombre, talle: talles.nombre, prov: proveedores.nombre })
    .from(variantes).innerJoin(modelos, eq(modelos.id, variantes.modeloId)).innerJoin(categorias, eq(categorias.id, modelos.categoriaId))
    .leftJoin(colores, eq(colores.id, variantes.colorId)).leftJoin(talles, eq(talles.id, variantes.talleId))
    .leftJoin(proveedores, eq(proveedores.id, modelos.proveedorId))
    .orderBy(asc(categorias.nombre), asc(modelos.nombre), asc(colores.nombre), asc(talles.orden)).all()
    .filter((x) => (opciones.incluirInactivos || x.v.activo) && (!opciones.categoriaId || x.m.categoriaId === opciones.categoriaId));
  const ps = db.select().from(precios).all();
  return filas.map((x) => {
    const fila: Record<string, string | number | null> = {
      sku: x.v.sku, categoria: x.cat, subcategoria: subcat.find((c) => c.id === x.m.subcategoriaId)?.nombre ?? null,
      modelo: x.m.nombre, genero: x.m.genero, color: x.color, talle: x.talle, proveedor: x.prov, codigoBarras: x.v.codigoBarras,
      costo: x.v.costoCentavos, estado: x.v.activo ? 'Activo' : 'Inactivo', notas: x.v.notas,
    };
    for (const p of ps.filter((p) => p.varianteId === x.v.id)) fila[`precio:${p.listaId}`] = p.precioCentavos;
    return fila;
  });
}

export async function aXlsx(titulo: string, columnas: ColumnaExport[], filas: Record<string, unknown>[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Herencia Cuero ERP';
  const ws = wb.addWorksheet(titulo.slice(0, 31));
  ws.columns = columnas.map((c) => ({ header: c.titulo, key: c.clave, width: c.tipo === 'texto' ? 22 : 14, style: c.tipo === 'dinero' ? { numFmt: '"$" #,##0.00' } : {} }));
  for (const f of filas) {
    ws.addRow(Object.fromEntries(columnas.map((c) => {
      const v = f[c.clave];
      return [c.clave, c.tipo === 'dinero' && typeof v === 'number' ? v / 100 : v ?? null];
    })));
  }
  const h = ws.getRow(1);
  h.font = { bold: true, color: { argb: 'FFEFE6D2' } };
  h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15120F' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function aCsv(columnas: ColumnaExport[], filas: Record<string, unknown>[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [columnas.map((c) => esc(c.titulo)).join(';')];
  for (const f of filas) {
    lineas.push(columnas.map((c) => {
      const v = f[c.clave];
      // Importes con coma decimal para que Excel en español los lea como número
      return c.tipo === 'dinero' && typeof v === 'number' ? (v / 100).toFixed(2).replace('.', ',') : esc(v);
    }).join(';'));
  }
  return '﻿' + lineas.join('\r\n');
}
