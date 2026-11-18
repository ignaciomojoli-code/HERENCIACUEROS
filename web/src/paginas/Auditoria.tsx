import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../api';
import { Campo, Cargando, Encabezado, ErrorCarga, Modal } from '../componentes/ui';
import { fechaHora } from '../formato';

interface Fila { id: number; fecha: string; usuario: string | null; accion: string; entidad: string; entidadTexto: string; entidadId: string | null; antes: unknown; despues: unknown; detalle: string | null }
const ACCIONES: Record<string, string> = { crear: 'Creó', reservar: 'Reservó material', liberar: 'Liberó reservas', modificar: 'Modificó', desactivar: 'Desactivó', reactivar: 'Reactivó', login: 'Ingresó', login_fallido: 'Ingreso fallido', logout: 'Salió', exportar: 'Exportó', importar: 'Importó', cambio_masivo_precios: 'Cambio masivo de precios', cambiar_precio: 'Cambió precio', cambiar_password: 'Cambió su contraseña', resetear_password: 'Reseteó contraseña', backup: 'Copia de seguridad', restaurar: 'Restauró copia', duplicar: 'Duplicó',
  anular: 'Anuló', confirmar: 'Confirmó', recibir: 'Recibió', cobro: 'Cobró', aporte: 'Aporte', retiro: 'Retiro', pase: 'Pase', liquidacion: 'Liquidación', arqueo: 'Arqueo',
  saldo_inicial: 'Saldo inicial', adjuntar: 'Adjuntó', quitar_adjunto: 'Quitó adjunto', ajuste_stock: 'Ajustó stock', stock_inicial: 'Stock inicial', ajuste_material: 'Ajustó material',
  conteo_material: 'Contó material', ingreso_material: 'Ingresó material', aplicar: 'Aplicó', aplicar_costos: 'Aplicó costos', aplicar_precios_sugeridos: 'Aplicó precios sugeridos',
};
interface Opciones { usuarios: { id: number; nombre: string }[]; acciones: string[]; modulos: { clave: string; nombre: string }[] }

export function PaginaAuditoria() {
  const [f, setF] = useState({ modulo: '', usuarioId: '', accion: '', desde: '', hasta: '', texto: '' });
  const op = useQuery({ queryKey: ['auditoria-opciones'], queryFn: () => api.get<Opciones>('/auditoria/opciones') });
  const [pagina, setPagina] = useState(1);
  const [detalle, setDetalle] = useState<Fila | null>(null);
  const datos = useQuery({ queryKey: ['auditoria', f, pagina], queryFn: () => api.get<{ total: number; filas: Fila[] }>('/auditoria' + qs({ ...f, pagina })) });
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setPagina(1); };
  const paginas = Math.max(1, Math.ceil((datos.data?.total ?? 0) / 50));
  return (
    <>
      <Encabezado titulo="Auditoría" sub="Cada cambio queda registrado con quién, cuándo, y el antes y después. No se puede borrar." />
      <div className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Campo etiqueta="Módulo"><select className="entrada" value={f.modulo} onChange={(e) => set('modulo', e.target.value)}><option value="">Todos</option>{op.data?.modulos.map((m) => <option key={m.clave} value={m.clave}>{m.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Usuario"><select className="entrada" value={f.usuarioId} onChange={(e) => set('usuarioId', e.target.value)}><option value="">Todos</option>{op.data?.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Acción"><select className="entrada" value={f.accion} onChange={(e) => set('accion', e.target.value)}><option value="">Todas</option>{op.data?.acciones.map((a) => <option key={a} value={a}>{ACCIONES[a] ?? a}</option>)}</select></Campo>
        <Campo etiqueta="Desde"><input className="entrada" type="date" value={f.desde} onChange={(e) => set('desde', e.target.value)} /></Campo>
        <Campo etiqueta="Hasta"><input className="entrada" type="date" value={f.hasta} onChange={(e) => set('hasta', e.target.value)} /></Campo>
        <Campo etiqueta="Texto"><input className="entrada" value={f.texto} onChange={(e) => set('texto', e.target.value)} placeholder="Número, motivo…" /></Campo>
      </div>
      {datos.isLoading ? <Cargando /> : datos.isError ? <ErrorCarga error={datos.error} /> : (
        <>
          <div className="tarjeta overflow-x-auto">
            <table className="tabla">
              <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Sobre</th><th className="hidden md:table-cell">Detalle</th></tr></thead>
              <tbody>
                {datos.data!.filas.map((a) => (
                  <tr key={a.id} className="cursor-pointer" onClick={() => setDetalle(a)}>
                    <td className="whitespace-nowrap">{fechaHora(a.fecha)}</td><td>{a.usuario ?? 'Sistema'}</td>
                    <td className={a.accion === 'login_fallido' ? 'text-bordo' : ''}>{ACCIONES[a.accion] ?? a.accion}</td>
                    <td>{a.entidadTexto}{a.entidadId ? ` #${a.entidadId}` : ''}</td>
                    <td className="hidden max-w-xs truncate text-carbon/60 md:table-cell">{a.detalle ?? ''}</td>
                  </tr>
                ))}
                {!datos.data!.filas.length && <tr><td colSpan={5} className="py-8 text-center text-carbon/50">Sin registros.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-carbon/60">{datos.data!.total} registros</span>
            <div className="flex items-center gap-2">
              <button className="btn-secundario btn-chico" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</button>
              <span>{pagina} / {paginas}</span>
              <button className="btn-secundario btn-chico" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
            </div>
          </div>
        </>
      )}
      {detalle && (
        <Modal titulo={`${ACCIONES[detalle.accion] ?? detalle.accion} · ${detalle.entidadTexto}`} onCerrar={() => setDetalle(null)} ancho="max-w-2xl">
          <div className="space-y-3 text-sm">
            <div>{fechaHora(detalle.fecha)} · {detalle.usuario ?? 'Sistema'}</div>
            {detalle.detalle && <div className="text-carbon/70">{detalle.detalle}</div>}
            <Diferencias antes={detalle.antes} despues={detalle.despues} />
          </div>
        </Modal>
      )}
    </>
  );
}

function Diferencias({ antes, despues }: { antes: unknown; despues: unknown }) {
  const a = (antes ?? {}) as Record<string, unknown>;
  const d = (despues ?? {}) as Record<string, unknown>;
  const claves = [...new Set([...Object.keys(a), ...Object.keys(d)])];
  if (!claves.length) return null;
  const txt = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <table className="tabla">
      <thead><tr><th>Campo</th><th>Antes</th><th>Después</th></tr></thead>
      <tbody>{claves.map((k) => <tr key={k}><td>{k}</td><td className="break-all text-carbon/50">{txt(a[k])}</td><td className="break-all">{txt(d[k])}</td></tr>)}</tbody>
    </table>
  );
}
