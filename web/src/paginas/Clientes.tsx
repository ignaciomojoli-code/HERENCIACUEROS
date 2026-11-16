import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Plus } from 'lucide-react';
import { useSesion } from '../sesion';
import { Cargando, Encabezado, ErrorCarga, Vacio } from '../componentes/ui';
import { Th, coincide, useOrden } from '../componentes/Orden';
import { pesos } from '../formato';
import { fechaCorta } from '../plata';
import { ModalCliente, Tarjeta, useClientes, type Cliente } from './Ventas';

/** Clientes y lo que deben. Cada cliente lleva a sus ventas. */
export function PaginaClientes() {
  const { puede } = useSesion();
  const nav = useNavigate();
  const clientes = useClientes();
  const [q, setQ] = useState('');
  const [soloDeuda, setSoloDeuda] = useState(false);
  const [editar, setEditar] = useState<Cliente | 'nuevo' | null>(null);
  const visibles = (clientes.data ?? []).filter((c) => coincide(q, c.nombre, c.telefono, c.email, c.documento, c.notas) && (!soloDeuda || c.saldoCentavos > 0));
  const { filas, orden } = useOrden(visibles, { nombre: (c) => c.nombre, saldo: (c) => c.saldoCentavos, ventas: (c) => c.ventas, ultima: (c) => c.ultimaCompra }, { col: 'nombre', dir: 'asc' });
  const deuda = (clientes.data ?? []).reduce((s, c) => s + c.saldoCentavos, 0);
  const deudores = (clientes.data ?? []).filter((c) => c.saldoCentavos > 0).length;
  return (
    <>
      <Encabezado titulo="Clientes" sub="Quién compró y quién debe. Para que una venta quede con saldo a cobrar, tiene que tener cliente.">
        {puede('ventas', 'crear') && <button className="btn-primario" onClick={() => setEditar('nuevo')}><Plus className="h-4 w-4" />Nuevo cliente</button>}
      </Encabezado>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tarjeta titulo="Clientes" valor={clientes.data?.length ?? '—'} />
        <Tarjeta titulo="Falta cobrar" valor={pesos(deuda)} tono={deuda > 0 ? 'bordo' : undefined} sub={deudores ? `${deudores} ${deudores === 1 ? 'cliente debe' : 'clientes deben'}` : 'nadie debe'} />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="entrada max-w-sm" placeholder="Nombre, teléfono, DNI…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={soloDeuda} onChange={(e) => setSoloDeuda(e.target.checked)} />Solo los que deben</label>
      </div>
      {clientes.isLoading ? <Cargando /> : clientes.isError ? <ErrorCarga error={clientes.error} /> : !filas.length ? <Vacio>{clientes.data!.length ? 'Ningún cliente coincide.' : 'Todavía no hay clientes. Se crean acá o desde una venta.'}</Vacio> : (
        <div className="tarjeta overflow-x-auto">
          <table className="tabla">
            <thead><tr><Th col="nombre" orden={orden}>Cliente</Th><Th col="ventas" orden={orden} className="num">Compras</Th><Th col="ultima" orden={orden} className="hidden sm:table-cell">Última</Th><Th col="saldo" orden={orden} className="num">Debe</Th><th /></tr></thead>
            <tbody>
              {filas.map((c) => (
                <tr key={c.id} className={`cursor-pointer ${c.activo ? '' : 'text-carbon/40'}`} onClick={() => nav(`/ventas?cliente=${c.id}&desde=2000-01-01`)}>
                  <td><b>{c.nombre}</b>{!c.activo && ' (inactivo)'}<div className="text-xs text-carbon/55">{[c.telefono, c.documento, c.email].filter(Boolean).join(' · ')}</div></td>
                  <td className="num">{c.ventas}</td>
                  <td className="hidden sm:table-cell">{fechaCorta(c.ultimaCompra)}</td>
                  <td className={`num ${c.saldoCentavos > 0 ? 'font-medium text-bordo' : 'text-carbon/40'}`}>{c.saldoCentavos > 0 ? pesos(c.saldoCentavos) : '—'}</td>
                  <td className="text-right">{puede('ventas', 'modificar') && <button className="p-1 text-carbon/40 hover:text-carbon" aria-label="Editar" onClick={(e) => { e.stopPropagation(); setEditar(c); }}><Pencil className="h-4 w-4" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editar && <ModalCliente cliente={editar === 'nuevo' ? undefined : editar} onCerrar={() => setEditar(null)} />}
    </>
  );
}
