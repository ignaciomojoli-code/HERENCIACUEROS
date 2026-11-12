/** Lectura de archivos Excel (.xlsx) y CSV a una estructura simple de hojas → filas de texto. */
import ExcelJS from 'exceljs';

export interface HojaLeida {
  nombre: string;
  filas: string[][];
}

function celdaATexto(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'SI' : 'NO';
  if (v instanceof Date) {
    // Excel guarda fechas como medianoche UTC
    const d = v;
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  }
  if (typeof v === 'object') {
    if ('result' in v && v.result !== undefined) return celdaATexto(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((r) => r.text).join('').trim();
    if ('text' in v) return String(v.text).trim();
    if ('error' in v) return '';
  }
  return String(v);
}

export async function leerXlsx(buffer: Buffer): Promise<HojaLeida[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const hojas: HojaLeida[] = [];
  wb.eachSheet((ws) => {
    const filas: string[][] = [];
    const maxCol = Math.min(ws.columnCount, 80);
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const fila: string[] = [];
      for (let c = 1; c <= maxCol; c++) fila.push(celdaATexto(row.getCell(c).value));
      filas[n - 1] = fila;
    });
    for (let i = 0; i < filas.length; i++) if (!filas[i]) filas[i] = [];
    // Recorta filas vacías del final
    while (filas.length && filas[filas.length - 1].every((c) => !c)) filas.pop();
    hojas.push({ nombre: ws.name, filas });
  });
  return hojas;
}

/** CSV con separador detectado (coma o punto y coma) y comillas dobles. */
export function leerCsv(texto: string, nombre = 'CSV'): HojaLeida[] {
  const limpio = texto.replace(/^﻿/, '');
  // El separador se decide mirando las primeras líneas (la primera puede ser un título sin separadores).
  const muestra = limpio.split(/\r?\n/, 20).join('\n');
  const sep = (muestra.match(/;/g)?.length ?? 0) > (muestra.match(/,/g)?.length ?? 0) ? ';' : ',';
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const ch = limpio[i];
    if (comillas) {
      if (ch === '"' && limpio[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(campo.trim()); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && limpio[i + 1] === '\n') i++;
      fila.push(campo.trim()); filas.push(fila); fila = []; campo = '';
    } else campo += ch;
  }
  if (campo || fila.length) { fila.push(campo.trim()); filas.push(fila); }
  return [{ nombre, filas }];
}

/** Detecta la fila de encabezados: la primera, dentro de las primeras 15, con al menos 3 celdas de texto no numérico. */
export function detectarEncabezado(filas: string[][]): number {
  for (let i = 0; i < Math.min(filas.length, 15); i++) {
    const textos = (filas[i] ?? []).filter((c) => c && !/^[\d$.,\s-]+$/.test(c));
    if (textos.length >= 3) return i;
  }
  return 0;
}
