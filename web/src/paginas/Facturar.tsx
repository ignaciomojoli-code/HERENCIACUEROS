import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Minus, Plus, ReceiptText, RotateCcw, Trash2, X } from 'lucide-react';
import { api, qs } from '../api';
import { describirVariante, type Aux, type VarianteBuscada } from '../tipos';
import { Confirmar, avisarError } from '../componentes/ui';
import { Importe } from '../componentes/Importe';
import { BuscadorVariante } from '../componentes/BuscadorVariante';
import { pesos } from '../formato';
import { hoy, queriesPlata, useFormasPago } from '../plata';
import { useClientes } from './Ventas';

/**
 * Facturación directa: pantalla de caja para vender rápido mientras se atiende.
 * Usa la misma venta del sistema (stock, caja, comisiones y auditoría), con pagos combinados,
 * autocompletado de lo que falta y cálculo del vuelto en efectivo.
 */
interface Linea { varianteId: number; sku: string; descripcion: string; stock: number; cantidad: number; precioLista: number | null; precio: number | null; tocado: boolean }
interface Pago { clave: number; formaPagoId: number; importe: number | null; usd: number | null; tocado: boolean }
interface Hecha { id: number; numero: number; totalCentavos: number; saldoCentavos: number; vueltoCentavos: number }

let siguienteClave = 1;

export function PaginaFacturar() {
  const qc = useQueryClient();
  const aux = useQuery({ queryKey: ['aux'], queryFn: () => api.get<Aux>('/catalogo/aux') });
  const listas = (aux.data?.listasPrecio ?? []).filter((l) => l.activo);
  const formas = useFormasPago();
  const activas = (formas.data ?? []).filter((f) => f.activo);
  const clientes = useClientes();

  const [listaId, setListaId] = useState(0);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [desc, setDesc] = useState<{ modo: 'pesos' | 'pct'; pesos: number | null; pct: string; motivo: string }>({ modo: 'pesos', pesos: null, pct: '', motivo: '' });
  const [verDescuento, setVerDescuento] = useState(false);
  const [entrega, setEntrega] = useState<number | null>(null);
  const [clienteId, setClienteId] = useState<number | null>(null);
  const [hecha, setHecha] = useState<Hecha | null>(null);
  const [cancelar, setCancelar] = useState(false);
  const [buscador, setBuscador] = useState(0);
  const nueva = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (!listaId && listas.length) setListaId(listas[0].id); }, [listas.length, listaId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Precios de lista de lo cargado (cambian si se cambia la lista, salvo los que se tocaron a mano).
  const ids = lineas.map((l) => l.varianteId).sort().join(',');
  const precios = useQuery({ queryKey: ['precios-venta', listaId, ids], queryFn: () => api.get<Record<string, number>>('/ventas/precios' + qs({ listaId, ids })), enabled: !!ids && !!listaId });
  useEffect(() => {
    if (!precios.data) return;
    setLineas((ls) => ls.map((l) => { const p = precios.data![l.varianteId] ?? null; return { ...l, precioLista: p, precio: l.tocado ? l.precio : p }; }));
  }, [precios.data]);

  const subtotal = lineas.reduce((s, l) => s + l.cantidad * (l.precio ?? 0), 0);
  const pctNum = Number(desc.pct.replace(',', '.'));
  const descuento = desc.modo === 'pesos' ? desc.pesos ?? 0 : Number.isFinite(pctNum) && pctNum > 0 ? Math.round((subtotal * pctNum) / 100) : 0;
  const total = Math.max(0, subtotal - descuento);
  const abonado = pagos.reduce((s, p) => s + (p.importe ?? 0), 0);
  const restante = total - abonado;
  const forma = (id: number) => activas.find((f) => f.id === id);
  const esEfectivo = (id: number) => { const f = forma(id); return f?.tipoCuenta === 'efectivo' && f.moneda === 'ARS'; };
  const enEfectivo = pagos.filter((p) => esEfectivo(p.formaPagoId)).reduce((s, p) => s + (p.importe ?? 0), 0);
  const vuelto = entrega != null && enEfectivo > 0 ? entrega - enEfectivo : null;

  // Con un solo pago que no se tocó a mano, el importe sigue al total.
  useEffect(() => { if (pagos.length === 1 && !pagos[0].tocado && pagos[0].importe !== total) setPagos((ps) => [{ ...ps[0], importe: total }]); }, [total, pagos.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const agregar = (v: VarianteBuscada) => {
    setLineas((ls) => {
      const ya = ls.find((l) => l.varianteId === v.varianteId);
      if (ya) return ls.map((l) => (l === ya ? { ...l, cantidad: l.cantidad + 1 } : l));
      return [...ls, { varianteId: v.varianteId, sku: v.sku, descripcion: describirVariante(v), stock: v.stock, cantidad: 1, precioLista: null, precio: null, tocado: false }];
    });
  };
  const cambiarLinea = (i: number, cambio: Partial<Linea>) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...cambio } : l)));
  const elegirForma = (id: number) => {
    const ya = pagos.find((p) => p.formaPagoId === id);
    if (ya) { if (restante > 0) setPagos(pagos.map((p) => (p === ya ? { ...p, importe: (p.importe ?? 0) + restante, tocado: true } : p))); return; }
    // El primer pago va por el total; los siguientes, por lo que falta.
    const primero = pagos.length === 0;
    setPagos([...pagos.map((p) => ({ ...p, tocado: true })), { clave: siguienteClave++, formaPagoId: id, importe: Math.max(0, restante), usd: null, tocado: !primero }]);
  };
  const reiniciar = () => {
    setLineas([]); setPagos([]); setDesc({ modo: 'pesos', pesos: null, pct: '', motivo: '' }); setVerDescuento(false); setEntrega(null); setClienteId(null); setBuscador((n) => n + 1);
  };

  const sinPrecio = lineas.filter((l) => l.precio == null);
  const sinStock = lineas.filter((l) => l.cantidad > l.stock);
  const faltaUsd = pagos.some((p) => forma(p.formaPagoId)?.moneda === 'USD' && !(p.usd && p.usd > 0));
  const problemas: string[] = [];
  if (!lineas.length) problemas.push('Agregá un producto');
  if (sinPrecio.length) problemas.push(`Falta el precio de ${sinPrecio.map((l) => l.sku).join(', ')}`);
  if (sinStock.length) problemas.push(`No hay stock suficiente de ${sinStock.map((l) => l.sku).join(', ')}`);
  if (descuento > subtotal) problemas.push('El descuento es mayor que el total');
  if (lineas.length && !pagos.length) problemas.push('Elegí cómo paga');
  if (pagos.some((p) => !(p.importe && p.importe > 0))) problemas.push('Hay un medio de pago sin importe');
  if (faltaUsd) problemas.push('Indicá los dólares recibidos');
  if (restante < 0) problemas.push(`Lo abonado supera el total por ${pesos(-restante)}. Si te dio de más en efectivo, cargalo en "Paga con"`);
  if (restante > 0 && pagos.length && !clienteId) problemas.push(`Faltan ${pesos(restante)}. Completá el pago o elegí el cliente que queda debiendo`);
  if (vuelto != null && vuelto < 0) problemas.push(`El efectivo entregado no alcanza: faltan ${pesos(-vuelto)}`);

  const confirmar = useMutation({
    mutationFn: () => api.post<Hecha>('/ventas', {
      fecha: hoy(), listaPrecioId: listaId || null, clienteId,
      descuentoCentavos: descuento, motivoDescuento: descuento ? desc.motivo.trim() || (desc.modo === 'pct' ? `Descuento ${desc.pct}% en caja` : 'Descuento en caja') : null,
      efectivoRecibidoCentavos: enEfectivo > 0 && entrega != null ? entrega : null,
      items: lineas.map((l) => ({ varianteId: l.varianteId, cantidad: l.cantidad, precioCentavos: l.precio! })),
      pagos: pagos.map((p) => ({ formaPagoId: p.formaPagoId, importeCentavos: p.importe!, importeMonedaCentavos: forma(p.formaPagoId)?.moneda === 'USD' ? p.usd : null })),
    }, true),
    onSuccess: (r) => {
      setHecha(r); reiniciar(); window.scrollTo({ top: 0 });
      queriesPlata.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      ['clientes', 'stock', 'buscar-variante'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: avisarError,
  });
  useEffect(() => { if (hecha) nueva.current?.focus(); }, [hecha]);

  const listaDeForma = useMemo(() => {
    const conLista = pagos.map((p) => forma(p.formaPagoId)).find((f) => f?.listaPrecioId && f.listaPrecioId !== listaId);
    return conLista ? listas.find((l) => l.id === conLista.listaPrecioId) : undefined;
  }, [pagos, listaId, listas]); // eslint-disable-line react-hooks/exhaustive-deps

  const estado = !lineas.length ? null : restante === 0 && pagos.length ? 'pagado' : restante > 0 ? 'falta' : 'sobra';

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="etiqueta text-conac">Caja</div>
          <h1 className="font-titulo text-3xl font-bold">Facturación directa</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="etiqueta">Precios</span>
          <div className="inline-flex rounded-md border border-arena bg-crema-50 p-0.5">
            {listas.map((l) => (
              <button key={l.id} onClick={() => setListaId(l.id)} className={`rounded px-3 py-1.5 text-sm ${l.id === listaId ? 'bg-carbon text-marfil' : 'text-carbon/70 hover:bg-carbon/5'}`}>{l.nombre}</button>
            ))}
          </div>
        </div>
      </div>

      {hecha && (
        <div className="tarjeta mb-5 flex flex-wrap items-center justify-between gap-4 border-conac/40 bg-conac-claro p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-carbon text-marfil"><Check className="h-5 w-5" /></span>
            <div>
              <div className="font-medium">Venta V-{hecha.numero} registrada · {pesos(hecha.totalCentavos)}</div>
              <div className="text-sm text-carbon/60">{hecha.saldoCentavos > 0 ? `Queda debiendo ${pesos(hecha.saldoCentavos)}` : 'Cobrada completa'} · <Link className="underline" to={`/ventas/${hecha.id}`}>ver venta</Link></div>
            </div>
          </div>
          {hecha.vueltoCentavos > 0 && <div className="text-right"><div className="etiqueta">Vuelto</div><div className="font-titulo text-4xl font-bold">{pesos(hecha.vueltoCentavos)}</div></div>}
          <button ref={nueva} className="btn-primario" onClick={() => { setHecha(null); setBuscador((n) => n + 1); }}><Plus className="h-4 w-4" />Nueva venta</button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="min-w-0 space-y-4">
          <div className="tarjeta p-4">
            <BuscadorVariante key={buscador} onElegir={(v) => { setHecha(null); agregar(v); }} autoFocus mantenerFoco placeholder="Buscá por nombre o código, o pasá el lector…" />
          </div>
          <div className="tarjeta overflow-hidden">
            {!lineas.length ? (
              <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-carbon/50"><ReceiptText className="h-8 w-8 text-dorado" />Todavía no hay productos en esta venta.</div>
            ) : (
              <ul className="divide-y divide-arena/50">
                {lineas.map((l, i) => (
                  <li key={l.varianteId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_8rem_6.5rem_auto]">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{l.descripcion}</div>
                      <div className="text-xs text-carbon/50">{l.sku} · {l.cantidad > l.stock ? <span className="text-bordo">stock {l.stock}</span> : `stock ${l.stock}`}{l.precioLista != null && l.precio !== l.precioLista && ` · lista ${pesos(l.precioLista)}`}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button className="btn-secundario h-8 w-8 p-0" aria-label="Uno menos" onClick={() => (l.cantidad > 1 ? cambiarLinea(i, { cantidad: l.cantidad - 1 }) : setLineas(lineas.filter((_, j) => j !== i)))}><Minus className="h-4 w-4" /></button>
                      <span className="w-8 text-center tabular-nums">{l.cantidad}</span>
                      <button className="btn-secundario h-8 w-8 p-0" aria-label="Uno más" onClick={() => cambiarLinea(i, { cantidad: l.cantidad + 1 })}><Plus className="h-4 w-4" /></button>
                    </div>
                    <div className="col-span-2 sm:col-span-1"><Importe valor={l.precio} onCambio={(c) => cambiarLinea(i, { precio: c, tocado: true })} placeholder="Precio" /></div>
                    <div className="num font-medium">{pesos(l.cantidad * (l.precio ?? 0))}</div>
                    <button className="justify-self-end p-1 text-carbon/40 hover:text-bordo" aria-label="Quitar" onClick={() => setLineas(lineas.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {lineas.length > 0 && (
            <div className="tarjeta p-4">
              {!verDescuento && !descuento ? (
                <button className="text-sm text-conac underline" onClick={() => setVerDescuento(true)}>+ Aplicar descuento</button>
              ) : (
                <div className="grid gap-3 sm:grid-cols-[auto_10rem_minmax(0,1fr)_auto] sm:items-end">
                  <div className="inline-flex rounded-md border border-arena p-0.5">
                    <button className={`rounded px-3 py-1.5 text-sm ${desc.modo === 'pesos' ? 'bg-carbon text-marfil' : ''}`} onClick={() => setDesc({ ...desc, modo: 'pesos' })}>$</button>
                    <button className={`rounded px-3 py-1.5 text-sm ${desc.modo === 'pct' ? 'bg-carbon text-marfil' : ''}`} onClick={() => setDesc({ ...desc, modo: 'pct' })}>%</button>
                  </div>
                  {desc.modo === 'pesos'
                    ? <Importe valor={desc.pesos} onCambio={(c) => setDesc({ ...desc, pesos: c })} placeholder="Descuento" />
                    : <input className="entrada text-right" inputMode="decimal" placeholder="%" value={desc.pct} onChange={(e) => setDesc({ ...desc, pct: e.target.value })} aria-label="Porcentaje de descuento" />}
                  <input className="entrada" placeholder="Motivo (opcional)" value={desc.motivo} onChange={(e) => setDesc({ ...desc, motivo: e.target.value })} />
                  <button className="text-sm text-carbon/60 underline" onClick={() => { setDesc({ modo: 'pesos', pesos: null, pct: '', motivo: '' }); setVerDescuento(false); }}>Quitar</button>
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="tarjeta h-fit space-y-4 p-5 lg:sticky lg:top-6">
          <div>
            <div className="etiqueta">Total de la venta</div>
            <div className="font-titulo text-5xl font-bold tabular-nums">{pesos(total)}</div>
            {descuento > 0 && <div className="text-sm text-carbon/60">Subtotal {pesos(subtotal)} − descuento {pesos(descuento)}</div>}
          </div>

          <div className="space-y-2 border-t border-arena pt-4">
            <div className="etiqueta">Medio de pago</div>
            <div className="flex flex-wrap gap-1.5">
              {[...activas.slice(0, 5), ...activas.slice(5).filter((f) => pagos.some((p) => p.formaPagoId === f.id))].map((f) => {
                const usado = pagos.some((p) => p.formaPagoId === f.id);
                return <button key={f.id} onClick={() => elegirForma(f.id)} disabled={!lineas.length} className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${usado ? 'border-carbon bg-carbon text-marfil' : 'border-arena bg-crema-50 hover:border-carbon/40'} disabled:opacity-40`}>{f.nombre}</button>;
              })}
            </div>
            {activas.length > 5 && (
              <select className="entrada" value="" disabled={!lineas.length} onChange={(e) => e.target.value && elegirForma(Number(e.target.value))} aria-label="Otro medio de pago">
                <option value="">Otro medio de pago (tarjetas, cuotas, dólares)…</option>
                {activas.slice(5).filter((f) => !pagos.some((p) => p.formaPagoId === f.id)).map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
              </select>
            )}
            {pagos.map((p, i) => {
              const f = forma(p.formaPagoId);
              return (
                <div key={p.clave} className="rounded-md border border-arena/70 bg-crema p-2.5">
                  <div className="mb-1.5 flex items-center justify-between text-sm"><span className="font-medium">{f?.nombre ?? '—'}</span>
                    <span className="flex items-center gap-2">
                      {restante > 0 && <button className="text-xs text-conac underline" onClick={() => setPagos(pagos.map((x, j) => (j === i ? { ...x, importe: (x.importe ?? 0) + restante, tocado: true } : x)))}>+ lo que falta</button>}
                      <button className="p-0.5 text-carbon/40 hover:text-bordo" aria-label="Quitar medio de pago" onClick={() => setPagos(pagos.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button>
                    </span>
                  </div>
                  <Importe valor={p.importe} onCambio={(c) => setPagos(pagos.map((x, j) => (j === i ? { ...x, importe: c, tocado: true } : x)))} />
                  {f?.moneda === 'USD' && (
                    <input className="entrada mt-1.5 text-right" inputMode="decimal" placeholder="Dólares recibidos" value={p.usd == null ? '' : p.usd / 100}
                      onChange={(e) => { const n = Number(e.target.value.replace(',', '.')); setPagos(pagos.map((x, j) => (j === i ? { ...x, usd: e.target.value === '' || Number.isNaN(n) ? null : Math.round(n * 100) } : x))); }} />
                  )}
                </div>
              );
            })}
          </div>

          {enEfectivo > 0 && (
            <div className="space-y-2 border-t border-arena pt-4">
              <div className="flex items-center justify-between"><span className="etiqueta">Paga con (efectivo)</span><span className="text-xs text-carbon/55">a cubrir {pesos(enEfectivo)}</span></div>
              <Importe valor={entrega} onCambio={setEntrega} placeholder="Billetes que entrega" />
              <div className="flex flex-wrap gap-1.5">
                {billetes(enEfectivo).map((b) => <button key={b} className="rounded border border-arena px-2 py-1 text-xs hover:border-carbon/40" onClick={() => setEntrega(b)}>{b === enEfectivo ? 'Justo' : pesos(b)}</button>)}
              </div>
              {vuelto != null && (vuelto >= 0
                ? <div className="flex items-baseline justify-between rounded-md bg-carbon px-3 py-2 text-marfil"><span className="etiqueta text-marfil/70">Vuelto</span><span className="font-titulo text-3xl font-bold tabular-nums">{pesos(vuelto)}</span></div>
                : <div className="rounded-md bg-bordo-claro px-3 py-2 text-sm text-bordo">Faltan {pesos(-vuelto)} en efectivo</div>)}
            </div>
          )}

          <dl className="space-y-1 border-t border-arena pt-4 text-sm">
            <div className="flex justify-between"><dt className="text-carbon/60">Total</dt><dd className="tabular-nums">{pesos(total)}</dd></div>
            <div className="flex justify-between"><dt className="text-carbon/60">Abonado</dt><dd className="tabular-nums">{pesos(abonado)}</dd></div>
            <div className="flex items-center justify-between"><dt className="text-carbon/60">{restante >= 0 ? 'Falta pagar' : 'Sobra'}</dt>
              <dd className={`font-titulo text-xl font-bold tabular-nums ${restante > 0 ? 'text-bordo' : restante < 0 ? 'text-conac' : ''}`}>{pesos(Math.abs(restante))}</dd></div>
            {estado && <div className="pt-1"><span className={`pildora ${estado === 'pagado' ? 'bg-carbon text-marfil' : estado === 'falta' ? 'bg-bordo-claro text-bordo' : 'bg-conac-claro text-conac'}`}>{estado === 'pagado' ? 'Pago completo' : estado === 'falta' ? 'Pago incompleto' : 'Pago de más'}</span></div>}
          </dl>

          {restante > 0 && pagos.length > 0 && (
            <div className="space-y-1">
              <label className="etiqueta" htmlFor="cliente-debe">Queda debiendo (elegí el cliente)</label>
              <select id="cliente-debe" className="entrada" value={clienteId ?? ''} onChange={(e) => setClienteId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Sin cliente</option>
                {clientes.data?.filter((c) => c.activo).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
          )}
          {listaDeForma && <p className="text-xs text-carbon/60">Ese medio de pago usa la lista {listaDeForma.nombre}. <button className="text-conac underline" onClick={() => setListaId(listaDeForma.id)}>Usar esos precios</button></p>}
          {lineas.length > 0 && problemas.length > 0 && <ul className="space-y-0.5 text-sm text-bordo">{problemas.map((p) => <li key={p}>{p}</li>)}</ul>}

          <button className="btn-primario w-full py-3.5 text-base" disabled={problemas.length > 0 || confirmar.isPending} onClick={() => confirmar.mutate()}>
            <Check className="h-5 w-5" />{confirmar.isPending ? 'Registrando…' : 'Confirmar venta'}
          </button>
          <button className="btn-secundario w-full" disabled={!lineas.length && !pagos.length} onClick={() => setCancelar(true)}><RotateCcw className="h-4 w-4" />Cancelar y empezar de nuevo</button>
        </aside>
      </div>
      {cancelar && <Confirmar titulo="¿Cancelar esta venta?" textoBoton="Sí, cancelar" peligro onConfirmar={() => { reiniciar(); setCancelar(false); }} onCerrar={() => setCancelar(false)}>Se borra lo cargado en pantalla. No se registra nada.</Confirmar>}
    </>
  );
}

/** Montos típicos con los que paga el cliente: justo y el siguiente redondeo en billetes comunes. */
function billetes(monto: number) {
  const pasos = [1000000, 2000000, 5000000, 10000000];
  const r = new Set<number>([monto]);
  for (const p of pasos) r.add(Math.ceil(monto / p) * p);
  return [...r].filter((x) => x >= monto).sort((a, b) => a - b).slice(0, 5);
}
