import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
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
                    {puede('proveedores', 'modificar') && <button className="btn-secundario btn-chico" onClick={() => setEditar(p)}>Editar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
