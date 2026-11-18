import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCopy, PackagePlus, Plus, RotateCcw, X } from 'lucide-react';
import { api } from '../api';
import { useSesion } from '../sesion';
import { Campo, Cargando, Encabezado, ErrorCarga, Modal, Vacio, avisar, avisarError } from '../componentes/ui';
import { BuscadorVariante } from '../componentes/BuscadorVariante';
import { coincide } from '../componentes/Orden';
import { describirVariante, type VarianteBuscada } from '../tipos';
import { pesos } from '../formato';

type Circuito = 'comprar' | 'fabricar';
interface Linea {
  varianteId: number; sku: string; modelo: string; color: string | null; talle: string | null; categoria: string; circuito: Circuito;
  stock: number; minimo: number | null; enPedido: number; vendido: number; enLista: number; sugerida: number; cantidad: number; motivo: string;
  proveedorId: number | null; proveedor: string; proveedorSugeridoId: number | null; proveedorCambiado: boolean; costoCentavos?: number | null;
}
interface GrupoProv { proveedorId: number | null; proveedor: string; unidades: number; valorCentavos?: number; items: Linea[] }
interface Grupo { categoriaId: number; categoria: string; circuito: Circuito; unidades: number; proveedores: GrupoProv[] }
interface Descartado extends Linea { decisionId: number; motivoDescarte: string | null; descartadoEn: string }
interface Respuesta { grupos: Grupo[]; descartados: Descartado[]; resumen: { productos: number; unidades: number; yaPedidos: number; descartados: number } }
interface Proveedor { id: number; nombre: string; activo: boolean }

const nombre = (l: Linea) => `${l.modelo}${l.color ? ` · ${l.color}` : ''}${l.talle ? ` · T${l.talle}` : ''}`;

/**
 * Reposición General: todo lo que hay que reponer (stock en cero o bajo el mínimo, más lo vendido pendiente de pedir),
 * por categoría y proveedor. El sistema propone; acá se edita la cantidad, se descarta o reincluye y se cambia el proveedor.
 */
export function PaginaReposicion() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['reposicion'], queryFn: () => api.get<Respuesta>('/reposicion') });
  const provs = useQuery({ queryKey: ['proveedores'], queryFn: () => api.get<Proveedor[]>('/proveedores'), enabled: puede('proveedores') });
  const [texto, setTexto] = useState('');
  const [circuito, setCircuito] = useState<'' | Circuito>('');
  const [categoria, setCategoria] = useState('');
  const [proveedor, setProveedor] = useState('');
  const [agregar, setAgregar] = useState(false);
  const [verDescartados, setVerDescartados] = useState(false);
  const inv = () => ['reposicion', 'para-pedir', 'compras'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const grupos = useMemo(() => (q.data?.grupos ?? [])
    .filter((g) => (!circuito || g.circuito === circuito) && (!categoria || String(g.categoriaId) === categoria))
    .map((g) => ({ ...g, proveedores: g.proveedores
      .filter((p) => !proveedor || String(p.proveedorId ?? 'ninguno') === proveedor)
      .map((p) => ({ ...p, items: p.items.filter((i) => coincide(texto, i.sku, i.modelo, i.color, i.talle)) }))
      .filter((p) => p.items.length) }))
    .filter((g) => g.proveedores.length), [q.data, circuito, categoria, proveedor, texto]);
  const categorias = useMemo(() => [...new Map((q.data?.grupos ?? []).map((g) => [g.categoriaId, g.categoria])).entries()], [q.data]);
  const provsEnLista = useMemo(() => [...new Map((q.data?.grupos ?? []).flatMap((g) => g.proveedores).map((p) => [String(p.proveedorId ?? 'ninguno'), p.proveedor])).entries()], [q.data]);

  if (q.isLoading) return <Cargando />;
  if (q.isError) return <ErrorCarga error={q.error} />;
  const r = q.data!;
  return (
    <>
      <Encabezado titulo="Reposición general" sub="Todo lo que está en cero, bajo el mínimo o vendido sin pedir, por categoría y proveedor. El sistema propone: vos corregís cantidades, descartás o cambiás el proveedor y armás los pedidos.">
        {puede('compras', 'crear') && <button className="btn-secundario" onClick={() => setAgregar(true)}><Plus className="h-4 w-4" />Agregar producto</button>}
      </Encabezado>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="tarjeta p-4"><div className="etiqueta">Productos a reponer</div><div className="mt-1 font-titulo text-2xl font-bold">{r.resumen.productos}</div></div>
        <div className="tarjeta p-4"><div className="etiqueta">Unidades</div><div className="mt-1 font-titulo text-2xl font-bold">{r.resumen.unidades}</div></div>
        <div className="tarjeta p-4"><div className="etiqueta">Ya pedidos</div><div className="mt-1 font-titulo text-2xl font-bold">{r.resumen.yaPedidos}</div><div className="text-xs text-carbon/50">en pedidos abiertos, no se repiten</div></div>
        <button className="tarjeta p-4 text-left hover:bg-crema-50" onClick={() => setVerDescartados((v) => !v)}><div className="etiqueta">Descartados</div><div className="mt-1 font-titulo text-2xl font-bold">{r.resumen.descartados}</div><div className="text-xs text-carbon/50 underline">{verDescartados ? 'ocultar' : 'ver y reincluir'}</div></button>
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <input className="entrada" placeholder="Buscar producto o código" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <select className="entrada" value={circuito} onChange={(e) => setCircuito(e.target.value as typeof circuito)}>
          <option value="">Todo</option><option value="comprar">Productos terminados (a proveedores)</option><option value="fabricar">Camperas propias (a fabricar)</option>
        </select>
        <select className="entrada" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          <option value="">Todas las categorías</option>{categorias.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select>
        <select className="entrada" value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
          <option value="">Todos los proveedores</option>{provsEnLista.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </select>
      </div>

      {verDescartados && <Descartados items={r.descartados} onCambio={inv} />}

      {!grupos.length ? <Vacio>No hay nada para reponer con ese filtro.</Vacio> : (
        <div className="space-y-8">
          {grupos.map((g) => (
            <section key={`${g.circuito}-${g.categoriaId}`}>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-titulo text-xl font-bold">{g.categoria}</h2>
                <span className="text-sm text-carbon/60">{g.circuito === 'fabricar' ? 'Fabricación propia · ' : ''}{g.unidades} {g.unidades === 1 ? 'unidad' : 'unidades'}</span>
              </div>
              {g.circuito === 'fabricar' && <p className="mb-3 rounded bg-crema-50 px-3 py-2 text-xs text-carbon/65">Camperas de fabricación propia: no se compran, se mandan a fabricar. Desde acá se arma el pedido de confección al taller (en borrador, sin deuda ni stock hasta que se confirme y entregue).</p>}
              <div className="space-y-4">{g.proveedores.map((p) => <TarjetaProveedor key={p.proveedorId ?? 'ninguno'} p={p} circuito={g.circuito} proveedores={provs.data ?? []} onCambio={inv} />)}</div>
            </section>
          ))}
        </div>
      )}
      <p className="mt-6 text-xs text-carbon/50">La lista anterior que solo suma ventas sigue en <Link className="underline" to="/para-pedir">Para pedir</Link>; las cantidades que corrijas acá se ven también ahí.</p>
      {agregar && <ModalAgregar onCerrar={() => setAgregar(false)} onListo={inv} />}
    </>
  );
}

function TarjetaProveedor({ p, circuito, proveedores, onCambio }: { p: GrupoProv; circuito: Circuito; proveedores: Proveedor[]; onCambio: () => void }) {
  const { puede } = useSesion();
  const nav = useNavigate();
  const editable = puede('compras', 'crear');
  const costos = puede('costos');
  const [fuera, setFuera] = useState<Set<number>>(new Set());
  const [cant, setCant] = useState<Record<number, number>>({});
  const [armar, setArmar] = useState(false);
  const [descartar, setDescartar] = useState<Linea | null>(null);
  const cantidad = (l: Linea) => cant[l.varianteId] ?? l.cantidad;
  const elegidas = p.items.filter((l) => !fuera.has(l.varianteId));
  const unidades = elegidas.reduce((s, l) => s + cantidad(l), 0);
  const valor = elegidas.reduce((s, l) => s + cantidad(l) * (l.costoCentavos ?? 0), 0);

  const fijar = useMutation({
    mutationFn: ({ varianteId, cantidad }: { varianteId: number; cantidad: number }) => api.put(`/reposicion/${varianteId}/cantidad`, { cantidad }),
    onSuccess: (_r, v) => { setCant((c) => { const n = { ...c }; delete n[v.varianteId]; return n; }); onCambio(); }, onError: avisarError,
  });
  const cambiarProv = useMutation({
    mutationFn: ({ varianteId, proveedorId }: { varianteId: number; proveedorId: number }) => api.post(`/reposicion/${varianteId}/proveedor`, { proveedorId }),
    onSuccess: () => { avisar('Proveedor cambiado: pasó a la lista de ese proveedor'); onCambio(); }, onError: avisarError,
  });
  const copiar = async () => {
    try {
      const { texto } = await api.get<{ texto: string }>(`/reposicion/texto?proveedorId=${p.proveedorId ?? 'ninguno'}`);
      await navigator.clipboard.writeText(texto);
      avisar('Lista copiada: pegala en WhatsApp o en un mail');
    } catch (e) { avisarError(e); }
  };
  const alternar = (id: number) => setFuera((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <section className="tarjeta overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-arena/50 px-4 py-3">
        <div>
          <h3 className="text-lg font-bold">{p.proveedor}</h3>
          <div className="text-sm text-carbon/60">{elegidas.length} de {p.items.length} productos · {unidades} {unidades === 1 ? 'unidad' : 'unidades'}{costos && valor > 0 ? ` · ${pesos(valor)} estimado` : ''}</div>
        </div>
        <div className="flex gap-2">
          <button className="btn-secundario btn-chico" onClick={copiar}><ClipboardCopy className="h-4 w-4" />Copiar lista</button>
          {editable && costos && p.proveedorId !== null && <button className="btn-primario btn-chico" disabled={!elegidas.length} onClick={() => setArmar(true)}><PackagePlus className="h-4 w-4" />{circuito === 'fabricar' ? 'Armar pedido de confección' : 'Armar pedido'}</button>}
        </div>
      </div>
      {p.proveedorId === null && <p className="bg-crema-50 px-4 py-2 text-xs text-carbon/60">Sin proveedor: elegí uno en cada línea (o asignáselo al modelo en Productos).</p>}
      <div className="overflow-x-auto">
        <table className="tabla">
          <thead><tr>{editable && <th className="w-8" />}<th>Producto</th><th className="hidden md:table-cell">Motivo</th><th className="num">Stock</th><th className="num hidden sm:table-cell">En pedido</th><th className="num">A pedir</th>{editable && <th className="hidden lg:table-cell">Proveedor</th>}{editable && <th />}</tr></thead>
          <tbody>{p.items.map((l) => (
            <tr key={l.varianteId} className={fuera.has(l.varianteId) ? 'opacity-45' : ''}>
              {editable && <td><input type="checkbox" checked={!fuera.has(l.varianteId)} onChange={() => alternar(l.varianteId)} aria-label={`Incluir ${l.sku} en el pedido`} /></td>}
              <td>{nombre(l)}<div className="text-xs text-carbon/50">{l.sku}<span className="md:hidden"> · {l.motivo}</span></div></td>
              <td className="hidden md:table-cell text-sm text-carbon/65">{l.motivo}</td>
              <td className={`num ${l.stock <= 0 ? 'font-medium text-bordo' : ''}`}>{l.stock}{l.minimo != null && <div className="text-[11px] text-carbon/45">mín. {l.minimo}</div>}</td>
              <td className="num hidden sm:table-cell text-carbon/60">{l.enPedido || '—'}</td>
              <td className="num">
                {editable ? (
                  <input className="entrada w-16 py-1 text-right" type="number" min={1} value={cantidad(l)}
                    onChange={(e) => setCant((c) => ({ ...c, [l.varianteId]: Number(e.target.value) }))}
                    onBlur={() => { const n = cantidad(l); if (Number.isInteger(n) && n > 0 && n !== l.cantidad) fijar.mutate({ varianteId: l.varianteId, cantidad: n }); else setCant((c) => { const x = { ...c }; delete x[l.varianteId]; return x; }); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} aria-label={`Cantidad a pedir de ${l.sku}`} />
                ) : l.cantidad}
                {l.sugerida > 0 && l.sugerida !== cantidad(l) && <div className="text-[11px] text-carbon/45">sugerido {l.sugerida}</div>}
              </td>
              {editable && (
                <td className="hidden lg:table-cell">
                  <select className="entrada py-1 text-sm" value={l.proveedorId ?? ''} onChange={(e) => e.target.value && cambiarProv.mutate({ varianteId: l.varianteId, proveedorId: Number(e.target.value) })} aria-label={`Proveedor de ${l.sku}`}>
                    {l.proveedorId === null && <option value="">Elegir…</option>}
                    {proveedores.filter((x) => x.activo || x.id === l.proveedorId).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                  </select>
                  {l.proveedorCambiado && <div className="text-[11px] text-carbon/45">cambiado a mano</div>}
                </td>
              )}
              {editable && <td className="text-right"><button className="rounded p-1 text-carbon/50 hover:bg-arena/30 hover:text-bordo" title="Descartar" aria-label={`Descartar ${l.sku}`} onClick={() => setDescartar(l)}><X className="h-4 w-4" /></button></td>}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {armar && p.proveedorId !== null && (
        <ModalArmar proveedorId={p.proveedorId} proveedor={p.proveedor} circuito={circuito} lineas={elegidas.map((l) => ({ ...l, cantidad: cantidad(l) }))} valor={costos ? valor : null}
          onCerrar={() => setArmar(false)} onListo={(id) => { onCambio(); nav(`/compras/${id}`); }} />
      )}
      {descartar && <ModalDescartar l={descartar} onCerrar={() => setDescartar(null)} onListo={() => { setDescartar(null); onCambio(); }} />}
    </section>
  );
}

function ModalArmar({ proveedorId, proveedor, circuito, lineas, valor, onCerrar, onListo }: { proveedorId: number; proveedor: string; circuito: Circuito; lineas: Linea[]; valor: number | null; onCerrar: () => void; onListo: (compraId: number) => void }) {
  const [tipo, setTipo] = useState<'' | 'reventa' | 'confeccion'>(circuito === 'fabricar' ? 'confeccion' : '');
  const unidades = lineas.reduce((s, l) => s + l.cantidad, 0);
  const m = useMutation({
    mutationFn: () => api.post<{ compraId: number; numero: number; unidades: number }>('/reposicion/armar', { proveedorId, ...(tipo ? { tipo } : {}), lineas: lineas.map((l) => ({ varianteId: l.varianteId, cantidad: l.cantidad })) }, true),
    onSuccess: (r) => { avisar(`Pedido P-${r.numero} armado en borrador (${r.unidades} unidades): revisalo y confirmalo`); onListo(r.compraId); }, onError: avisarError,
  });
  return (
    <Modal titulo={`Armar pedido a ${proveedor}`} onCerrar={onCerrar}>
      <div className="space-y-4">
        <p className="text-sm text-carbon/70">Se crea un pedido en <strong>borrador</strong> con {lineas.length} productos ({unidades} unidades{valor ? `, ${pesos(valor)} estimado` : ''}). No genera deuda ni mueve stock: antes de confirmarlo podés cambiar cantidades y precios. Si lo anulás, vuelve a esta planilla.</p>
        <Campo etiqueta="Tipo de pedido" ayuda="Si no elegís, se usa el del último pedido a este proveedor. Confección: el costo que se propone es la mano de obra de la receta.">
          <select className="entrada" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
            <option value="">Como el último pedido</option><option value="reventa">Reventa (producto terminado)</option><option value="confeccion">Confección (taller)</option>
          </select>
        </Campo>
        <div className="max-h-48 overflow-y-auto rounded border border-arena/60 text-sm">
          {lineas.map((l) => <div key={l.varianteId} className="flex justify-between border-b border-arena/40 px-3 py-1.5 last:border-0"><span>{nombre(l)}</span><span className="font-medium">{l.cantidad}</span></div>)}
        </div>
        <div className="flex justify-end gap-2"><button className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Armando…' : 'Armar pedido'}</button></div>
      </div>
    </Modal>
  );
}

function ModalDescartar({ l, onCerrar, onListo }: { l: Linea; onCerrar: () => void; onListo: () => void }) {
  const [motivo, setMotivo] = useState('');
  const m = useMutation({ mutationFn: () => api.post(`/reposicion/${l.varianteId}/descartar`, { motivo }), onSuccess: () => { avisar('Descartado: lo ves en "Descartados" para reincluirlo'); onListo(); }, onError: avisarError });
  return (
    <Modal titulo={`Descartar ${nombre(l)}`} onCerrar={onCerrar}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <p className="text-sm text-carbon/70">Sale de la planilla hasta que lo reincluyas o hasta que vuelva a entrar stock. No se borra nada.</p>
        <Campo etiqueta="Motivo (opcional)"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: se discontinúa, no lo trabaja más el proveedor" autoFocus /></Campo>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={m.isPending}>Descartar</button></div>
      </form>
    </Modal>
  );
}

function Descartados({ items, onCambio }: { items: Descartado[]; onCambio: () => void }) {
  const { puede } = useSesion();
  const m = useMutation({ mutationFn: (varianteId: number) => api.post(`/reposicion/${varianteId}/reincluir`, {}), onSuccess: () => { avisar('Reincluido en la reposición'); onCambio(); }, onError: avisarError });
  return (
    <section className="tarjeta mb-6 overflow-hidden">
      <div className="border-b border-arena/50 px-4 py-3"><h2 className="text-lg font-bold">Descartados</h2><div className="text-sm text-carbon/60">Vuelven solos si entra stock. Reincluí los que quieras pedir igual.</div></div>
      {!items.length ? <p className="px-4 py-3 text-sm text-carbon/60">No hay productos descartados.</p> : (
        <div className="overflow-x-auto"><table className="tabla">
          <thead><tr><th>Producto</th><th className="hidden sm:table-cell">Proveedor</th><th className="num">Stock</th><th className="hidden md:table-cell">Motivo</th><th /></tr></thead>
          <tbody>{items.map((l) => (
            <tr key={l.varianteId}>
              <td>{nombre(l)}<div className="text-xs text-carbon/50">{l.sku} · {l.categoria}</div></td>
              <td className="hidden sm:table-cell">{l.proveedor}</td>
              <td className="num">{l.stock}</td>
              <td className="hidden md:table-cell text-sm text-carbon/65">{l.motivoDescarte ?? '—'}</td>
              <td className="text-right">{puede('compras', 'crear') && <button className="btn-secundario btn-chico" disabled={m.isPending} onClick={() => m.mutate(l.varianteId)}><RotateCcw className="h-4 w-4" />Reincluir</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

function ModalAgregar({ onCerrar, onListo }: { onCerrar: () => void; onListo: () => void }) {
  const [v, setV] = useState<VarianteBuscada | null>(null);
  const [cantidad, setCantidad] = useState(1);
  const m = useMutation({
    mutationFn: () => api.post('/para-pedir', { varianteId: v!.varianteId, cantidad, motivo: 'Agregado en la Reposición General' }, true),
    onSuccess: () => { avisar('Agregado a la reposición'); onListo(); onCerrar(); }, onError: avisarError,
  });
  return (
    <Modal titulo="Agregar a la reposición" onCerrar={onCerrar}>
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
