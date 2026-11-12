import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Archive, Boxes, ClipboardList, PackageCheck, BookOpen, Database, FileUp, Home, LogOut, Menu, Settings, ShieldCheck, Tag, Tags, Truck, User, Users, X } from 'lucide-react';
import { useSesion } from '../sesion';
import { Logo } from './ui';

type Item = { a: string; texto: string; icono: typeof Home; modulo?: string; accion?: 'crear' };
const SECCIONES: { titulo: string; items: Item[] }[] = [
  { titulo: '', items: [{ a: '/', texto: 'Inicio', icono: Home }] },
  { titulo: 'Productos', items: [
    { a: '/catalogo', texto: 'Catálogo', icono: Tags, modulo: 'catalogo' },
    { a: '/precios', texto: 'Precios', icono: Tag, modulo: 'precios' },
    { a: '/tablas', texto: 'Categorías, colores y talles', icono: BookOpen, modulo: 'catalogo' },
    { a: '/importar', texto: 'Importar planilla', icono: FileUp, modulo: 'importacion', accion: 'crear' },
  ] },
  { titulo: 'Stock', items: [
    { a: '/stock', texto: 'Stock', icono: Boxes, modulo: 'stock' },
    { a: '/conteos', texto: 'Conteos físicos', icono: ClipboardList, modulo: 'stock' },
  ] },
  { titulo: 'Compras', items: [
    { a: '/compras', texto: 'Pedidos y recepciones', icono: PackageCheck, modulo: 'compras' },
    { a: '/proveedores', texto: 'Proveedores', icono: Truck, modulo: 'proveedores' },
  ] },
  { titulo: 'Sistema', items: [
    { a: '/usuarios', texto: 'Usuarios y roles', icono: Users, modulo: 'usuarios' },
    { a: '/configuracion', texto: 'Configuración', icono: Settings, modulo: 'configuracion' },
    { a: '/auditoria', texto: 'Auditoría', icono: ShieldCheck, modulo: 'auditoria' },
    { a: '/backups', texto: 'Copias de seguridad', icono: Database, modulo: 'backups' },
  ] },
];

export function Marco({ children }: { children: ReactNode }) {
  const { usuario, puede, salir } = useSesion();
  const [abierto, setAbierto] = useState(false);
  const loc = useLocation();
  const [ultima, setUltima] = useState(loc.pathname);
  if (ultima !== loc.pathname) { setUltima(loc.pathname); setAbierto(false); }

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="px-6 pb-6 pt-7"><Logo claro chico /></div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3">
        {SECCIONES.map((s) => {
          const items = s.items.filter((i) => !i.modulo || puede(i.modulo, i.accion ?? 'ver'));
          if (!items.length) return null;
          return (
            <div key={s.titulo}>
              {s.titulo && <div className="mb-1 px-3 text-[10px] font-medium uppercase tracking-etiqueta text-dorado/80">{s.titulo}</div>}
              {items.map((i) => (
                <NavLink key={i.a} to={i.a} end={i.a === '/'}
                  className={({ isActive }) => `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${isActive ? 'bg-marfil/10 text-marfil' : 'text-marfil/65 hover:bg-marfil/5 hover:text-marfil'}`}>
                  <i.icono className="h-4 w-4 text-dorado" />{i.texto}
                </NavLink>
              ))}
            </div>
          );
        })}
        <div className="px-3 pt-2 text-[11px] leading-relaxed text-marfil/35">
          Próximas entregas: ventas y caja, costos y producción, panel y reportes.
        </div>
      </div>
      <div className="border-t border-marfil/10 p-3">
        <NavLink to="/mi-cuenta" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-marfil/80 hover:bg-marfil/5">
          <User className="h-4 w-4 text-dorado" />
          <span className="min-w-0 flex-1"><span className="block truncate">{usuario.nombre}</span><span className="block text-[11px] text-marfil/45">{usuario.rol}</span></span>
        </NavLink>
        <button onClick={salir} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-marfil/60 hover:bg-marfil/5 hover:text-marfil">
          <LogOut className="h-4 w-4 text-dorado" />Salir
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-carbon lg:block">{nav}</aside>
      <header className="sticky top-0 z-20 flex items-center justify-between bg-carbon px-4 py-3 lg:hidden">
        <button onClick={() => setAbierto(true)} className="text-marfil" aria-label="Menú"><Menu className="h-6 w-6" /></button>
        <Logo claro chico />
        <Archive className="h-6 w-6 opacity-0" />
      </header>
      {abierto && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-carbon/60" onClick={() => setAbierto(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-carbon">
            <button onClick={() => setAbierto(false)} className="absolute right-3 top-3 text-marfil/70" aria-label="Cerrar"><X className="h-5 w-5" /></button>
            {nav}
          </aside>
        </div>
      )}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</main>
    </div>
  );
}
