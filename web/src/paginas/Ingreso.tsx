import { useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Aviso, Campo, Logo } from '../componentes/ui';

function Pantalla({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-carbon px-4 py-10">
      <Logo claro />
      <p className="mt-4 text-xs uppercase tracking-etiqueta text-dorado/80">Cuero genuino · hecho para heredarse</p>
      <div className="mt-10 w-full max-w-sm rounded-xl bg-crema p-6 shadow-2xl">{children}</div>
      <p className="mt-8 text-[11px] text-marfil/30">Malabia 48 · Villa Crespo</p>
    </div>
  );
}

export function PaginaIngreso() {
  const qc = useQueryClient();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setOcupado(true); setError('');
    try { await api.post('/login', { usuario, password }); await qc.invalidateQueries({ queryKey: ['yo'] }); }
    catch (err) { setError((err as Error).message); }
    finally { setOcupado(false); }
  };
  return (
    <Pantalla>
      <h1 className="mb-5 text-xl font-bold">Ingresar</h1>
      <form onSubmit={enviar} className="space-y-4">
        <Campo etiqueta="Usuario"><input className="entrada" autoFocus autoCapitalize="none" autoComplete="username" value={usuario} onChange={(e) => setUsuario(e.target.value)} /></Campo>
        <Campo etiqueta="Contraseña"><input className="entrada" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Campo>
        {error && <Aviso tono="critico">{error}</Aviso>}
        <button className="btn-primario w-full" disabled={ocupado || !usuario || !password}>{ocupado ? 'Ingresando…' : 'Ingresar'}</button>
      </form>
    </Pantalla>
  );
}

export function PaginaPrimerUso() {
  const qc = useQueryClient();
  const [d, setD] = useState({ nombre: '', usuario: '', password: '', repetir: '' });
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (d.password !== d.repetir) return setError('Las contraseñas no coinciden');
    setOcupado(true); setError('');
    try {
      await api.post('/setup', { nombre: d.nombre, usuario: d.usuario, password: d.password });
      await api.post('/login', { usuario: d.usuario, password: d.password });
      await qc.invalidateQueries();
    } catch (err) { setError((err as Error).message); }
    finally { setOcupado(false); }
  };
  const c = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value });
  return (
    <Pantalla>
      <h1 className="text-xl font-bold">Primer uso</h1>
      <p className="mb-5 mt-1 text-sm text-carbon/60">Creá el usuario administrador. Después vas a poder sumar al resto del equipo con su propio rol.</p>
      <form onSubmit={enviar} className="space-y-4">
        <Campo etiqueta="Tu nombre"><input className="entrada" autoFocus value={d.nombre} onChange={c('nombre')} /></Campo>
        <Campo etiqueta="Usuario" ayuda="Sin espacios. Ej: mojo"><input className="entrada" autoCapitalize="none" value={d.usuario} onChange={c('usuario')} /></Campo>
        <Campo etiqueta="Contraseña" ayuda="Mínimo 8 caracteres"><input className="entrada" type="password" autoComplete="new-password" value={d.password} onChange={c('password')} /></Campo>
        <Campo etiqueta="Repetir contraseña"><input className="entrada" type="password" autoComplete="new-password" value={d.repetir} onChange={c('repetir')} /></Campo>
        {error && <Aviso tono="critico">{error}</Aviso>}
        <button className="btn-primario w-full" disabled={ocupado}>{ocupado ? 'Creando…' : 'Crear y entrar'}</button>
      </form>
    </Pantalla>
  );
}

export function FormCambioPassword({ alTerminar }: { alTerminar: () => void }) {
  const [d, setD] = useState({ actual: '', nueva: '', repetir: '' });
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (d.nueva !== d.repetir) return setError('Las contraseñas nuevas no coinciden');
    setOcupado(true); setError('');
    try { await api.post('/yo/password', { actual: d.actual, nueva: d.nueva }); setD({ actual: '', nueva: '', repetir: '' }); alTerminar(); }
    catch (err) { setError((err as Error).message); }
    finally { setOcupado(false); }
  };
  const c = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value });
  return (
    <form onSubmit={enviar} className="space-y-4">
      <Campo etiqueta="Contraseña actual"><input className="entrada" type="password" autoComplete="current-password" value={d.actual} onChange={c('actual')} /></Campo>
      <Campo etiqueta="Contraseña nueva" ayuda="Mínimo 8 caracteres"><input className="entrada" type="password" autoComplete="new-password" value={d.nueva} onChange={c('nueva')} /></Campo>
      <Campo etiqueta="Repetir nueva"><input className="entrada" type="password" autoComplete="new-password" value={d.repetir} onChange={c('repetir')} /></Campo>
      {error && <Aviso tono="critico">{error}</Aviso>}
      <button className="btn-primario w-full" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Cambiar contraseña'}</button>
    </form>
  );
}

export function CambioObligatorio() {
  const qc = useQueryClient();
  return (
    <Pantalla>
      <h1 className="text-xl font-bold">Elegí tu contraseña</h1>
      <p className="mb-5 mt-1 text-sm text-carbon/60">Te dieron una contraseña provisoria. Cambiala para seguir.</p>
      <FormCambioPassword alTerminar={() => qc.invalidateQueries({ queryKey: ['yo'] })} />
    </Pantalla>
  );
}
