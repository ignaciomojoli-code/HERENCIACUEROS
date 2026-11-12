import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useSesion } from '../sesion';
import type { ModeloResumen } from '../tipos';
import { Aviso, Encabezado } from '../componentes/ui';
import { fechaHora, pesos } from '../formato';
import { inicioMes, hoy, useCuentas } from '../plata';

export function PaginaInicio() {
  const { usuario, puede, cotizUsd } = useSesion();
  const modelos = useQuery({ queryKey: ['modelos', '', 'activos', ''], queryFn: () => api.get<ModeloResumen[]>('/catalogo/modelos'), enabled: puede('catalogo') });
  const bajoMinimo = useQuery({ queryKey: ['stock', '', 'bajo_minimo', ''], queryFn: () => api.get<{ filas: unknown[] }>('/stock?filtro=bajo_minimo'), enabled: puede('stock') });
  const negativos = useQuery({ queryKey: ['stock', '', 'negativo', ''], queryFn: () => api.get<{ filas: unknown[] }>('/stock?filtro=negativo'), enabled: puede('stock') });
  const stockTotal = useQuery({ queryKey: ['stock', '', 'todos', ''], queryFn: () => api.get<{ totales: { unidades: number } }>('/stock'), enabled: puede('stock') });
  const pedidos = useQuery({ queryKey: ['compras', '', 'confirmada'], queryFn: () => api.get<{ fechaEsperada: string | null; pedidas: number; recibidas: number }[]>('/compras?estado=confirmada'), enabled: puede('compras') });
  const hoyIso = new Date().toLocaleDateString('en-CA');
  const atrasados = (pedidos.data ?? []).filter((p) => p.fechaEsperada && p.fechaEsperada.slice(0, 10) < hoyIso).length;
  const ventasHoy = useQuery({ queryKey: ['ventas', 'hoy'], queryFn: () => api.get<{ resumen: { ventas: number; totalCentavos: number } }>(`/ventas?desde=${hoy()}&hasta=${hoy()}&estado=confirmada`), enabled: puede('ventas') });
  const ventasMes = useQuery({ queryKey: ['ventas', 'mes'], queryFn: () => api.get<{ resumen: { ventas: number; totalCentavos: number; gananciaCentavos?: number } }>(`/ventas?desde=${inicioMes()}&hasta=${hoy()}&estado=confirmada`), enabled: puede('ventas') });
  const cuentas = useCuentas(puede('caja'));
  const plata = (cuentas.data ?? []).filter((c) => c.tipo !== 'externa').reduce((s, c) => s + (c.saldoArsCentavos ?? 0), 0);
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
        {(negativos.data?.filas.length ?? 0) > 0 && <Aviso tono="critico">Hay <b>{negativos.data!.filas.length}</b> productos con stock negativo. <Link className="underline" to="/stock?filtro=negativo">Revisar</Link></Aviso>}
        {(bajoMinimo.data?.filas.length ?? 0) > 0 && <Aviso tono="atencion"><b>{bajoMinimo.data!.filas.length}</b> productos están por debajo del stock mínimo. <Link className="underline" to="/stock?filtro=bajo_minimo">Ver cuáles</Link></Aviso>}
        {atrasados > 0 && <Aviso tono="atencion"><b>{atrasados}</b> pedidos pasaron la fecha de entrega esperada. <Link className="underline" to="/compras?estado=confirmada">Ver pedidos</Link></Aviso>}
        {puede('backups') && backups.data && !ultimo && <Aviso tono="critico">Todavía no hay ninguna copia de seguridad. <Link className="underline" to="/backups">Hacer una ahora</Link></Aviso>}
      </div>
      {(puede('ventas') || puede('caja')) && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {puede('ventas') && <Dato titulo="Ventas de hoy" valor={ventasHoy.data ? pesos(ventasHoy.data.resumen.totalCentavos) : '…'} sub={ventasHoy.data && `${ventasHoy.data.resumen.ventas} ventas`} a={`/ventas?desde=${hoy()}`} />}
          {puede('ventas') && <Dato titulo="Ventas del mes" valor={ventasMes.data ? pesos(ventasMes.data.resumen.totalCentavos) : '…'} sub={ventasMes.data && `${ventasMes.data.resumen.ventas} ventas`} a="/ventas" />}
          {puede('ventas') && puede('costos') && <Dato titulo="Ganancia bruta del mes" valor={ventasMes.data ? pesos(ventasMes.data.resumen.gananciaCentavos) : '…'} sub="Ventas menos costo y comisiones" a="/ventas" />}
          {puede('caja') && <Dato titulo="Plata en cuentas" valor={cuentas.data ? pesos(plata) : '…'} sub="Incluye tarjetas a liquidar" a="/caja" />}
        </div>
      )}
      {puede('catalogo') && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <Dato titulo="Productos activos" valor={modelos.isLoading ? '…' : ms.length} a="/catalogo" />
          <Dato titulo="Variantes (color y talle)" valor={modelos.isLoading ? '…' : variantes} a="/catalogo" />
          {puede('stock') ? <Dato titulo="Unidades en stock" valor={stockTotal.data ? stockTotal.data.totales.unidades.toLocaleString('es-AR') : '…'} a="/stock" /> : <Dato titulo="Productos sin precio" valor={modelos.isLoading ? '…' : sinPrecio} a="/catalogo" />}
          {puede('compras') && <Dato titulo="Pedidos por recibir" valor={pedidos.data ? pedidos.data.length : '…'} a="/compras?estado=confirmada" />}
          {puede('backups') && <Dato titulo="Última copia de seguridad" valor={ultimo ? fechaHora(ultimo.fecha) : '—'} a="/backups" chico />}
        </div>
      )}
      <div className="tarjeta mt-8 p-5 text-sm text-carbon/70">
        <div className="etiqueta mb-2">En esta versión</div>
        Catálogo con variantes, costos y listas de precio; cambios de precio con vista previa y aprobación; importación de planillas;
        stock por movimientos con ajustes, conteos físicos y carga inicial; pedidos a proveedores y al taller con recepciones parciales y costo promedio;
        ventas con cobro en una o varias formas de pago y comisiones; caja por cuenta con pases, liquidaciones de tarjetas, aportes, retiros y arqueos;
        gastos con categorías y subcategorías; pagos y cuenta corriente de proveedores; usuarios con roles y permisos; auditoría de cada cambio; configuración y copias de seguridad automáticas.
        <div className="etiqueta mb-2 mt-4">Próximas entregas</div>
        Costos, producción con Laura y formación de precios · panel, reportes y alertas.
      </div>
    </>
  );
}

function Dato({ titulo, valor, a, chico, sub }: { titulo: string; valor: React.ReactNode; a: string; chico?: boolean; sub?: React.ReactNode }) {
  return (
    <Link to={a} className="tarjeta block p-4 transition-colors hover:border-dorado">
      <div className="etiqueta">{titulo}</div>
      <div className={`mt-2 font-titulo font-bold ${chico ? 'text-base' : 'text-3xl'}`}>{valor}</div>
      {sub && <div className="mt-0.5 text-xs text-carbon/55">{sub}</div>}
    </Link>
  );
}
