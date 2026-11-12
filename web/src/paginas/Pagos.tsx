import { useState } from 'react';
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

interface Proveedor { id: number; nombre: string; activo: boolean }
interface Pago { id: number; numero: number; fecha: string; proveedorId: number; proveedor: string; compraId: number | null; compraNumero: number | null; cuenta: string; importeCentavos: number; comprobante: string | null; notas: string | null; estado: 'activo' | 'anulado'; motivoAnulacion: string | null }
interface CuentaCorriente { proveedor: { id: number; nombre: string }; saldoCentavos: number; pendienteEntregaCentavos: number; lineas: { fecha: string; tipo: 'recepcion' | 'pago'; refId: number; detalle: string; debeCentavos: number; haberCentavos: number; saldoCentavos: number }[] }
type Saldos = Record<string, { recibidoCentavos: number; pagadoCentavos: number; saldoCentavos: number }>;

export function PaginaPagos() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const proveedorId = params.get('proveedor') ?? '';
  const fijar = (v: string) => { const p = new URLSearchParams(params); if (v) p.set('proveedor', v); else p.delete('proveedor'); setParams(p, { replace: true }); };
  const provs = useQuery({ queryKey: ['proveedores'], queryFn: () => api.get<Proveedor[]>('/proveedores'), enabled: puede('proveedores') });
  const costos = puede('costos');
  const saldos = useQuery({ queryKey: ['saldos-proveedores'], queryFn: () => api.get<Saldos>('/proveedores/saldos'), enabled: costos });
  const pagos = useQuery({ queryKey: ['pagos', proveedorId], queryFn: () => api.get<Pago[]>('/pagos-proveedores' + qs({ proveedorId, estado: 'todos' })) });
  const cc = useQuery({ queryKey: ['cuenta-corriente', proveedorId], queryFn: () => api.get<CuentaCorriente>(`/proveedores/${proveedorId}/cuenta-corriente`), enabled: !!proveedorId && costos });
  const [nuevo, setNuevo] = useState(false);
  const [anular, setAnular] = useState<Pago | null>(null);
  const [motivo, setMotivo] = useState('');
  const inv = () => queriesPlata.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const anu = useMutation({
    mutationFn: () => api.post(`/pagos-proveedores/${anular!.id}/anular`, { motivo }),
    onSuccess: () => { avisar('Pago anulado'); setAnular(null); setMotivo(''); inv(); }, onError: avisarError,
  });
  const nombre = (id: string) => provs.data?.find((p) => String(p.id) === id)?.nombre ?? `#${id}`;
  const conSaldo = Object.entries(saldos.data ?? {}).filter(([, s]) => s.saldoCentavos !== 0).sort((a, b) => b[1].saldoCentavos - a[1].saldoCentavos);
  return (
    <>
      <Encabezado titulo="Pagos a proveedores" sub="Lo que se les paga a proveedores y talleres, y cuánto se les debe por lo que ya entregaron.">
        {puede('caja', 'crear') && <button className="btn-primario" onClick={() => setNuevo(true)}><Plus className="h-4 w-4" />Registrar pago</button>}
      </Encabezado>
      <select className="entrada mb-4 max-w-sm" value={proveedorId} onChange={(e) => fijar(e.target.value)}>
        <option value="">Todos los proveedores</option>{provs.data?.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </select>
      {costos && !proveedorId && conSaldo.length > 0 && (
        <div className="tarjeta mb-4 overflow-x-auto">
          <table className="tabla">
            <thead><tr><th>Proveedor</th><th className="num">Recibido</th><th className="num">Pagado</th><th className="num">Saldo</th></tr></thead>
            <tbody>{conSaldo.map(([id, s]) => (
              <tr key={id} className="cursor-pointer" onClick={() => fijar(id)}>
                <td className="font-medium">{nombre(id)}</td><td className="num">{pesos(s.recibidoCentavos)}</td><td className="num">{pesos(s.pagadoCentavos)}</td>
                <td className={`num font-medium ${s.saldoCentavos > 0 ? 'text-bordo' : ''}`}>{s.saldoCentavos > 0 ? `Se le debe ${pesos(s.saldoCentavos)}` : `A favor ${pesos(-s.saldoCentavos)}`}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="px-3 py-2 text-xs text-carbon/55">Recibido = lo entregado en recepciones, al costo del pedido. Saldo positivo: se le debe; negativo: se le pagó por adelantado.</p>
        </div>
      )}
      {cc.data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            <Tarjeta titulo="Saldo" valor={cc.data.saldoCentavos >= 0 ? pesos(cc.data.saldoCentavos) : `A favor ${pesos(-cc.data.saldoCentavos)}`} sub={cc.data.saldoCentavos > 0 ? 'Se le debe' : cc.data.saldoCentavos < 0 ? 'Se le pagó de más / adelanto' : 'Al día'} tono={cc.data.saldoCentavos > 0 ? 'bordo' : undefined} />
            <Tarjeta titulo="Pedido y todavía no entregado" valor={pesos(cc.data.pendienteEntregaCentavos)} sub={<Link className="underline" to={`/compras?proveedor=${proveedorId}`}>Ver pedidos</Link>} />
          </div>
          <h2 className="mb-2 text-lg font-bold">Cuenta corriente</h2>
          {!cc.data.lineas.length ? <Vacio>Sin movimientos.</Vacio> : (
            <div className="tarjeta mb-6 overflow-x-auto">
              <table className="tabla">
                <thead><tr><th>Fecha</th><th>Detalle</th><th className="num">Entregó</th><th className="num">Pagado</th><th className="num">Saldo</th></tr></thead>
                <tbody>{cc.data.lineas.map((l, i) => (
                  <tr key={i}><td className="whitespace-nowrap">{fechaCorta(l.fecha)}</td><td>{l.detalle}</td><td className="num">{l.debeCentavos ? pesos(l.debeCentavos) : ''}</td><td className="num">{l.haberCentavos ? pesos(l.haberCentavos) : ''}</td><td className="num font-medium">{pesos(l.saldoCentavos)}</td></tr>
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
            <thead><tr><th>N°</th><th>Fecha</th><th>Proveedor</th><th className="hidden md:table-cell">Pagado con</th><th className="hidden sm:table-cell">Pedido</th><th className="num">Importe</th><th /></tr></thead>
            <tbody>{pagos.data!.map((p) => (
              <tr key={p.id} className={p.estado === 'anulado' ? 'text-carbon/40' : ''}>
                <td className="font-medium">PP-{p.numero}</td><td className="whitespace-nowrap">{fechaCorta(p.fecha)}</td>
                <td><span className={p.estado === 'anulado' ? 'line-through' : ''}>{p.proveedor}</span>{p.notas && <div className="text-xs text-carbon/50">{p.notas}</div>}{p.estado === 'anulado' && <div className="text-xs">Anulado: {p.motivoAnulacion}</div>}</td>
                <td className="hidden md:table-cell">{p.cuenta}</td>
                <td className="hidden sm:table-cell">{p.compraId ? <Link className="underline" to={`/compras/${p.compraId}`}>P-{p.compraNumero}</Link> : '—'}</td>
                <td className="num font-medium">{pesos(p.importeCentavos)}</td>
                <td className="text-right">{p.estado === 'activo' && puede('caja', 'anular') && <button className="btn-secundario btn-chico" onClick={() => setAnular(p)}>Anular</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {nuevo && <ModalPago proveedores={(provs.data ?? []).filter((p) => p.activo)} proveedorInicial={Number(proveedorId) || 0} onCerrar={() => setNuevo(false)} onListo={inv} />}
      {anular && (
        <Confirmar titulo={`Anular pago PP-${anular.numero}`} textoBoton="Anular" peligro ocupado={anu.isPending} onCerrar={() => { setAnular(null); setMotivo(''); }} onConfirmar={() => anu.mutate()}>
          <p>Vuelven {pesos(anular.importeCentavos)} a {anular.cuenta} y el saldo con {anular.proveedor} se recalcula.</p>
          <Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
        </Confirmar>
      )}
    </>
  );
}

function ModalPago({ proveedores, proveedorInicial, onCerrar, onListo }: { proveedores: Proveedor[]; proveedorInicial: number; onCerrar: () => void; onListo: () => void }) {
  const cuentas = useCuentas();
  const [d, setD] = useState({ fecha: hoy(), proveedorId: proveedorInicial, compraId: null as number | null, cuentaId: 0, importe: null as number | null, comprobante: '', notas: '' });
  const compras = useQuery({ queryKey: ['compras', d.proveedorId, 'pago'], queryFn: () => api.get<{ id: number; numero: number; fecha: string; estado: string; totalCentavos?: number }[]>('/compras' + qs({ proveedorId: d.proveedorId })), enabled: !!d.proveedorId });
  const pagables = (cuentas.data ?? []).filter((c) => c.activo && c.tipo !== 'a_liquidar' && c.moneda === 'ARS');
  const cuenta = pagables.find((c) => c.id === d.cuentaId);
  const m = useMutation({
    mutationFn: () => api.post('/pagos-proveedores', { fecha: d.fecha, proveedorId: d.proveedorId, compraId: d.compraId, cuentaId: d.cuentaId, importeCentavos: d.importe, comprobante: d.comprobante || null, notas: d.notas || null }, true),
    onSuccess: () => { avisar('Pago registrado'); onListo(); onCerrar(); }, onError: avisarError,
  });
  const valido = d.proveedorId && d.cuentaId && d.importe && d.importe > 0;
  return (
    <Modal titulo="Registrar pago a proveedor" onCerrar={onCerrar}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valido) m.mutate(); }}>
        <Campo etiqueta="Proveedor / taller"><select className="entrada" value={d.proveedorId} onChange={(e) => setD({ ...d, proveedorId: Number(e.target.value), compraId: null })}><option value={0}>Elegí…</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Pedido (opcional)" ayuda="Para saber a qué pedido corresponde. El saldo se calcula igual por proveedor.">
          <select className="entrada" value={d.compraId ?? ''} onChange={(e) => setD({ ...d, compraId: e.target.value ? Number(e.target.value) : null })} disabled={!d.proveedorId}>
            <option value="">Sin pedido (pago a cuenta)</option>{compras.data?.filter((c) => c.estado !== 'anulada').map((c) => <option key={c.id} value={c.id}>P-{c.numero} · {fechaCorta(c.fecha)}{c.totalCentavos != null ? ` · ${pesos(c.totalCentavos)}` : ''}</option>)}
          </select>
        </Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Fecha"><input className="entrada" type="date" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></Campo>
          <Campo etiqueta="Importe"><Importe valor={d.importe} onCambio={(v) => setD({ ...d, importe: v })} /></Campo>
        </div>
        <Campo etiqueta="Pagado con" ayuda={cuenta?.tipo === 'externa' ? `Queda registrado como aporte de ${cuenta.nombre}.` : undefined}>
          <select className="entrada" value={d.cuentaId} onChange={(e) => setD({ ...d, cuentaId: Number(e.target.value) })}><option value={0}>Elegí…</option>{pagables.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
        </Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Comprobante (opcional)"><input className="entrada" value={d.comprobante} onChange={(e) => setD({ ...d, comprobante: e.target.value })} /></Campo>
          <Campo etiqueta="Notas (opcional)"><input className="entrada" value={d.notas} onChange={(e) => setD({ ...d, notas: e.target.value })} /></Campo>
        </div>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={!valido || m.isPending}>{m.isPending ? 'Guardando…' : 'Registrar pago'}</button></div>
      </form>
    </Modal>
  );
}
