import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '../api';
import { useSesion } from '../sesion';
import { Aviso, Campo, Cargando, Encabezado, Modal, avisar, avisarError } from '../componentes/ui';
import { bytes, fechaHora } from '../formato';

interface B { nombre: string; fecha: string; tipo: string; bytes: number }
const TIPOS: Record<string, string> = { auto: 'Automática', manual: 'Manual', 'previo-restauracion': 'Antes de restaurar' };

export function PaginaBackups() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const datos = useQuery({ queryKey: ['backups'], queryFn: () => api.get<{ carpeta: string; backups: B[] }>('/backups') });
  const [restaurar, setRestaurar] = useState<B | null>(null);
  const [texto, setTexto] = useState('');
  const crear = useMutation({ mutationFn: () => api.post<B>('/backups'), onSuccess: (b) => { avisar(`Copia creada: ${b.nombre}`); qc.invalidateQueries({ queryKey: ['backups'] }); }, onError: avisarError });
  const rest = useMutation({
    mutationFn: () => api.post('/backups/restaurar', { nombre: restaurar!.nombre, confirmacion: texto }),
    onSuccess: () => { avisar('Copia restaurada'); setRestaurar(null); qc.invalidateQueries(); },
    onError: avisarError,
  });
  if (datos.isLoading) return <Cargando />;
  return (
    <>
      <Encabezado titulo="Copias de seguridad" sub={<>Se guardan en <code className="text-xs">{datos.data?.carpeta}</code>. La frecuencia y la carpeta se cambian en Configuración.</>}>
        {puede('backups', 'crear') && <button className="btn-primario" disabled={crear.isPending} onClick={() => crear.mutate()}>{crear.isPending ? 'Creando…' : 'Hacer copia ahora'}</button>}
      </Encabezado>
      <div className="tarjeta overflow-x-auto">
        <table className="tabla">
          <thead><tr><th>Fecha</th><th>Tipo</th><th className="num">Tamaño</th><th /></tr></thead>
          <tbody>
            {datos.data!.backups.map((b) => (
              <tr key={b.nombre}>
                <td>{fechaHora(b.fecha)}</td><td>{TIPOS[b.tipo] ?? b.tipo}</td><td className="num">{bytes(b.bytes)}</td>
                <td className="whitespace-nowrap text-right">
                  {puede('backups', 'exportar') && <a className="btn-secundario btn-chico" href={`/api/backups/${encodeURIComponent(b.nombre)}/descargar`}><Download className="h-3.5 w-3.5" />Bajar</a>}
                  {puede('backups', 'aprobar') && <button className="btn-secundario btn-chico ml-1" onClick={() => { setRestaurar(b); setTexto(''); }}>Restaurar</button>}
                </td>
              </tr>
            ))}
            {!datos.data!.backups.length && <tr><td colSpan={4} className="py-8 text-center text-carbon/50">Todavía no hay copias.</td></tr>}
          </tbody>
        </table>
      </div>
      {restaurar && (
        <Modal titulo="Restaurar copia" onCerrar={() => setRestaurar(null)}>
          <div className="space-y-4 text-sm">
            <Aviso tono="critico">Todo el sistema vuelve a como estaba el <b>{fechaHora(restaurar.fecha)}</b>. Lo que se cargó después se pierde de la base activa.</Aviso>
            <p>Antes de restaurar se hace automáticamente una copia del estado actual, así que se puede deshacer.</p>
            <Campo etiqueta='Escribí RESTAURAR para confirmar'><input className="entrada" value={texto} onChange={(e) => setTexto(e.target.value)} /></Campo>
            <div className="flex justify-end gap-2"><button className="btn-secundario" onClick={() => setRestaurar(null)}>Cancelar</button><button className="btn-peligro" disabled={texto !== 'RESTAURAR' || rest.isPending} onClick={() => rest.mutate()}>{rest.isPending ? 'Restaurando…' : 'Restaurar'}</button></div>
          </div>
        </Modal>
      )}
    </>
  );
}
