import { useSesion } from '../sesion';
import { Encabezado, avisar } from '../componentes/ui';
import { FormCambioPassword } from './Ingreso';

export function PaginaMiCuenta() {
  const { usuario } = useSesion();
  return (
    <>
      <Encabezado titulo="Mi cuenta" sub={`${usuario.nombre} · usuario ${usuario.usuario} · rol ${usuario.rol}`} />
      <div className="tarjeta max-w-md p-5">
        <h2 className="mb-4 text-lg font-bold">Cambiar contraseña</h2>
        <FormCambioPassword alTerminar={() => avisar('Contraseña cambiada.')} />
      </div>
    </>
  );
}
