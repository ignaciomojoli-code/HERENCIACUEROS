import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, CreditCard, Download, HandCoins, LogOut, Scale } from 'lucide-react';
import { api, qs } from '../api';
import { useSesion } from '../sesion';
import { Aviso, Campo, Cargando, Confirmar, Encabezado, ErrorCarga, Modal, Vacio, avisar, avisarError } from '../componentes/ui';
import { Importe } from '../componentes/Importe';
import { pesos } from '../formato';
import { NOMBRE_TIPO_CAJA, TIPOS_CUENTA, enMoneda, fechaCorta, hoy, queriesPlata, useCuentas, type Cuenta } from '../plata';

interface Mov {
  id: number; fecha: string; cuentaId: number; cuenta: string; moneda: 'ARS' | 'USD'; importeCentavos: number; importeArsCentavos: number; tipo: string;
  concepto: string; grupo: string | null; anulaId: number | null; anulado: boolean; manual: boolean; saldoCentavos: number;
}
type Operacion = 'pase' | 'liquidacion' | 'aporte' | 'retiro' | 'arqueo' | 'saldo';

export function PaginaCaja() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const f = { cuentaId: params.get('cuenta') ?? '', tipo: params.get('tipo') ?? '', desde: params.get('desde') ?? '', hasta: params.get('hasta') ?? '', q: params.get('q') ?? '', pagina: Number(params.get('pagina') ?? 1) };
  const fijar = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); if (k !== 'pagina') p.delete('pagina'); setParams(p, { replace: true }); };
  const cuentas = useCuentas();
  const movs = useQuery({ queryKey: ['caja', f], queryFn: () => api.get<{ total: number; entraCentavos: number; saleCentavos: number; filas: Mov[] }>('/caja/movimientos' + qs(f)) });
  const [op, setOp] = useState<{ tipo: Operacion; cuentaId?: number } | null>(null);
  const [anular, setAnular] = useState<Mov | null>(null);
  const [motivo, setMotivo] = useState('');
  const inv = () => queriesPlata.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const anu = useMutation({
    mutationFn: () => api.post(`/caja/operaciones/${encodeURIComponent(anular!.grupo!)}/anular`, { motivo }),
    onSuccess: () => { avisar('Operación anulada'); setAnular(null); setMotivo(''); inv(); }, onError: avisarError,
  });
  const ctas = (cuentas.data ?? []).filter((c) => c.activo || (c.saldoCentavos ?? 0) !== 0);
  const totalArs = ctas.filter((c) => c.tipo !== 'externa').reduce((s, c) => s + (c.saldoArsCentavos ?? 0), 0);
  const cuentaSel = ctas.find((c) => String(c.id) === f.cuentaId);
  const porPagina = 50;
  return (
    <>
      <Encabezado titulo="Caja" sub="Dónde está la plata. Cada movimiento queda registrado; para corregir se anula, no se borra.">
        {puede('caja', 'exportar') && <a className="btn-secundario" href={'/api/caja/exportar' + qs({ ...f, pagina: undefined })}><Download className="h-4 w-4" />Excel</a>}
      </Encabezado>
      {puede('caja', 'crear') && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button className="btn-secundario" onClick={() => setOp({ tipo: 'pase' })}><ArrowLeftRight className="h-4 w-4" />Pase entre cuentas</button>
          <button className="btn-secundario" onClick={() => setOp({ tipo: 'liquidacion' })}><CreditCard className="h-4 w-4" />Liquidación de tarjetas</button>
          <button className="btn-secundario" onClick={() => setOp({ tipo: 'aporte' })}><HandCoins className="h-4 w-4" />Aporte</button>
          <button className="btn-secundario" onClick={() => setOp({ tipo: 'retiro' })}><LogOut className="h-4 w-4" />Retiro personal</button>
          {puede('caja', 'aprobar') && <button className="btn-secundario" onClick={() => setOp({ tipo: 'arqueo' })}><Scale className="h-4 w-4" />Arqueo</button>}
        </div>
      )}
      {cuentas.isLoading ? <Cargando /> : (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {ctas.map((c) => (
            <button key={c.id} onClick={() => fijar('cuenta', String(c.id) === f.cuentaId ? '' : String(c.id))}
              className={`tarjeta p-4 text-left transition-colors hover:border-dorado ${String(c.id) === f.cuentaId ? 'border-dorado ring-1 ring-dorado' : ''}`}>
              <div className="etiqueta">{c.nombre}</div>
              <div className={`mt-1 font-titulo text-2xl font-bold ${(c.saldoCentavos ?? 0) < 0 ? 'text-bordo' : ''}`}>{enMoneda(c.saldoCentavos, c.moneda, pesos)}</div>
              <div className="text-xs text-carbon/55">{TIPOS_CUENTA[c.tipo]}{c.moneda === 'USD' && ` · ≈ ${pesos(c.saldoArsCentavos)}`}{!c.activo && ' · inactiva'}</div>
              {c.movimientos === 0 && puede('caja', 'aprobar') && c.tipo !== 'externa' && <span role="link" className="mt-1 inline-block text-xs text-conac underline" onClick={(e) => { e.stopPropagation(); setOp({ tipo: 'saldo', cuentaId: c.id }); }}>Cargar saldo inicial</span>}
            </button>
          ))}
          <div className="tarjeta bg-carbon p-4 text-marfil">
            <div className="etiqueta text-marfil/60">Total en pesos</div>
            <div className="mt-1 font-titulo text-2xl font-bold">{pesos(totalArs)}</div>
            <div className="text-xs text-marfil/50">Incluye tarjetas a liquidar y dólares al cambio</div>
          </div>
        </div>
      )}
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <select className="entrada" value={f.tipo} onChange={(e) => fijar('tipo', e.target.value)}><option value="">Todos los movimientos</option>{Object.entries(NOMBRE_TIPO_CAJA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input className="entrada" type="date" value={f.desde} onChange={(e) => fijar('desde', e.target.value)} aria-label="Desde" />
        <input className="entrada" type="date" value={f.hasta} onChange={(e) => fijar('hasta', e.target.value)} aria-label="Hasta" />
        <input className="entrada" placeholder="Buscar concepto" defaultValue={f.q} onKeyDown={(e) => e.key === 'Enter' && fijar('q', (e.target as HTMLInputElement).value)} onBlur={(e) => fijar('q', e.target.value)} />
      </div>
      {cuentaSel && <p className="mb-2 text-sm text-carbon/60">Viendo <b>{cuentaSel.nombre}</b>, con el saldo después de cada movimiento. <button className="text-conac underline" onClick={() => fijar('cuenta', '')}>Ver todas</button></p>}
      {movs.isLoading ? <Cargando /> : movs.isError ? <ErrorCarga error={movs.error} /> : !movs.data!.filas.length ? <Vacio>No hay movimientos con ese filtro.</Vacio> : (
        <>
          <div className="mb-2 text-sm text-carbon/60">{movs.data!.total} movimientos · entró {pesos(movs.data!.entraCentavos)} · salió {pesos(-movs.data!.saleCentavos)}</div>
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>Fecha</th>{!cuentaSel && <th>Cuenta</th>}<th>Concepto</th><th className="num">Importe</th>{cuentaSel && <th className="num">Saldo</th>}<th /></tr></thead>
              <tbody>
                {movs.data!.filas.map((m) => (
                  <tr key={m.id} className={m.anulado ? 'text-carbon/40' : ''}>
                    <td className="whitespace-nowrap">{fechaCorta(m.fecha)}</td>
                    {!cuentaSel && <td className="whitespace-nowrap">{m.cuenta}</td>}
                    <td><span className="pildora mr-2 bg-carbon/5 text-carbon/70">{NOMBRE_TIPO_CAJA[m.tipo]}</span><span className={m.anulado ? 'line-through' : ''}>{m.concepto}</span></td>
                    <td className={`num font-medium ${m.importeCentavos < 0 ? 'text-bordo' : ''}`}>{enMoneda(m.importeCentavos, m.moneda, pesos)}</td>
                    {cuentaSel && <td className="num text-carbon/60">{enMoneda(m.saldoCentavos, m.moneda, pesos)}</td>}
                    <td className="text-right">{m.manual && m.grupo && !m.anulado && puede('caja', 'anular') && <button className="btn-secundario btn-chico" onClick={() => setAnular(m)}>Anular</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {movs.data!.total > porPagina && (
            <div className="mt-3 flex items-center justify-end gap-2 text-sm">
              <button className="btn-secundario btn-chico" disabled={f.pagina <= 1} onClick={() => fijar('pagina', String(f.pagina - 1))}>Anterior</button>
              <span>Página {f.pagina} de {Math.ceil(movs.data!.total / porPagina)}</span>
              <button className="btn-secundario btn-chico" disabled={f.pagina * porPagina >= movs.data!.total} onClick={() => fijar('pagina', String(f.pagina + 1))}>Siguiente</button>
            </div>
          )}
        </>
      )}
      {op && <ModalOperacion op={op.tipo} cuentaInicial={op.cuentaId} cuentas={(cuentas.data ?? []).filter((c) => c.activo)} onCerrar={() => setOp(null)} onListo={inv} />}
      {anular && (
        <Confirmar titulo="Anular operación" textoBoton="Anular" peligro ocupado={anu.isPending} onCerrar={() => { setAnular(null); setMotivo(''); }} onConfirmar={() => anu.mutate()}>
          <p>Se agrega el movimiento contrario de <b>{anular.concepto}</b> (y de su otra pata, si es un pase o una liquidación).</p>
          <Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
        </Confirmar>
      )}
    </>
  );
}

const TITULOS: Record<Operacion, string> = { pase: 'Pase entre cuentas', liquidacion: 'Liquidación de tarjetas', aporte: 'Aporte de plata', retiro: 'Retiro personal', arqueo: 'Arqueo de caja', saldo: 'Saldo inicial' };

function ModalOperacion({ op, cuentas, cuentaInicial, onCerrar, onListo }: { op: Operacion; cuentas: Cuenta[]; cuentaInicial?: number; onCerrar: () => void; onListo: () => void }) {
  const propias = cuentas.filter((c) => c.tipo !== 'externa');
  const aLiquidar = propias.filter((c) => c.tipo === 'a_liquidar');
  const destinosLiq = propias.filter((c) => c.tipo !== 'a_liquidar' && c.moneda === 'ARS');
  const primera = (l: Cuenta[], n = 0) => l[n]?.id ?? 0;
  const [d, setD] = useState({
    fecha: hoy(), cuentaId: cuentaInicial ?? primera(op === 'retiro' ? propias.filter((c) => c.tipo !== 'a_liquidar') : propias),
    origenId: op === 'liquidacion' ? primera(aLiquidar) : primera(propias, 1), destinoId: op === 'liquidacion' ? primera(destinosLiq, 1) || primera(destinosLiq) : primera(propias),
    importe: null as number | null, importeDestino: null as number | null, bruto: null as number | null, neto: null as number | null,
    aportante: 'Inversor externo', concepto: '',
  });
  const cta = (id: number) => cuentas.find((c) => c.id === id);
  const origen = cta(d.origenId);
  const destino = cta(d.destinoId);
  const cuenta = cta(d.cuentaId);
  const cambio = op === 'pase' && origen && destino && origen.moneda !== destino.moneda;
  const enviar = useMutation({
    mutationFn: () => {
      switch (op) {
        case 'pase': return api.post('/caja/pases', { fecha: d.fecha, origenId: d.origenId, destinoId: d.destinoId, importeCentavos: d.importe, importeDestinoCentavos: cambio ? d.importeDestino : null, concepto: d.concepto || null }, true);
        case 'liquidacion': return api.post('/caja/liquidaciones', { fecha: d.fecha, origenId: d.origenId, destinoId: d.destinoId, brutoCentavos: d.bruto, netoCentavos: d.neto, concepto: d.concepto || null }, true);
        case 'aporte': return api.post('/caja/aportes', { fecha: d.fecha, cuentaId: d.cuentaId, importeCentavos: d.importe, aportante: d.aportante, concepto: d.concepto || null }, true);
        case 'retiro': return api.post('/caja/retiros', { fecha: d.fecha, cuentaId: d.cuentaId, importeCentavos: d.importe, concepto: d.concepto }, true);
        case 'arqueo': return api.post('/caja/arqueos', { fecha: d.fecha, cuentaId: d.cuentaId, saldoRealCentavos: d.importe, notas: d.concepto || null }, true);
        case 'saldo': return api.post('/caja/saldo-inicial', { fecha: d.fecha, cuentaId: d.cuentaId, importeCentavos: d.importe }, true);
      }
    },
    onSuccess: (r) => {
      const dif = (r as { diferenciaCentavos?: number }).diferenciaCentavos;
      avisar(op === 'arqueo' ? (dif ? `Arqueo guardado: diferencia de ${pesos(dif)} registrada como ajuste` : 'Arqueo guardado: coincide con el sistema') : 'Listo');
      onListo(); onCerrar();
    },
    onError: avisarError,
  });
  const selector = (etiqueta: string, valor: number, lista: Cuenta[], k: 'cuentaId' | 'origenId' | 'destinoId') => (
    <Campo etiqueta={etiqueta}>
      <select className="entrada" value={valor} onChange={(e) => setD({ ...d, [k]: Number(e.target.value) })}>
        {lista.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({enMoneda(c.saldoCentavos, c.moneda, pesos)})</option>)}
      </select>
    </Campo>
  );
  const etiquetaImporte = (c?: Cuenta) => (c?.moneda === 'USD' ? 'Importe en dólares' : 'Importe');
  const importeUsd = (k: 'importe' | 'importeDestino') => (
    <input className="entrada text-right" inputMode="decimal" value={d[k] == null ? '' : d[k]! / 100} onChange={(e) => { const n = Number(e.target.value.replace(',', '.')); setD({ ...d, [k]: e.target.value === '' || Number.isNaN(n) ? null : Math.round(n * 100) }); }} />
  );
  const campoImporte = (c?: Cuenta, k: 'importe' | 'importeDestino' = 'importe', etiqueta = etiquetaImporte(c)) => (
    <Campo etiqueta={etiqueta}>{c?.moneda === 'USD' ? importeUsd(k) : <Importe valor={d[k]} onCambio={(v) => setD({ ...d, [k]: v })} />}</Campo>
  );
  let valido = !!d.fecha;
  if (op === 'pase') valido &&= !!d.importe && d.origenId !== d.destinoId && (!cambio || !!d.importeDestino);
  if (op === 'liquidacion') valido &&= !!d.neto && !!d.bruto && d.bruto >= d.neto;
  if (op === 'aporte') valido &&= !!d.importe && !!d.aportante.trim();
  if (op === 'retiro') valido &&= !!d.importe && !!d.concepto.trim();
  if (op === 'arqueo' || op === 'saldo') valido &&= d.importe != null;
  return (
    <Modal titulo={TITULOS[op]} onCerrar={onCerrar}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valido) enviar.mutate(); }}>
        <Campo etiqueta="Fecha"><input className="entrada" type="date" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></Campo>
        {op === 'pase' && <>
          <div className="grid gap-3 sm:grid-cols-2">{selector('Sale de', d.origenId, propias.filter((c) => c.tipo !== 'a_liquidar'), 'origenId')}{selector('Entra a', d.destinoId, propias.filter((c) => c.tipo !== 'a_liquidar'), 'destinoId')}</div>
          {campoImporte(origen, 'importe', cambio ? `Sale (${origen?.moneda})` : 'Importe')}
          {cambio && campoImporte(destino, 'importeDestino', `Llega (${destino?.moneda})`)}
          {cambio && d.importe && d.importeDestino ? <p className="text-xs text-carbon/55">Cambio: {pesos(origen!.moneda === 'USD' ? Math.round((d.importeDestino / d.importe) * 100) : Math.round((d.importe / d.importeDestino) * 100))} por dólar</p> : null}
          <Campo etiqueta="Nota (opcional)"><input className="entrada" value={d.concepto} onChange={(e) => setD({ ...d, concepto: e.target.value })} placeholder="Ej.: transferí y me dieron efectivo" /></Campo>
        </>}
        {op === 'liquidacion' && <>
          {!aLiquidar.length && <Aviso tono="atencion">No hay una cuenta de tarjetas a liquidar.</Aviso>}
          <div className="grid gap-3 sm:grid-cols-2">{selector('Desde', d.origenId, aLiquidar, 'origenId')}{selector('Llega a', d.destinoId, destinosLiq, 'destinoId')}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Ventas que se liquidan (bruto)"><Importe valor={d.bruto} onCambio={(v) => setD({ ...d, bruto: v })} /></Campo>
            <Campo etiqueta="Lo que llegó (neto)"><Importe valor={d.neto} onCambio={(v) => setD({ ...d, neto: v })} /></Campo>
          </div>
          {d.bruto && d.neto ? <p className="text-sm">Comisiones y retenciones: <b>{pesos(d.bruto - d.neto)}</b>{d.bruto ? ` (${((1 - d.neto / d.bruto) * 100).toFixed(1).replace('.', ',')}%)` : ''}</p> : null}
          <Campo etiqueta="Nota (opcional)"><input className="entrada" value={d.concepto} onChange={(e) => setD({ ...d, concepto: e.target.value })} placeholder="Ej.: ventas del 27/10, adelanto" /></Campo>
        </>}
        {op === 'aporte' && <>
          {selector('Entra a', d.cuentaId, propias.filter((c) => c.tipo !== 'a_liquidar'), 'cuentaId')}
          {campoImporte(cuenta)}
          <Campo etiqueta="Quién aporta"><input className="entrada" value={d.aportante} onChange={(e) => setD({ ...d, aportante: e.target.value })} /></Campo>
          <Campo etiqueta="Concepto (opcional)"><input className="entrada" value={d.concepto} onChange={(e) => setD({ ...d, concepto: e.target.value })} /></Campo>
          <p className="text-xs text-carbon/55">No es una venta: no suma a la ganancia. Si el inversor pagó algo directamente (ej. la luz), cargalo como gasto "pagado con Inversor externo".</p>
        </>}
        {op === 'retiro' && <>
          {selector('Sale de', d.cuentaId, propias.filter((c) => c.tipo !== 'a_liquidar'), 'cuentaId')}
          {campoImporte(cuenta)}
          <Campo etiqueta="Concepto"><input className="entrada" value={d.concepto} onChange={(e) => setD({ ...d, concepto: e.target.value })} placeholder="Ej.: corte de pelo, lavado de auto" /></Campo>
          <p className="text-xs text-carbon/55">Plata que sale para uso personal: no cuenta como gasto del local.</p>
        </>}
        {(op === 'arqueo' || op === 'saldo') && <>
          {selector('Cuenta', d.cuentaId, propias, 'cuentaId')}
          {op === 'arqueo' && cuenta && <p className="text-sm">Según el sistema hay <b>{enMoneda(cuenta.saldoCentavos, cuenta.moneda, pesos)}</b> (con todos los movimientos cargados).</p>}
          {campoImporte(cuenta, 'importe', op === 'arqueo' ? 'Lo que hay realmente' : etiquetaImporte(cuenta))}
          {op === 'arqueo' && cuenta && d.importe != null && d.importe !== cuenta.saldoCentavos && <Aviso tono="atencion">Diferencia de {enMoneda(d.importe - (cuenta.saldoCentavos ?? 0), cuenta.moneda, pesos)}: queda registrada como "diferencia de caja no identificada", separada de los gastos del local.</Aviso>}
          {op === 'arqueo' && <Campo etiqueta="Notas (opcional)"><input className="entrada" value={d.concepto} onChange={(e) => setD({ ...d, concepto: e.target.value })} /></Campo>}
        </>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={!valido || enviar.isPending}>{enviar.isPending ? 'Guardando…' : 'Guardar'}</button></div>
      </form>
    </Modal>
  );
}

