import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../api';
import { useSesion } from '../sesion';
import type { Aux } from '../tipos';
import { Campo, Cargando, Encabezado, Estado, Modal, avisar, avisarError } from '../componentes/ui';
import { pct, pesos } from '../formato';
import { TIPOS_CUENTA, enMoneda, useCuentas, useFormasPago, type Cuenta, type FormaPago, type TipoCuenta } from '../plata';

export function PaginaCuentasFormas() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const cuentas = useCuentas();
  const formas = useFormasPago();
  const aux = useQuery({ queryKey: ['aux'], queryFn: () => api.get<Aux>('/catalogo/aux'), enabled: puede('catalogo') });
  const [cuenta, setCuenta] = useState<Partial<Cuenta> | null>(null);
  const [forma, setForma] = useState<Partial<FormaPago> | null>(null);
  const edita = puede('caja', 'aprobar');
  const gCuenta = useMutation({
    mutationFn: (c: Partial<Cuenta>) => { const cuerpo = { nombre: c.nombre, tipo: c.tipo, moneda: c.moneda, orden: c.orden ?? 0, activo: c.activo ?? true }; return c.id ? api.put(`/cuentas/${c.id}`, cuerpo) : api.post('/cuentas', cuerpo); },
    onSuccess: () => { avisar('Cuenta guardada'); setCuenta(null); qc.invalidateQueries({ queryKey: ['cuentas'] }); qc.invalidateQueries({ queryKey: ['formas-pago'] }); }, onError: avisarError,
  });
  const gForma = useMutation({
    mutationFn: (f: Partial<FormaPago>) => { const cuerpo = { nombre: f.nombre, cuentaId: f.cuentaId, listaPrecioId: f.listaPrecioId ?? null, comisionBp: f.comisionBp ?? 0, orden: f.orden ?? 0, activo: f.activo ?? true }; return f.id ? api.put(`/formas-pago/${f.id}`, cuerpo) : api.post('/formas-pago', cuerpo); },
    onSuccess: () => { avisar('Forma de pago guardada'); setForma(null); qc.invalidateQueries({ queryKey: ['formas-pago'] }); }, onError: avisarError,
  });
  if (cuentas.isLoading || formas.isLoading) return <Cargando />;
  const ctas = cuentas.data ?? [];
  return (
    <>
      <Encabezado titulo="Cuentas y formas de pago" sub="Dónde está la plata y cómo cobra el local. La comisión de cada forma de pago se usa para estimar la ganancia." />
      <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-bold">Cuentas</h2>{edita && <button className="btn-secundario btn-chico" onClick={() => setCuenta({ tipo: 'efectivo', moneda: 'ARS', activo: true })}><Plus className="h-3 w-3" />Nueva cuenta</button>}</div>
      <div className="tarjeta mb-8 overflow-x-auto">
        <table className="tabla">
          <thead><tr><th>Cuenta</th><th>Tipo</th><th>Moneda</th><th className="num">Saldo</th><th>Estado</th><th /></tr></thead>
          <tbody>{ctas.map((c) => (
            <tr key={c.id}><td className="font-medium">{c.nombre}</td><td>{TIPOS_CUENTA[c.tipo]}</td><td>{c.moneda}</td><td className="num">{enMoneda(c.saldoCentavos, c.moneda, pesos)}</td><td><Estado activo={c.activo} /></td>
              <td className="text-right">{edita && <button className="btn-secundario btn-chico" onClick={() => setCuenta(c)}>Editar</button>}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-bold">Formas de pago</h2>{edita && <button className="btn-secundario btn-chico" onClick={() => setForma({ cuentaId: ctas[0]?.id, comisionBp: 0, activo: true })}><Plus className="h-3 w-3" />Nueva forma de pago</button>}</div>
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead><tr><th>Forma de pago</th><th>La plata entra en</th><th>Precio que se cobra</th><th className="num">Comisión estimada</th><th>Estado</th><th /></tr></thead>
          <tbody>{(formas.data ?? []).map((f) => (
            <tr key={f.id}><td className="font-medium">{f.nombre}</td><td>{f.cuenta}</td><td>{f.lista ?? '—'}</td><td className="num">{pct(f.comisionBp)}</td><td><Estado activo={f.activo} /></td>
              <td className="text-right">{edita && <button className="btn-secundario btn-chico" onClick={() => setForma(f)}>Editar</button>}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-carbon/55">Comisión = cargo + IVA + retenciones. Si la plata entra a "tarjetas a liquidar", la comisión real queda registrada al cargar la liquidación.</p>
      {cuenta && (
        <Modal titulo={cuenta.id ? cuenta.nombre! : 'Nueva cuenta'} onCerrar={() => setCuenta(null)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); gCuenta.mutate(cuenta); }}>
            <Campo etiqueta="Nombre"><input className="entrada" value={cuenta.nombre ?? ''} onChange={(e) => setCuenta({ ...cuenta, nombre: e.target.value })} required /></Campo>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Tipo" ayuda={cuenta.tipo === 'externa' ? 'Para pagos que hace alguien de afuera: cada pago queda como aporte suyo.' : undefined}>
                <select className="entrada" value={cuenta.tipo} onChange={(e) => setCuenta({ ...cuenta, tipo: e.target.value as TipoCuenta })}>{Object.entries(TIPOS_CUENTA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </Campo>
              <Campo etiqueta="Moneda"><select className="entrada" value={cuenta.moneda} onChange={(e) => setCuenta({ ...cuenta, moneda: e.target.value as 'ARS' })}><option value="ARS">Pesos</option><option value="USD">Dólares</option></select></Campo>
            </div>
            {cuenta.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!cuenta.activo} onChange={(e) => setCuenta({ ...cuenta, activo: e.target.checked })} />Activa</label>}
            <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={() => setCuenta(null)}>Cancelar</button><button className="btn-primario" disabled={gCuenta.isPending}>Guardar</button></div>
          </form>
        </Modal>
      )}
      {forma && (
        <Modal titulo={forma.id ? forma.nombre! : 'Nueva forma de pago'} onCerrar={() => setForma(null)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); gForma.mutate(forma); }}>
            <Campo etiqueta="Nombre"><input className="entrada" value={forma.nombre ?? ''} onChange={(e) => setForma({ ...forma, nombre: e.target.value })} required /></Campo>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="La plata entra en"><select className="entrada" value={forma.cuentaId} onChange={(e) => setForma({ ...forma, cuentaId: Number(e.target.value) })}>{ctas.filter((c) => c.activo && c.tipo !== 'externa').map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Campo>
              <Campo etiqueta="Precio que se cobra"><select className="entrada" value={forma.listaPrecioId ?? ''} onChange={(e) => setForma({ ...forma, listaPrecioId: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{aux.data?.listasPrecio.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}</select></Campo>
              <Campo etiqueta="Comisión estimada (%)"><input className="entrada text-right" inputMode="decimal" defaultValue={((forma.comisionBp ?? 0) / 100).toString().replace('.', ',')} onChange={(e) => { const n = Number(e.target.value.replace(',', '.')); if (!Number.isNaN(n)) setForma({ ...forma, comisionBp: Math.round(n * 100) }); }} /></Campo>
            </div>
            {forma.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!forma.activo} onChange={(e) => setForma({ ...forma, activo: e.target.checked })} />Activa</label>}
            <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={() => setForma(null)}>Cancelar</button><button className="btn-primario" disabled={gForma.isPending}>Guardar</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
