import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useSesion } from '../sesion';
import type { ModeloResumen } from '../tipos';
import { Aviso, Encabezado } from '../componentes/ui';
import { fechaHora } from '../formato';

export function PaginaInicio() {
  const { usuario, puede, cotizUsd } = useSesion();
  const modelos = useQuery({ queryKey: ['modelos', '', 'activos', ''], queryFn: () => api.get<ModeloResumen[]>('/catalogo/modelos'), enabled: puede('catalogo') });
  const backups = useQuery({ queryKey: ['backups'], queryFn: () => api.get<{ backups: { fecha: string }[] }>('/backups'), enabled: puede('backups') });
  const ms = modelos.data ?? [];
  const variantes = ms.reduce((s, m) => s + m.variantes, 0);
  const sinCosto = ms.reduce((s, m) => s + (m.sinCosto ?? 0), 0);
  const sinPrecio = ms.filter((m) => m.precios.length === 0).length;
  const ultimo = backups.data?.backups[0];
  const hora = new Date().getHours();
  const saludo = hora < 13 ? 'Buen día' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <>
      <Encabezado titulo={`${saludo}, ${usuario.nombre.split(' ')[0]}`} sub="Herencia Cuero · sistema de gestión" />
      <div className="space-y-3">
        {puede('configuracion') && !cotizUsd && <Aviso tono="atencion">La cotización del dólar está <b>pendiente</b>: sin ella no se muestra el "≈ USD" al lado de los precios. <Link className="underline" to="/configuracion">Cargarla</Link></Aviso>}
        {puede('costos') && sinCosto > 0 && <Aviso tono="atencion">Hay <b>{sinCosto}</b> variantes sin costo cargado. <Link className="underline" to="/catalogo?sinCosto=1">Ver cuáles</Link></Aviso>}
        {puede('backups') && backups.data && !ultimo && <Aviso tono="critico">Todavía no hay ninguna copia de seguridad. <Link className="underline" to="/backups">Hacer una ahora</Link></Aviso>}
      </div>
      {puede('catalogo') && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Dato titulo="Productos activos" valor={modelos.isLoading ? '…' : ms.length} a="/catalogo" />
          <Dato titulo="Variantes (color y talle)" valor={modelos.isLoading ? '…' : variantes} a="/catalogo" />
          <Dato titulo="Productos sin precio" valor={modelos.isLoading ? '…' : sinPrecio} a="/catalogo" />
          {puede('backups') && <Dato titulo="Última copia de seguridad" valor={ultimo ? fechaHora(ultimo.fecha) : '—'} a="/backups" chico />}
        </div>
      )}
      <div className="tarjeta mt-8 p-5 text-sm text-carbon/70">
        <div className="etiqueta mb-2">En esta versión</div>
        Catálogo con variantes, costos y listas de precio; cambios de precio con vista previa y aprobación; importación de planillas;
        proveedores; usuarios con roles y permisos; auditoría de cada cambio; configuración y copias de seguridad automáticas.
        <div className="etiqueta mb-2 mt-4">Próximas entregas</div>
        Stock por movimientos y compras · ventas, cobros y caja · costos, producción con Laura y formación de precios · panel, reportes y alertas.
      </div>
    </>
  );
}

function Dato({ titulo, valor, a, chico }: { titulo: string; valor: React.ReactNode; a: string; chico?: boolean }) {
  return (
    <Link to={a} className="tarjeta block p-4 transition-colors hover:border-dorado">
      <div className="etiqueta">{titulo}</div>
      <div className={`mt-2 font-titulo font-bold ${chico ? 'text-base' : 'text-3xl'}`}>{valor}</div>
    </Link>
  );
}
