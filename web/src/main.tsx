import { PaginaParaPedir } from './paginas/ParaPedir';
import { PaginaReposicion } from './paginas/Reposicion';
import { PaginaReponerMateriales } from './paginas/ReponerMateriales';
import { PaginaProduccion } from './paginas/Produccion';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import './estilos.css';
import { api } from './api';
import type { Usuario } from './tipos';
import { ProveedorSesion, crearPuede } from './sesion';
import { Cargando, Toasts } from './componentes/ui';
import { Marco } from './componentes/Marco';
import { PaginaIngreso, PaginaPrimerUso, CambioObligatorio } from './paginas/Ingreso';
import { PaginaInicio } from './paginas/Inicio';
import { PaginaCatalogo } from './paginas/Catalogo';
import { PaginaModelo } from './paginas/Modelo';
import { PaginaModeloNuevo } from './paginas/ModeloNuevo';
import { PaginaPrecios } from './paginas/Precios';
import { PaginaImportar } from './paginas/Importar';
import { PaginaImportarCompras } from './paginas/ImportarCompras';
import { PaginaProveedores } from './paginas/Proveedores';
import { PaginaUsuarios } from './paginas/Usuarios';
import { PaginaConfiguracion } from './paginas/Configuracion';
import { PaginaAuditoria } from './paginas/Auditoria';
import { PaginaBackups } from './paginas/Backups';
import { PaginaMiCuenta } from './paginas/MiCuenta';
import { PaginaTablas } from './paginas/Tablas';
import { PaginaStock } from './paginas/Stock';
import { PaginaMovimientos } from './paginas/Movimientos';
import { PaginaConteo, PaginaConteos } from './paginas/Conteos';
import { PaginaStockInicial } from './paginas/StockInicial';
import { PaginaCompra, PaginaCompraForm, PaginaCompras } from './paginas/Compras';
import { PaginaVenta, PaginaVentaEditar, PaginaVentaNueva, PaginaVentas } from './paginas/Ventas';
import { PaginaClientes } from './paginas/Clientes';
import { PaginaFacturar } from './paginas/Facturar';
import { PaginaCaja } from './paginas/Caja';
import { PaginaReportes } from './paginas/Reportes';
import { PaginaMateriales } from './paginas/Materiales';
import { PaginaCosteo } from './paginas/Costeo';
import { PaginaPreciosSugeridos } from './paginas/PreciosSugeridos';
import { PaginaGastos } from './paginas/Gastos';
import { PaginaGastosPersonales } from './paginas/GastosPersonales';
import { PaginaPagos } from './paginas/Pagos';
import { PaginaCuentasFormas } from './paginas/CuentasFormas';

const cliente = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false } } });

/** Caja es la pantalla de inicio: los enlaces viejos a /caja llevan ahí, con sus filtros. */
function IrACaja() {
  const loc = useLocation();
  return <Navigate to={{ pathname: '/', search: loc.search }} replace />;
}

function App() {
  const qc = useQueryClient();
  const estado = useQuery({ queryKey: ['estado'], queryFn: () => api.get<{ configurado: boolean }>('/estado') });
  const yo = useQuery({ queryKey: ['yo'], queryFn: () => api.get<Usuario>('/yo').catch(() => null), enabled: !!estado.data?.configurado });
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get<Record<string, any>>('/config'), enabled: !!yo.data });
  const [, refrescar] = useState(0);

  useEffect(() => {
    const f = () => { qc.setQueryData(['yo'], null); refrescar((n) => n + 1); };
    window.addEventListener('sesion-vencida', f);
    return () => window.removeEventListener('sesion-vencida', f);
  }, [qc]);

  if (estado.isLoading || (estado.data?.configurado && yo.isLoading)) return <Cargando />;
  if (estado.isError) return <div className="p-8 text-center">No hay conexión con el sistema.</div>;
  if (!estado.data?.configurado) return <PaginaPrimerUso />;
  if (!yo.data) return <PaginaIngreso />;
  if (yo.data.debeCambiarPassword) return <CambioObligatorio />;

  const usuario = yo.data;
  const puede = crearPuede(usuario);
  const salir = async () => { await api.post('/logout').catch(() => {}); qc.clear(); qc.setQueryData(['estado'], { configurado: true }); qc.setQueryData(['yo'], null); };

  return (
    <ProveedorSesion valor={{ usuario, puede, salir, cotizUsd: config.data?.cotizaciones?.usdCentavos ?? null }}>
      <Marco>
        <Routes>
          <Route path="/" element={puede('caja') ? <PaginaCaja /> : <PaginaInicio />} />
          <Route path="/resumen" element={<PaginaInicio />} />
          {puede('catalogo') && <Route path="/catalogo" element={<PaginaCatalogo />} />}
          {puede('catalogo', 'crear') && <Route path="/catalogo/nuevo" element={<PaginaModeloNuevo />} />}
          {puede('catalogo') && <Route path="/catalogo/:id" element={<PaginaModelo />} />}
          {puede('catalogo') && <Route path="/tablas" element={<PaginaTablas />} />}
          {puede('precios') && <Route path="/precios" element={<PaginaPrecios />} />}
          {puede('importacion', 'crear') && <Route path="/importar" element={<PaginaImportar />} />}
          {puede('importacion', 'crear') && puede('compras', 'crear') && <Route path="/importar-compras" element={<PaginaImportarCompras />} />}
          {puede('proveedores') && <Route path="/proveedores" element={<PaginaProveedores />} />}
          {puede('stock') && <Route path="/stock" element={<PaginaStock />} />}
          {puede('stock') && <Route path="/stock/movimientos" element={<PaginaMovimientos />} />}
          {puede('stock', 'aprobar') && <Route path="/stock/inicial" element={<PaginaStockInicial />} />}
          {puede('stock') && <Route path="/conteos" element={<PaginaConteos />} />}
          {puede('stock') && <Route path="/conteos/:id" element={<PaginaConteo />} />}
          {puede('compras') && <Route path="/compras" element={<PaginaCompras />} />}
          {puede('compras') && <Route path="/reposicion" element={<PaginaReposicion />} />}
          {puede('compras') && <Route path="/para-pedir" element={<PaginaParaPedir />} />}
          {puede('compras') && <Route path="/reponer-materiales" element={<PaginaReponerMateriales />} />}
          {puede('compras', 'crear') && <Route path="/compras/nuevo" element={<PaginaCompraForm />} />}
          {puede('compras') && <Route path="/compras/:id" element={<PaginaCompra />} />}
          {puede('compras', 'modificar') && <Route path="/compras/:id/editar" element={<PaginaCompraForm />} />}
          {puede('ventas', 'crear') && <Route path="/facturar" element={<PaginaFacturar />} />}
          {puede('ventas') && <Route path="/ventas" element={<PaginaVentas />} />}
          {puede('ventas', 'crear') && <Route path="/ventas/nueva" element={<PaginaVentaNueva />} />}
          {puede('ventas') && <Route path="/ventas/:id" element={<PaginaVenta />} />}
          {puede('ventas', 'modificar') && <Route path="/ventas/:id/editar" element={<PaginaVentaEditar />} />}
          {puede('ventas') && <Route path="/clientes" element={<PaginaClientes />} />}
          {puede('caja') && <Route path="/caja" element={<IrACaja />} />}
          {puede('caja') && <Route path="/pagos" element={<PaginaPagos />} />}
          {puede('caja') && <Route path="/cuentas" element={<PaginaCuentasFormas />} />}
          {puede('gastos') && <Route path="/gastos" element={<PaginaGastos />} />}
          {puede('caja') && <Route path="/gastos-personales" element={<PaginaGastosPersonales />} />}
          {puede('panel') && <Route path="/reportes" element={<PaginaReportes />} />}
          {puede('materiales') && <Route path="/materiales" element={<PaginaMateriales />} />}
          {puede('materiales') && <Route path="/produccion" element={<PaginaProduccion />} />}
          {puede('costos') && <Route path="/costeo" element={<PaginaCosteo />} />}
          {puede('precios') && puede('costos') && <Route path="/precios/sugeridos" element={<PaginaPreciosSugeridos />} />}
          {puede('usuarios') && <Route path="/usuarios" element={<PaginaUsuarios />} />}
          {puede('configuracion') && <Route path="/configuracion" element={<PaginaConfiguracion />} />}
          {puede('auditoria') && <Route path="/auditoria" element={<PaginaAuditoria />} />}
          {puede('backups') && <Route path="/backups" element={<PaginaBackups />} />}
          <Route path="/mi-cuenta" element={<PaginaMiCuenta />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Marco>
    </ProveedorSesion>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={cliente}>
      <BrowserRouter>
        <App />
        <Toasts />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
