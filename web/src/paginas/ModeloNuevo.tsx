import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '../api';
import { useSesion } from '../sesion';
import type { Aux, Modelo } from '../tipos';
import { Campo, Cargando, Encabezado, avisar, avisarError } from '../componentes/ui';
import { Importe } from '../componentes/Importe';

export interface DatosModeloForm {
  nombre: string; descripcion: string | null; categoriaId: number; subcategoriaId: number | null; genero: 'Hombre' | 'Mujer' | 'Unisex' | null;
  marca: string | null; proveedorId: number | null; notas: string | null;
}

export function FormModelo({ inicial, aux, onGuardar, onCancelar, ocupado, sinBotones, onCambio }: {
  inicial?: Partial<Modelo>; aux: Aux; onGuardar?: (d: DatosModeloForm) => void; onCancelar?: () => void; ocupado?: boolean;
  sinBotones?: boolean; onCambio?: (d: Partial<DatosModeloForm>) => void;
}) {
  const [d, setDBase] = useState<Partial<DatosModeloForm>>({
    nombre: inicial?.nombre ?? '', descripcion: inicial?.descripcion ?? null, categoriaId: inicial?.categoriaId, subcategoriaId: inicial?.subcategoriaId ?? null,
    genero: inicial?.genero ?? null, marca: inicial?.marca ?? null, proveedorId: inicial?.proveedorId ?? null, notas: inicial?.notas ?? null,
  });
  const setD = (n: Partial<DatosModeloForm>) => { setDBase(n); onCambio?.(n); };
  const cats = aux.categorias.filter((c) => !c.padreId && (c.activo || c.id === d.categoriaId));
  const subs = aux.categorias.filter((c) => c.padreId === d.categoriaId && (c.activo || c.id === d.subcategoriaId));
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (d.nombre && d.categoriaId) onGuardar?.(d as DatosModeloForm); }} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Nombre" className="sm:col-span-2"><input className="entrada" value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} required autoFocus /></Campo>
        <Campo etiqueta="Categoría">
          <select className="entrada" value={d.categoriaId ?? ''} onChange={(e) => setD({ ...d, categoriaId: Number(e.target.value) || undefined, subcategoriaId: null })} required>
            <option value="">Elegí…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Subcategoría / tipo">
          <select className="entrada" value={d.subcategoriaId ?? ''} onChange={(e) => setD({ ...d, subcategoriaId: e.target.value ? Number(e.target.value) : null })} disabled={!subs.length}>
            <option value="">{subs.length ? 'Ninguna' : 'Sin subcategorías'}</option>{subs.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Género">
          <select className="entrada" value={d.genero ?? ''} onChange={(e) => setD({ ...d, genero: (e.target.value || null) as DatosModeloForm['genero'] })}>
            <option value="">No aplica</option><option>Hombre</option><option>Mujer</option><option>Unisex</option>
          </select>
        </Campo>
        <Campo etiqueta="Proveedor / taller">
          <select className="entrada" value={d.proveedorId ?? ''} onChange={(e) => setD({ ...d, proveedorId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Sin asignar</option>{aux.proveedores.filter((p) => p.activo || p.id === d.proveedorId).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Marca"><input className="entrada" value={d.marca ?? ''} onChange={(e) => setD({ ...d, marca: e.target.value || null })} placeholder="Herencia Cuero" /></Campo>
        <Campo etiqueta="Notas"><input className="entrada" value={d.notas ?? ''} onChange={(e) => setD({ ...d, notas: e.target.value || null })} /></Campo>
        <Campo etiqueta="Descripción (para catálogo)" className="sm:col-span-2"><textarea className="entrada" rows={2} value={d.descripcion ?? ''} onChange={(e) => setD({ ...d, descripcion: e.target.value || null })} /></Campo>
      </div>
      {!sinBotones && (
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secundario" onClick={onCancelar}>Cancelar</button>
          <button className="btn-primario" disabled={ocupado || !d.nombre || !d.categoriaId}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
        </div>
      )}
    </form>
  );
}

export function PaginaModeloNuevo() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { puede } = useSesion();
  const aux = useQuery({ queryKey: ['aux'], queryFn: () => api.get<Aux>('/catalogo/aux') });
  const [modelo, setModelo] = useState<Partial<DatosModeloForm>>({});
  const [colores, setColores] = useState<number[]>([]);
  const [talles, setTalles] = useState<number[]>([]);
  const [prefijo, setPrefijo] = useState('');
  const [costo, setCosto] = useState<number | null>(null);
  const [precios, setPrecios] = useState<Record<number, number | null>>({});

  const variantes = useMemo(() => {
    if (!aux.data) return [];
    const cs = colores.length ? colores : [null];
    const ts = talles.length ? talles : [null];
    const nombreColor = (id: number | null) => aux.data!.colores.find((c) => c.id === id)?.nombre;
    const nombreTalle = (id: number | null) => aux.data!.talles.find((t) => t.id === id)?.nombre;
    return cs.flatMap((c) => ts.map((t) => ({
      colorId: c, talleId: t,
      sku: [prefijo.trim(), cs.length > 1 ? nombreColor(c)?.slice(0, 3).toUpperCase() : '', nombreTalle(t) ?? ''].filter(Boolean).join(''),
    })));
  }, [aux.data, colores, talles, prefijo]);

  const crear = useMutation({
    mutationFn: () => api.post<{ id: number }>('/catalogo/modelos', {
      modelo,
      variantes: prefijo.trim() ? variantes.map((v) => ({
        ...v,
        ...(puede('costos', 'modificar') && costo != null ? { costoCentavos: costo } : {}),
        ...(puede('precios', 'modificar') ? { precios: Object.fromEntries(Object.entries(precios).filter(([, p]) => p != null)) } : {}),
      })) : [],
    }, true),
    onSuccess: (r) => { avisar('Producto creado'); qc.invalidateQueries({ queryKey: ['modelos'] }); nav(`/catalogo/${r.id}`); },
    onError: avisarError,
  });

  if (aux.isLoading) return <Cargando />;
  const a = aux.data!;
  const alternar = (lista: number[], set: (x: number[]) => void, id: number) => set(lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);

  return (
    <>
      <Link to="/catalogo" className="mb-3 inline-flex items-center gap-1 text-sm text-carbon/60 hover:text-carbon"><ArrowLeft className="h-4 w-4" />Catálogo</Link>
      <Encabezado titulo="Nuevo producto" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="tarjeta p-5">
          <h2 className="mb-4 text-lg font-bold">Datos</h2>
          <FormModelo aux={a} sinBotones onCambio={setModelo} />
          {!a.categorias.length && <p className="mt-3 text-sm text-conac">No hay categorías. <Link className="underline" to="/tablas">Crealas acá</Link>.</p>}
        </div>
        <div className="tarjeta p-5">
          <h2 className="text-lg font-bold">Variantes</h2>
          <p className="mb-4 text-sm text-carbon/60">Elegí colores y talles y se arma una variante por combinación. También podés agregarlas después.</p>
          <Campo etiqueta="Prefijo del código" ayuda="Ej: CSUN → CSUN1, CSUN2… (vacío = crear sin variantes)"><input className="entrada" value={prefijo} onChange={(e) => setPrefijo(e.target.value)} /></Campo>
          <div className="etiqueta mb-1 mt-4">Colores</div>
          <div className="flex flex-wrap gap-1.5">{a.colores.filter((c) => c.activo).map((c) => <Chip key={c.id} activo={colores.includes(c.id)} onClick={() => alternar(colores, setColores, c.id)}>{c.nombre}</Chip>)}</div>
          <div className="etiqueta mb-1 mt-4">Talles</div>
          <div className="flex flex-wrap gap-1.5">{a.talles.filter((t) => t.activo).map((t) => <Chip key={t.id} activo={talles.includes(t.id)} onClick={() => alternar(talles, setTalles, t.id)}>{t.nombre}</Chip>)}</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {puede('costos', 'modificar') && <Campo etiqueta="Costo (para todas)"><Importe valor={costo} onCambio={setCosto} /></Campo>}
            {puede('precios', 'modificar') && a.listasPrecio.filter((l) => l.activo).map((l) => (
              <Campo key={l.id} etiqueta={l.nombre}><Importe valor={precios[l.id]} onCambio={(c) => setPrecios({ ...precios, [l.id]: c })} /></Campo>
            ))}
          </div>
          {prefijo.trim() && (
            <div className="mt-4 rounded-md bg-marfil p-3 text-xs">
              <div className="etiqueta mb-1">Se van a crear {variantes.length}</div>
              <div className="flex flex-wrap gap-1">{variantes.map((v) => <span key={v.sku} className="rounded bg-crema-50 px-1.5 py-0.5">{v.sku}</span>)}</div>
            </div>
          )}
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Link className="btn-secundario" to="/catalogo">Cancelar</Link>
        <button className="btn-primario" disabled={crear.isPending || !modelo.nombre || !modelo.categoriaId} onClick={() => crear.mutate()}>{crear.isPending ? 'Creando…' : 'Crear producto'}</button>
      </div>
    </>
  );
}

export function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`rounded-full border px-3 py-1 text-xs ${activo ? 'border-carbon bg-carbon text-marfil' : 'border-arena hover:border-carbon'}`}>{children}</button>;
}
