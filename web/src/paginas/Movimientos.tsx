import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api, qs } from '../api';
import { NOMBRE_MOVIMIENTO, type Movimiento } from '../tipos';
import { Campo, Cargando, Encabezado, ErrorCarga } from '../componentes/ui';
import { ModalKardex } from '../componentes/StockModales';
import { fechaHora } from '../formato';

export function PaginaMovimientos() {
  const [f, setF] = useState({ tipo: '', desde: '', hasta: '', q: '' });
  const [pagina, setPagina] = useState(1);
  const [kardex, setKardex] = useState<number | null>(null);
  const datos = useQuery({ queryKey: ['movimientos', f, pagina], queryFn: () => api.get<{ total: number; filas: Movimiento[] }>('/stock/movimientos' + qs({ ...f, pagina })) });
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setPagina(1); };
  const paginas = Math.max(1, Math.ceil((datos.data?.total ?? 0) / 50));
  return (
    <>
      <Link to="/stock" className="mb-3 inline-flex items-center gap-1 text-sm text-carbon/60 hover:text-carbon"><ArrowLeft className="h-4 w-4" />Stock</Link>
      <Encabezado titulo="Movimientos de stock" sub="Todo lo que entró y salió. No se puede editar ni borrar: las correcciones son movimientos nuevos." />
      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <Campo etiqueta="Tipo"><select className="entrada" value={f.tipo} onChange={(e) => set('tipo', e.target.value)}><option value="">Todos</option>{Object.entries(NOMBRE_MOVIMIENTO).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></Campo>
        <Campo etiqueta="Desde"><input className="entrada" type="date" value={f.desde} onChange={(e) => set('desde', e.target.value)} /></Campo>
        <Campo etiqueta="Hasta"><input className="entrada" type="date" value={f.hasta} onChange={(e) => set('hasta', e.target.value)} /></Campo>
        <Campo etiqueta="Buscar"><input className="entrada" value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="Código, producto, motivo" /></Campo>
      </div>
      {datos.isLoading ? <Cargando /> : datos.isError ? <ErrorCarga error={datos.error} /> : (
        <>
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>Fecha</th><th>Código</th><th className="hidden sm:table-cell">Producto</th><th>Tipo</th><th className="num">Cant.</th><th className="hidden md:table-cell">Detalle</th></tr></thead>
              <tbody>
                {datos.data!.filas.map((m) => (
                  <tr key={m.id} className="cursor-pointer" onClick={() => setKardex(m.varianteId)}>
                    <td className="whitespace-nowrap">{fechaHora(m.fecha)}</td><td className="font-medium">{m.sku}</td>
                    <td className="hidden sm:table-cell">{m.modelo}</td><td>{NOMBRE_MOVIMIENTO[m.tipo] ?? m.tipo}</td>
                    <td className={`num font-medium ${m.cantidad < 0 ? 'text-bordo' : ''}`}>{m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}</td>
                    <td className="hidden max-w-sm truncate text-xs text-carbon/60 md:table-cell">{m.motivo}</td>
                  </tr>
                ))}
                {!datos.data!.filas.length && <tr><td colSpan={6} className="py-8 text-center text-carbon/50">Sin movimientos.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-carbon/60">{datos.data!.total} movimientos</span>
            <div className="flex items-center gap-2">
              <button className="btn-secundario btn-chico" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</button>
              <span>{pagina} / {paginas}</span>
              <button className="btn-secundario btn-chico" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
            </div>
          </div>
        </>
      )}
      {kardex && <ModalKardex varianteId={kardex} onCerrar={() => setKardex(null)} />}
    </>
  );
}
