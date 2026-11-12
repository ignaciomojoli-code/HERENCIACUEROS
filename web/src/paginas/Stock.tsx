import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Download, History, Search, SlidersHorizontal, Upload } from 'lucide-react';
import { api, qs } from '../api';
import { useSesion } from '../sesion';
import type { Aux, FilaStock } from '../tipos';
import { Cargando, Encabezado, ErrorCarga, Pendiente, Vacio } from '../componentes/ui';
import { ModalAjuste, ModalKardex } from '../componentes/StockModales';
import { pesos } from '../formato';

interface Respuesta { filas: FilaStock[]; totales: { variantes: number; unidades: number; valorCostoCentavos?: number; valorVentaCentavos: number; sinCosto?: number } }
const FILTROS = [['todos', 'Todos'], ['con_stock', 'Con stock'], ['sin_stock', 'Sin stock'], ['bajo_minimo', 'Bajo mínimo'], ['negativo', 'Negativo']] as const;

export function PaginaStock() {
  const { puede } = useSesion();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const filtro = params.get('filtro') ?? 'todos';
  const categoriaId = params.get('categoria') ?? '';
  const fijar = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const aux = useQuery({ queryKey: ['aux'], queryFn: () => api.get<Aux>('/catalogo/aux') });
  const datos = useQuery({ queryKey: ['stock', q, filtro, categoriaId], queryFn: () => api.get<Respuesta>('/stock' + qs({ q, filtro, categoriaId })) });
  const [kardex, setKardex] = useState<number | null>(null);
  const [ajuste, setAjuste] = useState(false);
  const verCostos = puede('costos');
  const t = datos.data?.totales;

  return (
    <>
      <Encabezado titulo="Stock" sub="El stock de cada producto es la suma de sus movimientos: compras, ventas, ajustes y conteos.">
        <Link className="btn-secundario" to="/stock/movimientos"><History className="h-4 w-4" />Movimientos</Link>
        <Link className="btn-secundario" to="/conteos"><ClipboardList className="h-4 w-4" />Conteos</Link>
        {puede('stock', 'exportar') && <a className="btn-secundario" href={'/api/stock/exportar' + qs({ q, filtro, categoriaId })}><Download className="h-4 w-4" />Exportar</a>}
        {puede('stock', 'crear') && <button className="btn-primario" onClick={() => setAjuste(true)}><SlidersHorizontal className="h-4 w-4" />Ajuste</button>}
      </Encabezado>

      {t && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Dato titulo="Unidades en stock" valor={t.unidades.toLocaleString('es-AR')} />
          <Dato titulo="Variantes listadas" valor={t.variantes} />
          {verCostos && <Dato titulo="Valor al costo" valor={pesos(t.valorCostoCentavos)} nota={t.sinCosto ? `${t.sinCosto} con stock y sin costo` : undefined} />}
          <Dato titulo="Valor a precio efectivo" valor={pesos(t.valorVentaCentavos)} />
        </div>
      )}

      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-carbon/40" />
          <input className="entrada pl-9" placeholder="Buscar por código, producto o color…" value={q} onChange={(e) => fijar('q', e.target.value)} />
        </div>
        <select className="entrada" value={categoriaId} onChange={(e) => fijar('categoria', e.target.value)}>
          <option value="">Todas las categorías</option>
          {aux.data?.categorias.filter((c) => !c.padreId).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </div>
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {FILTROS.map(([k, n]) => <button key={k} onClick={() => fijar('filtro', k === 'todos' ? '' : k)} className={`rounded-full border px-3 py-1 ${filtro === k ? 'border-carbon bg-carbon text-marfil' : 'border-arena'}`}>{n}</button>)}
        {puede('stock', 'aprobar') && <Link to="/stock/inicial" className="ml-auto inline-flex items-center gap-1 text-xs text-conac underline"><Upload className="h-3.5 w-3.5" />Cargar stock inicial desde planilla</Link>}
      </div>

      {datos.isLoading ? <Cargando /> : datos.isError ? <ErrorCarga error={datos.error} /> : !datos.data!.filas.length ? <Vacio>No hay productos con ese filtro.</Vacio> : (
        <>
          <div className="space-y-2 sm:hidden">
            {datos.data!.filas.map((f) => (
              <button key={f.varianteId} onClick={() => setKardex(f.varianteId)} className="tarjeta flex w-full items-center justify-between gap-3 p-3 text-left">
                <span className="min-w-0"><b>{f.sku}</b><span className="block truncate text-xs text-carbon/60">{[f.modelo, f.color, f.talle && `talle ${f.talle}`].filter(Boolean).join(' · ')}</span></span>
                <Cantidad f={f} grande />
              </button>
            ))}
          </div>
          <div className="tarjeta hidden overflow-x-auto sm:block">
            <table className="tabla">
              <thead><tr><th>Código</th><th>Producto</th><th>Color</th><th>Talle</th><th className="num">Stock</th><th className="num">Mín.</th>{verCostos && <th className="num">Costo</th>}{verCostos && <th className="num">Valor costo</th>}<th className="num">Precio ef.</th></tr></thead>
              <tbody>
                {datos.data!.filas.map((f) => (
                  <tr key={f.varianteId} className="cursor-pointer" onClick={() => setKardex(f.varianteId)}>
                    <td className="font-medium">{f.sku}</td>
                    <td><Link to={`/catalogo/${f.modeloId}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{f.modelo}</Link><div className="text-xs text-carbon/45">{f.categoria}</div></td>
                    <td>{f.color ?? '—'}</td><td>{f.talle ?? '—'}</td>
                    <td className="num"><Cantidad f={f} /></td>
                    <td className="num text-carbon/50">{f.stockMinimo ?? ''}</td>
                    {verCostos && <td className="num">{f.costoCentavos == null ? (f.stock > 0 ? <Pendiente /> : '—') : pesos(f.costoCentavos)}</td>}
                    {verCostos && <td className="num">{f.costoCentavos != null && f.stock > 0 ? pesos(f.costoCentavos * f.stock) : ''}</td>}
                    <td className="num">{pesos(f.precioCentavos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {kardex && <ModalKardex varianteId={kardex} onCerrar={() => setKardex(null)} />}
      {ajuste && <ModalAjuste onCerrar={() => setAjuste(false)} />}
    </>
  );
}

function Cantidad({ f, grande }: { f: FilaStock; grande?: boolean }) {
  const bajo = f.stockMinimo != null && f.stock < f.stockMinimo;
  const clase = f.stock < 0 ? 'text-bordo' : bajo ? 'text-conac' : f.stock === 0 ? 'text-carbon/35' : '';
  return <span className={`font-titulo font-bold ${grande ? 'text-2xl' : 'text-base'} ${clase}`} title={bajo ? 'Bajo el mínimo' : undefined}>{f.stock}</span>;
}

function Dato({ titulo, valor, nota }: { titulo: string; valor: React.ReactNode; nota?: string }) {
  return (
    <div className="tarjeta p-4">
      <div className="etiqueta">{titulo}</div>
      <div className="mt-2 font-titulo text-2xl font-bold">{valor}</div>
      {nota && <div className="mt-1 text-xs text-conac">{nota}</div>}
    </div>
  );
}
