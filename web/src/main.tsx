import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
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
import { PaginaProveedores } from './paginas/Proveedores';
import { PaginaUsuarios } from './paginas/Usuarios';
import { PaginaConfiguracion } from './paginas/Configuracion';
import { PaginaAuditoria } from './paginas/Auditoria';
import { PaginaBackups } from './paginas/Backups';
import { PaginaMiCuenta } from './paginas/MiCuenta';
import { PaginaTablas } from './paginas/Tablas';

const cliente = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false } } });

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
          <Route path="/" element={<PaginaInicio />} />
          {puede('catalogo') && <Route path="/catalogo" element={<PaginaCatalogo />} />}
          {puede('catalogo', 'crear') && <Route path="/catalogo/nuevo" element={<PaginaModeloNuevo />} />}
          {puede('catalogo') && <Route path="/catalogo/:id" element={<PaginaModelo />} />}
          {puede('catalogo') && <Route path="/tablas" element={<PaginaTablas />} />}
          {puede('precios') && <Route path="/precios" element={<PaginaPrecios />} />}
          {puede('importacion', 'crear') && <Route path="/importar" element={<PaginaImportar />} />}
          {puede('proveedores') && <Route path="/proveedores" element={<PaginaProveedores />} />}
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
