import { createContext, useContext, type ReactNode } from 'react';
import type { Accion, Usuario } from './tipos';

interface Ctx { usuario: Usuario; puede: (modulo: string, accion?: Accion) => boolean; salir: () => void; cotizUsd: number | null }
const Contexto = createContext<Ctx | null>(null);
export const ProveedorSesion = ({ valor, children }: { valor: Ctx; children: ReactNode }) => <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
export function useSesion() {
  const c = useContext(Contexto);
  if (!c) throw new Error('Sin sesión');
  return c;
}
export const crearPuede = (u: Usuario) => (modulo: string, accion: Accion = 'ver') => (u.permisos[modulo] ?? []).includes(accion);
