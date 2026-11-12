/** Error de negocio con mensaje para mostrar al usuario y código HTTP. */
export class ErrorNegocio extends Error {
  constructor(message: string, public readonly status = 400, public readonly detalles?: unknown) {
    super(message);
  }
}
export const noEncontrado = (que: string) => new ErrorNegocio(`${que} no existe`, 404);
