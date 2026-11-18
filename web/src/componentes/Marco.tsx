import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Contact, Archive, Layers, Factory, BarChart3, Boxes, Calculator, Scissors, Sparkles, CreditCard, HandCoins, Receipt, ReceiptText, ShoppingBag, Wallet, ClipboardList, PackageCheck, ListTodo, BookOpen, Database, FileUp, Home, LogOut, Menu, Settings, ShieldCheck, Tag, Tags, Truck, User, Users, X } from 'lucide-react';
import { useSesion } from '../sesion';
import { Logo } from './ui';

type Item = { a: string; texto: string; icono: typeof Home; modulo?: string; accion?: 'crear'; requiere?: string };
/** Menú principal en el orden pedido; lo demás (que ya funcionaba) queda en secciones secundarias. */
const SECCIONES: { titulo: string; items: Item[] }[] = [
  { titulo: '', items: [
    { a: '/', texto: 'Caja', icono: Wallet, modulo: 'caja' },
    { a: '/facturar', texto: 'Facturación directa', icono: ReceiptText, modulo: 'ventas', accion: 'crear' },
    { a: '/ventas', texto: 'Ventas', icono: ShoppingBag, modulo: 'ventas' },
    { a: '/catalogo', texto: 'Productos', icono: Tags, modulo: 'catalogo' },
    { a: '/stock', texto: 'Stock', icono: Boxes, modulo: 'stock' },
    { a: '/reposicion', texto: 'Reposición general', icono: ListTodo, modulo: 'compras' },
    { a: '/compras', texto: 'Pedidos a proveedores', icono: PackageCheck, modulo: 'compras' },
    { a: '/compras?estado=todos', texto: 'Compras', icono: Archive, modulo: 'compras' },
    { a: '/proveedores', texto: 'Proveedores', icono: Truck, modulo: 'proveedores' },
    { a: '/produccion', texto: 'Producción', icono: Factory, modulo: 'materiales' },
    { a: '/pagos', texto: 'Cuentas corrientes', icono: HandCoins, modulo: 'caja' },
    { a: '/gastos', texto: 'Gastos', icono: Receipt, modulo: 'gastos' },
    { a: '/reportes', texto: 'Estadísticas', icono: BarChart3, modulo: 'panel' },
    { a: '/auditoria', texto: 'Auditoría', icono: ShieldCheck, modulo: 'auditoria' },
  ] },
  { titulo: 'Más de ventas y productos', items: [
    { a: '/clientes', texto: 'Clientes', icono: Contact, modulo: 'ventas' },
    { a: '/precios', texto: 'Precios', icono: Tag, modulo: 'precios' },
    { a: '/precios/sugeridos', texto: 'Precios sugeridos', icono: Sparkles, modulo: 'precios', requiere: 'costos' },
    { a: '/tablas', texto: 'Categorías, colores y talles', icono: BookOpen, modulo: 'catalogo' },
    { a: '/conteos', texto: 'Conteos físicos', icono: ClipboardList, modulo: 'stock' },
    { a: '/importar', texto: 'Importar planilla', icono: FileUp, modulo: 'importacion', accion: 'crear' },
  ] },
  { titulo: 'Más de compras y producción', items: [
    { a: '/para-pedir', texto: 'Para pedir (solo ventas)', icono: ListTodo, modulo: 'compras' },
    { a: '/reponer-materiales', texto: 'Reponer materiales', icono: Layers, modulo: 'compras' },
    { a: '/importar-compras', texto: 'Importar compras', icono: FileUp, modulo: 'importacion', accion: 'crear' },
    { a: '/materiales', texto: 'Materiales', icono: Scissors, modulo: 'materiales' },
    { a: '/costeo', texto: 'Recetas y costeo', icono: Calculator, modulo: 'costos' },
    { a: '/gastos-personales', texto: 'Gastos personales', icono: User, modulo: 'caja' },
    { a: '/resumen', texto: 'Resumen', icono: Home },
  ] },
  { titulo: 'Sistema', items: [
    { a: '/cuentas', texto: 'Cuentas y formas de pago', icono: CreditCard, modulo: 'caja' },
    { a: '/usuarios', texto: 'Usuarios y roles', icono: Users, modulo: 'usuarios' },
    { a: '/configuracion', texto: 'Configuración', icono: Settings, modulo: 'configuracion' },
    { a: '/backups', texto: 'Copias de seguridad', icono: Database, modulo: 'backups' },
  ] },
];

/** "Pedidos a proveedores" y "Compras" son la misma pantalla con distinto filtro: se marca la que corresponde. */
function activo(i: Item, pathname: string, search: string) {
  const [ruta, qs] = i.a.split('?');
  if (ruta === '/' || ruta === '/precios') return pathname === ruta && (!qs || search.includes(qs));
  if (!(pathname === ruta || pathname.startsWith(ruta + '/'))) return false;
  if (ruta === '/compras' && pathname === '/compras') return qs ? search.includes(qs) : !search.includes('estado=todos');
  return true;
}

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
          const items = s.items.filter((i) => (!i.modulo || puede(i.modulo, i.accion ?? 'ver')) && (!i.requiere || puede(i.requiere)));
          if (!items.length) return null;
          return (
            <div key={s.titulo}>
              {s.titulo && <div className="mb-1 px-3 text-[10px] font-medium uppercase tracking-etiqueta text-dorado/80">{s.titulo}</div>}
              {items.map((i) => (
                <NavLink key={i.a} to={i.a}
                  className={() => `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${activo(i, loc.pathname, loc.search) ? 'bg-marfil/10 text-marfil' : 'text-marfil/65 hover:bg-marfil/5 hover:text-marfil'}`}>
                  <i.icono className="h-4 w-4 text-dorado" />{i.texto}
                </NavLink>
              ))}
            </div>
          );
        })}
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
