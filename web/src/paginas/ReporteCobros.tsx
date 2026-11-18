import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Download, Printer } from 'lucide-react';
import { api, qs } from '../api';
import { useSesion } from '../sesion';
import { Campo, Cargando, ErrorCarga, Modal, Vacio, avisar, avisarError } from '../componentes/ui';
import { Importe } from '../componentes/Importe';
import { pesos } from '../formato';
import { MEDIOS, fechaCorta, hoy, porcentaje, queriesPlata, useCuentas, useFormasPago, type MedioPago } from '../plata';

interface Cobro {
  id: number; fecha: string; ventaId: number; ventaNumero: number; formaPagoId: number; forma: string; medio: MedioPago | null; procesador: string | null; cuotas: number | null;
  cuentaId: number; cuenta: string; aLiquidar: boolean; brutoCentavos: number; comisionEstimadaCentavos: number; comisionRealCentavos: number | null; comisionCentavos: number;
  comisionBp: number; comisionBpEstimada: number; netoEsperadoCentavos: number; netoAcreditadoCentavos: number | null; estado: 'acreditado' | 'pendiente';
  fechaAcreditacion: string | null; diferenciaCentavos: number | null;
}
interface Suma { cobros: number; brutoCentavos: number; comisionCentavos: number; netoEsperadoCentavos: number; acreditadoCentavos: number; pendienteCentavos: number; pendienteBrutoCentavos: number; diferenciaCentavos: number }
interface Reporte { desde: string; hasta: string; ventas: { cantidad: number; totalCentavos: number }; totales: Suma; porMedio: (Suma & { formaPagoId: number; forma: string; medio: MedioPago | null; procesador: string | null; cuotas: number | null })[]; cobros: Cobro[] }

type Props = { params: URLSearchParams; fijar: (k: Record<string, string>) => void };

const sumarDias = (f: string, d: number) => { const x = new Date(f + 'T12:00'); x.setDate(x.getDate() + d); return x.toLocaleDateString('en-CA'); };
function periodo(p: string): { desde: string; hasta: string } {
  const h = hoy();
  if (p === 'hoy') return { desde: h, hasta: h };
  if (p === 'semana') { const dia = (new Date(h + 'T12:00').getDay() + 6) % 7; return { desde: sumarDias(h, -dia), hasta: h }; }
  if (p === 'mes_anterior') { const d = new Date(h.slice(0, 8) + '01T12:00'); d.setDate(0); const fin = d.toLocaleDateString('en-CA'); return { desde: fin.slice(0, 8) + '01', hasta: fin }; }
  return { desde: h.slice(0, 8) + '01', hasta: h };
}
const FILTROS = ['cdesde', 'chasta', 'cmedio', 'cforma', 'cproc', 'ccuotas', 'cestado', 'cventa', 'cmin', 'cmax', 'cbp', 'cdif'];
const cuotasTxt = (c: number | null) => (c == null ? '' : c === 1 ? '1 pago' : `${c} cuotas`);

/** Cobros, comisiones y acreditaciones: cuánto se vendió, cuánto se descontó y cuánto llegó de verdad. */
export function VistaCobros({ params, fijar }: Props) {
  const { puede } = useSesion();
  const formas = useFormasPago();
  const def = periodo('mes');
  const desde = params.get('cdesde') ?? def.desde;
  const hasta = params.get('chasta') ?? def.hasta;
  const pesosA = (v: string | null) => (v ? String(Math.round(Number(v) * 100)) : '');
  const filtro = {
    desde, hasta, medio: params.get('cmedio') ?? '', formaPagoId: params.get('cforma') ?? '', procesador: params.get('cproc') ?? '', cuotas: params.get('ccuotas') ?? '',
    estado: params.get('cestado') ?? '', ventaNumero: params.get('cventa') ?? '', importeMin: pesosA(params.get('cmin')), importeMax: pesosA(params.get('cmax')),
    comisionBp: params.get('cbp') ?? '', conDiferencia: params.get('cdif') ?? '',
  };
  const q = useQuery({ queryKey: ['reporte-cobros', filtro], queryFn: () => api.get<Reporte>('/reportes/cobros' + qs(filtro)) });
  const [abierto, setAbierto] = useState<number | null>(null);
  const [elegidos, setElegidos] = useState<number[]>([]);
  const [acreditar, setAcreditar] = useState(false);
  const fs = formas.data ?? [];
  const procesadores = [...new Set(fs.map((f) => f.procesador).filter(Boolean))] as string[];
  const cuotas = [...new Set(fs.map((f) => f.cuotas).filter((c): c is number => c != null))].sort((a, b) => a - b);
  const porcentajes = [...new Set(fs.map((f) => f.comisionBp))].sort((a, b) => a - b);
  const r = q.data;
  const elegidosCobros = (r?.cobros ?? []).filter((c) => elegidos.includes(c.id));
  const alternar = (c: Cobro) => {
    const otros = elegidosCobros.filter((x) => x.id !== c.id);
    if (elegidos.includes(c.id)) return setElegidos(otros.map((x) => x.id));
    // Se acreditan juntos solo cobros de la misma cuenta a liquidar.
    setElegidos([...(otros.length && otros[0].cuentaId !== c.cuentaId ? [] : otros.map((x) => x.id)), c.id]);
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {[['hoy', 'Hoy'], ['semana', 'Esta semana'], ['mes', 'Este mes'], ['mes_anterior', 'Mes anterior']].map(([k, t]) => {
          const p = periodo(k); const activo = p.desde === desde && p.hasta === hasta;
          return <button key={k} className={`rounded-md border px-3 py-1.5 text-sm ${activo ? 'border-carbon bg-carbon text-marfil' : 'border-arena bg-crema-50 hover:border-carbon/40'}`} onClick={() => fijar({ cdesde: p.desde, chasta: p.hasta })}>{t}</button>;
        })}
        <label className="text-sm">Desde <input className="entrada !w-auto py-1" type="date" value={desde} max={hasta} onChange={(e) => fijar({ cdesde: e.target.value })} /></label>
        <label className="text-sm">Hasta <input className="entrada !w-auto py-1" type="date" value={hasta} min={desde} onChange={(e) => fijar({ chasta: e.target.value })} /></label>
      </div>
      <div className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <select className="entrada" value={filtro.medio} onChange={(e) => fijar({ cmedio: e.target.value })} aria-label="Medio"><option value="">Todos los medios</option>{Object.entries(MEDIOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="entrada" value={filtro.formaPagoId} onChange={(e) => fijar({ cforma: e.target.value })} aria-label="Forma de pago"><option value="">Todas las formas</option>{fs.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}</select>
        <select className="entrada" value={filtro.procesador} onChange={(e) => fijar({ cproc: e.target.value })} aria-label="Plataforma"><option value="">Todas las plataformas</option>{procesadores.map((p) => <option key={p} value={p}>{p}</option>)}</select>
        <select className="entrada" value={filtro.cuotas} onChange={(e) => fijar({ ccuotas: e.target.value })} aria-label="Cuotas"><option value="">Cualquier cuota</option>{cuotas.map((c) => <option key={c} value={c}>{cuotasTxt(c)}</option>)}</select>
        <select className="entrada" value={filtro.estado} onChange={(e) => fijar({ cestado: e.target.value })} aria-label="Estado"><option value="">Acreditado y pendiente</option><option value="acreditado">Acreditado</option><option value="pendiente">Pendiente de acreditación</option></select>
        <select className="entrada" value={filtro.comisionBp} onChange={(e) => fijar({ cbp: e.target.value })} aria-label="Comisión aplicada"><option value="">Cualquier comisión</option>{porcentajes.map((b) => <option key={b} value={b}>{porcentaje(b)}</option>)}</select>
        <input className="entrada" inputMode="numeric" placeholder="Venta N°" defaultValue={filtro.ventaNumero} onBlur={(e) => fijar({ cventa: e.target.value.replace(/\D/g, '') })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <input className="entrada" inputMode="decimal" placeholder="Importe desde $" defaultValue={params.get('cmin') ?? ''} onBlur={(e) => fijar({ cmin: e.target.value.replace(/[^\d]/g, '') })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <input className="entrada" inputMode="decimal" placeholder="Importe hasta $" defaultValue={params.get('cmax') ?? ''} onBlur={(e) => fijar({ cmax: e.target.value.replace(/[^\d]/g, '') })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={filtro.conDiferencia === 'true'} onChange={(e) => fijar({ cdif: e.target.checked ? 'true' : '' })} />Solo con diferencia</label>
        <button className="text-left text-sm text-conac underline" onClick={() => fijar(Object.fromEntries(FILTROS.map((k) => [k, ''])))}>Limpiar filtros</button>
        <div className="flex gap-2 lg:justify-end">
          {puede('panel', 'exportar') && <a className="btn-secundario btn-chico" href={'/api/reportes/cobros/exportar' + qs(filtro)}><Download className="h-4 w-4" />Excel</a>}
          {r && <button className="btn-secundario btn-chico" onClick={() => imprimir(r)}><Printer className="h-4 w-4" />PDF</button>}
        </div>
      </div>

      {q.isLoading ? <Cargando /> : q.isError ? <ErrorCarga error={q.error} /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Dato titulo="Total de ventas" valor={r!.ventas.totalCentavos} sub={`${r!.ventas.cantidad} ventas del período`} />
            <Dato titulo="Cobrado (bruto)" valor={r!.totales.brutoCentavos} sub={`${r!.totales.cobros} cobros con estos filtros`} />
            <Dato titulo="Comisiones" valor={r!.totales.comisionCentavos} sub="estimadas o reales" negativo />
            <Dato titulo="Neto esperado" valor={r!.totales.netoEsperadoCentavos} sub="bruto − comisión estimada" />
            <Dato titulo="Acreditado" valor={r!.totales.acreditadoCentavos} sub="plata que ya entró" fuerte />
            <Dato titulo="Pendiente de acreditación" valor={r!.totales.pendienteCentavos} sub={`neto esperado · bruto ${pesos(r!.totales.pendienteBrutoCentavos)}`} />
            <Dato titulo="Diferencia real vs esperado" valor={r!.totales.diferenciaCentavos} sub={r!.totales.diferenciaCentavos < 0 ? 'llegó menos de lo esperado' : r!.totales.diferenciaCentavos > 0 ? 'llegó más de lo esperado' : 'sin diferencias'} />
          </div>
          <p className="mb-4 text-xs text-carbon/55">El total de ventas cuenta las ventas del período; lo cobrado cuenta los cobros del período (incluye lo que se cobró después a clientes con saldo). La caja solo suma lo acreditado: lo pendiente de las tarjetas entra cuando se carga la liquidación real.</p>

          {!!r!.porMedio.length && (
            <div className="tarjeta mb-5 overflow-x-auto">
              <table className="tabla text-sm">
                <thead><tr><th>Medio de pago</th><th className="num">Cobros</th><th className="num">Bruto</th><th className="num">Comisión</th><th className="num">Neto esperado</th><th className="num">Acreditado</th><th className="num">Pendiente</th><th className="num">Diferencia</th></tr></thead>
                <tbody>{r!.porMedio.map((m) => (
                  <tr key={m.formaPagoId} className="cursor-pointer hover:bg-crema-50" onClick={() => fijar({ cforma: String(m.formaPagoId) })}>
                    <td>{m.forma}</td><td className="num">{m.cobros}</td><td className="num">{pesos(m.brutoCentavos)}</td><td className="num">{m.comisionCentavos ? `− ${pesos(m.comisionCentavos)}` : '—'}</td>
                    <td className="num">{pesos(m.netoEsperadoCentavos)}</td><td className="num">{pesos(m.acreditadoCentavos)}</td><td className="num">{m.pendienteCentavos ? pesos(m.pendienteCentavos) : '—'}</td>
                    <td className={`num ${m.diferenciaCentavos < 0 ? 'text-bordo' : ''}`}>{m.diferenciaCentavos ? pesos(m.diferenciaCentavos) : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          {elegidos.length > 0 && (
            <div className="sticky top-16 z-10 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-carbon px-4 py-2 text-sm text-marfil lg:top-2">
              <span>{elegidos.length} {elegidos.length === 1 ? 'cobro elegido' : 'cobros elegidos'} · bruto {pesos(elegidosCobros.reduce((s, c) => s + c.brutoCentavos, 0))} · neto esperado {pesos(elegidosCobros.reduce((s, c) => s + c.netoEsperadoCentavos, 0))}</span>
              <span className="flex gap-2"><button className="underline" onClick={() => setElegidos([])}>Ninguno</button><button className="btn-primario btn-chico" onClick={() => setAcreditar(true)}>Registrar acreditación</button></span>
            </div>
          )}

          {!r!.cobros.length ? <Vacio>No hay cobros con esos filtros.</Vacio> : (
            <div className="tarjeta overflow-x-auto">
              <table className="tabla text-sm">
                <thead><tr>{puede('caja', 'crear') && <th className="w-8" />}<th>Fecha</th><th>Venta</th><th>Medio</th><th className="num">Bruto</th><th className="num hidden sm:table-cell">Comisión</th><th className="num">Neto</th><th>Estado</th></tr></thead>
                <tbody>{r!.cobros.map((c) => (
                  <Fragment key={c.id}>
                    <tr className="cursor-pointer hover:bg-crema-50" onClick={() => setAbierto(abierto === c.id ? null : c.id)}>
                      {puede('caja', 'crear') && <td onClick={(e) => e.stopPropagation()}>{c.estado === 'pendiente' && <input type="checkbox" checked={elegidos.includes(c.id)} onChange={() => alternar(c)} aria-label={`Elegir cobro de V-${c.ventaNumero}`} />}</td>}
                      <td className="whitespace-nowrap">{abierto === c.id ? <ChevronDown className="mr-1 inline h-3.5 w-3.5" /> : <ChevronRight className="mr-1 inline h-3.5 w-3.5" />}{fechaCorta(c.fecha)}</td>
                      <td><Link className="underline" to={`/ventas/${c.ventaId}`} onClick={(e) => e.stopPropagation()}>V-{c.ventaNumero}</Link></td>
                      <td>{c.forma}</td>
                      <td className="num">{pesos(c.brutoCentavos)}</td>
                      <td className="num hidden sm:table-cell">{c.comisionCentavos ? `− ${pesos(c.comisionCentavos)} (${porcentaje(c.comisionBp)})` : '—'}</td>
                      <td className="num">{pesos(c.netoAcreditadoCentavos ?? c.netoEsperadoCentavos)}</td>
                      <td>{c.estado === 'acreditado' ? <span className="pildora bg-carbon/10">Acreditado</span> : <span className="pildora bg-dorado/30">Pendiente</span>}{(c.diferenciaCentavos ?? 0) !== 0 && <span className={`ml-1 text-xs ${(c.diferenciaCentavos ?? 0) < 0 ? 'text-bordo' : 'text-carbon/60'}`}>dif. {(c.diferenciaCentavos ?? 0) > 0 ? '+' : ''}{pesos(c.diferenciaCentavos)}</span>}</td>
                    </tr>
                    {abierto === c.id && (
                      <tr className="bg-crema-50"><td colSpan={8} className="px-4 py-3">
                        <dl className="grid max-w-xl grid-cols-2 gap-x-6 gap-y-1">
                          <dt className="text-carbon/60">Medio</dt><dd>{c.medio ? MEDIOS[c.medio] : 'Sin clasificar'}{c.procesador ? ` · ${c.procesador}` : ''}{c.cuotas ? ` · ${cuotasTxt(c.cuotas)}` : ''}</dd>
                          <dt className="text-carbon/60">Entró a</dt><dd>{c.cuenta}</dd>
                          <dt className="text-carbon/60">Bruto cobrado al cliente</dt><dd className="tabular-nums">{pesos(c.brutoCentavos)}</dd>
                          <dt className="text-carbon/60">Comisión estimada ({porcentaje(c.comisionBpEstimada)})</dt><dd className="tabular-nums">− {pesos(c.comisionEstimadaCentavos)}</dd>
                          <dt className="text-carbon/60">Neto esperado</dt><dd className="tabular-nums">{pesos(c.netoEsperadoCentavos)}</dd>
                          <dt className="text-carbon/60">Comisión real</dt><dd className="tabular-nums">{c.comisionRealCentavos == null ? 'igual a la estimada' : `− ${pesos(c.comisionRealCentavos)}`}</dd>
                          <dt className="font-medium">Neto acreditado</dt><dd className="font-medium tabular-nums">{c.netoAcreditadoCentavos == null ? 'pendiente' : pesos(c.netoAcreditadoCentavos)}</dd>
                          <dt className="text-carbon/60">Fecha de acreditación</dt><dd>{c.fechaAcreditacion ? fechaCorta(c.fechaAcreditacion) : '—'}</dd>
                          {c.diferenciaCentavos != null && <><dt className="text-carbon/60">Diferencia (real − esperado)</dt><dd className={`tabular-nums ${c.diferenciaCentavos < 0 ? 'text-bordo' : ''}`}>{pesos(c.diferenciaCentavos)}</dd></>}
                        </dl>
                        {c.estado === 'pendiente' && <p className="mt-2 text-xs text-carbon/55">Tildalo y tocá "Registrar acreditación" cuando veas lo que llegó a la cuenta.</p>}
                      </td></tr>
                    )}
                  </Fragment>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
      {acreditar && <ModalAcreditar cobros={elegidosCobros} onCerrar={() => setAcreditar(false)} onListo={() => { setAcreditar(false); setElegidos([]); }} />}
    </>
  );
}

function Dato({ titulo, valor, sub, negativo, fuerte }: { titulo: string; valor: number; sub?: string; negativo?: boolean; fuerte?: boolean }) {
  return (
    <div className={`tarjeta p-4 ${fuerte ? 'bg-carbon text-marfil' : ''}`}>
      <div className={`etiqueta ${fuerte ? 'text-marfil/60' : ''}`}>{titulo}</div>
      <div className={`mt-1 font-titulo text-2xl font-bold tabular-nums ${valor < 0 && !negativo ? 'text-bordo' : ''}`}>{negativo && valor ? `− ${pesos(valor)}` : pesos(valor)}</div>
      {sub && <div className={`text-xs ${fuerte ? 'text-marfil/50' : 'text-carbon/55'}`}>{sub}</div>}
    </div>
  );
}

/** Acreditación real: lo que llegó a la cuenta. Usa la liquidación de caja (se puede anular desde Caja). */
function ModalAcreditar({ cobros, onCerrar, onListo }: { cobros: Cobro[]; onCerrar: () => void; onListo: () => void }) {
  const qc = useQueryClient();
  const cuentas = useCuentas();
  const destinos = (cuentas.data ?? []).filter((c) => c.activo && c.moneda === 'ARS' && c.tipo !== 'a_liquidar' && c.tipo !== 'externa');
  const esperado = cobros.reduce((s, c) => s + c.netoEsperadoCentavos, 0);
  const bruto = cobros.reduce((s, c) => s + c.brutoCentavos, 0);
  const [d, setD] = useState<{ fecha: string; destinoId: number; neto: number | null; concepto: string }>({ fecha: hoy(), destinoId: 0, neto: esperado, concepto: '' });
  const destinoId = d.destinoId || destinos.find((c) => c.tipo === 'billetera')?.id || destinos[0]?.id || 0;
  const m = useMutation({
    mutationFn: () => api.post('/cobros/acreditar', { cobroIds: cobros.map((c) => c.id), fecha: d.fecha, destinoId, netoCentavos: d.neto, concepto: d.concepto || null }),
    onSuccess: () => { avisar('Acreditación registrada: el neto entró a la cuenta y la comisión real quedó aparte'); queriesPlata.forEach((k) => qc.invalidateQueries({ queryKey: [k] })); onListo(); }, onError: avisarError,
  });
  const dif = (d.neto ?? 0) - esperado;
  return (
    <Modal titulo="Registrar acreditación real" onCerrar={onCerrar}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (d.neto && destinoId) m.mutate(); }}>
        <p className="text-sm text-carbon/70">{cobros.length} {cobros.length === 1 ? 'cobro' : 'cobros'} de {cobros[0]?.cuenta}: bruto {pesos(bruto)}, neto esperado {pesos(esperado)}.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Fecha de acreditación"><input className="entrada" type="date" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} required /></Campo>
          <Campo etiqueta="Entró a"><select className="entrada" value={destinoId} onChange={(e) => setD({ ...d, destinoId: Number(e.target.value) })}>{destinos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Campo>
        </div>
        <Campo etiqueta="Importe que llegó de verdad" ayuda={`Comisión real: ${pesos(bruto - (d.neto ?? 0))}${dif ? ` · diferencia con lo esperado: ${pesos(dif)}` : ' · igual a lo esperado'}`}>
          <Importe valor={d.neto} onCambio={(n) => setD({ ...d, neto: n })} />
        </Campo>
        <Campo etiqueta="Detalle (opcional)"><input className="entrada" value={d.concepto} onChange={(e) => setD({ ...d, concepto: e.target.value })} placeholder="Ej.: liquidación Payway 18/11" /></Campo>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={!d.neto || !destinoId || m.isPending}>Registrar</button></div>
      </form>
    </Modal>
  );
}

/** Versión para imprimir o guardar como PDF, con los mismos filtros. */
function imprimir(r: Reporte) {
  const e = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const fila = (t: string, v: number) => `<tr><td>${t}</td><td class="n">${pesos(v)}</td></tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Cobros y comisiones ${r.desde} a ${r.hasta}</title>
  <style>body{font-family:system-ui,sans-serif;font-size:11px;margin:24px;color:#1a1714}h1{font-size:18px;margin:0}h2{font-size:13px;margin:18px 0 6px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:3px 5px;text-align:left}th{background:#f3eee6}.n{text-align:right;font-variant-numeric:tabular-nums}.res{width:auto;min-width:320px}</style></head><body>
  <h1>Herencia Cuero · Cobros, comisiones y acreditaciones</h1><div>Del ${fechaCorta(r.desde)} al ${fechaCorta(r.hasta)}</div>
  <h2>Resumen</h2><table class="res">${fila('Total de ventas', r.ventas.totalCentavos)}${fila('Cobrado (bruto)', r.totales.brutoCentavos)}${fila('Comisiones', -r.totales.comisionCentavos)}${fila('Neto esperado', r.totales.netoEsperadoCentavos)}${fila('Acreditado', r.totales.acreditadoCentavos)}${fila('Pendiente de acreditación', r.totales.pendienteCentavos)}${fila('Diferencia real vs esperado', r.totales.diferenciaCentavos)}</table>
  <h2>Por medio de pago</h2><table><tr><th>Medio</th><th class="n">Cobros</th><th class="n">Bruto</th><th class="n">Comisión</th><th class="n">Neto esperado</th><th class="n">Acreditado</th><th class="n">Pendiente</th><th class="n">Diferencia</th></tr>
  ${r.porMedio.map((m) => `<tr><td>${e(m.forma)}</td><td class="n">${m.cobros}</td><td class="n">${pesos(m.brutoCentavos)}</td><td class="n">${pesos(m.comisionCentavos)}</td><td class="n">${pesos(m.netoEsperadoCentavos)}</td><td class="n">${pesos(m.acreditadoCentavos)}</td><td class="n">${pesos(m.pendienteCentavos)}</td><td class="n">${pesos(m.diferenciaCentavos)}</td></tr>`).join('')}</table>
  <h2>Detalle</h2><table><tr><th>Fecha</th><th>Venta</th><th>Medio</th><th class="n">Bruto</th><th class="n">Comisión</th><th class="n">%</th><th class="n">Neto esperado</th><th class="n">Acreditado</th><th>Estado</th><th>Acreditación</th></tr>
  ${r.cobros.map((c) => `<tr><td>${fechaCorta(c.fecha)}</td><td>V-${c.ventaNumero}</td><td>${e(c.forma)}</td><td class="n">${pesos(c.brutoCentavos)}</td><td class="n">${pesos(c.comisionCentavos)}</td><td class="n">${porcentaje(c.comisionBp)}</td><td class="n">${pesos(c.netoEsperadoCentavos)}</td><td class="n">${c.netoAcreditadoCentavos == null ? '—' : pesos(c.netoAcreditadoCentavos)}</td><td>${c.estado === 'acreditado' ? 'Acreditado' : 'Pendiente'}</td><td>${c.fechaAcreditacion ? fechaCorta(c.fechaAcreditacion) : '—'}</td></tr>`).join('')}</table>
  <script>window.onload=()=>window.print()</script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { avisar('El navegador bloqueó la ventana: permití las ventanas emergentes para imprimir'); return; }
  w.document.write(html); w.document.close();
}
