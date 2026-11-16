import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, qs } from '../api';
import { useSesion } from '../sesion';
import { Campo, Cargando, Confirmar, Encabezado, ErrorCarga, Modal, Vacio, avisar, avisarError } from '../componentes/ui';
import { Importe } from '../componentes/Importe';
import { pesos } from '../formato';
import { fechaCorta, hoy, queriesPlata, useCuentas } from '../plata';
import { Tarjeta } from './Ventas';
import { Adjuntos } from '../componentes/Adjuntos';

interface Proveedor { id: number; nombre: string; activo: boolean }
interface Pago { id: number; numero: number; fecha: string; proveedorId: number; proveedor: string; compraId: number | null; compraNumero: number | null; cuenta: string; importeCentavos: number; comprobante: string | null; notas: string | null; estado: 'activo' | 'anulado'; motivoAnulacion: string | null; imputaciones: { compraId: number; compraNumero: number; importeCentavos: number }[]; sinImputarCentavos: number }
interface Comprobante { id: number; numero: number; fecha: string; comprobante: string | null; estadoPedido: string; aPagarCentavos: number; pagadoCentavos: number; saldoCentavos: number; vencimientoEfectivo: string | null; vencido: boolean }
interface Comprobantes { comprobantes: Comprobante[]; sinImputarCentavos: number }
interface Generales { proveedores: { proveedorId: number; proveedor: string; saldoCentavos: number; vencidoCentavos: number; sinFechaCentavos: number; proximoVencimiento: string | null; proximoCentavos: number }[]; clientes: { id: number; nombre: string; saldoCentavos: number; ultimaCompra: string | null }[] }
interface CuentaCorriente { proveedor: { id: number; nombre: string }; saldoCentavos: number; pendienteEntregaCentavos: number; lineas: { fecha: string; tipo: 'recepcion' | 'material' | 'pago' | 'ajuste'; refId: number; detalle: string; debeCentavos: number; haberCentavos: number; saldoCentavos: number }[] }
type Saldos = Record<string, { recibidoCentavos: number; pagadoCentavos: number; saldoCentavos: number }>;

export function PaginaPagos() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const proveedorId = params.get('proveedor') ?? '';
  const pagar = Number(params.get('pagar')) || null;
  const fijar = (v: string) => { const p = new URLSearchParams(params); if (v) p.set('proveedor', v); else p.delete('proveedor'); setParams(p, { replace: true }); };
  const provs = useQuery({ queryKey: ['proveedores'], queryFn: () => api.get<Proveedor[]>('/proveedores'), enabled: puede('proveedores') });
  const costos = puede('costos');
  const generales = useQuery({ queryKey: ['saldos-proveedores', 'general'], queryFn: () => api.get<Generales>('/cuentas-corrientes'), enabled: costos && !proveedorId });
  const comps = useQuery({ queryKey: ['cuenta-corriente', proveedorId, 'comprobantes'], queryFn: () => api.get<Comprobantes>(`/proveedores/${proveedorId}/comprobantes`), enabled: !!proveedorId && costos });
  const pagos = useQuery({ queryKey: ['pagos', proveedorId], queryFn: () => api.get<Pago[]>('/pagos-proveedores' + qs({ proveedorId, estado: 'todos' })) });
  const cc = useQuery({ queryKey: ['cuenta-corriente', proveedorId], queryFn: () => api.get<CuentaCorriente>(`/proveedores/${proveedorId}/cuenta-corriente`), enabled: !!proveedorId && costos });
  const [nuevo, setNuevo] = useState(!!pagar);
  const [detalle, setDetalle] = useState<Pago | null>(null);
  const [anular, setAnular] = useState<Pago | null>(null);
  const [motivo, setMotivo] = useState('');
  const [ajustar, setAjustar] = useState(false);
  const [anularAjuste, setAnularAjuste] = useState<{ refId: number; detalle: string } | null>(null);
  const inv = () => queriesPlata.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const anu = useMutation({
    mutationFn: () => api.post(`/pagos-proveedores/${anular!.id}/anular`, { motivo }),
    onSuccess: () => { avisar('Pago anulado'); setAnular(null); setMotivo(''); inv(); }, onError: avisarError,
  });
  const anuAj = useMutation({
    mutationFn: () => api.post(`/proveedores/ajustes/${anularAjuste!.refId}/anular`, { motivo }),
    onSuccess: () => { avisar('Ajuste anulado'); setAnularAjuste(null); setMotivo(''); inv(); }, onError: avisarError,
  });
  const gen = generales.data;
  return (
    <>
      <Encabezado titulo="Cuentas corrientes y pagos" sub="Cuánto se les debe a proveedores y talleres, cuándo vence y a qué pedido se aplicó cada pago.">
        {puede('caja', 'crear') && <button className="btn-primario" onClick={() => setNuevo(true)}><Plus className="h-4 w-4" />Registrar pago</button>}
      </Encabezado>
      <select className="entrada mb-4 max-w-sm" value={proveedorId} onChange={(e) => fijar(e.target.value)}>
        <option value="">Todos los proveedores</option>{provs.data?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </select>
      {costos && !proveedorId && gen && (
        <div className="mb-6 grid gap-4 lg:grid-cols-3">
          <div className="tarjeta overflow-x-auto lg:col-span-2">
            <div className="etiqueta px-3 pt-3">Proveedores</div>
            {!gen.proveedores.length ? <p className="p-3 text-sm text-carbon/55">No se le debe nada a nadie.</p> : (
              <table className="tabla">
                <thead><tr><th>Proveedor</th><th className="num">Saldo</th><th className="num">Vencido</th><th className="hidden sm:table-cell">Próximo vencimiento</th></tr></thead>
                <tbody>{[...gen.proveedores].sort((a, b) => b.vencidoCentavos - a.vencidoCentavos || b.saldoCentavos - a.saldoCentavos).map((p) => (
                  <tr key={p.proveedorId} className="cursor-pointer" onClick={() => fijar(String(p.proveedorId))}>
                    <td className="font-medium">{p.proveedor}</td>
                    <td className={`num ${p.saldoCentavos > 0 ? 'font-medium' : ''}`}>{p.saldoCentavos >= 0 ? pesos(p.saldoCentavos) : `A favor ${pesos(-p.saldoCentavos)}`}</td>
                    <td className={`num ${p.vencidoCentavos ? 'font-medium text-bordo' : 'text-carbon/40'}`}>{p.vencidoCentavos ? pesos(p.vencidoCentavos) : '—'}</td>
                    <td className="hidden sm:table-cell">{p.proximoVencimiento ? <>{fechaCorta(p.proximoVencimiento)} · {pesos(p.proximoCentavos)}</> : <span className="text-carbon/40">—</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            <p className="px-3 py-2 text-xs text-carbon/55">Saldo: lo recibido y comprado menos lo pagado (incluye ajustes y pagos a cuenta). Vencido: saldo de pedidos con fecha de pago pasada.</p>
          </div>
          <div className="tarjeta overflow-x-auto">
            <div className="etiqueta px-3 pt-3">Clientes que deben</div>
            {!gen.clientes.length ? <p className="p-3 text-sm text-carbon/55">Ningún cliente debe.</p> : (
              <table className="tabla"><tbody>{gen.clientes.map((c) => (
                <tr key={c.id}><td><Link className="font-medium hover:underline" to={`/ventas?cliente=${c.id}&saldo=true&desde=2000-01-01`}>{c.nombre}</Link></td><td className="num font-medium text-bordo">{pesos(c.saldoCentavos)}</td></tr>
              ))}</tbody></table>
            )}
          </div>
        </div>
      )}
      {cc.data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            <Tarjeta titulo="Saldo" valor={cc.data.saldoCentavos >= 0 ? pesos(cc.data.saldoCentavos) : `A favor ${pesos(-cc.data.saldoCentavos)}`} sub={cc.data.saldoCentavos > 0 ? 'Se le debe' : cc.data.saldoCentavos < 0 ? 'Se le pagó de más / adelanto' : 'Al día'} tono={cc.data.saldoCentavos > 0 ? 'bordo' : undefined} />
            <Tarjeta titulo="Pedido y todavía no entregado" valor={pesos(cc.data.pendienteEntregaCentavos)} sub={<Link className="underline" to={`/compras?proveedor=${proveedorId}`}>Ver pedidos</Link>} />
          </div>
          {comps.data && comps.data.comprobantes.length > 0 && (
            <>
              <h2 className="mb-2 text-lg font-bold">Pedidos y lo que falta pagar de cada uno</h2>
              <div className="tarjeta mb-6 overflow-x-auto">
                <table className="tabla">
                  <thead><tr><th>Pedido</th><th className="hidden sm:table-cell">Factura</th><th className="num">A pagar</th><th className="num">Pagado</th><th className="num">Saldo</th><th>Vence</th></tr></thead>
                  <tbody>{comps.data.comprobantes.map((c) => (
                    <tr key={c.id}>
                      <td><Link className="font-medium underline" to={`/compras/${c.id}`}>P-{c.numero}</Link><div className="text-xs text-carbon/50">{fechaCorta(c.fecha)}</div></td>
                      <td className="hidden sm:table-cell">{c.comprobante ?? '—'}</td>
                      <td className="num">{pesos(c.aPagarCentavos)}</td><td className="num">{pesos(c.pagadoCentavos)}</td>
                      <td className={`num font-medium ${c.saldoCentavos > 0 ? '' : 'text-carbon/40'}`}>{pesos(c.saldoCentavos)}</td>
                      <td className={`whitespace-nowrap ${c.vencido ? 'font-medium text-bordo' : ''}`}>{c.saldoCentavos > 0 && c.vencimientoEfectivo ? fechaCorta(c.vencimientoEfectivo) + (c.vencido ? ' · vencido' : '') : '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
                {comps.data.sinImputarCentavos > 0 && <p className="px-3 py-2 text-xs text-carbon/55">Hay {pesos(comps.data.sinImputarCentavos)} pagados sin asignar a un pedido (a cuenta). Asignalos desde la lista de pagos con “Detalle”.</p>}
              </div>
            </>
          )}
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Cuenta corriente</h2>
            {puede('caja', 'aprobar') && <button className="btn-secundario btn-chico" onClick={() => setAjustar(true)}>Ajustar saldo</button>}
          </div>
          {!cc.data.lineas.length ? <Vacio>Sin movimientos.</Vacio> : (
            <div className="tarjeta mb-6 overflow-x-auto">
              <table className="tabla">
                <thead><tr><th>Fecha</th><th>Detalle</th><th className="num">Entregó</th><th className="num">Pagado</th><th className="num">Saldo</th><th /></tr></thead>
                <tbody>{cc.data.lineas.map((l, i) => (
                  <tr key={i}><td className="whitespace-nowrap">{fechaCorta(l.fecha)}</td><td>{l.detalle}</td><td className="num">{l.debeCentavos ? pesos(l.debeCentavos) : ''}</td><td className="num">{l.haberCentavos ? pesos(l.haberCentavos) : ''}</td><td className="num font-medium">{pesos(l.saldoCentavos)}</td>
                    <td className="text-right">{l.tipo === 'ajuste' && puede('caja', 'anular') && <button className="btn-secundario btn-chico" onClick={() => setAnularAjuste(l)}>Anular</button>}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
      <h2 className="mb-2 text-lg font-bold">Pagos</h2>
      {pagos.isLoading ? <Cargando /> : pagos.isError ? <ErrorCarga error={pagos.error} /> : !pagos.data!.length ? <Vacio>No hay pagos registrados.</Vacio> : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead><tr><th>N°</th><th>Fecha</th><th>Proveedor</th><th className="hidden md:table-cell">Pagado con</th><th className="hidden sm:table-cell">Aplicado a</th><th className="num">Importe</th><th /></tr></thead>
            <tbody>{pagos.data!.map((p) => (
              <tr key={p.id} className={p.estado === 'anulado' ? 'text-carbon/40' : ''}>
                <td className="font-medium">PP-{p.numero}</td><td className="whitespace-nowrap">{fechaCorta(p.fecha)}</td>
                <td><span className={p.estado === 'anulado' ? 'line-through' : ''}>{p.proveedor}</span>{p.notas && <div className="text-xs text-carbon/50">{p.notas}</div>}{p.estado === 'anulado' && <div className="text-xs">Anulado: {p.motivoAnulacion}</div>}</td>
                <td className="hidden md:table-cell">{p.cuenta}</td>
                <td className="hidden sm:table-cell">{p.imputaciones.map((i) => <Link key={i.compraId} className="mr-2 underline" to={`/compras/${i.compraId}`}>P-{i.compraNumero}{p.imputaciones.length > 1 || p.sinImputarCentavos ? ` (${pesos(i.importeCentavos)})` : ''}</Link>)}{p.estado === 'activo' && p.sinImputarCentavos > 0 && <span className="text-xs text-carbon/55">{p.imputaciones.length ? '+ ' : ''}a cuenta {pesos(p.sinImputarCentavos)}</span>}</td>
                <td className="num font-medium">{pesos(p.importeCentavos)}</td>
                <td className="whitespace-nowrap text-right"><button className="btn-secundario btn-chico mr-1" onClick={() => setDetalle(p)}>Detalle</button>{p.estado === 'activo' && puede('caja', 'anular') && <button className="btn-secundario btn-chico" onClick={() => setAnular(p)}>Anular</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {nuevo && <ModalPago proveedores={(provs.data ?? []).filter((p) => p.activo)} proveedorInicial={Number(proveedorId) || 0} compraInicial={pagar} onCerrar={() => { setNuevo(false); if (pagar) { const p = new URLSearchParams(params); p.delete('pagar'); setParams(p, { replace: true }); } }} onListo={inv} />}
      {detalle && <ModalDetallePago pago={detalle} onCerrar={() => setDetalle(null)} onListo={inv} />}
      {ajustar && cc.data && <ModalAjuste proveedor={cc.data.proveedor} onCerrar={() => setAjustar(false)} onListo={inv} />}
      {anularAjuste && (
        <Confirmar titulo="Anular ajuste" textoBoton="Anular" peligro ocupado={anuAj.isPending} onCerrar={() => { setAnularAjuste(null); setMotivo(''); }} onConfirmar={() => anuAj.mutate()}>
          <p>{anularAjuste.detalle}. El saldo se recalcula; el ajuste queda registrado como anulado.</p>
          <Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
        </Confirmar>
      )}
      {anular && (
        <Confirmar titulo={`Anular pago PP-${anular.numero}`} textoBoton="Anular" peligro ocupado={anu.isPending} onCerrar={() => { setAnular(null); setMotivo(''); }} onConfirmar={() => anu.mutate()}>
          <p>Vuelven {pesos(anular.importeCentavos)} a {anular.cuenta} y el saldo con {anular.proveedor} se recalcula.</p>
          <Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
        </Confirmar>
      )}
    </>
  );
}

type Imputaciones = Record<number, number | null>;

/** Reparto de un pago entre los pedidos con saldo del proveedor. Lo que no se asigna queda a cuenta. */
function Imputar({ proveedorId, importe, valor, onCambio, actuales }: { proveedorId: number; importe: number; valor: Imputaciones; onCambio: (v: Imputaciones) => void; actuales?: Pago['imputaciones'] }) {
  const comps = useQuery({ queryKey: ['cuenta-corriente', String(proveedorId), 'comprobantes'], queryFn: () => api.get<Comprobantes>(`/proveedores/${proveedorId}/comprobantes`), enabled: !!proveedorId });
  // Lo que ya tenía imputado este mismo pago vuelve a estar disponible para repartir.
  const propio = (id: number) => actuales?.find((i) => i.compraId === id)?.importeCentavos ?? 0;
  const lista = (comps.data?.comprobantes ?? []).filter((c) => c.saldoCentavos + propio(c.id) > 0 || valor[c.id]);
  const asignado = Object.values(valor).reduce<number>((s, v) => s + (v ?? 0), 0);
  if (!proveedorId) return null;
  if (comps.isLoading) return <Cargando />;
  if (!lista.length) return <p className="text-sm text-carbon/55">No hay pedidos con saldo: el pago queda a cuenta.</p>;
  return (
    <div>
      <div className="etiqueta mb-1">A qué pedidos se aplica</div>
      <div className="max-h-56 overflow-y-auto rounded-md border border-arena/60">
        {lista.map((c) => {
          const disp = c.saldoCentavos + propio(c.id);
          return (
            <div key={c.id} className="flex items-center gap-2 border-b border-arena/40 px-3 py-1.5 text-sm last:border-0">
              <div className="flex-1">P-{c.numero}{c.comprobante && <span className="text-xs text-carbon/55"> · {c.comprobante}</span>}<div className={`text-xs ${c.vencido ? 'text-bordo' : 'text-carbon/55'}`}>debe {pesos(disp)}{c.vencimientoEfectivo && ` · vence ${fechaCorta(c.vencimientoEfectivo)}`}</div></div>
              <button type="button" className="text-xs text-conac underline" onClick={() => onCambio({ ...valor, [c.id]: Math.min(disp, Math.max(0, importe - asignado + (valor[c.id] ?? 0))) || null })}>saldar</button>
              <div className="w-32"><Importe valor={valor[c.id] ?? null} onCambio={(v) => onCambio({ ...valor, [c.id]: v })} placeholder="0" /></div>
            </div>
          );
        })}
      </div>
      <p className={`mt-1 text-xs ${asignado > importe ? 'text-bordo' : 'text-carbon/55'}`}>{asignado > importe ? `Asignaste ${pesos(asignado - importe)} de más` : `Asignado ${pesos(asignado)}${importe - asignado > 0 ? ` · queda a cuenta ${pesos(importe - asignado)}` : ''}`}</p>
    </div>
  );
}
const aLista = (v: Imputaciones) => Object.entries(v).filter(([, x]) => x && x > 0).map(([id, x]) => ({ compraId: Number(id), importeCentavos: x! }));

function ModalPago({ proveedores, proveedorInicial, compraInicial, onCerrar, onListo }: { proveedores: Proveedor[]; proveedorInicial: number; compraInicial: number | null; onCerrar: () => void; onListo: () => void }) {
  const cuentas = useCuentas();
  const [d, setD] = useState({ fecha: hoy(), proveedorId: proveedorInicial, cuentaId: 0, importe: null as number | null, comprobante: '', notas: '' });
  const [imps, setImps] = useState<Imputaciones>({});
  const comps = useQuery({ queryKey: ['cuenta-corriente', String(d.proveedorId), 'comprobantes'], queryFn: () => api.get<Comprobantes>(`/proveedores/${d.proveedorId}/comprobantes`), enabled: !!d.proveedorId && !!compraInicial });
  // Si se viene desde un pedido, se propone pagar su saldo.
  useEffect(() => {
    const c = comps.data?.comprobantes.find((x) => x.id === compraInicial);
    if (c && c.saldoCentavos > 0 && d.importe == null) { setD((x) => ({ ...x, importe: c.saldoCentavos })); setImps({ [c.id]: c.saldoCentavos }); }
  }, [comps.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const pagables = (cuentas.data ?? []).filter((c) => c.activo && c.tipo !== 'a_liquidar' && c.moneda === 'ARS');
  const cuenta = pagables.find((c) => c.id === d.cuentaId);
  const lista = aLista(imps);
  const asignado = lista.reduce((s, i) => s + i.importeCentavos, 0);
  const m = useMutation({
    mutationFn: () => api.post('/pagos-proveedores', { fecha: d.fecha, proveedorId: d.proveedorId, cuentaId: d.cuentaId, importeCentavos: d.importe, comprobante: d.comprobante || null, notas: d.notas || null, imputaciones: lista }, true),
    onSuccess: () => { avisar('Pago registrado'); onListo(); onCerrar(); }, onError: avisarError,
  });
  const valido = d.proveedorId && d.cuentaId && d.importe && d.importe > 0 && asignado <= d.importe;
  return (
    <Modal titulo="Registrar pago a proveedor" onCerrar={onCerrar} ancho="max-w-xl">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valido) m.mutate(); }}>
        <Campo etiqueta="Proveedor / taller"><select className="entrada" value={d.proveedorId} onChange={(e) => { setD({ ...d, proveedorId: Number(e.target.value) }); setImps({}); }}><option value={0}>Elegí…</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Fecha"><input className="entrada" type="date" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></Campo>
          <Campo etiqueta="Importe"><Importe valor={d.importe} onCambio={(v) => setD({ ...d, importe: v })} /></Campo>
        </div>
        <Campo etiqueta="Pagado con" ayuda={cuenta?.tipo === 'externa' ? `Queda registrado como aporte de ${cuenta.nombre}.` : undefined}>
          <select className="entrada" value={d.cuentaId} onChange={(e) => setD({ ...d, cuentaId: Number(e.target.value) })}><option value={0}>Elegí…</option>{pagables.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
        </Campo>
        <Imputar proveedorId={d.proveedorId} importe={d.importe ?? 0} valor={imps} onCambio={setImps} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Comprobante (opcional)"><input className="entrada" value={d.comprobante} onChange={(e) => setD({ ...d, comprobante: e.target.value })} /></Campo>
          <Campo etiqueta="Notas (opcional)"><input className="entrada" value={d.notas} onChange={(e) => setD({ ...d, notas: e.target.value })} /></Campo>
        </div>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={!valido || m.isPending}>{m.isPending ? 'Guardando…' : 'Registrar pago'}</button></div>
      </form>
    </Modal>
  );
}

/** Detalle de un pago: a qué pedidos se aplicó (se puede cambiar, no mueve plata) y el comprobante adjunto. */
function ModalDetallePago({ pago, onCerrar, onListo }: { pago: Pago; onCerrar: () => void; onListo: () => void }) {
  const { puede } = useSesion();
  const [imps, setImps] = useState<Imputaciones>(Object.fromEntries(pago.imputaciones.map((i) => [i.compraId, i.importeCentavos])));
  const [motivo, setMotivo] = useState('');
  const editable = pago.estado === 'activo' && puede('caja', 'modificar') && puede('costos');
  const lista = aLista(imps);
  const asignado = lista.reduce((s, i) => s + i.importeCentavos, 0);
  const m = useMutation({
    mutationFn: () => api.put(`/pagos-proveedores/${pago.id}/imputaciones`, { imputaciones: lista, motivo: motivo || null }),
    onSuccess: () => { avisar('Imputación guardada'); onListo(); onCerrar(); }, onError: avisarError,
  });
  return (
    <Modal titulo={`Pago PP-${pago.numero} · ${pago.proveedor}`} onCerrar={onCerrar} ancho="max-w-xl">
      <div className="space-y-4 text-sm">
        <p>{fechaCorta(pago.fecha)} · {pesos(pago.importeCentavos)} desde {pago.cuenta}{pago.comprobante && ` · ${pago.comprobante}`}{pago.estado === 'anulado' && <b className="text-bordo"> · anulado</b>}</p>
        {editable ? <>
          <Imputar proveedorId={pago.proveedorId} importe={pago.importeCentavos} valor={imps} onCambio={setImps} actuales={pago.imputaciones} />
          <Campo etiqueta="Motivo del cambio (opcional)"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
          <div className="flex justify-end"><button className="btn-primario" disabled={asignado > pago.importeCentavos || m.isPending} onClick={() => m.mutate()}>Guardar imputación</button></div>
        </> : <p>Aplicado a: {pago.imputaciones.map((i) => `P-${i.compraNumero} (${pesos(i.importeCentavos)})`).join(', ') || 'a cuenta'}</p>}
        <div className="border-t border-arena pt-3"><div className="etiqueta mb-2">Comprobante del pago</div><Adjuntos entidad="pago_proveedor" entidadId={pago.id} /></div>
      </div>
    </Modal>
  );
}

/** Ajuste de cuenta corriente: saldo inicial, redondeos o notas de crédito. No mueve plata ni stock. */
function ModalAjuste({ proveedor, onCerrar, onListo }: { proveedor: { id: number; nombre: string }; onCerrar: () => void; onListo: () => void }) {
  const [d, setD] = useState({ fecha: hoy(), sentido: 1, importe: null as number | null, motivo: '' });
  const m = useMutation({
    mutationFn: () => api.post(`/proveedores/${proveedor.id}/ajustes`, { fecha: d.fecha, importeCentavos: d.sentido * (d.importe ?? 0), motivo: d.motivo }, true),
    onSuccess: () => { avisar('Ajuste registrado'); onListo(); onCerrar(); }, onError: avisarError,
  });
  const valido = d.importe && d.importe > 0 && d.motivo.trim();
  return (
    <Modal titulo={`Ajustar saldo con ${proveedor.nombre}`} onCerrar={onCerrar}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valido) m.mutate(); }}>
        <p className="text-sm text-carbon/70">Para cargar un saldo inicial o corregir una diferencia. No mueve plata ni stock: solo cambia cuánto se le debe.</p>
        <Campo etiqueta="El ajuste…">
          <select className="entrada" value={d.sentido} onChange={(e) => setD({ ...d, sentido: Number(e.target.value) })}>
            <option value={1}>Suma a lo que se le debe</option><option value={-1}>Resta a lo que se le debe (a favor nuestro)</option>
          </select>
        </Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Fecha"><input className="entrada" type="date" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></Campo>
          <Campo etiqueta="Importe"><Importe valor={d.importe} onCambio={(v) => setD({ ...d, importe: v })} /></Campo>
        </div>
        <Campo etiqueta="Motivo"><input className="entrada" value={d.motivo} onChange={(e) => setD({ ...d, motivo: e.target.value })} placeholder="Ej.: saldo al 16/10 según planilla" /></Campo>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={!valido || m.isPending}>{m.isPending ? 'Guardando…' : 'Registrar ajuste'}</button></div>
      </form>
    </Modal>
  );
}
