import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useSesion } from '../sesion';
import type { Aux, VarianteBuscada } from '../tipos';
import { Aviso, Campo, Cargando, Confirmar, Encabezado, ErrorCarga, Modal, Vacio, avisar, avisarError } from '../componentes/ui';
import { BuscadorVariante } from '../componentes/BuscadorVariante';
import { fechaHora } from '../formato';

interface ConteoResumen { id: number; numero: number; fecha: string; categoria: string | null; estado: 'abierto' | 'aplicado' | 'descartado'; items: number; aplicadoEn: string | null }
interface ItemConteo { id: number; varianteId: number; sku: string; modelo: string; color: string | null; talle: string | null; contado: number; sistema: number; diferencia: number }
interface Conteo extends Omit<ConteoResumen, 'items'> { categoriaId: number | null; notas: string | null; items: ItemConteo[]; sinContar: { varianteId: number; sku: string; modelo: string; stock: number }[] }
const ESTADO: Record<string, string> = { abierto: 'En curso', aplicado: 'Aplicado', descartado: 'Descartado' };

export function PaginaConteos() {
  const { puede } = useSesion();
  const nav = useNavigate();
  const lista = useQuery({ queryKey: ['conteos'], queryFn: () => api.get<ConteoResumen[]>('/conteos') });
  const aux = useQuery({ queryKey: ['aux'], queryFn: () => api.get<Aux>('/catalogo/aux') });
  const [nuevo, setNuevo] = useState(false);
  const [cat, setCat] = useState('');
  const crear = useMutation({
    mutationFn: () => api.post<{ id: number }>('/conteos', { categoriaId: cat ? Number(cat) : null }, true),
    onSuccess: (c) => nav(`/conteos/${c.id}`), onError: avisarError,
  });
  return (
    <>
      <Link to="/stock" className="mb-3 inline-flex items-center gap-1 text-sm text-carbon/60 hover:text-carbon"><ArrowLeft className="h-4 w-4" />Stock</Link>
      <Encabezado titulo="Conteos físicos" sub="Contá lo que hay en el local (se puede hacer desde el celular) y el sistema ajusta las diferencias.">
        {puede('stock', 'crear') && <button className="btn-primario" onClick={() => setNuevo(true)}><Plus className="h-4 w-4" />Nuevo conteo</button>}
      </Encabezado>
      {lista.isLoading ? <Cargando /> : lista.isError ? <ErrorCarga error={lista.error} /> : !lista.data!.length ? <Vacio>Todavía no se hizo ningún conteo.</Vacio> : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead><tr><th>N°</th><th>Fecha</th><th>Alcance</th><th className="num">Contados</th><th>Estado</th></tr></thead>
            <tbody>
              {lista.data!.map((c) => (
                <tr key={c.id} className="cursor-pointer" onClick={() => nav(`/conteos/${c.id}`)}>
                  <td className="font-medium">C-{c.numero}</td><td>{fechaHora(c.fecha)}</td><td>{c.categoria ?? 'Todo el local'}</td>
                  <td className="num">{c.items}</td>
                  <td><span className={`pildora ${c.estado === 'abierto' ? 'bg-conac-claro text-conac' : 'bg-carbon/5 text-carbon/60'}`}>{ESTADO[c.estado]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nuevo && (
        <Modal titulo="Nuevo conteo" onCerrar={() => setNuevo(false)}>
          <div className="space-y-4">
            <Campo etiqueta="Qué se cuenta" ayuda="Podés contar una categoría por vez (ej. solo camperas).">
              <select className="entrada" value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">Todo el local</option>{aux.data?.categorias.filter((c) => !c.padreId).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Campo>
            <div className="flex justify-end gap-2"><button className="btn-secundario" onClick={() => setNuevo(false)}>Cancelar</button><button className="btn-primario" disabled={crear.isPending} onClick={() => crear.mutate()}>Empezar</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}

export function PaginaConteo() {
  const { id } = useParams();
  const { puede } = useSesion();
  const qc = useQueryClient();
  const c = useQuery({ queryKey: ['conteo', id], queryFn: () => api.get<Conteo>(`/conteos/${id}`) });
  const [pendiente, setPendiente] = useState<VarianteBuscada | null>(null);
  const [cant, setCant] = useState('');
  const [confirmar, setConfirmar] = useState<'aplicar' | 'descartar' | null>(null);
  const refrescar = () => qc.invalidateQueries({ queryKey: ['conteo', id] });
  const cargar = useMutation({
    mutationFn: (items: { varianteId: number; contado: number | null }[]) => api.put(`/conteos/${id}/items`, { items }),
    onSuccess: () => { refrescar(); setPendiente(null); setCant(''); }, onError: avisarError,
  });
  const accion = useMutation({
    mutationFn: (a: 'aplicar' | 'descartar') => api.post<{ ajustes?: number }>(`/conteos/${id}/${a}`),
    onSuccess: (r, a) => { avisar(a === 'aplicar' ? `Conteo aplicado: ${r.ajustes} ajustes` : 'Conteo descartado'); setConfirmar(null); refrescar(); qc.invalidateQueries({ queryKey: ['conteos'] }); qc.invalidateQueries({ queryKey: ['stock'] }); },
    onError: (e) => { avisarError(e); setConfirmar(null); },
  });
  if (c.isLoading) return <Cargando />;
  if (c.isError) return <ErrorCarga error={c.error} />;
  const k = c.data!;
  const abierto = k.estado === 'abierto';
  const edita = abierto && puede('stock', 'crear');
  const conDif = k.items.filter((i) => i.diferencia !== 0);
  // Al elegir un producto ya contado, se suma 1 (cómodo para escanear de a una prenda).
  const elegido = (v: VarianteBuscada) => {
    const ya = k.items.find((i) => i.varianteId === v.varianteId);
    if (ya) cargar.mutate([{ varianteId: v.varianteId, contado: ya.contado + 1 }]);
    else { setPendiente(v); setCant('1'); }
  };

  return (
    <>
      <Link to="/conteos" className="mb-3 inline-flex items-center gap-1 text-sm text-carbon/60 hover:text-carbon"><ArrowLeft className="h-4 w-4" />Conteos</Link>
      <Encabezado titulo={`Conteo C-${k.numero}`} sub={`${k.categoria ?? 'Todo el local'} · ${ESTADO[k.estado]} · ${fechaHora(k.fecha)}`}>
        {abierto && puede('stock', 'anular') && <button className="btn-secundario" onClick={() => setConfirmar('descartar')}>Descartar</button>}
        {abierto && puede('stock', 'aprobar') && <button className="btn-primario" disabled={!k.items.length} onClick={() => setConfirmar('aplicar')}>Aplicar conteo</button>}
      </Encabezado>
      {edita && (
        <div className="tarjeta mb-4 p-4">
          <Campo etiqueta="Agregar producto contado" ayuda="Con lector de código de barras: cada lectura suma una unidad.">
            <BuscadorVariante autoFocus mantenerFoco categoriaId={k.categoriaId} onElegir={elegido} />
          </Campo>
          {pendiente && (
            <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); cargar.mutate([{ varianteId: pendiente.varianteId, contado: Number(cant) }]); }}>
              <div className="min-w-0 flex-1 text-sm"><b>{pendiente.sku}</b> <span className="text-carbon/60">{pendiente.modelo}</span></div>
              <input className="entrada w-24" type="number" min={0} inputMode="numeric" autoFocus value={cant} onChange={(e) => setCant(e.target.value)} />
              <button className="btn-primario" disabled={cant === '' || cargar.isPending}>Cargar</button>
            </form>
          )}
        </div>
      )}
      {!abierto ? null : conDif.length > 0 && <div className="mb-3"><Aviso tono="atencion">{conDif.length} productos con diferencia. Al aplicar se ajusta el stock a lo contado.</Aviso></div>}
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead><tr><th>Código</th><th className="hidden sm:table-cell">Producto</th><th className="num">Sistema</th><th className="num">Contado</th><th className="num">Dif.</th>{edita && <th />}</tr></thead>
          <tbody>
            {k.items.map((i) => (
              <tr key={i.id}>
                <td className="font-medium">{i.sku}<div className="text-xs font-normal text-carbon/50 sm:hidden">{i.modelo}</div></td>
                <td className="hidden sm:table-cell">{[i.modelo, i.color, i.talle && `talle ${i.talle}`].filter(Boolean).join(' · ')}</td>
                <td className="num text-carbon/60">{i.sistema}</td>
                <td className="num">{edita ? <input className="entrada w-20 py-1 text-right" type="number" min={0} defaultValue={i.contado} onBlur={(e) => Number(e.target.value) !== i.contado && e.target.value !== '' && cargar.mutate([{ varianteId: i.varianteId, contado: Number(e.target.value) }])} /> : i.contado}</td>
                <td className={`num font-medium ${i.diferencia < 0 ? 'text-bordo' : i.diferencia > 0 ? 'text-conac' : 'text-carbon/35'}`}>{i.diferencia > 0 ? `+${i.diferencia}` : i.diferencia}</td>
                {edita && <td className="text-right"><button className="p-1 text-carbon/40 hover:text-bordo" aria-label="Quitar" onClick={() => cargar.mutate([{ varianteId: i.varianteId, contado: null }])}><Trash2 className="h-4 w-4" /></button></td>}
              </tr>
            ))}
            {!k.items.length && <tr><td colSpan={6} className="py-8 text-center text-carbon/50">Todavía no se cargó nada.</td></tr>}
          </tbody>
        </table>
      </div>
      {abierto && k.sinContar.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-carbon/70">{k.sinContar.length} productos con stock en el sistema que todavía no se contaron (no se tocan al aplicar)</summary>
          <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{k.sinContar.map((s) => <div key={s.varianteId} className="text-xs"><b>{s.sku}</b> {s.modelo} · {s.stock}</div>)}</div>
        </details>
      )}
      {confirmar && (
        <Confirmar titulo={confirmar === 'aplicar' ? 'Aplicar conteo' : 'Descartar conteo'} textoBoton={confirmar === 'aplicar' ? 'Aplicar' : 'Descartar'} peligro={confirmar === 'descartar'} ocupado={accion.isPending} onCerrar={() => setConfirmar(null)} onConfirmar={() => accion.mutate(confirmar)}>
          {confirmar === 'aplicar' ? <p>Se ajusta el stock de <b>{conDif.length}</b> productos a lo contado. Cada ajuste queda como movimiento "Conteo físico" con lo que había y lo que se contó. Los productos no contados no se tocan.</p> : <p>Se descarta sin tocar el stock.</p>}
        </Confirmar>
      )}
    </>
  );
}
