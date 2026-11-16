import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCopy, PackagePlus, Plus, X } from 'lucide-react';
import { api } from '../api';
import { useSesion } from '../sesion';
import { Campo, Cargando, Encabezado, ErrorCarga, Modal, Vacio, avisar, avisarError } from '../componentes/ui';
import { BuscadorVariante } from '../componentes/BuscadorVariante';
import { describirVariante, type VarianteBuscada } from '../tipos';
import { pesos } from '../formato';

interface Item { varianteId: number; sku: string; modelo: string; color: string | null; talle: string | null; stock: number; cantidad: number; ventas: number; costoCentavos?: number | null }
interface Grupo { proveedorId: number | null; proveedor: string; unidades: number; items: Item[] }

/** Lo vendido (y lo agregado a mano) que hay que reponer, una lista por proveedor. */
export function PaginaParaPedir() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['para-pedir'], queryFn: () => api.get<Grupo[]>('/para-pedir') });
  const [agregar, setAgregar] = useState(false);
  const inv = () => { qc.invalidateQueries({ queryKey: ['para-pedir'] }); qc.invalidateQueries({ queryKey: ['compras'] }); };
  const total = (q.data ?? []).reduce((s, g) => s + g.unidades, 0);
  return (
    <>
      <Encabezado titulo="Para pedir" sub="Cada venta suma lo vendido a la lista de su proveedor. Corregí cantidades, agregá lo que falte y armá el pedido.">
        {puede('compras', 'crear') && <button className="btn-secundario" onClick={() => setAgregar(true)}><Plus className="h-4 w-4" />Agregar producto</button>}
      </Encabezado>
      {q.isLoading ? <Cargando /> : q.isError ? <ErrorCarga error={q.error} /> : !q.data!.length ? (
        <Vacio>No hay nada para pedir. A medida que vendas, los productos aparecen acá, separados por proveedor.</Vacio>
      ) : (
        <>
          <p className="mb-4 text-sm text-carbon/60">{total} unidades en {q.data!.length} {q.data!.length === 1 ? 'proveedor' : 'proveedores'}.</p>
          <div className="space-y-5">{q.data!.map((g) => <TarjetaProveedor key={g.proveedorId ?? 'ninguno'} g={g} onCambio={inv} />)}</div>
        </>
      )}
      {agregar && <ModalAgregar onCerrar={() => setAgregar(false)} onListo={inv} />}
    </>
  );
}

function TarjetaProveedor({ g, onCambio }: { g: Grupo; onCambio: () => void }) {
  const { puede } = useSesion();
  const nav = useNavigate();
  const [armar, setArmar] = useState(false);
  const fijar = useMutation({
    mutationFn: ({ varianteId, cantidad }: { varianteId: number; cantidad: number }) => api.put(`/para-pedir/${varianteId}`, { cantidad }),
    onSuccess: onCambio, onError: avisarError,
  });
  const copiar = async () => {
    try {
      const { texto } = await api.get<{ texto: string }>(`/para-pedir/texto?proveedorId=${g.proveedorId ?? 'ninguno'}`);
      await navigator.clipboard.writeText(texto);
      avisar('Lista copiada: pegala en WhatsApp o en un mail');
    } catch (e) { avisarError(e); }
  };
  const editable = puede('compras', 'crear');
  const costos = puede('costos');
  const valor = g.items.reduce((s, i) => s + i.cantidad * (i.costoCentavos ?? 0), 0);
  return (
    <section className="tarjeta overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-arena/50 px-4 py-3">
        <div>
          <h2 className="text-lg font-bold">{g.proveedor}</h2>
          <div className="text-sm text-carbon/60">{g.unidades} {g.unidades === 1 ? 'unidad' : 'unidades'}{costos && valor > 0 ? ` · ${pesos(valor)} al costo actual` : ''}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn-secundario btn-chico" onClick={copiar}><ClipboardCopy className="h-4 w-4" />Copiar lista</button>
          {editable && costos && g.proveedorId !== null && <button className="btn-primario btn-chico" onClick={() => setArmar(true)}><PackagePlus className="h-4 w-4" />Armar pedido</button>}
        </div>
      </div>
      {g.proveedorId === null && <p className="bg-crema-50 px-4 py-2 text-xs text-carbon/60">Estos productos no tienen proveedor asignado en el catálogo: asignáselo en el modelo y pasan solos a la lista de ese proveedor.</p>}
      <div className="overflow-x-auto">
        <table className="tabla">
          <thead><tr><th>Producto</th><th className="hidden sm:table-cell">Código</th><th className="num">Stock hoy</th><th className="num">A pedir</th><th /></tr></thead>
          <tbody>{g.items.map((i) => (
            <tr key={i.varianteId}>
              <td>{i.modelo}{i.color ? ` · ${i.color}` : ''}{i.talle ? ` · T${i.talle}` : ''}{i.ventas > 0 && <div className="text-xs text-carbon/50">{i.ventas} {i.ventas === 1 ? 'vendida' : 'vendidas'}</div>}</td>
              <td className="hidden sm:table-cell text-carbon/60">{i.sku}</td>
              <td className={`num ${i.stock <= 0 ? 'font-medium text-bordo' : ''}`}>{i.stock}</td>
              <td className="num">
                {editable ? (
                  <input className="entrada w-16 py-1 text-right" type="number" min={0} defaultValue={i.cantidad} key={i.cantidad}
                    onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 0 && n !== i.cantidad) fijar.mutate({ varianteId: i.varianteId, cantidad: n }); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} aria-label={`Cantidad a pedir de ${i.sku}`} />
                ) : i.cantidad}
              </td>
              <td className="text-right">{editable && <button className="rounded p-1 text-carbon/50 hover:bg-arena/30 hover:text-bordo" title="Sacar de la lista" aria-label={`Sacar ${i.sku} de la lista`} onClick={() => fijar.mutate({ varianteId: i.varianteId, cantidad: 0 })}><X className="h-4 w-4" /></button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {armar && g.proveedorId !== null && <ModalArmar g={g} onCerrar={() => setArmar(false)} onListo={(id) => { onCambio(); nav(`/compras/${id}`); }} />}
    </section>
  );
}

function ModalArmar({ g, onCerrar, onListo }: { g: Grupo; onCerrar: () => void; onListo: (compraId: number) => void }) {
  const [tipo, setTipo] = useState<'' | 'reventa' | 'confeccion'>('');
  const m = useMutation({
    mutationFn: () => api.post<{ compraId: number; numero: number; unidades: number }>('/para-pedir/armar', { proveedorId: g.proveedorId, ...(tipo ? { tipo } : {}) }, true),
    onSuccess: (r) => { avisar(`Pedido P-${r.numero} armado en borrador (${r.unidades} unidades): revisalo y confirmalo`); onListo(r.compraId); }, onError: avisarError,
  });
  return (
    <Modal titulo={`Armar pedido a ${g.proveedor}`} onCerrar={onCerrar}>
      <div className="space-y-4">
        <p className="text-sm text-carbon/70">Se crea un pedido en <strong>borrador</strong> con los {g.unidades} productos de la lista. Antes de confirmarlo podés cambiar cantidades y costos. Si después lo anulás, los productos vuelven a esta lista.</p>
        <Campo etiqueta="Tipo de pedido" ayuda="Si no elegís, se usa el del último pedido a este proveedor. Confección: el costo que se propone es la mano de obra de la receta.">
          <select className="entrada" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
            <option value="">Como el último pedido</option><option value="reventa">Reventa (producto terminado)</option><option value="confeccion">Confección (taller)</option>
          </select>
        </Campo>
        <div className="flex justify-end gap-2"><button className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Armando…' : 'Armar pedido'}</button></div>
        <p className="text-xs text-carbon/50">Los pedidos se ven en <Link className="underline" to="/compras">Pedidos y recepciones</Link>.</p>
      </div>
    </Modal>
  );
}

function ModalAgregar({ onCerrar, onListo }: { onCerrar: () => void; onListo: () => void }) {
  const [v, setV] = useState<VarianteBuscada | null>(null);
  const [cantidad, setCantidad] = useState(1);
  const m = useMutation({
    mutationFn: () => api.post('/para-pedir', { varianteId: v!.varianteId, cantidad }, true),
    onSuccess: () => { avisar('Agregado a la lista'); onListo(); onCerrar(); }, onError: avisarError,
  });
  return (
    <Modal titulo="Agregar a la lista para pedir" onCerrar={onCerrar}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (v && cantidad > 0) m.mutate(); }}>
        <Campo etiqueta="Producto">{v ? (
          <div className="flex items-center justify-between rounded border border-arena px-3 py-2"><span>{describirVariante(v)}</span><button type="button" className="text-sm underline" onClick={() => setV(null)}>Cambiar</button></div>
        ) : <BuscadorVariante autoFocus onElegir={setV} />}</Campo>
        <Campo etiqueta="Cantidad"><input className="entrada w-28" type="number" min={1} value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))} /></Campo>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={!v || cantidad < 1 || m.isPending}>Agregar</button></div>
      </form>
    </Modal>
  );
}
