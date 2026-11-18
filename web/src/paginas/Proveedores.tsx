import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { Importe } from '../componentes/Importe';
import { SelectorColor } from '../componentes/SelectorColor';
import { useMateriales } from '../costos';
import { fecha as fmtFecha, pct, pesos } from '../formato';
import { api } from '../api';
import { useSesion } from '../sesion';
import { Campo, Cargando, Encabezado, ErrorCarga, Estado, Modal, Pendiente, Vacio, avisar, avisarError } from '../componentes/ui';
import { Th, coincide, useOrden } from '../componentes/Orden';

export const ROLES_PROVEEDOR = { taller: 'Taller (fabrica para nosotros)', materiales: 'Materiales y materia prima', producto_terminado: 'Producto terminado', servicios: 'Servicios', otro: 'Otro' } as const;
export const CONDICIONES_PAGO = { al_pedir: 'Se paga al pedir', al_recibir: 'Se paga al recibir', a_plazo: 'A plazo (días)', cuenta_corriente: 'Cuenta corriente' } as const;
type Rol = keyof typeof ROLES_PROVEEDOR;
type Condicion = keyof typeof CONDICIONES_PAGO;
const ROL_CORTO: Record<Rol, string> = { taller: 'Taller', materiales: 'Materiales', producto_terminado: 'Prod. terminado', servicios: 'Servicios', otro: 'Otro' };

interface Proveedor {
  id: number; nombre: string; razonSocial: string | null; cuit: string | null; rubro: string | null; contacto: string | null; telefono: string | null;
  email: string | null; direccion: string | null; condiciones: string | null; plazoPagoDias: number | null; notas: string | null;
  rol: Rol | null; condicionPago: Condicion | null;
  estado: 'activo' | 'prospecto'; activo: boolean; esDemo: boolean;
}
const CAMPOS: [keyof Proveedor, string][] = [['razonSocial', 'Razón social'], ['cuit', 'CUIT'], ['rubro', 'Rubro'], ['contacto', 'Contacto'], ['telefono', 'Teléfono / WhatsApp'], ['email', 'Email'], ['direccion', 'Dirección'], ['condiciones', 'Condiciones comerciales']];

export function PaginaProveedores() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const lista = useQuery({ queryKey: ['proveedores'], queryFn: () => api.get<Proveedor[]>('/proveedores') });
  const [editar, setEditar] = useState<Partial<Proveedor> | null>(null);
  const [verInactivos, setVerInactivos] = useState(false);
  const [precios, setPrecios] = useState<Proveedor | null>(null);
  const guardar = useMutation({
    mutationFn: (p: Partial<Proveedor>) => {
      const { id, esDemo: _e, ...resto } = p as Proveedor;
      const cuerpo = Object.fromEntries(Object.entries(resto).filter(([k]) => !['creadoEn', 'actualizadoEn'].includes(k)));
      return id ? api.put(`/proveedores/${id}`, cuerpo) : api.post('/proveedores', cuerpo);
    },
    onSuccess: () => { avisar('Proveedor guardado'); setEditar(null); qc.invalidateQueries({ queryKey: ['proveedores'] }); qc.invalidateQueries({ queryKey: ['aux'] }); },
    onError: avisarError,
  });
  const [q, setQ] = useState('');
  const [rol, setRol] = useState('');
  const visibles = (lista.data ?? []).filter((p) => (verInactivos || p.activo) && coincide(q, p.nombre, p.razonSocial, p.rubro, p.contacto, p.cuit)
    && (!rol || (rol === 'pendiente' ? !p.rol : p.rol === rol)));
  const { filas, orden } = useOrden(visibles, {
    nombre: (p) => p.nombre, rol: (p) => (p.rol ? ROL_CORTO[p.rol] : null), pago: (p) => (p.condicionPago ? textoPago(p) : null), contacto: (p) => p.contacto ?? p.telefono, cuit: (p) => p.cuit,
  }, { col: 'nombre' });

  return (
    <>
      <Encabezado titulo="Proveedores" sub="Proveedores de reventa, materiales y talleres.">
        {puede('proveedores', 'crear') && <button className="btn-primario" onClick={() => setEditar({ estado: 'activo', activo: true })}><Plus className="h-4 w-4" />Nuevo proveedor</button>}
      </Encabezado>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className="entrada max-w-xs" placeholder="Buscar por nombre, rubro, contacto o CUIT" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="entrada w-auto" value={rol} onChange={(e) => setRol(e.target.value)} aria-label="Rol">
          <option value="">Todos los roles</option>{Object.entries(ROLES_PROVEEDOR).map(([k, t]) => <option key={k} value={k}>{t}</option>)}<option value="pendiente">Sin rol cargado</option>
        </select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} />Mostrar inactivos</label>
      </div>
      {lista.isLoading ? <Cargando /> : lista.isError ? <ErrorCarga error={lista.error} /> : !filas.length ? <Vacio>No hay proveedores cargados.</Vacio> : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead><tr><Th col="nombre" orden={orden}>Nombre</Th><Th col="rol" orden={orden} className="hidden sm:table-cell">Rol</Th><Th col="pago" orden={orden} className="hidden sm:table-cell">Pago</Th><Th col="contacto" orden={orden}>Contacto</Th><Th col="cuit" orden={orden} className="hidden md:table-cell">CUIT</Th><th>Estado</th><th /></tr></thead>
            <tbody>
              {filas.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.nombre} {p.estado === 'prospecto' && <span className="pildora bg-dorado/30">Prospecto</span>}</td>
                  <td className="hidden sm:table-cell">{p.rol ? ROL_CORTO[p.rol] : <Pendiente />}{p.rubro && <div className="text-xs text-carbon/50">{p.rubro}</div>}</td>
                  <td className="hidden sm:table-cell">{p.condicionPago ? textoPago(p) : <Pendiente />}</td>
                  <td>{[p.contacto, p.telefono].filter(Boolean).join(' · ') || <Pendiente />}</td>
                  <td className="hidden md:table-cell">{p.cuit ?? <Pendiente />}</td>
                  <td><Estado activo={p.activo} /></td>
                  <td className="whitespace-nowrap text-right">
                    {puede('compras') && <Link className="btn-secundario btn-chico mr-1" to={`/compras?proveedor=${p.id}&estado=todos`}>Compras</Link>}
                    {puede('costos') && <button className="btn-secundario btn-chico mr-1" onClick={() => setPrecios(p)}>Precios</button>}
                    {puede('proveedores', 'modificar') && <button className="btn-secundario btn-chico" onClick={() => setEditar(p)}>Editar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {precios && <ModalPrecios proveedor={precios} onCerrar={() => setPrecios(null)} />}
      {editar && (
        <Modal titulo={editar.id ? editar.nombre! : 'Nuevo proveedor'} onCerrar={() => setEditar(null)} ancho="max-w-2xl">
          <form onSubmit={(e) => { e.preventDefault(); guardar.mutate(editar); }} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Nombre *" className="sm:col-span-2"><input className="entrada" value={editar.nombre ?? ''} onChange={(e) => setEditar({ ...editar, nombre: e.target.value })} required /></Campo>
              {CAMPOS.map(([k, t]) => <Campo key={k} etiqueta={t}><input className="entrada" value={(editar[k] as string) ?? ''} onChange={(e) => setEditar({ ...editar, [k]: e.target.value || null })} /></Campo>)}
              <Campo etiqueta="Qué nos provee" ayuda="Taller: fabrica con nuestros materiales. Producto terminado: no lleva receta.">
                <select className="entrada" value={editar.rol ?? ''} onChange={(e) => setEditar({ ...editar, rol: (e.target.value || null) as Rol | null })}><option value="">Sin definir</option>{Object.entries(ROLES_PROVEEDOR).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
              </Campo>
              <Campo etiqueta="Condición de pago">
                <select className="entrada" value={editar.condicionPago ?? ''} onChange={(e) => setEditar({ ...editar, condicionPago: (e.target.value || null) as Condicion | null })}><option value="">Sin definir</option>{Object.entries(CONDICIONES_PAGO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
              </Campo>
              <Campo etiqueta={editar.condicionPago === 'a_plazo' ? 'Plazo de pago (días) *' : 'Plazo de pago (días)'} ayuda="Si el plazo es variable (ej. 15 a 30), poné el máximo y aclaralo en condiciones."><input className="entrada" type="number" min={0} value={editar.plazoPagoDias ?? ''} onChange={(e) => setEditar({ ...editar, plazoPagoDias: e.target.value === '' ? null : Number(e.target.value) })} /></Campo>
              <Campo etiqueta="Estado">
                <select className="entrada" value={editar.estado} onChange={(e) => setEditar({ ...editar, estado: e.target.value as Proveedor['estado'] })}><option value="activo">Proveedor actual</option><option value="prospecto">Prospecto (todavía no le compramos)</option></select>
              </Campo>
              <Campo etiqueta="Notas" className="sm:col-span-2"><textarea className="entrada" rows={2} value={editar.notas ?? ''} onChange={(e) => setEditar({ ...editar, notas: e.target.value || null })} /></Campo>
              {editar.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!editar.activo} onChange={(e) => setEditar({ ...editar, activo: e.target.checked })} />Activo</label>}
            </div>
            <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={() => setEditar(null)}>Cancelar</button><button className="btn-primario" disabled={guardar.isPending}>Guardar</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

function textoPago(p: Pick<Proveedor, 'condicionPago' | 'plazoPagoDias'>) {
  if (p.condicionPago === 'a_plazo') return p.plazoPagoDias ? `A ${p.plazoPagoDias} días` : 'A plazo';
  return p.condicionPago ? { al_pedir: 'Al pedir', al_recibir: 'Al recibir', cuenta_corriente: 'Cta. corriente' }[p.condicionPago] : '';
}

interface GrupoPrecio {
  clave: string; materialId: number | null; colorId: number | null; varianteId: number | null; nombre: string; detalle: string | null; unidad: string | null;
  habitualCentavos: number | null; habitualFecha: string | null; ultimoCentavos: number; ultimaFecha: string; variacionBp: number | null;
  cambios: { id: number; fecha: string; origen: 'compra' | 'habitual'; precioCentavos: number; compraNumero: number | null; motivo: string | null; variacionBp: number | null }[];
}

/**
 * Precios del proveedor: el habitual (el que se usa para estimar pedidos; cambia solo cuando lo decidís)
 * y el historial de lo que se acordó en cada pedido, con fecha y aumento.
 */
function ModalPrecios({ proveedor, onCerrar }: { proveedor: Proveedor; onCerrar: () => void }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const h = useQuery({ queryKey: ['precios-proveedor', proveedor.id], queryFn: () => api.get<GrupoPrecio[]>(`/proveedores/${proveedor.id}/precios`) });
  const mats = useMateriales();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [editar, setEditar] = useState<{ materialId: number | null; colorId: number | null; varianteId: number | null; precio: number | null; motivo: string; nombre?: string } | null>(null);
  const guardar = useMutation({
    mutationFn: () => api.post(`/proveedores/${proveedor.id}/precios`, { materialId: editar!.materialId, colorId: editar!.colorId, varianteId: editar!.varianteId, precioCentavos: editar!.precio, motivo: editar!.motivo || null }),
    onSuccess: () => { avisar('Precio habitual guardado'); setEditar(null); qc.invalidateQueries({ queryKey: ['precios-proveedor', proveedor.id] }); }, onError: avisarError,
  });
  const material = mats.data?.find((m) => m.id === editar?.materialId);
  return (
    <Modal titulo={`Precios de ${proveedor.nombre}`} onCerrar={onCerrar} ancho="max-w-4xl">
      <p className="mb-3 text-sm text-carbon/65">El <b>precio habitual</b> se usa para estimar los pedidos nuevos y solo cambia cuando lo decidís. Lo acordado en cada pedido queda guardado solo, con su fecha.</p>
      {puede('proveedores', 'modificar') && !editar && <button className="btn-secundario btn-chico mb-3" onClick={() => setEditar({ materialId: null, colorId: null, varianteId: null, precio: null, motivo: '' })}><Plus className="h-3.5 w-3.5" />Cargar precio habitual de un material</button>}
      {editar && (
        <div className="tarjeta mb-4 grid gap-3 bg-crema p-4 sm:grid-cols-[minmax(0,1fr)_10rem_10rem]">
          {editar.nombre ? <div className="self-center font-medium">{editar.nombre}</div> : (
            <div className="grid gap-2 sm:grid-cols-2">
              <select className="entrada" value={editar.materialId ?? ''} onChange={(e) => setEditar({ ...editar, materialId: e.target.value ? Number(e.target.value) : null, colorId: null })} aria-label="Material">
                <option value="">Elegí el material…</option>{mats.data?.filter((m) => m.activo && m.tipo === 'material').map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
              {material?.porColor && <SelectorColor valor={editar.colorId} onCambio={(c) => setEditar({ ...editar, colorId: c })} />}
            </div>
          )}
          <Importe valor={editar.precio} onCambio={(c) => setEditar({ ...editar, precio: c })} placeholder="Precio" />
          <input className="entrada" placeholder="Motivo (opcional)" value={editar.motivo} onChange={(e) => setEditar({ ...editar, motivo: e.target.value })} />
          <div className="flex justify-end gap-2 sm:col-span-3"><button className="btn-secundario btn-chico" onClick={() => setEditar(null)}>Cancelar</button><button className="btn-primario btn-chico" disabled={editar.precio == null || (!editar.materialId && !editar.varianteId) || guardar.isPending} onClick={() => guardar.mutate()}>Guardar precio habitual</button></div>
        </div>
      )}
      {h.isLoading ? <Cargando /> : h.isError ? <ErrorCarga error={h.error} /> : !h.data!.length ? <Vacio>Todavía no hay precios de este proveedor. Se van guardando solos al confirmar pedidos.</Vacio> : (
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead><tr><th>Material o producto</th><th className="num">Habitual</th><th className="num">Último</th><th className="num">Cambio</th><th>Fecha</th><th /></tr></thead>
            <tbody>
              {h.data!.map((g) => (
                <Fragment key={g.clave}>
                  <tr className="cursor-pointer" onClick={() => setAbierto(abierto === g.clave ? null : g.clave)}>
                    <td>{abierto === g.clave ? <ChevronDown className="mr-1 inline h-3.5 w-3.5" /> : <ChevronRight className="mr-1 inline h-3.5 w-3.5" />}<b>{g.nombre}</b>{g.detalle && <span className="text-carbon/55"> · {g.detalle}</span>}{g.unidad && <span className="text-xs text-carbon/45"> (por {g.unidad})</span>}</td>
                    <td className="num">{g.habitualCentavos == null ? <span className="text-carbon/40">—</span> : pesos(g.habitualCentavos)}</td>
                    <td className="num font-medium">{pesos(g.ultimoCentavos)}</td>
                    <td className={`num ${(g.variacionBp ?? 0) > 0 ? 'text-bordo' : 'text-carbon/50'}`}>{g.variacionBp == null ? '—' : `${g.variacionBp > 0 ? '+' : ''}${pct(g.variacionBp)}`}</td>
                    <td className="whitespace-nowrap text-carbon/60">{fmtFecha(g.ultimaFecha + 'T12:00')}</td>
                    <td className="text-right">{puede('proveedores', 'modificar') && <button className="btn-secundario btn-chico" onClick={(e) => { e.stopPropagation(); setEditar({ materialId: g.materialId, colorId: g.colorId, varianteId: g.varianteId, precio: g.ultimoCentavos, motivo: '', nombre: `${g.nombre}${g.detalle ? ' · ' + g.detalle : ''}` }); }}>Fijar habitual</button>}</td>
                  </tr>
                  {abierto === g.clave && g.cambios.map((c) => (
                    <tr key={g.clave + c.id} className="bg-crema/60 text-xs">
                      <td className="pl-9">{c.origen === 'habitual' ? 'Precio habitual' : `Pedido P-${c.compraNumero}`}{c.motivo && <span className="text-carbon/55"> · {c.motivo}</span>}</td>
                      <td /><td className="num">{pesos(c.precioCentavos)}</td>
                      <td className={`num ${(c.variacionBp ?? 0) > 0 ? 'text-bordo' : 'text-carbon/50'}`}>{c.variacionBp == null ? '' : `${c.variacionBp > 0 ? '+' : ''}${pct(c.variacionBp)}`}</td>
                      <td className="whitespace-nowrap text-carbon/60">{fmtFecha(c.fecha + 'T12:00')}</td><td />
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
