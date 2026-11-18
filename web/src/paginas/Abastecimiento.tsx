/**
 * Abastecimiento de un pedido de confección: qué material lleva (por color), qué hay, qué se reserva, qué se le
 * entrega al taller y qué hay que comprar, agrupado por proveedor. Nada se compra solo: se arma un pedido en borrador.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Lock, Printer, ShoppingCart, Truck, Unlock } from 'lucide-react';
import { api } from '../api';
import { useSesion } from '../sesion';
import { Aviso, Campo, Confirmar, Modal, Vacio, avisar, avisarError } from '../componentes/ui';
import { pesos } from '../formato';
import { cant, conColor, leerCant, type Unidad } from '../costos';
import { ModalEntrega, type Prellenado } from './Produccion';

type Caso = 'A' | 'B' | 'C' | 'cubierto';
interface Fila {
  clave: string; materialId: number; colorId: number | null; color: string | null; porColor: boolean; codigo: string; nombre: string; unidad: Unidad;
  esCuero: boolean; proveedorId: number | null; proveedor: string | null; costoCentavos?: number | null;
  totalMil: number; pendienteMil: number; entregadoMil: number; enTallerMil: number; stockLocalMil: number;
  cubreTallerMil: number; faltaEntregarMil: number; reservadoMil: number; usarStockMil: number; disponibleParaReservarMil: number;
  reservadoOtrosMil: number; enCaminoMil: number; enCaminoDe: { compraId: number; numero: number; estado: string; proveedor: string; cantidadMil: number }[];
  faltaComprarMil: number; otrosLugares: { ubicacionProveedorId: number; lugar: string; cantidadMil: number }[]; sugeridoMil: number; caso: Caso;
}
interface Datos {
  compraId: number; numero: number; estado: string; tallerId: number; taller: string; abierto: boolean; sinReceta: string[];
  materiales: Fila[]; sugerencias: { proveedorId: number | null; proveedor: string; cuero: boolean; items: Fila[] }[];
  reservadoEnOtros: { compraId: number; numero: number; items: { clave: string; nombre: string; color: string | null; unidad: Unidad; reservadoMil: number }[] }[];
  proveedoresMateriales: { id: number; nombre: string; rol: string | null; activo: boolean }[];
}

const CASOS: Record<Caso, { texto: string; clase: string }> = {
  cubierto: { texto: 'Lo tiene el taller', clase: 'bg-arena/40 text-carbon/70' },
  A: { texto: 'Hay stock', clase: 'bg-dorado/25 text-dorado-oscuro' },
  B: { texto: 'Stock parcial', clase: 'bg-conac/15 text-conac' },
  C: { texto: 'Sin stock', clase: 'bg-bordo/10 text-bordo' },
};
const nombre = (f: { nombre: string; color: string | null }) => conColor(f.nombre, f.color);

export function Abastecimiento({ compraId }: { compraId: number }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['abastecimiento', compraId], queryFn: () => api.get<Datos>(`/abastecimiento/${compraId}`) });
  const enCurso = useQuery({ queryKey: ['produccion'], queryFn: () => api.get<Parameters<typeof ModalEntrega>[0]['pedidos']>('/custodia/produccion') });
  const [reservar, setReservar] = useState(false);
  const [liberar, setLiberar] = useState(false);
  const [entregar, setEntregar] = useState<Prellenado | null>(null);
  const inv = () => ['abastecimiento', 'produccion', 'custodia', 'traslados', 'materiales', 'material', 'reposicion-materiales', 'compras', 'compra'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const resDisp = useMutation({ mutationFn: () => api.post(`/abastecimiento/${compraId}/reservar-disponible`), onSuccess: () => { avisar('Reservado lo que hay libre en el local'); inv(); }, onError: avisarError });
  const lib = useMutation({ mutationFn: () => api.post(`/abastecimiento/${compraId}/liberar`, { motivo: 'Liberado a mano' }), onSuccess: () => { avisar('Reservas liberadas'); setLiberar(false); inv(); }, onError: avisarError });
  if (!q.data) return null;
  const d = q.data;
  const edita = puede('materiales', 'modificar') && d.abierto;
  const hayReservas = d.materiales.some((f) => f.reservadoMil > 0);
  const paraEntregar = d.materiales.filter((f) => f.reservadoMil + f.usarStockMil > 0);
  const prellenarEntrega = (): Prellenado => ({
    origen: null, destino: d.tallerId, compraId,
    items: paraEntregar.map((f) => ({ materialId: f.materialId, colorId: f.colorId, texto: cant(f.reservadoMil || f.usarStockMil) })),
  });
  const conOtros = d.materiales.filter((f) => f.otrosLugares.length && f.faltaComprarMil > 0);
  const enCamino = d.materiales.filter((f) => f.enCaminoMil > 0);
  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">Abastecimiento del pedido</h2>
          <p className="text-sm text-carbon/60">Qué material lleva lo que falta hacer, qué hay, qué reservar, qué entregarle a {d.taller} y qué comprar.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secundario btn-chico" href={`/api/abastecimiento/${compraId}/excel`}><Download className="h-4 w-4" />Excel</a>
          <button className="btn-secundario btn-chico" onClick={() => imprimir(d)}><Printer className="h-4 w-4" />Imprimir / PDF</button>
          {edita && <button className="btn-secundario btn-chico" onClick={() => setReservar(true)}><Lock className="h-4 w-4" />Reservar</button>}
          {edita && hayReservas && <button className="btn-secundario btn-chico" onClick={() => setLiberar(true)}><Unlock className="h-4 w-4" />Liberar</button>}
          {edita && paraEntregar.length > 0 && <button className="btn-primario btn-chico" onClick={() => setEntregar(prellenarEntrega())}><Truck className="h-4 w-4" />Entregar a {d.taller}</button>}
        </div>
      </div>
      {d.sinReceta.length > 0 && <Aviso tono="atencion">Sin receta: {d.sinReceta.join(', ')}. No se puede calcular qué material lleva.</Aviso>}
      {!d.abierto && <Aviso>El pedido está {d.estado}: no reserva material ni genera sugerencias.</Aviso>}
      {!d.materiales.length ? <Vacio>Sin materiales por receta.</Vacio> : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead><tr>
              <th className="min-w-[13rem]">Material</th><th className="num">Necesita</th><th className="num" title="Lo que ya tiene el taller y cubre este pedido">Taller</th><th className="num">Falta entregar</th>
              <th className="num">Reservado</th><th className="num" title="Stock libre del local que alcanza para este pedido">Del local</th><th className="num" title="Pedido a un proveedor, todavía sin llegar">En camino</th><th className="num">A comprar</th><th>Estado</th>
            </tr></thead>
            <tbody>{d.materiales.map((f) => (
              <tr key={f.clave}>
                <td><span className="font-medium">{nombre(f)}</span><div className="text-xs text-carbon/55">{f.proveedor ?? 'Sin proveedor'} · local {cant(f.stockLocalMil)} {f.unidad}{f.reservadoOtrosMil > 0 ? ` (${cant(f.reservadoOtrosMil)} reservado para otros)` : ''}</div></td>
                <td className="num">{cant(f.pendienteMil)} {f.unidad}</td>
                <td className="num">{cant(f.cubreTallerMil)}</td>
                <td className="num font-medium">{cant(f.faltaEntregarMil)}</td>
                <td className="num">{f.reservadoMil ? cant(f.reservadoMil) : <span className="text-carbon/35">0</span>}</td>
                <td className="num">{f.usarStockMil ? cant(f.usarStockMil) : <span className="text-carbon/35">0</span>}</td>
                <td className="num">{f.enCaminoMil ? cant(f.enCaminoMil) : <span className="text-carbon/35">0</span>}</td>
                <td className={`num ${f.faltaComprarMil > 0 ? 'font-semibold text-bordo' : 'text-carbon/35'}`}>{cant(f.faltaComprarMil)}</td>
                <td><span className={`pildora whitespace-nowrap ${CASOS[f.caso].clase}`}>{CASOS[f.caso].texto}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-carbon/55">
        "Del local" es lo que hay libre y alcanza para este pedido (los pedidos más viejos se cubren primero). Reservar lo deja apartado para que no lo use otro pedido.
        Al entregarlo a {d.taller} pasa a su custodia, y se consume recién cuando entrega las camperas. Si el pedido se anula, lo reservado vuelve a estar libre.
      </p>

      {(enCamino.length > 0 || conOtros.length > 0 || d.reservadoEnOtros.length > 0) && (
        <div className="grid gap-3 md:grid-cols-3">
          {enCamino.length > 0 && <Lista titulo="Pendiente de recibir" filas={enCamino.map((f) => `${nombre(f)}: ${cant(f.enCaminoMil)} ${f.unidad} (${f.enCaminoDe.map((p) => `P-${p.numero} ${p.proveedor}${p.estado === 'borrador' ? ', borrador' : ''}`).join('; ')})`)} />}
          {conOtros.length > 0 && (
            <div className="tarjeta p-4 text-sm">
              <div className="etiqueta mb-2">Hay en otro lugar: evaluá traerlo antes de comprar</div>
              <ul className="space-y-2">{conOtros.flatMap((f) => f.otrosLugares.map((o) => (
                <li key={f.clave + o.ubicacionProveedorId} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{nombre(f)}: {cant(o.cantidadMil)} {f.unidad} en {o.lugar}</span>
                  {edita && <button className="btn-secundario btn-chico" onClick={() => setEntregar({ origen: o.ubicacionProveedorId, destino: d.tallerId, compraId, items: [{ materialId: f.materialId, colorId: f.colorId, texto: cant(Math.min(o.cantidadMil, f.faltaComprarMil)) }] })}>Trasladar</button>}
                </li>
              )))}</ul>
              <p className="mt-2 text-xs text-carbon/55">La sugerencia de compra ya descuenta lo que hay en otro lugar. Si no lo vas a traer, subí la cantidad a comprar.</p>
            </div>
          )}
          {d.reservadoEnOtros.length > 0 && <Lista titulo="Reservado para otros pedidos" filas={d.reservadoEnOtros.flatMap((p) => p.items.map((i) => `P-${p.numero}: ${conColor(i.nombre, i.color)} ${cant(i.reservadoMil)} ${i.unidad}`))} />}
        </div>
      )}

      <Sugerencias d={d} onListo={inv} />

      {reservar && <ModalReservar d={d} onCerrar={() => setReservar(false)} onListo={inv} onTodo={() => { resDisp.mutate(); setReservar(false); }} />}
      {liberar && (
        <Confirmar titulo="Liberar reservas" textoBoton="Liberar" ocupado={lib.isPending} onCerrar={() => setLiberar(false)} onConfirmar={() => lib.mutate()}>
          <p className="text-sm">Lo reservado para este pedido vuelve a estar libre para otros. No se mueve stock.</p>
        </Confirmar>
      )}
      {entregar && enCurso.data && <ModalEntrega inicial={entregar} pedidos={enCurso.data} onCerrar={() => setEntregar(null)} onListo={inv} />}
      {enCamino.length === 0 && d.sugerencias.length === 0 && d.abierto && d.materiales.some((f) => f.faltaEntregarMil > 0) && d.materiales.every((f) => f.faltaComprarMil === 0) && (
        <p className="text-sm text-dorado-oscuro">Todo lo que falta entregar está en el local. <Link className="underline" to="/materiales">Ver materiales</Link></p>
      )}
    </div>
  );
}

function Lista({ titulo, filas }: { titulo: string; filas: string[] }) {
  return (
    <div className="tarjeta p-4 text-sm">
      <div className="etiqueta mb-2">{titulo}</div>
      <ul className="space-y-1">{filas.map((f, i) => <li key={i}>{f}</li>)}</ul>
    </div>
  );
}

/** Sugerencias de compra por proveedor, editables: cantidad y (en el cuero) a quién se le pide. */
function Sugerencias({ d, onListo }: { d: Datos; onListo: () => void }) {
  const { puede } = useSesion();
  const puedeArmar = puede('compras', 'crear') && puede('costos') && d.abierto;
  const inicial = useMemo(() => Object.fromEntries(d.sugerencias.flatMap((g) => g.items.map((f) => [f.clave, cant(f.sugeridoMil)]))), [d]);
  const [cants, setCants] = useState<Record<string, string>>(inicial);
  const [prov, setProv] = useState<Record<string, number | null>>({});
  const armar = useMutation({
    mutationFn: (g: Datos['sugerencias'][number]) => {
      const proveedorId = prov[g.proveedor] ?? g.proveedorId;
      if (!proveedorId) throw new Error('Elegí a qué proveedor se le pide');
      const lineas = g.items.map((f) => ({ materialId: f.materialId, colorId: f.colorId, cantidadMil: leerCant(cants[f.clave] ?? '') })).filter((l) => l.cantidadMil > 0);
      if (lineas.some((l) => !Number.isFinite(l.cantidadMil))) throw new Error('Hay una cantidad que no es un número');
      if (!lineas.length) throw new Error('No hay cantidades para pedir');
      return api.post<{ pedidos: { numero: number }[] }>(`/abastecimiento/${d.compraId}/armar-compras`, { grupos: [{ proveedorId, lineas }] }, true);
    },
    onSuccess: (r) => { avisar(`Pedido ${r.pedidos.map((p) => `P-${p.numero}`).join(', ')} armado en borrador: revisalo y confirmalo en Pedidos`); onListo(); },
    onError: avisarError,
  });
  if (!d.sugerencias.length) return null;
  return (
    <div>
      <h3 className="mb-2 text-lg font-bold">Sugerencias de compra</h3>
      <p className="mb-3 text-sm text-carbon/60">Editá las cantidades antes de armar el pedido. Nada se compra solo: queda en borrador en Pedidos para que lo revises y lo confirmes.</p>
      <div className="grid gap-3 lg:grid-cols-2">{d.sugerencias.map((g) => {
        const total = g.items.reduce((s, f) => s + (f.costoCentavos != null ? Math.round(((leerCant(cants[f.clave] ?? '') || 0) * f.costoCentavos) / 1000) : 0), 0);
        return (
          <section key={g.proveedor} className="tarjeta p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="font-bold">{g.cuero ? 'Cuero' : 'Materiales e insumos'}</div>
              {g.cuero || !g.proveedorId ? (
                <Campo etiqueta="Pedírselo a"><select className="entrada py-1" value={prov[g.proveedor] ?? g.proveedorId ?? ''} onChange={(e) => setProv({ ...prov, [g.proveedor]: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Elegí…</option>{d.proveedoresMateriales.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.activo ? '' : ' (inactivo)'}</option>)}
                </select></Campo>
              ) : <span className="text-sm">{g.proveedor}</span>}
            </div>
            <table className="tabla text-sm">
              <thead><tr><th>Material</th><th className="num">Falta</th><th className="num w-28">A pedir</th></tr></thead>
              <tbody>{g.items.map((f) => (
                <tr key={f.clave}>
                  <td>{nombre(f)}</td>
                  <td className="num">{cant(f.faltaComprarMil)} {f.unidad}</td>
                  <td><input className="entrada py-1 text-right" inputMode="decimal" value={cants[f.clave] ?? ''} disabled={!puedeArmar} onChange={(e) => setCants({ ...cants, [f.clave]: e.target.value })} /></td>
                </tr>
              ))}</tbody>
            </table>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              {total > 0 ? <span className="text-sm">Aprox. {pesos(total)}</span> : <span />}
              {puedeArmar && <button className="btn-primario btn-chico" disabled={armar.isPending} onClick={() => armar.mutate(g)}><ShoppingCart className="h-4 w-4" />Armar pedido en borrador</button>}
            </div>
          </section>
        );
      })}</div>
    </div>
  );
}

function ModalReservar({ d, onCerrar, onListo, onTodo }: { d: Datos; onCerrar: () => void; onListo: () => void; onTodo: () => void }) {
  const filas = d.materiales.filter((f) => f.disponibleParaReservarMil > 0 || f.reservadoMil > 0);
  const [cants, setCants] = useState<Record<string, string>>(Object.fromEntries(filas.map((f) => [f.clave, cant(f.reservadoMil)])));
  const mil = (k: string) => leerCant(cants[k] ?? '');
  const malos = filas.filter((f) => !(mil(f.clave) >= 0) || mil(f.clave) > f.disponibleParaReservarMil);
  const cambiadas = filas.filter((f) => mil(f.clave) !== f.reservadoMil);
  const g = useMutation({
    mutationFn: () => api.post(`/abastecimiento/${d.compraId}/reservas`, { lineas: cambiadas.map((f) => ({ materialId: f.materialId, colorId: f.colorId, cantidadMil: mil(f.clave) })) }),
    onSuccess: () => { avisar('Reservas guardadas'); onListo(); onCerrar(); }, onError: avisarError,
  });
  return (
    <Modal titulo={`Reservar material para P-${d.numero}`} onCerrar={onCerrar} ancho="max-w-2xl">
      {!filas.length ? <p className="text-sm">No hay material libre en el local para este pedido.</p> : (
        <div className="space-y-4">
          <p className="text-sm text-carbon/70">Lo reservado queda apartado para este pedido hasta que se lo entregues a {d.taller}. No se mueve stock.</p>
          <table className="tabla text-sm">
            <thead><tr><th>Material</th><th className="num">Se puede reservar</th><th className="num w-32">Reservar</th></tr></thead>
            <tbody>{filas.map((f) => (
              <tr key={f.clave}>
                <td>{nombre(f)}</td>
                <td className="num">{cant(f.disponibleParaReservarMil)} {f.unidad}</td>
                <td><input className={`entrada py-1 text-right ${malos.includes(f) ? 'border-bordo' : ''}`} inputMode="decimal" value={cants[f.clave] ?? ''} onChange={(e) => setCants({ ...cants, [f.clave]: e.target.value })} /></td>
              </tr>
            ))}</tbody>
          </table>
          <div className="flex flex-wrap justify-between gap-2">
            <button type="button" className="btn-secundario" onClick={onTodo}>Reservar todo lo disponible</button>
            <div className="flex gap-2">
              <button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button>
              <button className="btn-primario" disabled={!cambiadas.length || malos.length > 0 || g.isPending} onClick={() => g.mutate()}>Guardar reservas</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Planilla para imprimir o guardar como PDF (desde el diálogo de impresión). */
function imprimir(d: Datos) {
  const n = (f: { nombre: string; color: string | null }) => esc(nombre(f));
  const tabla = (titulo: string, filas: string[][], cab: string[]) => !filas.length ? '' : `<h2>${esc(titulo)}</h2><table><thead><tr>${cab.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${filas.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const m = d.materiales;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Abastecimiento P-${d.numero}</title><style>
    body{font-family:system-ui,sans-serif;color:#15120F;margin:24px;font-size:12px} h1{font-size:20px;margin:0 0 4px} h2{font-size:14px;margin:18px 0 6px}
    table{border-collapse:collapse;width:100%} th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left} th{background:#f3eee4} .n{text-align:right} p{color:#555}
  </style></head><body>
  <h1>Abastecimiento · pedido P-${d.numero} · ${esc(d.taller)}</h1><p>${new Date().toLocaleDateString('es-AR')}. Cantidades en la unidad de cada material.</p>
  ${tabla('Necesidad del pedido', m.map((f) => [n(f), cant(f.pendienteMil) + ' ' + f.unidad, cant(f.cubreTallerMil), cant(f.faltaEntregarMil), cant(f.reservadoMil), cant(f.usarStockMil), cant(f.enCaminoMil), cant(f.faltaComprarMil)]), ['Material', 'Necesita', 'Lo tiene el taller', 'Falta entregar', 'Reservado', 'Sale del local', 'Pedido sin llegar', 'Falta comprar'])}
  ${tabla('1. Retirar del stock del local', m.filter((f) => f.reservadoMil + f.usarStockMil > 0).map((f) => [n(f), cant(f.reservadoMil + f.usarStockMil) + ' ' + f.unidad, f.reservadoMil ? 'Reservado' : 'Sin reservar']), ['Material', 'Cantidad', 'Estado'])}
  ${tabla('2. Materiales a pedir', d.sugerencias.filter((g) => !g.cuero).flatMap((g) => g.items.map((f) => [n(f), cant(f.sugeridoMil) + ' ' + f.unidad, esc(g.proveedor)])), ['Material', 'Cantidad', 'Proveedor'])}
  ${tabla('3. Cuero a pedir', d.sugerencias.filter((g) => g.cuero).flatMap((g) => g.items.map((f) => [n(f), cant(f.sugeridoMil) + ' ' + f.unidad, esc(g.proveedor)])), ['Material', 'Cantidad', 'Proveedor'])}
  ${tabla('4. Pendiente de recibir', m.filter((f) => f.enCaminoMil > 0).map((f) => [n(f), cant(f.enCaminoMil) + ' ' + f.unidad, esc(f.enCaminoDe.map((p) => `P-${p.numero} ${p.proveedor}`).join(', '))]), ['Material', 'Cantidad', 'Pedido'])}
  ${tabla('5. Reservado para otros pedidos', d.reservadoEnOtros.flatMap((p) => p.items.map((i) => [esc(conColor(i.nombre, i.color)), cant(i.reservadoMil) + ' ' + i.unidad, 'P-' + p.numero])), ['Material', 'Cantidad', 'Pedido'])}
  ${tabla('En otro lugar (evaluar traslado)', m.flatMap((f) => f.otrosLugares.map((o) => [n(f), cant(o.cantidadMil) + ' ' + f.unidad, esc(o.lugar)])), ['Material', 'Cantidad', 'Dónde'])}
  <script>window.onload=()=>window.print()</script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { avisar('El navegador bloqueó la ventana: permití las ventanas emergentes para imprimir'); return; }
  w.document.write(html); w.document.close();
}
