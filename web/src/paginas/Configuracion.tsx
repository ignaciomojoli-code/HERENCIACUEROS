import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useSesion } from '../sesion';
import { Campo, Cargando, Encabezado, Pendiente, avisar, avisarError } from '../componentes/ui';
import { Importe } from '../componentes/Importe';
import { fechaHora } from '../formato';

type Config = Record<string, Record<string, any>>;
const EMPRESA: [string, string][] = [['nombreFantasia', 'Nombre de fantasía'], ['razonSocial', 'Razón social'], ['cuit', 'CUIT'], ['condicionIva', 'Condición frente al IVA'], ['direccion', 'Dirección'], ['telefono', 'Teléfono / WhatsApp'], ['email', 'Email'], ['horario', 'Horario'], ['slogan', 'Slogan (ES)'], ['sloganEn', 'Slogan (EN)']];

export function PaginaConfiguracion() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get<Config>('/config') });
  const [c, setC] = useState<Config | null>(null);
  useEffect(() => { if (config.data) setC(structuredClone(config.data)); }, [config.data]);
  const guardar = useMutation({
    mutationFn: ({ clave, valor }: { clave: string; valor: unknown }) => api.put(`/config/${clave}`, valor),
    onSuccess: () => { avisar('Guardado'); qc.invalidateQueries({ queryKey: ['config'] }); },
    onError: avisarError,
  });
  if (!c) return <Cargando />;
  const edita = puede('configuracion', 'modificar');
  const set = (sec: string, k: string, v: unknown) => setC({ ...c, [sec]: { ...c[sec], [k]: v } });
  const Seccion = ({ clave, titulo, children, sub }: { clave: string; titulo: string; sub?: string; children: React.ReactNode }) => (
    <section className="tarjeta p-5">
      <h2 className="text-lg font-bold">{titulo}</h2>
      {sub && <p className="mb-2 text-sm text-carbon/60">{sub}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>
      {edita && <div className="mt-4 flex justify-end"><button className="btn-primario" disabled={guardar.isPending || JSON.stringify(c[clave]) === JSON.stringify(config.data?.[clave])} onClick={() => guardar.mutate({ clave, valor: c[clave] })}>Guardar</button></div>}
    </section>
  );
  const bp = (v: number) => String(v / 100);

  return (
    <>
      <Encabezado titulo="Configuración" sub="Lo que figura como pendiente se puede completar acá cuando lo tengas." />
      <div className="space-y-6">
        {Seccion({ clave: 'empresa', titulo: 'Datos del negocio', children: EMPRESA.map(([k, t]) => (
          <Campo key={k} etiqueta={t}>
            <input className="entrada" disabled={!edita} value={c.empresa[k] ?? ''} placeholder="Pendiente" onChange={(e) => set('empresa', k, e.target.value || (k === 'nombreFantasia' ? '' : null))} />
          </Campo>
        )) })}

        {Seccion({ clave: 'cotizaciones', titulo: 'Cotizaciones', sub: 'Pesos por cada unidad de moneda extranjera. Se usan para mostrar "≈ USD" y para cobros en dólares o reales.', children: <>
          <Campo etiqueta="Dólar (USD)" ayuda={c.cotizaciones.usdCentavos == null ? undefined : `Actualizada ${fechaHora(c.cotizaciones.actualizadaEn)}`}>
            <Importe valor={c.cotizaciones.usdCentavos} disabled={!edita} onCambio={(v) => setC({ ...c, cotizaciones: { ...c.cotizaciones, usdCentavos: v, actualizadaEn: new Date().toISOString() } })} placeholder="Pendiente" />
          </Campo>
          <Campo etiqueta="Real (BRL)">
            <Importe valor={c.cotizaciones.brlCentavos} disabled={!edita} onCambio={(v) => setC({ ...c, cotizaciones: { ...c.cotizaciones, brlCentavos: v, actualizadaEn: new Date().toISOString() } })} placeholder="Pendiente" />
          </Campo>
          {c.cotizaciones.usdCentavos == null && <div className="sm:col-span-2"><Pendiente texto="Cotización pendiente" /></div>}
        </> })}

        {Seccion({ clave: 'precios', titulo: 'Formación de precios', sub: 'Valores por defecto para sugerir precios. Margen y markup son cosas distintas: margen es ganancia sobre el precio de venta, markup es ganancia sobre el costo.', children: <>
          <Campo etiqueta="Método por defecto">
            <select className="entrada" disabled={!edita} value={c.precios.metodoPorDefecto} onChange={(e) => set('precios', 'metodoPorDefecto', e.target.value)}>
              <option value="margen">Margen objetivo</option><option value="markup">Markup sobre costo</option><option value="precio_objetivo">Precio objetivo</option>
            </select>
          </Campo>
          <Campo etiqueta="Redondeo hacia arriba"><Importe valor={c.precios.redondeoCentavos} disabled={!edita} onCambio={(v) => set('precios', 'redondeoCentavos', v ?? 0)} /></Campo>
          <Campo etiqueta="Margen objetivo (%)" ayuda="Ej: 50 → de cada $100 de venta, $50 son ganancia"><input className="entrada" disabled={!edita} inputMode="decimal" defaultValue={bp(c.precios.margenObjetivoBp)} onBlur={(e) => set('precios', 'margenObjetivoBp', Math.round(Number(e.target.value.replace(',', '.')) * 100) || 0)} /></Campo>
          <Campo etiqueta="Markup objetivo (%)" ayuda="Ej: 100 → precio = costo × 2"><input className="entrada" disabled={!edita} inputMode="decimal" defaultValue={bp(c.precios.markupObjetivoBp)} onBlur={(e) => set('precios', 'markupObjetivoBp', Math.round(Number(e.target.value.replace(',', '.')) * 100) || 0)} /></Campo>
        </> })}

        {Seccion({ clave: 'inventario', titulo: 'Inventario', sub: 'Se usa a partir de la entrega de stock.', children: <>
          <Campo etiqueta="Stock mínimo por defecto"><input className="entrada" type="number" min={0} disabled={!edita} value={c.inventario.stockMinimoPorDefecto} onChange={(e) => set('inventario', 'stockMinimoPorDefecto', Number(e.target.value))} /></Campo>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" disabled={!edita} checked={c.inventario.permitirVentaSinStock} onChange={(e) => set('inventario', 'permitirVentaSinStock', e.target.checked)} />Permitir vender sin stock</label>
        </> })}

        {Seccion({ clave: 'backups', titulo: 'Copias de seguridad', sub: 'Recomendado: una carpeta sincronizada con Google Drive, así la copia queda también fuera de la compu.', children: <>
          <Campo etiqueta="Carpeta" ayuda="Vacío = carpeta datos\backups junto al sistema" className="sm:col-span-2"><input className="entrada" disabled={!edita} value={c.backups.carpeta ?? ''} placeholder="Ej: C:\Users\...\Google Drive\Herencia backups" onChange={(e) => set('backups', 'carpeta', e.target.value || null)} /></Campo>
          <Campo etiqueta="Cada cuántas horas"><input className="entrada" type="number" min={1} max={24} disabled={!edita} value={c.backups.cadaHoras} onChange={(e) => set('backups', 'cadaHoras', Number(e.target.value))} /></Campo>
          <Campo etiqueta="Días que se guardan todas"><input className="entrada" type="number" min={1} disabled={!edita} value={c.backups.retenerDiarios} onChange={(e) => set('backups', 'retenerDiarios', Number(e.target.value))} /></Campo>
          <Campo etiqueta="Meses que se guarda una por mes"><input className="entrada" type="number" min={0} disabled={!edita} value={c.backups.retenerMensuales} onChange={(e) => set('backups', 'retenerMensuales', Number(e.target.value))} /></Campo>
        </> })}

        <section className="tarjeta p-5">
          <h2 className="text-lg font-bold">Identidad de marca</h2>
          <p className="mb-3 text-sm text-carbon/60">Paleta del Manual de marca 2026, aplicada en todo el sistema.</p>
          <div className="flex flex-wrap gap-3">
            {[['#15120F', 'Negro carbón'], ['#EFE6D2', 'Marfil'], ['#EFE8DA', 'Crema'], ['#CDB6A9', 'Arena rosada'], ['#C2AC7E', 'Dorado arena'], ['#6B1E28', 'Bordó'], ['#A65A2E', 'Coñac'], ['#B8261C', 'Rojo oferta (solo ofertas)']].map(([hex, n]) => (
              <div key={hex} className="w-28 text-xs"><div className="h-12 rounded border border-arena" style={{ background: hex }} /><div className="mt-1 font-medium">{n}</div><div className="text-carbon/50">{hex}</div></div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
