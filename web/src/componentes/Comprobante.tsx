import { Campo } from './ui';
import { Importe } from './Importe';

export type CondicionPago = 'al_pedir' | 'al_recibir' | 'a_plazo' | 'cuenta_corriente';
export const CONDICIONES: Record<CondicionPago, string> = { al_pedir: 'Al pedir', al_recibir: 'Al recibir', a_plazo: 'A plazo (días)', cuenta_corriente: 'Cuenta corriente (sin fecha)' };
export interface DatosComprobante {
  comprobante: string; fechaComprobante: string; descuentoCentavos: number | null; impuestosCentavos: number | null;
  condicionPago: CondicionPago | ''; plazoPagoDias: number | null; vencimiento: string;
  /** Total de la factura: si está, es lo que se le debe por el pedido. */
  importeFacturadoCentavos: number | null;
}
export const comprobanteVacio = (): DatosComprobante => ({ comprobante: '', fechaComprobante: '', descuentoCentavos: null, impuestosCentavos: null, condicionPago: '', plazoPagoDias: null, vencimiento: '', importeFacturadoCentavos: null });
export const comprobanteDe = (c: { comprobante: string | null; fechaComprobante: string | null; descuentoCentavos: number; impuestosCentavos: number; condicionPago: CondicionPago | null; plazoPagoDias: number | null; vencimiento: string | null; importeFacturadoCentavos?: number | null }): DatosComprobante => ({
  importeFacturadoCentavos: c.importeFacturadoCentavos ?? null,
  comprobante: c.comprobante ?? '', fechaComprobante: c.fechaComprobante ?? '', descuentoCentavos: c.descuentoCentavos || null, impuestosCentavos: c.impuestosCentavos || null,
  condicionPago: c.condicionPago ?? '', plazoPagoDias: c.plazoPagoDias, vencimiento: c.vencimiento ?? '',
});
export const cuerpoComprobante = (d: DatosComprobante) => ({
  comprobante: d.comprobante.trim() || null, fechaComprobante: d.fechaComprobante || null, descuentoCentavos: d.descuentoCentavos ?? 0, impuestosCentavos: d.impuestosCentavos ?? 0,
  condicionPago: d.condicionPago || null, plazoPagoDias: d.condicionPago === 'a_plazo' ? d.plazoPagoDias : null, vencimiento: d.vencimiento || null,
  importeFacturadoCentavos: d.importeFacturadoCentavos,
});
export const comprobanteValido = (d: DatosComprobante) => d.condicionPago !== 'a_plazo' || !!d.plazoPagoDias || !!d.vencimiento;

/** Factura, descuento, impuestos y condición de pago de un pedido. */
export function CamposComprobante({ d, onCambio, conFacturado = false }: { d: DatosComprobante; onCambio: (d: DatosComprobante) => void; conFacturado?: boolean }) {
  const set = (p: Partial<DatosComprobante>) => onCambio({ ...d, ...p });
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Campo etiqueta="Condición de pago (esta operación)">
        <select className="entrada" value={d.condicionPago} onChange={(e) => set({ condicionPago: e.target.value as CondicionPago | '' })}>
          <option value="">Sin definir</option>{Object.entries(CONDICIONES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Campo>
      {d.condicionPago === 'a_plazo' && <Campo etiqueta="Días"><input className="entrada text-right" type="number" min={1} value={d.plazoPagoDias ?? ''} onChange={(e) => set({ plazoPagoDias: e.target.value ? Number(e.target.value) : null })} /></Campo>}
      <Campo etiqueta="Vence (opcional)" ayuda="Si lo dejás vacío se calcula con la condición"><input className="entrada" type="date" value={d.vencimiento} onChange={(e) => set({ vencimiento: e.target.value })} /></Campo>
      <Campo etiqueta="Factura / comprobante N°"><input className="entrada" value={d.comprobante} onChange={(e) => set({ comprobante: e.target.value })} placeholder="Ej.: FC A 0001-00001234" /></Campo>
      <Campo etiqueta="Fecha de la factura"><input className="entrada" type="date" value={d.fechaComprobante} onChange={(e) => set({ fechaComprobante: e.target.value })} /></Campo>
      <Campo etiqueta="Descuento"><Importe valor={d.descuentoCentavos} onCambio={(v) => set({ descuentoCentavos: v })} placeholder="0" /></Campo>
      <Campo etiqueta="Impuestos (IVA, percepciones)"><Importe valor={d.impuestosCentavos} onCambio={(v) => set({ impuestosCentavos: v })} placeholder="0" /></Campo>
      {conFacturado && <Campo etiqueta="Total de la factura" ayuda="Si lo cargás, es lo que se le debe"><Importe valor={d.importeFacturadoCentavos} onCambio={(v) => set({ importeFacturadoCentavos: v })} placeholder="Sin factura" /></Campo>}
    </div>
  );
}
