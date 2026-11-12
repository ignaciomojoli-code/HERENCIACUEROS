/** Cliente de la API. Todas las llamadas usan la cookie de sesión. */
export class ErrorApi extends Error {
  constructor(message: string, public status: number, public detalles?: unknown) { super(message); }
}

async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown, opciones: { idempotente?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (cuerpo instanceof FormData) body = cuerpo;
  else if (cuerpo !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(cuerpo); }
  if (opciones.idempotente) headers['idempotency-key'] = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  let r: Response;
  try {
    r = await fetch('/api' + ruta, { method: metodo, headers, body, credentials: 'same-origin' });
  } catch {
    throw new ErrorApi('No hay conexión con el sistema. Revisá que la compu del local esté prendida y en la misma red.', 0);
  }
  if (r.status === 401 && !ruta.startsWith('/login')) window.dispatchEvent(new Event('sesion-vencida'));
  const tipo = r.headers.get('content-type') ?? '';
  const datos = tipo.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new ErrorApi((datos as { error?: string })?.error ?? 'Error inesperado', r.status, (datos as { detalles?: unknown })?.detalles);
  return datos as T;
}

export const api = {
  get: <T>(ruta: string) => pedir<T>('GET', ruta),
  post: <T>(ruta: string, cuerpo?: unknown, idempotente = false) => pedir<T>('POST', ruta, cuerpo ?? {}, { idempotente }),
  put: <T>(ruta: string, cuerpo: unknown) => pedir<T>('PUT', ruta, cuerpo),
};

export const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? '?' + s : '';
};
