import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, PackagePlus, Plus, SlidersHorizontal } from 'lucide-react';
import { api } from '../api';
import { useSesion } from '../sesion';
import type { Aux } from '../tipos';
import { Aviso, Campo, Cargando, Confirmar, Encabezado, ErrorCarga, Estado, Modal, Pendiente, Vacio, avisar, avisarError } from '../componentes/ui';
import { SelectorColor } from '../componentes/SelectorColor';
import { Importe } from '../componentes/Importe';
import { fecha as fmtFecha, pesos } from '../formato';
import { hoy } from '../plata';
import { Th, coincide, useOrden } from '../componentes/Orden';
import { CLASIF_MATERIAL, TIPOS_MOV, UNIDADES, type ClasificacionMaterial, cant, leerCant, useMateriales, type DetalleMaterial, type Material, type MovMaterial } from '../costos';

const bajoMinimo = (m: Material) => m.stockMil !== null && (m.stockMil < 0 || (m.stockMinimoMil !== null && m.stockMil <= m.stockMinimoMil));
const inv = (qc: ReturnType<typeof useQueryClient>) => ['materiales', 'material', 'costeo', 'saldos-proveedores', 'cuenta-corriente'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

export function PaginaMateriales() {
  const { puede } = useSesion();
  const lista = useMateriales();
  const [q, setQ] = useState('');
  const [verId, setVerId] = useState<number | null>(null);
  const [editar, setEditar] = useState<Partial<Material> | null>(null);
  const [clase, setClase] = useState('');
  const verCostos = puede('costos');
  const visibles = (lista.data ?? []).filter((m) => coincide(q, m.codigo, m.nombre, m.proveedor)
    && (!clase || (clase === 'mano_obra' ? m.tipo === 'mano_obra' : clase === 'pendiente' ? m.tipo === 'material' && !m.clasificacion : m.clasificacion === clase)));
  const { filas, orden } = useOrden(visibles, {
    codigo: (m) => m.codigo, nombre: (m) => m.nombre, tipo: (m) => (m.tipo === 'mano_obra' ? 'Mano de obra' : m.clasificacion ? CLASIF_MATERIAL[m.clasificacion] : null),
    stock: (m) => m.stockMil, costo: (m) => m.costoCentavos, proveedor: (m) => m.proveedor, modelos: (m) => m.modelosQueLoUsan, estado: (m) => m.activo,
  }, { col: 'codigo' });
  if (lista.isLoading) return <Cargando />;
  if (lista.isError) return <ErrorCarga error={lista.error} />;
  const alertas = (lista.data ?? []).filter((m) => m.activo && bajoMinimo(m));
  return (
    <>
      <Encabezado titulo="Materiales" sub="Cuero, forros, cierres y mano de obra. El stock baja solo cuando el taller entrega prendas, según la receta de cada modelo.">
        {puede('materiales', 'exportar') && <a className="btn-secundario" href="/api/materiales/exportar"><Download className="h-4 w-4" />Excel</a>}
        {puede('materiales', 'crear') && <button className="btn-primario" onClick={() => setEditar({ unidad: 'm', tipo: 'material', activo: true })}><Plus className="h-4 w-4" />Nuevo material</button>}
      </Encabezado>
      {alertas.length > 0 && (
        <Aviso tono="atencion"><AlertTriangle className="mr-1 inline h-4 w-4" />Para reponer: {alertas.map((m) => `${m.nombre} (${cant(m.stockMil)} ${m.unidad})`).join(' · ')}</Aviso>
      )}
      <div className="my-3 grid gap-2 sm:grid-cols-[1fr_auto]">
        <input className="entrada" placeholder="Buscar por código, nombre o proveedor" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="entrada" value={clase} onChange={(e) => setClase(e.target.value)} aria-label="Tipo de material">
          <option value="">Todos los tipos</option>{Object.entries(CLASIF_MATERIAL).map(([k, t]) => <option key={k} value={k}>{t}</option>)}<option value="mano_obra">Mano de obra</option><option value="pendiente">Sin clasificar</option>
        </select>
      </div>
      {!filas.length ? <Vacio>{lista.data?.length ? 'Nada coincide con la búsqueda.' : 'Todavía no hay materiales cargados.'}</Vacio> : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead><tr><Th col="codigo" orden={orden}>Código</Th><Th col="nombre" orden={orden}>Material</Th><Th col="tipo" orden={orden} className="hidden lg:table-cell">Tipo</Th><Th col="stock" orden={orden} className="num">Stock</Th>{verCostos && <Th col="costo" orden={orden} className="num">Costo</Th>}<Th col="proveedor" orden={orden} className="hidden md:table-cell">Proveedor</Th><Th col="modelos" orden={orden} className="hidden sm:table-cell num">Modelos</Th><Th col="estado" orden={orden} className="hidden sm:table-cell">Estado</Th></tr></thead>
            <tbody>{filas.map((m) => (
              <tr key={m.id} className="cursor-pointer hover:bg-arena/20" onClick={() => setVerId(m.id)}>
                <td className="font-mono text-xs">{m.codigo}</td>
                <td className="font-medium">{m.nombre}{m.tipo === 'mano_obra' && <span className="pildora ml-2 bg-arena/50">Mano de obra</span>}{m.porColor && <span className="pildora ml-2 bg-arena/50">Por color</span>}</td>
                <td className="hidden lg:table-cell">{m.tipo === 'mano_obra' ? '—' : m.clasificacion ? CLASIF_MATERIAL[m.clasificacion] : <Pendiente texto="Sin clasificar" />}</td>
                <td className={`num ${bajoMinimo(m) ? 'font-semibold text-bordo' : ''}`}>{m.stockMil === null ? '—' : `${cant(m.stockMil)} ${m.unidad}`}{m.porColor && !!m.stockColores?.length && <div className="text-xs font-normal text-carbon/55">{m.stockColores.map((c) => `${c.color} ${cant(c.cantidadMil)}`).join(' · ')}</div>}</td>
                {verCostos && <td className="num">{m.costoCentavos == null ? <Pendiente /> : <>{pesos(m.costoCentavos)}<span className="text-xs text-carbon/45"> /{m.unidad}</span></>}</td>}
                <td className="hidden md:table-cell">{m.proveedor ?? '—'}</td>
                <td className="hidden sm:table-cell num">{m.modelosQueLoUsan || '—'}</td>
                <td className="hidden sm:table-cell"><Estado activo={m.activo} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {verId !== null && <FichaMaterial id={verId} onCerrar={() => setVerId(null)} onEditar={(m) => { setVerId(null); setEditar(m); }} />}
      {editar && <EditarMaterial material={editar} onCerrar={() => setEditar(null)} />}
    </>
  );
}

function EditarMaterial({ material, onCerrar }: { material: Partial<Material>; onCerrar: () => void }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const aux = useQuery({ queryKey: ['aux'], queryFn: () => api.get<Aux>('/catalogo/aux'), enabled: puede('catalogo') });
  const [m, setM] = useState(material);
  const [minimo, setMinimo] = useState(material.stockMinimoMil == null ? '' : cant(material.stockMinimoMil));
  const [motivo, setMotivo] = useState('');
  const editaCosto = puede('costos', 'modificar');
  const cambiaCosto = !!m.id && editaCosto && m.costoCentavos !== material.costoCentavos;
  const g = useMutation({
    mutationFn: () => {
      const min = minimo.trim() ? leerCant(minimo) : null;
      if (Number.isNaN(min)) throw new Error('El stock mínimo no es un número');
      const cuerpo = { codigo: m.codigo, nombre: m.nombre, unidad: m.unidad, tipo: m.tipo, proveedorId: m.proveedorId ?? null, stockMinimoMil: min, notas: m.notas ?? null, activo: m.activo ?? true, clasificacion: m.tipo === 'mano_obra' ? null : m.clasificacion ?? null, porColor: m.tipo === 'material' && !!m.porColor,
        ...(editaCosto ? { costoCentavos: m.costoCentavos ?? null } : m.id ? {} : { costoCentavos: null }), motivo: motivo || undefined };
      return m.id ? api.put(`/materiales/${m.id}`, cuerpo) : api.post('/materiales', cuerpo);
    },
    onSuccess: () => { avisar('Material guardado'); inv(qc); onCerrar(); }, onError: avisarError,
  });
  return (
    <Modal titulo={m.id ? `Editar ${material.nombre}` : 'Nuevo material'} onCerrar={onCerrar}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); g.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo etiqueta="Código"><input className="entrada font-mono uppercase" value={m.codigo ?? ''} onChange={(e) => setM({ ...m, codigo: e.target.value })} placeholder="MAT-018" required /></Campo>
          <Campo etiqueta="Nombre" className="sm:col-span-2"><input className="entrada" value={m.nombre ?? ''} onChange={(e) => setM({ ...m, nombre: e.target.value })} required /></Campo>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Tipo"><select className="entrada" value={m.tipo} onChange={(e) => setM({ ...m, tipo: e.target.value as Material['tipo'] })}><option value="material">Material (tiene stock)</option><option value="mano_obra">Mano de obra (sin stock)</option></select></Campo>
          {m.tipo === 'material' && <Campo etiqueta="Clasificación" ayuda="Materia prima: cuero. Material de producción: forros, cierres, avíos. Insumo: bolsas, etiquetas."><select className="entrada" value={m.clasificacion ?? ''} onChange={(e) => setM({ ...m, clasificacion: (e.target.value || null) as ClasificacionMaterial | null })}><option value="">Sin clasificar</option>{Object.entries(CLASIF_MATERIAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>}
          <Campo etiqueta="Se mide en"><select className="entrada" value={m.unidad} onChange={(e) => setM({ ...m, unidad: e.target.value as Material['unidad'] })}>{Object.entries(UNIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
          {editaCosto && <Campo etiqueta={`Costo por ${UNIDADES[m.unidad ?? 'u'].replace(/s$/, '').replace(/e$/, '')}`} ayuda="Vacío si todavía no se sabe: queda pendiente."><Importe valor={m.costoCentavos} onCambio={(c) => setM({ ...m, costoCentavos: c })} /></Campo>}
          <Campo etiqueta="Proveedor habitual"><select className="entrada" value={m.proveedorId ?? ''} onChange={(e) => setM({ ...m, proveedorId: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{aux.data?.proveedores.filter((p) => p.activo || p.id === m.proveedorId).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
          {m.tipo === 'material' && <Campo etiqueta="Avisar cuando quede" ayuda="Stock mínimo. Vacío: no avisa."><input className="entrada text-right" inputMode="decimal" value={minimo} onChange={(e) => setMinimo(e.target.value)} /></Campo>}
        </div>
        <Campo etiqueta="Notas"><input className="entrada" value={m.notas ?? ''} onChange={(e) => setM({ ...m, notas: e.target.value })} /></Campo>
        {cambiaCosto && <Campo etiqueta="Motivo del cambio de costo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: aumento del proveedor" /></Campo>}
        {m.tipo === 'material' && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={!!m.porColor} onChange={(e) => setM({ ...m, porColor: e.target.checked })} /><span>Se controla por color <span className="block text-xs text-carbon/55">Como el cuero: el stock, las compras y las entregas van por color, y cada campera usa el de su color.</span></span></label>}
        {m.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!m.activo} onChange={(e) => setM({ ...m, activo: e.target.checked })} />Activo</label>}
        {cambiaCosto && <p className="text-xs text-carbon/55">Cambiar el costo no cambia solo el costo de las prendas: lo aplicás desde Costeo, viendo antes cómo queda.</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={g.isPending}>Guardar</button></div>
      </form>
    </Modal>
  );
}

function FichaMaterial({ id, onCerrar, onEditar }: { id: number; onCerrar: () => void; onEditar: (m: Material) => void }) {
  const { puede } = useSesion();
  const qc = useQueryClient();
  const det = useQuery({ queryKey: ['material', id], queryFn: () => api.get<DetalleMaterial>(`/materiales/${id}`) });
  const [accion, setAccion] = useState<'compra' | 'ajuste' | null>(null);
  const [contar, setContar] = useState(false);
  const [anular, setAnular] = useState<MovMaterial | null>(null);
  const [motivo, setMotivo] = useState('');
  const anu = useMutation({
    mutationFn: () => api.post<{ avisoCosto: string | null }>(`/materiales/movimientos/${anular!.id}/anular`, { motivo }),
    onSuccess: (r) => { avisar(r.avisoCosto ?? 'Movimiento anulado'); setAnular(null); setMotivo(''); inv(qc); }, onError: avisarError,
  });
  const m = det.data;
  return (
    <Modal titulo={m ? `${m.codigo} · ${m.nombre}` : 'Material'} onCerrar={onCerrar} ancho="max-w-3xl">
      {!m ? <Cargando /> : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div><div className="etiqueta">Stock</div><div className="text-xl font-bold">{m.stockMil === null ? 'No lleva stock' : `${cant(m.stockMil)} ${UNIDADES[m.unidad]}`}</div></div>
            {m.costoCentavos !== undefined && <div><div className="etiqueta">Costo por {m.unidad}</div><div className="text-xl font-bold">{m.costoCentavos === null ? <Pendiente /> : pesos(m.costoCentavos)}</div></div>}
            <div><div className="etiqueta">Proveedor</div><div>{m.proveedor ?? '—'}</div></div>
          </div>
          {m.porColor && !!m.stockColores?.length && (
            <div><div className="etiqueta mb-1">Por color</div>
              <div className="flex flex-wrap gap-1.5 text-sm">{m.stockColores.map((c) => <span key={`${c.colorId}-${c.ubicacionProveedorId}`} className={`pildora ${c.cantidadMil < 0 ? 'bg-bordo/10 text-bordo' : 'bg-arena/40'}`}>{c.color}{c.ubicacionProveedorId !== null ? ` (${c.ubicacion})` : ''}: {cant(c.cantidadMil)} {m.unidad}</span>)}</div>
            </div>
          )}
          {m.ubicaciones && m.ubicaciones.length > 1 && (
            <div className="flex flex-wrap gap-1.5 text-sm">{m.ubicaciones.map((u) => <span key={u.ubicacionProveedorId ?? 'l'} className="pildora bg-arena/40">{u.ubicacion}: {cant(u.cantidadMil)} {m.unidad}</span>)}</div>
          )}
          <div className="flex flex-wrap gap-2">
            {puede('materiales', 'modificar') && <button className="btn-secundario btn-chico" onClick={() => onEditar(m)}>Editar</button>}
            {m.tipo === 'material' && puede('materiales', 'crear') && puede('costos') && <button className="btn-primario btn-chico" onClick={() => setAccion('compra')}><PackagePlus className="h-3 w-3" />Cargar compra</button>}
            {m.tipo === 'material' && puede('materiales', 'modificar') && <button className="btn-secundario btn-chico" onClick={() => setAccion('ajuste')}><SlidersHorizontal className="h-3 w-3" />Ajustar stock</button>}
            {m.tipo === 'material' && puede('materiales', 'modificar') && <button className="btn-secundario btn-chico" onClick={() => setContar(true)}>Cargar conteo</button>}
          </div>
          {m.usadoEn.length > 0 && (
            <div><div className="etiqueta mb-1">Se usa en</div>
              <div className="flex flex-wrap gap-1.5 text-sm">{m.usadoEn.map((u, i) => <span key={i} className="pildora bg-arena/40">{u.modelo}: {cant(u.cantidadMil)} {m.unidad}{u.talles ? ` (talle ${u.talles.join(', ')})` : ''}</span>)}</div>
            </div>
          )}
          <div>
            <div className="etiqueta mb-1">Movimientos</div>
            {!m.movimientos.length ? <p className="text-sm text-carbon/50">Sin movimientos.</p> : (
              <div className="max-h-72 overflow-auto rounded border border-arena/60">
                <table className="tabla text-sm">
                  <thead><tr><th>Fecha</th><th>Tipo</th><th className="num">Cantidad</th><th className="num">Saldo</th><th className="hidden sm:table-cell">Detalle</th><th /></tr></thead>
                  <tbody>{m.movimientos.map((x) => (
                    <tr key={x.id} className={x.anulado ? 'text-carbon/40 line-through' : ''}>
                      <td>{fmtFecha(x.fecha + 'T12:00')}</td><td>{TIPOS_MOV[x.tipo]}{x.ubicacion && x.ubicacion !== 'Local' && <div className="text-xs text-carbon/55">{x.ubicacion}</div>}{m.porColor && <div className="text-xs text-carbon/55">{x.color ?? 'Sin color'}</div>}</td>
                      <td className={`num ${x.cantidadMil < 0 ? 'text-bordo' : ''}`}>{x.cantidadMil > 0 ? '+' : ''}{cant(x.cantidadMil)}</td><td className="num">{cant(x.saldoMil)}</td>
                      <td className="hidden sm:table-cell text-xs">{[x.proveedor, x.comprobante, x.motivo, x.costoUnitarioCentavos != null && x.tipo === 'compra' ? `${pesos(x.costoUnitarioCentavos)}/${m.unidad}` : null].filter(Boolean).join(' · ')}</td>
                      <td className="text-right">{!x.anulado && ['compra', 'ajuste', 'inicial'].includes(x.tipo) && puede('materiales', 'anular') && <button className="btn-secundario btn-chico" onClick={() => setAnular(x)}>Anular</button>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
          {m.historial && m.historial.length > 0 && (
            <div><div className="etiqueta mb-1">Historial de costo</div>
              <ul className="space-y-0.5 text-sm">{m.historial.slice(0, 8).map((h) => <li key={h.id}>{fmtFecha(h.fecha)}: {h.anteriorCentavos == null ? 'pendiente' : pesos(h.anteriorCentavos)} → <b>{h.nuevoCentavos == null ? 'pendiente' : pesos(h.nuevoCentavos)}</b> <span className="text-carbon/50">{h.motivo ?? h.origen}</span></li>)}</ul>
            </div>
          )}
        </div>
      )}
      {m && accion && <MovimientoMaterial material={m} tipo={accion} onCerrar={() => setAccion(null)} />}
      {m && contar && <ConteoMaterial material={m} onCerrar={() => setContar(false)} />}
      {anular && (
        <Confirmar titulo="Anular movimiento" textoBoton="Anular" peligro ocupado={anu.isPending} onCerrar={() => setAnular(null)} onConfirmar={() => anu.mutate()}>
          <p className="mb-3 text-sm">Se agrega un movimiento contrario de {cant(-anular.cantidadMil)}. {anular.tipo === 'compra' && anular.proveedor ? `También se descuenta de la cuenta de ${anular.proveedor}.` : ''}</p>
          <Campo etiqueta="Motivo"><input className="entrada" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus /></Campo>
        </Confirmar>
      )}
    </Modal>
  );
}

/** "Hoy hay X": el sistema agrega la diferencia contra lo que tenía (no pisa lo consumido). */
function ConteoMaterial({ material, onCerrar }: { material: DetalleMaterial; onCerrar: () => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState({ fecha: hoy(), cantidad: '', motivo: '', lugar: '' });
  const [color, setColor] = useState<number | null | undefined>(undefined);
  const falta = material.porColor && color === undefined;
  const n = d.cantidad.trim() === '' ? NaN : leerCant(d.cantidad);
  const lugares = useQuery({ queryKey: ['custodia-lugares'], queryFn: () => api.get<{ ubicacionProveedorId: number | null; nombre: string }[]>('/custodia/lugares') });
  const lugarId = d.lugar === '' ? null : Number(d.lugar);
  const actual = material.porColor
    ? (material.stockColores ?? []).find((u) => u.ubicacionProveedorId === lugarId && u.colorId === (color ?? null))?.cantidadMil ?? 0
    : (material.ubicaciones ?? []).find((u) => u.ubicacionProveedorId === lugarId)?.cantidadMil ?? 0;
  const g = useMutation({
    mutationFn: () => api.post(`/materiales/${material.id}/conteo`, { fecha: d.fecha, contadoMil: n, motivo: d.motivo || null, ubicacionProveedorId: lugarId, colorId: color ?? null }, true),
    onSuccess: () => { avisar('Conteo cargado'); inv(qc); onCerrar(); }, onError: avisarError,
  });
  return (
    <Modal titulo={`Conteo de ${material.nombre}`} onCerrar={onCerrar}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (n >= 0 && !falta) g.mutate(); }}>
        {material.porColor && <Campo etiqueta="Color" ayuda="Se cuenta cada color por separado."><SelectorColor valor={color} onCambio={setColor} /></Campo>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Fecha"><input className="entrada" type="date" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} /></Campo>
          <Campo etiqueta={`Cuánto hay (${UNIDADES[material.unidad]})`}><input className="entrada" inputMode="decimal" autoFocus value={d.cantidad} onChange={(e) => setD({ ...d, cantidad: e.target.value })} /></Campo>
        </div>
        <Campo etiqueta="Dónde se contó"><select className="entrada" value={d.lugar} onChange={(e) => setD({ ...d, lugar: e.target.value })}>{lugares.data?.map((l) => <option key={l.ubicacionProveedorId ?? 'l'} value={l.ubicacionProveedorId ?? ''}>{l.nombre === 'Local' ? 'En el local' : `En poder de ${l.nombre}`}</option>)}</select></Campo>
        <p className="text-sm text-carbon/70">El sistema tiene {cant(actual)} {material.unidad} ahí.{n >= 0 && <> Se agrega un movimiento de <b>{n - actual > 0 ? '+' : ''}{cant(n - actual)} {material.unidad}</b> para que quede en {cant(n)}.</>}</p>
        <Campo etiqueta="Notas (opcional)"><input className="entrada" value={d.motivo} onChange={(e) => setD({ ...d, motivo: e.target.value })} placeholder="Ej.: contado en el local" /></Campo>
        <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={!(n >= 0) || falta || g.isPending}>Guardar conteo</button></div>
      </form>
    </Modal>
  );
}

function MovimientoMaterial({ material, tipo, onCerrar }: { material: DetalleMaterial; tipo: 'compra' | 'ajuste'; onCerrar: () => void }) {
  const qc = useQueryClient();
  const aux = useQuery({ queryKey: ['aux'], queryFn: () => api.get<Aux>('/catalogo/aux') });
  const [d, setD] = useState({ fecha: hoy(), cantidad: '', costo: material.costoCentavos ?? null as number | null, proveedorId: material.proveedorId, comprobante: '', motivo: '', inicial: false, signo: 1 });
  const [color, setColor] = useState<number | null | undefined>(undefined);
  const n = leerCant(d.cantidad);
  const g = useMutation({
    mutationFn: () => {
      if (!(n > 0)) throw new Error('Indicá una cantidad mayor a cero');
      if (material.porColor && color === undefined) throw new Error('Elegí el color');
      if (tipo === 'compra') {
        if (d.costo == null) throw new Error('Indicá el costo por unidad');
        return api.post(`/materiales/${material.id}/ingresos`, { fecha: d.fecha, colorId: color ?? null, cantidadMil: n, costoUnitarioCentavos: d.costo, proveedorId: d.proveedorId, comprobante: d.comprobante || null, notas: d.motivo || null }, true);
      }
      return api.post(`/materiales/${material.id}/ajustes`, { fecha: d.fecha, colorId: color ?? null, cantidadMil: d.inicial ? n : n * d.signo, motivo: d.motivo, tipo: d.inicial ? 'inicial' : 'ajuste' }, true);
    },
    onSuccess: () => { avisar(tipo === 'compra' ? 'Compra cargada' : 'Stock ajustado'); inv(qc); onCerrar(); }, onError: avisarError,
  });
  return (
    <Modal titulo={tipo === 'compra' ? `Compra de ${material.nombre}` : `Ajustar ${material.nombre}`} onCerrar={onCerrar}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); g.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Fecha"><input className="entrada" type="date" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} required /></Campo>
          {material.porColor && <Campo etiqueta="Color"><SelectorColor valor={color} onCambio={setColor} /></Campo>}
          {tipo === 'ajuste' && !d.inicial && <Campo etiqueta="Qué pasó"><select className="entrada" value={d.signo} onChange={(e) => setD({ ...d, signo: Number(e.target.value) })}><option value={1}>Sobró / apareció</option><option value={-1}>Faltó / se usó / se rompió</option></select></Campo>}
          <Campo etiqueta={`Cantidad (${UNIDADES[material.unidad]})`}><input className="entrada text-right" inputMode="decimal" value={d.cantidad} onChange={(e) => setD({ ...d, cantidad: e.target.value })} placeholder="1,5" required autoFocus /></Campo>
          {tipo === 'compra' && <Campo etiqueta={`Costo por ${material.unidad}`}><Importe valor={d.costo} onCambio={(c) => setD({ ...d, costo: c })} /></Campo>}
          {tipo === 'compra' && <Campo etiqueta="Proveedor" ayuda="Suma a su cuenta corriente, se paga desde Pagos a proveedores."><select className="entrada" value={d.proveedorId ?? ''} onChange={(e) => setD({ ...d, proveedorId: e.target.value ? Number(e.target.value) : null })}><option value="">— (pagado en el momento)</option>{aux.data?.proveedores.filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>}
          {tipo === 'compra' && <Campo etiqueta="Comprobante"><input className="entrada" value={d.comprobante} onChange={(e) => setD({ ...d, comprobante: e.target.value })} /></Campo>}
        </div>
        <Campo etiqueta={tipo === 'compra' ? 'Notas' : 'Motivo'}><input className="entrada" value={d.motivo} onChange={(e) => setD({ ...d, motivo: e.target.value })} required={tipo === 'ajuste'} /></Campo>
        {tipo === 'ajuste' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.inicial} onChange={(e) => setD({ ...d, inicial: e.target.checked })} />Es el stock inicial (primera carga)</label>}
        {tipo === 'compra' && n > 0 && d.costo != null && <p className="text-sm">Total: <b>{pesos(Math.round((d.costo * n) / 1000))}</b>. El costo del material pasa a ser el promedio entre lo que había y lo que entra.</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button><button className="btn-primario" disabled={g.isPending}>Guardar</button></div>
      </form>
    </Modal>
  );
}
