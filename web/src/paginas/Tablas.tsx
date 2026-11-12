import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../api';
import { useSesion } from '../sesion';
import type { Aux } from '../tipos';
import { Cargando, Encabezado, avisar, avisarError } from '../componentes/ui';

export function PaginaTablas() {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const aux = useQuery({ queryKey: ['aux'], queryFn: () => api.get<Aux>('/catalogo/aux') });
  const m = useMutation({
    mutationFn: ({ metodo, ruta, cuerpo }: { metodo: 'post' | 'put'; ruta: string; cuerpo: unknown }) => (metodo === 'post' ? api.post(ruta, cuerpo) : api.put(ruta, cuerpo)),
    onSuccess: () => { avisar('Guardado'); qc.invalidateQueries({ queryKey: ['aux'] }); qc.invalidateQueries({ queryKey: ['modelos'] }); },
    onError: avisarError,
  });
  if (aux.isLoading) return <Cargando />;
  const a = aux.data!;
  const crea = puede('catalogo', 'crear');
  const modif = puede('catalogo', 'modificar');
  const padres = a.categorias.filter((c) => !c.padreId);

  return (
    <>
      <Encabezado titulo="Categorías, colores y talles" sub="Las tablas que usa el catálogo. Lo que no se usa más se desactiva (no se borra, para no romper el historial)." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Bloque titulo="Categorías y subcategorías" puedeCrear={crea} onCrear={(nombre) => m.mutate({ metodo: 'post', ruta: '/catalogo/categorias', cuerpo: { nombre } })}>
          {padres.map((p) => (
            <div key={p.id} className="border-b border-arena/40 py-2">
              <Linea nombre={p.nombre} activo={p.activo} editable={modif} onGuardar={(nombre, activo) => m.mutate({ metodo: 'put', ruta: `/catalogo/categorias/${p.id}`, cuerpo: { nombre, activo, orden: p.orden } })} fuerte />
              <div className="ml-4">
                {a.categorias.filter((s) => s.padreId === p.id).map((s) => (
                  <Linea key={s.id} nombre={s.nombre} activo={s.activo} editable={modif} onGuardar={(nombre, activo) => m.mutate({ metodo: 'put', ruta: `/catalogo/categorias/${s.id}`, cuerpo: { nombre, activo, orden: s.orden } })} />
                ))}
                {crea && <Agregar texto="subcategoría" onCrear={(nombre) => m.mutate({ metodo: 'post', ruta: '/catalogo/categorias', cuerpo: { nombre, padreId: p.id } })} />}
              </div>
            </div>
          ))}
        </Bloque>
        <div className="space-y-6">
          <Bloque titulo="Colores" puedeCrear={crea} onCrear={(nombre) => m.mutate({ metodo: 'post', ruta: '/catalogo/colores', cuerpo: { nombre } })}>
            <div className="grid grid-cols-2 gap-x-4">{a.colores.map((c) => <Linea key={c.id} nombre={c.nombre} activo={c.activo} editable={modif} onGuardar={(nombre, activo) => m.mutate({ metodo: 'put', ruta: `/catalogo/colores/${c.id}`, cuerpo: { nombre, activo } })} />)}</div>
          </Bloque>
          <Bloque titulo="Talles" puedeCrear={crea} onCrear={(nombre) => m.mutate({ metodo: 'post', ruta: '/catalogo/talles', cuerpo: { nombre } })}>
            <div className="grid grid-cols-3 gap-x-4">{a.talles.map((t) => <Linea key={t.id} nombre={t.nombre} activo={t.activo} editable={modif} onGuardar={(nombre, activo) => m.mutate({ metodo: 'put', ruta: `/catalogo/talles/${t.id}`, cuerpo: { nombre, activo } })} />)}</div>
          </Bloque>
          <Bloque titulo="Listas de precio" puedeCrear={puede('precios', 'crear')} onCrear={(nombre) => m.mutate({ metodo: 'post', ruta: '/catalogo/listas', cuerpo: { nombre, orden: a.listasPrecio.length + 1 } })}>
            {a.listasPrecio.map((l) => <div key={l.id} className="py-1 text-sm"><b>{l.nombre}</b> <span className="text-carbon/60">{l.descripcion}</span></div>)}
          </Bloque>
        </div>
      </div>
    </>
  );
}

function Bloque({ titulo, children, puedeCrear, onCrear }: { titulo: string; children: React.ReactNode; puedeCrear: boolean; onCrear: (n: string) => void }) {
  return (
    <section className="tarjeta p-5">
      <h2 className="mb-3 text-lg font-bold">{titulo}</h2>
      {children}
      {puedeCrear && <div className="mt-3"><Agregar texto={titulo.split(' ')[0].toLowerCase()} onCrear={onCrear} /></div>}
    </section>
  );
}

function Agregar({ texto, onCrear }: { texto: string; onCrear: (n: string) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [n, setN] = useState('');
  if (!abierto) return <button className="mt-1 inline-flex items-center gap-1 text-xs text-conac hover:underline" onClick={() => setAbierto(true)}><Plus className="h-3 w-3" />Agregar {texto}</button>;
  return (
    <form className="mt-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (n.trim()) { onCrear(n.trim()); setN(''); setAbierto(false); } }}>
      <input className="entrada py-1" autoFocus value={n} onChange={(e) => setN(e.target.value)} placeholder="Nombre" />
      <button className="btn-primario btn-chico">Agregar</button><button type="button" className="btn-secundario btn-chico" onClick={() => setAbierto(false)}>×</button>
    </form>
  );
}

function Linea({ nombre, activo, editable, onGuardar, fuerte }: { nombre: string; activo: boolean; editable: boolean; onGuardar: (n: string, a: boolean) => void; fuerte?: boolean }) {
  const [editando, setEditando] = useState(false);
  const [n, setN] = useState(nombre);
  if (editando) return (
    <form className="flex gap-1 py-0.5" onSubmit={(e) => { e.preventDefault(); onGuardar(n, activo); setEditando(false); }}>
      <input className="entrada py-0.5 text-sm" autoFocus value={n} onChange={(e) => setN(e.target.value)} />
      <button className="btn-primario btn-chico">OK</button>
    </form>
  );
  return (
    <div className={`group flex items-center justify-between gap-2 py-0.5 text-sm ${activo ? '' : 'text-carbon/40 line-through'} ${fuerte ? 'font-medium' : ''}`}>
      <span>{nombre}</span>
      {editable && (
        <span className="flex gap-2 text-xs no-underline sm:hidden sm:group-hover:flex">
          <button className="text-conac" onClick={() => { setN(nombre); setEditando(true); }}>Editar</button>
          <button className="text-conac" onClick={() => onGuardar(nombre, !activo)}>{activo ? 'Desactivar' : 'Activar'}</button>
        </span>
      )}
    </div>
  );
}
