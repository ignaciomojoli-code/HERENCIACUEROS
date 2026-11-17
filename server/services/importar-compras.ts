/**
 * Importación de compras desde Excel/CSV, con revisión editable antes de guardar:
 *   1. leerLineas: cada fila del archivo pasa a una línea editable (fecha, proveedor, comprobante, código, cantidad, costo).
 *   2. revisar: busca el proveedor y el producto o material de cada línea, marca errores y posibles duplicados
 *      (en el archivo y contra los pedidos ya cargados) y arma los pedidos (uno por proveedor + fecha + comprobante).
 *      No guarda nada. El usuario corrige las líneas en pantalla y se vuelve a revisar.
 *   3. confirmar: crea los pedidos dentro de una transacción, todos atados a un lote de importación
 *      (se puede anular el lote entero). Nunca modifica pedidos existentes.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { compraItems, compraMateriales, compras, importaciones, materiales, modelos, proveedores, recepciones, variantes } from '../db/schema.js';
import type { DB } from '../db/index.js';
import { parsearImporte } from '../domain/dinero.js';
import { normalizarClave } from '../domain/texto.js';
import { auditar } from './auditoria.js';
import { ahora } from './tiempo.js';
import { ErrorNegocio, noEncontrado } from './errores.js';
import type { Ctx } from './stock.js';
import { anularRecepcion, cambiarEstadoCompra, crearCompra, obtenerCompra, recibir, type TipoCompra } from './compras.js';

export const CAMPOS_COMPRA = {
  fecha: 'Fecha',
  proveedor: 'Proveedor',
  comprobante: 'Comprobante (factura / remito)',
  codigo: 'Código (SKU o código de material)',
  descripcion: 'Descripción / material',
  cantidad: 'Cantidad',
  costo: 'Costo unitario',
  total: 'Total de la línea (si no hay costo unitario)',
  notas: 'Notas',
} as const;
export type CampoCompra = keyof typeof CAMPOS_COMPRA;
export type AsociacionCompra = Partial<Record<CampoCompra, number>>;

const SINONIMOS: Record<CampoCompra, string[]> = {
  fecha: ['fecha', 'dia'],
  proveedor: ['proveedor', 'prov', 'taller'],
  comprobante: ['comprobante', 'factura', 'remito', 'nro factura', 'n factura'],
  codigo: ['codigo', 'sku', 'cod', 'articulo'],
  descripcion: ['descripcion', 'detalle', 'producto', 'material', 'concepto', 'item'],
  cantidad: ['cantidad', 'cant', 'unidades', 'metros'],
  costo: ['costo unitario', 'precio unitario', 'costo', 'precio', 'unitario'],
  total: ['total', 'importe', 'subtotal', 'monto'],
  notas: ['notas', 'observaciones', 'obs', 'nota'],
};

export function sugerirAsociacionCompra(encabezados: string[]): AsociacionCompra {
  const hs = encabezados.map((h) => normalizarClave(h.replace(/\(.*?\)/g, '')));
  const asoc: AsociacionCompra = {};
  const usados = new Set<number>();
  for (const modo of ['exacta', 'prefijo'] as const) {
    for (const [campo, sins] of Object.entries(SINONIMOS) as [CampoCompra, string[]][]) {
      if (asoc[campo] !== undefined) continue;
      const i = hs.findIndex((h, idx) => !usados.has(idx) && h && sins.some((s) => (modo === 'exacta' ? h === s : h.startsWith(s))));
      if (i >= 0) { asoc[campo] = i; usados.add(i); }
    }
  }
  return asoc;
}

/** Fecha de la planilla a AAAA-MM-DD: "17/11/2026", "17/11/26", "2026-11-17" o número de serie de Excel. */
export function parsearFecha(txt: string): string | null {
  const s = txt.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return armar(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) return armar(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  if (/^\d{5}(\.\d+)?$/.test(s)) { // serie de Excel (días desde 30/12/1899)
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return armar(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return null;
}
function armar(a: number, m: number, d: number) {
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Cantidad con decimales ("1.5", "1,5", "2"). No adivina separadores de miles: una cantidad no los lleva. */
export function parsearCantidad(txt: string): number | null {
  const s = txt.trim().replace(/\s/g, '');
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^\d+,\d+$/.test(s)) return Number(s.replace(',', '.'));
  return null;
}

/** Línea editable (lo que se muestra y se corrige en la pantalla de revisión). */
export interface LineaImport {
  fila: number; incluir: boolean;
  fecha: string; proveedor: string; proveedorId: number | null; comprobante: string;
  codigo: string; descripcion: string; cantidad: string; costoUnitarioCentavos: number | null; notas: string;
}

export function leerLineas(db: DB, filas: string[][], filaEncabezado: number, asoc: AsociacionCompra): LineaImport[] {
  if (asoc.cantidad === undefined) throw new ErrorNegocio('Falta indicar la columna de la cantidad');
  if (asoc.codigo === undefined && asoc.descripcion === undefined) throw new ErrorNegocio('Falta indicar la columna del código o de la descripción');
  if (asoc.costo === undefined && asoc.total === undefined) throw new ErrorNegocio('Falta indicar la columna del costo unitario o del total');
  const col = (f: string[], c: CampoCompra) => (asoc[c] === undefined ? '' : (f[asoc[c]!] ?? '').trim());
  const provs = db.select({ id: proveedores.id, nombre: proveedores.nombre }).from(proveedores).all();
  const lineas: LineaImport[] = [];
  for (let i = filaEncabezado + 1; i < filas.length; i++) {
    const f = filas[i] ?? [];
    if (f.every((c) => !c?.trim())) continue;
    const fechaTxt = col(f, 'fecha');
    const prov = col(f, 'proveedor');
    const cant = col(f, 'cantidad');
    const cantNum = parsearCantidad(cant);
    let costo = parsearImporte(col(f, 'costo'));
    if (costo === null && asoc.total !== undefined && cantNum) {
      const total = parsearImporte(col(f, 'total'));
      if (total !== null) costo = Math.round(total / cantNum);
    }
    const p = prov ? provs.find((x) => normalizarClave(x.nombre) === normalizarClave(prov)) : undefined;
    lineas.push({
      fila: i + 1, incluir: true,
      fecha: (fechaTxt && parsearFecha(fechaTxt)) || fechaTxt, proveedor: prov, proveedorId: p?.id ?? null, comprobante: col(f, 'comprobante'),
      codigo: col(f, 'codigo'), descripcion: col(f, 'descripcion'), cantidad: cant, costoUnitarioCentavos: costo, notas: col(f, 'notas'),
    });
  }
  return lineas;
}

type Item = { tipo: 'variante' | 'material'; id: number; nombre: string; unidad: string };
export interface LineaRevisada extends LineaImport {
  item: Item | null; tipoCompra: TipoCompra | null; grupo: string | null;
  errores: string[]; avisos: string[]; duplicado: string | null;
}
export interface PedidoPropuesto {
  grupo: string; proveedorId: number; proveedor: string; tipo: TipoCompra; fecha: string; comprobante: string;
  lineas: number[]; totalCentavos: number; duplicado: string | null;
}

/** Busca proveedor e ítem de cada línea, marca errores y duplicados y arma los pedidos. No guarda nada. */
export function revisar(db: DB, entrada: LineaImport[]) {
  const provs = new Map(db.select().from(proveedores).all().map((p) => [p.id, p]));
  const vars = db.select({ id: variantes.id, sku: variantes.sku, modelo: modelos.nombre, activo: variantes.activo }).from(variantes).innerJoin(modelos, eq(modelos.id, variantes.modeloId)).all();
  const porSku = new Map(vars.map((v) => [v.sku.toLowerCase(), v]));
  const mats = db.select().from(materiales).all();
  const matPorCodigo = new Map(mats.map((m) => [m.codigo.toLowerCase(), m]));
  const matPorNombre = new Map<string, typeof mats>();
  for (const m of mats) matPorNombre.set(normalizarClave(m.nombre), [...(matPorNombre.get(normalizarClave(m.nombre)) ?? []), m]);

  const lineas: LineaRevisada[] = entrada.map((l) => {
    const r: LineaRevisada = { ...l, item: null, tipoCompra: null, grupo: null, errores: [], avisos: [], duplicado: null };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.fecha) || !parsearFecha(l.fecha)) r.errores.push(l.fecha ? `Fecha inválida: "${l.fecha}"` : 'Falta la fecha');
    const prov = l.proveedorId ? provs.get(l.proveedorId) : undefined;
    if (!prov) r.errores.push(l.proveedor ? `No encuentro el proveedor "${l.proveedor}": elegilo de la lista` : 'Falta el proveedor');
    else if (!prov.activo) r.errores.push(`${prov.nombre} está inactivo`);
    // Ítem: primero por código (SKU de producto o código de material), si no por nombre de material.
    const cod = l.codigo.trim().toLowerCase();
    const v = cod ? porSku.get(cod) : undefined;
    const mc = cod ? matPorCodigo.get(cod) : undefined;
    if (v) r.item = { tipo: 'variante', id: v.id, nombre: `${v.sku} · ${v.modelo}`, unidad: 'u' };
    else if (mc) r.item = { tipo: 'material', id: mc.id, nombre: mc.nombre, unidad: mc.unidad };
    else if (!cod && l.descripcion.trim()) {
      const cands = matPorNombre.get(normalizarClave(l.descripcion)) ?? [];
      if (cands.length === 1) r.item = { tipo: 'material', id: cands[0].id, nombre: cands[0].nombre, unidad: cands[0].unidad };
      else if (cands.length > 1) r.errores.push(`Hay ${cands.length} materiales llamados "${l.descripcion}": poné el código`);
    }
    if (!r.item && !r.errores.some((e) => e.startsWith('Hay '))) r.errores.push(cod ? `No existe el código "${l.codigo}" (ni producto ni material)` : `No encuentro "${l.descripcion || 'el producto'}": poné el código`);
    if (r.item?.tipo === 'variante' && v && !v.activo) r.avisos.push('El producto está inactivo');
    if (r.item?.tipo === 'material' && mats.find((m) => m.id === r.item!.id)!.tipo === 'mano_obra') {
      r.errores.push('La mano de obra no se importa como material: va en un pedido de confección al taller'); r.item = null;
    }
    const cant = parsearCantidad(l.cantidad);
    if (cant === null || cant <= 0) r.errores.push(l.cantidad ? `Cantidad inválida: "${l.cantidad}"` : 'Falta la cantidad');
    else if (r.item?.tipo === 'variante' && !Number.isInteger(cant)) r.errores.push('Los productos se cuentan en unidades enteras');
    if (l.costoUnitarioCentavos === null) r.errores.push('Falta el costo');
    else if (!Number.isInteger(l.costoUnitarioCentavos) || l.costoUnitarioCentavos < 0) r.errores.push('Costo inválido');
    else if (l.costoUnitarioCentavos === 0) r.avisos.push('Costo en cero');
    if (prov && r.item) {
      r.tipoCompra = r.item.tipo === 'material' ? 'materiales' : prov.rol === 'taller' ? 'confeccion' : 'reventa';
      r.grupo = [prov.id, l.fecha, normalizarClave(l.comprobante), r.tipoCompra === 'materiales' ? 'm' : 'p'].join('|');
    }
    return r;
  });

  // Repetidos dentro del archivo: el mismo producto dos veces en el mismo pedido.
  const vistos = new Map<string, number>();
  for (const r of lineas) {
    if (!r.incluir || !r.grupo || !r.item) continue;
    const k = `${r.grupo}|${r.item.tipo}${r.item.id}`;
    if (vistos.has(k)) r.errores.push(`Repetido en el archivo (fila ${vistos.get(k)}): sumá las cantidades en una sola línea o sacá esta`);
    else vistos.set(k, r.fila);
  }

  // Duplicados contra lo ya cargado.
  const provIds = [...new Set(lineas.map((l) => l.proveedorId).filter((x): x is number => !!x))];
  const existentes = provIds.length ? db.select().from(compras).where(and(inArray(compras.proveedorId, provIds), ne(compras.estado, 'anulada'))).all() : [];
  const ids = existentes.map((c) => c.id);
  const itemsEx = ids.length ? db.select().from(compraItems).where(inArray(compraItems.compraId, ids)).all() : [];
  const matsEx = ids.length ? db.select().from(compraMateriales).where(inArray(compraMateriales.compraId, ids)).all() : [];
  for (const r of lineas) {
    if (!r.proveedorId) continue;
    const comp = normalizarClave(r.comprobante);
    const mismoComprobante = comp ? existentes.find((c) => c.proveedorId === r.proveedorId && c.comprobante && normalizarClave(c.comprobante) === comp) : undefined;
    if (mismoComprobante) { r.duplicado = `Ya está cargado el comprobante ${r.comprobante} en el pedido P-${mismoComprobante.numero}`; continue; }
    if (!r.item) continue;
    const cant = parsearCantidad(r.cantidad) ?? 0;
    const parecido = existentes.find((c) => c.proveedorId === r.proveedorId && c.fecha.slice(0, 10) === r.fecha && (r.item!.tipo === 'variante'
      ? itemsEx.some((i) => i.compraId === c.id && i.varianteId === r.item!.id && i.cantidad === cant)
      : matsEx.some((i) => i.compraId === c.id && i.materialId === r.item!.id && i.cantidadMil === Math.round(cant * 1000))));
    if (parecido) r.duplicado = `Parece ya cargado: el pedido P-${parecido.numero} tiene el mismo proveedor, fecha, ítem y cantidad`;
  }

  const pedidos = new Map<string, PedidoPropuesto>();
  for (const r of lineas) {
    if (!r.incluir || r.errores.length || !r.grupo) continue;
    const p = pedidos.get(r.grupo) ?? { grupo: r.grupo, proveedorId: r.proveedorId!, proveedor: provs.get(r.proveedorId!)!.nombre, tipo: r.tipoCompra!, fecha: r.fecha, comprobante: r.comprobante.trim(), lineas: [], totalCentavos: 0, duplicado: null };
    p.lineas.push(r.fila);
    p.totalCentavos += Math.round((parsearCantidad(r.cantidad) ?? 0) * (r.costoUnitarioCentavos ?? 0));
    if (r.duplicado && !p.duplicado) p.duplicado = r.duplicado;
    pedidos.set(r.grupo, p);
  }
  const incluidas = lineas.filter((l) => l.incluir);
  return {
    lineas, pedidos: [...pedidos.values()],
    resumen: {
      total: lineas.length, incluidas: incluidas.length, conError: incluidas.filter((l) => l.errores.length).length,
      duplicadas: lineas.filter((l) => l.duplicado).length, pedidos: pedidos.size,
      totalCentavos: [...pedidos.values()].reduce((s, p) => s + p.totalCentavos, 0),
    },
  };
}

/** Primera revisión: las líneas que parecen ya cargadas arrancan sin tildar (el usuario decide si las incluye igual). */
export function revisarInicial(db: DB, lineas: LineaImport[]) {
  const r = revisar(db, lineas);
  const sacar = new Set(r.lineas.filter((l) => l.duplicado).map((l) => l.fila));
  return sacar.size ? revisar(db, lineas.map((l) => (sacar.has(l.fila) ? { ...l, incluir: false } : l))) : r;
}

export type ModoImportacion = 'pedido' | 'recibido';

/**
 * Crea los pedidos (confirmados). Con modo 'recibido' además registra la recepción completa en la fecha del pedido:
 * entra el stock (o los materiales), se actualiza el costo y queda la deuda con el proveedor. Debe correr en una transacción.
 */
export function confirmarImportacionCompras(ctx: Ctx, archivo: string, entrada: LineaImport[], modo: ModoImportacion) {
  const { lineas, pedidos } = revisar(ctx.db, entrada);
  const conError = lineas.filter((l) => l.incluir && l.errores.length);
  if (conError.length) throw new ErrorNegocio(`Hay ${conError.length} líneas tildadas con errores (filas ${conError.slice(0, 8).map((l) => l.fila).join(', ')}${conError.length > 8 ? '…' : ''}): corregilas o destildalas`);
  if (!pedidos.length) throw new ErrorNegocio('No hay líneas para importar');
  const imp = ctx.db.insert(importaciones).values({
    fecha: ahora(), usuarioId: ctx.usuarioId, tipo: 'compras', archivo, filasTotal: lineas.length, creadas: 0, actualizadas: 0,
    omitidas: lineas.filter((l) => !l.incluir).length, detalle: { modo },
  }).returning().get();
  const creadas: { id: number; numero: number }[] = [];
  for (const p of pedidos) {
    const ls = lineas.filter((l) => p.lineas.includes(l.fila));
    const items = ls.filter((l) => l.item!.tipo === 'variante').map((l) => ({ varianteId: l.item!.id, cantidad: parsearCantidad(l.cantidad)!, costoUnitarioCentavos: l.costoUnitarioCentavos!, notas: l.notas || null }));
    const mats = ls.filter((l) => l.item!.tipo === 'material').map((l) => ({ materialId: l.item!.id, cantidadMil: Math.round(parsearCantidad(l.cantidad)! * 1000), costoUnitarioCentavos: l.costoUnitarioCentavos!, notas: l.notas || null }));
    const c = crearCompra(ctx, {
      proveedorId: p.proveedorId, tipo: p.tipo, fecha: p.fecha, comprobante: p.comprobante || null, fechaComprobante: p.comprobante ? p.fecha : null,
      notas: `Importado de ${archivo} (filas ${p.lineas.join(', ')})`, items, materiales: mats,
    }, true);
    ctx.db.update(compras).set({ importacionId: imp.id }).where(eq(compras.id, c.id)).run();
    if (modo === 'recibido') {
      const det = obtenerCompra(ctx.db, c.id);
      recibir(ctx, c.id, {
        fecha: p.fecha, comprobante: p.comprobante || null, notas: `Importado de ${archivo}`,
        items: det.items.map((i) => ({ compraItemId: i.id, cantidad: i.cantidad })),
        materiales: det.materiales.map((m) => ({ compraMaterialId: m.id, cantidadMil: m.cantidadMil })),
      });
    }
    creadas.push({ id: c.id, numero: c.numero });
  }
  ctx.db.update(importaciones).set({ creadas: creadas.length, detalle: { modo, compras: creadas.map((c) => c.id) } }).where(eq(importaciones.id, imp.id)).run();
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'importar', entidad: 'compras', entidadId: imp.id, despues: { archivo, modo, pedidos: creadas.map((c) => `P-${c.numero}`) } });
  return { importacionId: imp.id, pedidos: creadas.map((c) => c.numero), omitidas: lineas.filter((l) => !l.incluir).length };
}

export function listarLotesCompras(db: DB) {
  const lotes = db.select().from(importaciones).where(eq(importaciones.tipo, 'compras')).orderBy(sql`${importaciones.id} desc`).all();
  const cs = lotes.length ? db.select({ id: compras.id, numero: compras.numero, estado: compras.estado, importacionId: compras.importacionId, proveedor: proveedores.nombre })
    .from(compras).innerJoin(proveedores, eq(proveedores.id, compras.proveedorId)).where(inArray(compras.importacionId, lotes.map((l) => l.id))).all() : [];
  return lotes.map((l) => ({ ...l, compras: cs.filter((c) => c.importacionId === l.id) }));
}

/** Anula todos los pedidos de un lote (y antes sus recepciones). Nada se borra: queda todo con su anulación. */
export function anularLoteCompras(ctx: Ctx, importacionId: number, motivo: string) {
  if (!motivo?.trim()) throw new ErrorNegocio('Indicá el motivo');
  const lote = ctx.db.select().from(importaciones).where(and(eq(importaciones.id, importacionId), eq(importaciones.tipo, 'compras'))).get();
  if (!lote) throw noEncontrado('La importación');
  const cs = ctx.db.select().from(compras).where(and(eq(compras.importacionId, importacionId), ne(compras.estado, 'anulada'))).all();
  if (!cs.length) throw new ErrorNegocio('Los pedidos de esta importación ya están anulados');
  for (const c of cs) {
    const recs = ctx.db.select().from(recepciones).where(and(eq(recepciones.compraId, c.id), eq(recepciones.estado, 'activa'))).all();
    for (const r of recs) anularRecepcion(ctx, r.id, `Anulación de la importación ${lote.archivo}: ${motivo.trim()}`);
    cambiarEstadoCompra(ctx, c.id, 'anular', `Anulación de la importación ${lote.archivo}: ${motivo.trim()}`);
  }
  auditar(ctx.db, { usuarioId: ctx.usuarioId, accion: 'anular', entidad: 'importacion', entidadId: importacionId, detalle: motivo.trim() });
  return { anulados: cs.length };
}
