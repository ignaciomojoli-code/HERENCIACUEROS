import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useSesion } from '../sesion';
import { NOMBRE_MOVIMIENTO, type Movimiento, type VarianteBuscada } from '../tipos';
import { Aviso, Campo, Cargando, Modal, avisar, avisarError } from './ui';
import { BuscadorVariante } from './BuscadorVariante';
import { fechaHora, pesos } from '../formato';

export function ModalKardex({ varianteId, onCerrar }: { varianteId: number; onCerrar: () => void }) {
  const { puede } = useSesion();
  const k = useQuery({ queryKey: ['kardex', varianteId], queryFn: () => api.get<{ sku: string; modelo: string; modeloId: number; stock: number; movimientos: Movimiento[] }>(`/stock/variante/${varianteId}`) });
  const [ajustar, setAjustar] = useState(false);
  return (
    <Modal titulo={k.data ? `${k.data.sku} · stock ${k.data.stock}` : 'Movimientos'} onCerrar={onCerrar} ancho="max-w-3xl">
      {k.isLoading ? <Cargando /> : k.data && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <Link className="underline" to={`/catalogo/${k.data.modeloId}`}>{k.data.modelo}</Link>
            {puede('stock', 'crear') && <button className="btn-secundario btn-chico" onClick={() => setAjustar(true)}>Ajustar stock</button>}
          </div>
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>Fecha</th><th>Tipo</th><th className="num">Cant.</th><th className="num">Saldo</th><th>Detalle</th></tr></thead>
              <tbody>
                {k.data.movimientos.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap">{fechaHora(m.fecha)}</td>
                    <td>{NOMBRE_MOVIMIENTO[m.tipo] ?? m.tipo}</td>
                    <td className={`num font-medium ${m.cantidad < 0 ? 'text-bordo' : ''}`}>{m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}</td>
                    <td className="num">{m.saldo}</td>
                    <td className="text-xs text-carbon/70">{m.motivo}{m.costoUnitarioCentavos != null && <span className="text-carbon/45"> · {pesos(m.costoUnitarioCentavos)} c/u</span>}</td>
                  </tr>
                ))}
                {!k.data.movimientos.length && <tr><td colSpan={5} className="py-6 text-center text-carbon/50">Sin movimientos todavía.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
      {ajustar && k.data && <ModalAjuste inicial={{ varianteId, sku: k.data.sku, stock: k.data.stock }} onCerrar={() => setAjustar(false)} />}
    </Modal>
  );
}

const MOTIVOS = ['Rotura / falla', 'Pérdida o robo', 'Regalo / canje', 'Uso interno / muestra', 'Error de carga anterior', 'Encontrado'];

export function ModalAjuste({ inicial, onCerrar }: { inicial?: { varianteId: number; sku: string; stock: number }; onCerrar: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState<{ varianteId: number; sku: string; stock: number; descripcion?: string } | null>(inicial ?? null);
  const [signo, setSigno] = useState<1 | -1>(-1);
  const [cant, setCant] = useState('1');
  const [motivo, setMotivo] = useState('');
  const n = Number(cant);
  const ok = v && Number.isInteger(n) && n > 0 && motivo.trim();
  const guardar = useMutation({
    mutationFn: () => api.post<{ stock: number }>('/stock/ajustes', { varianteId: v!.varianteId, cantidad: signo * n, motivo }, true),
    onSuccess: (r) => { avisar(`Ajuste guardado. Stock de ${v!.sku}: ${r.stock}`); qc.invalidateQueries({ queryKey: ['stock'] }); qc.invalidateQueries({ queryKey: ['kardex'] }); qc.invalidateQueries({ queryKey: ['modelo'] }); onCerrar(); },
    onError: avisarError,
  });
  return (
    <Modal titulo="Ajuste de stock" onCerrar={onCerrar}>
      <div className="space-y-4">
        {v ? (
          <div className="flex items-center justify-between rounded-md bg-marfil px-3 py-2 text-sm">
            <span><b>{v.sku}</b> {v.descripcion && <span className="text-carbon/60">{v.descripcion}</span>}</span>
            <span>stock actual <b>{v.stock}</b>{!inicial && <button className="ml-3 text-xs text-conac underline" onClick={() => setV(null)}>cambiar</button>}</span>
          </div>
        ) : (
          <Campo etiqueta="Producto"><BuscadorVariante autoFocus onElegir={(x: VarianteBuscada) => setV({ varianteId: x.varianteId, sku: x.sku, stock: x.stock, descripcion: [x.modelo, x.color, x.talle].filter(Boolean).join(' · ') })} /></Campo>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Movimiento">
            <div className="inline-flex w-full rounded-md border border-arena p-0.5 text-sm">
              <button type="button" className={`flex-1 rounded px-2 py-1.5 ${signo === -1 ? 'bg-carbon text-marfil' : ''}`} onClick={() => setSigno(-1)}>Sale</button>
              <button type="button" className={`flex-1 rounded px-2 py-1.5 ${signo === 1 ? 'bg-carbon text-marfil' : ''}`} onClick={() => setSigno(1)}>Entra</button>
            </div>
          </Campo>
          <Campo etiqueta="Cantidad"><input className="entrada" type="number" min={1} inputMode="numeric" value={cant} onChange={(e) => setCant(e.target.value)} /></Campo>
        </div>
        <Campo etiqueta="Motivo">
          <input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Obligatorio" list="motivos-ajuste" />
          <datalist id="motivos-ajuste">{MOTIVOS.map((m) => <option key={m} value={m} />)}</datalist>
        </Campo>
        {v && ok && signo === -1 && v.stock - n < 0 && <Aviso tono="critico">Quedaría en {v.stock - n}. No se permite stock negativo.</Aviso>}
        <p className="text-xs text-carbon/50">Las compras, ventas y conteos mueven el stock solos: el ajuste es para lo que no entra por ninguno de esos caminos.</p>
        <div className="flex justify-end gap-2">
          <button className="btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn-primario" disabled={!ok || guardar.isPending} onClick={() => guardar.mutate()}>{guardar.isPending ? 'Guardando…' : `${signo === 1 ? 'Sumar' : 'Restar'} ${ok ? n : ''}`}</button>
        </div>
      </div>
    </Modal>
  );
}
