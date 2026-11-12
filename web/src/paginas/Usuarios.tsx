import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus } from 'lucide-react';
import { api } from '../api';
import { useSesion } from '../sesion';
import type { Permisos } from '../tipos';
import { Aviso, Campo, Cargando, Encabezado, Estado, Modal, avisar, avisarError } from '../componentes/ui';
import { fechaHora } from '../formato';

interface UsuarioFila { id: number; usuario: string; nombre: string; rolId: number; rol?: string; activo: boolean; ultimoLogin: string | null; debeCambiarPassword: boolean }
interface Rol { id: number; nombre: string; descripcion: string; permisos: Permisos; esSistema: boolean }
const NOMBRES_MODULO: Record<string, string> = { panel: 'Panel', catalogo: 'Catálogo', costos: 'Costos', precios: 'Precios', proveedores: 'Proveedores', importacion: 'Importación', usuarios: 'Usuarios', configuracion: 'Configuración', auditoria: 'Auditoría', backups: 'Copias de seguridad' };

export function PaginaUsuarios() {
  const { puede, usuario: yo } = useSesion();
  const qc = useQueryClient();
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: () => api.get<UsuarioFila[]>('/usuarios') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Rol[]>('/roles') });
  const catalogo = useQuery({ queryKey: ['permisos-catalogo'], queryFn: () => api.get<{ modulos: Record<string, string>; acciones: string[] }>('/permisos/catalogo') });
  const [tab, setTab] = useState<'usuarios' | 'roles'>('usuarios');
  const [editU, setEditU] = useState<Partial<UsuarioFila> & { password?: string } | null>(null);
  const [resetU, setResetU] = useState<UsuarioFila | null>(null);
  const [editR, setEditR] = useState<Partial<Rol> | null>(null);
  const inv = () => { qc.invalidateQueries({ queryKey: ['usuarios'] }); qc.invalidateQueries({ queryKey: ['roles'] }); };

  const guardarU = useMutation({
    mutationFn: (u: NonNullable<typeof editU>) => u.id ? api.put(`/usuarios/${u.id}`, { nombre: u.nombre, rolId: u.rolId, activo: u.activo }) : api.post('/usuarios', { usuario: u.usuario, nombre: u.nombre, rolId: u.rolId, password: u.password }),
    onSuccess: (_r, u) => { avisar(u.id ? 'Usuario guardado' : 'Usuario creado. Va a tener que cambiar la contraseña al entrar.'); setEditU(null); inv(); },
    onError: avisarError,
  });
  const reset = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) => api.post(`/usuarios/${id}/password`, { password }),
    onSuccess: () => { avisar('Contraseña provisoria asignada'); setResetU(null); },
    onError: avisarError,
  });
  const guardarR = useMutation({
    mutationFn: (r: Partial<Rol>) => r.id ? api.put(`/roles/${r.id}`, { nombre: r.nombre, descripcion: r.descripcion, permisos: r.permisos }) : api.post('/roles', { nombre: r.nombre, descripcion: r.descripcion, permisos: r.permisos }),
    onSuccess: () => { avisar('Rol guardado'); setEditR(null); inv(); },
    onError: avisarError,
  });

  if (usuarios.isLoading || roles.isLoading) return <Cargando />;
  const nombreRol = (id: number) => roles.data?.find((r) => r.id === id)?.nombre ?? '—';

  return (
    <>
      <Encabezado titulo="Usuarios y roles">
        {tab === 'usuarios' && puede('usuarios', 'crear') && <button className="btn-primario" onClick={() => setEditU({ activo: true, rolId: roles.data?.find((r) => r.nombre === 'Ventas')?.id })}><Plus className="h-4 w-4" />Nuevo usuario</button>}
        {tab === 'roles' && puede('usuarios', 'crear') && <button className="btn-primario" onClick={() => setEditR({ nombre: '', descripcion: '', permisos: {} })}><Plus className="h-4 w-4" />Nuevo rol</button>}
      </Encabezado>
      <div className="mb-4 inline-flex rounded-md border border-arena p-0.5 text-sm">
        {(['usuarios', 'roles'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded px-3 py-1 ${tab === t ? 'bg-carbon text-marfil' : ''}`}>{t === 'usuarios' ? 'Usuarios' : 'Roles y permisos'}</button>)}
      </div>

      {tab === 'usuarios' ? (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th className="hidden sm:table-cell">Último ingreso</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {usuarios.data!.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium">{u.nombre}{u.id === yo.id && <span className="ml-1 text-xs text-carbon/50">(vos)</span>}</td>
                  <td>{u.usuario}</td><td>{nombreRol(u.rolId)}</td>
                  <td className="hidden sm:table-cell">{u.ultimoLogin ? fechaHora(u.ultimoLogin) : 'Nunca'}</td>
                  <td><Estado activo={u.activo} /></td>
                  <td className="whitespace-nowrap text-right">
                    {puede('usuarios', 'modificar') && <>
                      <button className="btn-secundario btn-chico" onClick={() => setEditU(u)}>Editar</button>
                      {u.id !== yo.id && <button className="btn-secundario btn-chico ml-1" onClick={() => setResetU(u)}>Contraseña</button>}
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {roles.data!.map((r) => (
            <div key={r.id} className="tarjeta p-4">
              <div className="flex items-start justify-between gap-2">
                <div><h3 className="font-bold">{r.nombre} {r.esSistema && <Lock className="inline h-3.5 w-3.5 text-dorado" />}</h3><p className="text-sm text-carbon/60">{r.descripcion}</p></div>
                {puede('usuarios', 'modificar') && <button className="btn-secundario btn-chico" onClick={() => setEditR(r)}>{r.esSistema ? 'Ver' : 'Editar'}</button>}
              </div>
              <div className="mt-2 text-xs text-carbon/60">{Object.entries(r.permisos).filter(([, a]) => a.includes('ver')).map(([m]) => NOMBRES_MODULO[m] ?? m).join(' · ') || 'Sin acceso'}</div>
              <div className="mt-1 text-xs text-carbon/40">{usuarios.data!.filter((u) => u.rolId === r.id).length} usuarios</div>
            </div>
          ))}
        </div>
      )}

      {editU && (
        <Modal titulo={editU.id ? `Editar ${editU.usuario}` : 'Nuevo usuario'} onCerrar={() => setEditU(null)}>
          <form onSubmit={(e) => { e.preventDefault(); guardarU.mutate(editU); }} className="space-y-4">
            <Campo etiqueta="Nombre"><input className="entrada" value={editU.nombre ?? ''} onChange={(e) => setEditU({ ...editU, nombre: e.target.value })} required /></Campo>
            {!editU.id && <>
              <Campo etiqueta="Usuario" ayuda="Sin espacios"><input className="entrada" autoCapitalize="none" value={editU.usuario ?? ''} onChange={(e) => setEditU({ ...editU, usuario: e.target.value })} required /></Campo>
              <Campo etiqueta="Contraseña provisoria" ayuda="Mínimo 8 caracteres. Se le pide cambiarla al entrar."><input className="entrada" value={editU.password ?? ''} onChange={(e) => setEditU({ ...editU, password: e.target.value })} required /></Campo>
            </>}
            <Campo etiqueta="Rol"><select className="entrada" value={editU.rolId} onChange={(e) => setEditU({ ...editU, rolId: Number(e.target.value) })}>{roles.data!.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></Campo>
            {editU.id && editU.id !== yo.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!editU.activo} onChange={(e) => setEditU({ ...editU, activo: e.target.checked })} />Activo (si lo desactivás, no puede entrar más)</label>}
            <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={() => setEditU(null)}>Cancelar</button><button className="btn-primario" disabled={guardarU.isPending}>Guardar</button></div>
          </form>
        </Modal>
      )}
      {resetU && <ModalReset u={resetU} ocupado={reset.isPending} onCerrar={() => setResetU(null)} onGuardar={(password) => reset.mutate({ id: resetU.id, password })} />}
      {editR && catalogo.data && (
        <Modal titulo={editR.id ? editR.nombre! : 'Nuevo rol'} onCerrar={() => setEditR(null)} ancho="max-w-3xl">
          {editR.esSistema && <div className="mb-4"><Aviso>El rol Administrador tiene todos los permisos y no se puede modificar, para que nunca quede el sistema sin nadie que lo administre.</Aviso></div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Nombre"><input className="entrada" value={editR.nombre} disabled={editR.esSistema} onChange={(e) => setEditR({ ...editR, nombre: e.target.value })} /></Campo>
            <Campo etiqueta="Descripción"><input className="entrada" value={editR.descripcion} disabled={editR.esSistema} onChange={(e) => setEditR({ ...editR, descripcion: e.target.value })} /></Campo>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>Módulo</th>{catalogo.data.acciones.map((a) => <th key={a} className="text-center">{a}</th>)}</tr></thead>
              <tbody>
                {Object.entries(catalogo.data.modulos).map(([m, nombreM]) => (
                  <tr key={m}>
                    <td>{nombreM}</td>
                    {catalogo.data.acciones.map((a) => {
                      const tiene = (editR.permisos?.[m] ?? []).includes(a as never);
                      return (
                        <td key={a} className="text-center">
                          <input type="checkbox" checked={tiene} disabled={editR.esSistema} onChange={() => {
                            const actual = new Set(editR.permisos?.[m] ?? []);
                            if (tiene) { actual.delete(a as never); if (a === 'ver') actual.clear(); } else { actual.add(a as never); actual.add('ver'); }
                            setEditR({ ...editR, permisos: { ...editR.permisos, [m]: [...actual] } });
                          }} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-carbon/50">Sin "ver" en Costos, el rol no ve costos ni márgenes en ninguna pantalla ni exportación.</p>
          {!editR.esSistema && <div className="mt-4 flex justify-end gap-2"><button className="btn-secundario" onClick={() => setEditR(null)}>Cancelar</button><button className="btn-primario" disabled={guardarR.isPending || !editR.nombre} onClick={() => guardarR.mutate(editR)}>Guardar</button></div>}
        </Modal>
      )}
    </>
  );
}

function ModalReset({ u, ocupado, onCerrar, onGuardar }: { u: UsuarioFila; ocupado: boolean; onCerrar: () => void; onGuardar: (p: string) => void }) {
  const [p, setP] = useState('');
  return (
    <Modal titulo={`Contraseña de ${u.nombre}`} onCerrar={onCerrar}>
      <p className="mb-4 text-sm text-carbon/70">Le asignás una contraseña provisoria. Se cierran sus sesiones abiertas y al entrar tiene que elegir una nueva.</p>
      <Campo etiqueta="Contraseña provisoria"><input className="entrada" value={p} onChange={(e) => setP(e.target.value)} /></Campo>
      <div className="mt-4 flex justify-end gap-2"><button className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={ocupado || p.length < 8} onClick={() => onGuardar(p)}>Asignar</button></div>
    </Modal>
  );
}
