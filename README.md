# Herencia Cuero · Sistema de gestión

Sistema de gestión para Herencia Cuero (Malabia 48, Villa Crespo). Corre en la compu del local y se usa desde el navegador de esa compu o desde cualquier celular o tablet conectado al mismo Wi-Fi.

## Qué incluye esta versión (entregas 1 a 5)

- **Ingreso con usuario y contraseña**, roles y permisos por módulo y acción (ver, crear, modificar, aprobar, anular, exportar). Siete roles de partida; el de Administrador no se puede modificar.
- **Catálogo**: productos con variantes por color y talle, código (SKU) y código de barras únicos, costo (vacío = pendiente), precios por lista (Efectivo / transferencia y Tarjeta), historial de costos y precios, duplicar, desactivar sin borrar, vista color × talle.
- **Precios**: cambios masivos (porcentaje, desde otra lista o precio fijo) con vista previa; aplicar requiere permiso de aprobación y motivo, y se rechaza si algo cambió desde la vista previa. Margen y markup siempre por separado.
- **Importar planilla** (.xlsx o .csv): detecta la fila de títulos, sugiere las columnas, muestra fila por fila qué va a pasar (nuevo, cambia, igual, duplicada, error) y solo actualiza lo existente si se tilda explícitamente. Todo en una transacción.
- **Exportar** catálogo a Excel o CSV eligiendo columnas (los costos solo salen para roles que pueden verlos).
- **Proveedores**, **configuración** (lo desconocido queda "pendiente"), **auditoría** de cada cambio con antes y después, **copias de seguridad** automáticas cada N horas con retención, descarga y restauración (con copia previa automática).
- **Stock por movimientos** (entrega 2): el stock es la suma de un libro de movimientos que no se edita ni se borra. Ajustes con motivo, conteos físicos desde el celular (con lector de código de barras) que ajustan solo lo contado, carga de stock inicial desde planilla, alertas de bajo mínimo y negativos, valorización al costo y a precio, exportación.
- **Compras** (entrega 2): pedidos a proveedores (reventa) y al taller (confección), recepciones parciales con remito, cierre con pendientes, anulación de recepciones con movimientos contrarios. En reventa el costo se actualiza por promedio ponderado; en confección entra stock sin pisar el costo (el costo completo llega con el módulo de producción).
- **Ventas** (entrega 3): con lector de código de barras, precio de la lista elegida (efectivo o tarjeta) y precio cobrado editable (queda registrada la diferencia contra lista). Se cobra en una o varias formas de pago, también en dólares. Descuentan stock, guardan el costo del momento y calculan comisión y ganancia (que solo ven los roles con permiso de costos). Se anulan con movimientos contrarios de stock y de plata.
- **Caja** (entrega 3): cuentas (efectivo, Mercado Pago, Cuenta DNI, tarjetas a liquidar, dólares, inversor externo) con saldo calculado de un libro de movimientos. Pases entre cuentas (también cambio de dólares), liquidaciones de tarjetas (la diferencia entre bruto y neto queda como comisión real), aportes, retiros personales (no cuentan como gasto) y arqueos (la diferencia queda como "diferencia de caja no identificada"). Formas de pago con su cuenta, lista de precios y comisión estimada, editables.
- **Gastos** (entrega 3): con categorías y subcategorías editables. Si los paga el inversor externo, queda registrado como aporte suyo sin mover la plata del local.
- **Pagos a proveedores** (entrega 3): pagos asociados o no a un pedido, y cuenta corriente por proveedor (entregado al costo del pedido menos pagado).
- **Materiales** (entrega 4): cuero, forros, avíos y mano de obra con costo (vacío = pendiente) e historial. Stock en metros/unidades por movimientos: compras (el costo pasa a promedio ponderado y el importe suma a la cuenta corriente del proveedor), ajustes, stock inicial y anulaciones. Aviso de reposición por mínimo o negativo.
- **Recetas y costeo** (entrega 4): qué lleva cada modelo, con agregados por talle (ej. cuero extra en 7 y 8). Calcula el costo de cada prenda (materiales + mano de obra + otros costos configurables: monto fijo, % sobre costo o % sobre precio) y lo compara con el cargado. Solo se aplica lo elegido, con motivo, y no se aplica si falta el costo de algún material.
- **Precios sugeridos** (entrega 4): precio que deja el margen o markup buscado, descontando los % sobre el precio, con el margen que deja hoy cada prenda. Publicar requiere permiso de aprobación, motivo, y se rechaza si el precio cambió mientras se miraba.
- **Producción** (entrega 4): al recibir prendas del taller se descuentan los materiales de su receta; si se anula la recepción, vuelven.
- **Panel de inicio** (entrega 5): ventas, cantidad y ticket promedio, ganancia bruta, resultado y plata en cuentas del período elegido (hoy, 7 días, mes, mes anterior, año o fechas a elección), comparados con el período anterior; ventas por día, cómo se cobró, lo más vendido, ventas por categoría y gastos. Cada rol ve solo lo que su permiso permite (sin permiso de costos no aparece costo ni ganancia).
- **Alertas** (entrega 5): stock negativo o bajo mínimo, materiales para reponer, pedidos atrasados, productos sin costo o sin precio, costos que no coinciden con la receta, materiales sin costo, ventas debajo del costo, cuentas en negativo, tarjetas sin liquidar, arqueos atrasados, deuda con proveedores, cotización pendiente y copias de seguridad atrasadas. Los plazos se configuran.
- **Reportes** (entrega 5): estado de resultados mes por mes (ventas, costo, comisiones, ganancia bruta, gastos por categoría, resultado; retiros y aportes aparte), ventas por producto con ganancia y margen, y stock sin movimiento con su valor al costo. Todos se bajan a Excel o CSV.
- Identidad del Manual de marca 2026: Playfair Display + Jost, negro carbón, marfil, crema, dorado arena, bordó y coñac. El rojo oferta queda reservado a ofertas.

Siguiente etapa: carga de los datos reales, pruebas en el local e instalación.

## Instalación en la compu del local (Windows)

1. Instalar **Node.js 22 LTS** desde nodejs.org (opciones por defecto).
2. Copiar esta carpeta a la compu (por ejemplo `C:\HerenciaCuero`).
3. Doble clic en **`instalar.bat`** (una sola vez; tarda unos minutos).
4. Doble clic en **`Iniciar Herencia.bat`**. Se abre el navegador; la primera vez pide crear el usuario administrador.
5. Para entrar desde el celular: la ventana muestra la dirección (algo como `http://192.168.0.15:3800`). Si Windows pregunta por el firewall, permitir el acceso en redes privadas.

Para que arranque solo al prender la compu: poner un acceso directo a `Iniciar Herencia.bat` en la carpeta de inicio (`Win + R` → `shell:startup`).

### Dónde quedan los datos

- Base de datos: `datos\herencia.db` (se puede cambiar con la variable `HERENCIA_DATOS`).
- Copias de seguridad: `datos\backups\`, o la carpeta que se elija en Configuración (recomendado: una carpeta sincronizada con Google Drive).
- **Los datos reales nunca van al repositorio**: `datos/`, `*.db`, `*.xlsx` y `*.csv` están excluidos en `.gitignore`.

## Desarrollo

```bash
npm install
npm run dev        # API en :3800 y pantalla en :5173 con recarga automática
npm test           # pruebas automáticas (base temporal, datos DEMO)
npm run typecheck
npm run build && npm start
```

Stack: Node 22 + TypeScript, Fastify, SQLite (better-sqlite3, modo WAL) con Drizzle y migraciones, React + Vite + Tailwind. La plata se guarda en centavos enteros y los porcentajes en puntos básicos (1% = 100). Cada operación va en una transacción junto con su registro de auditoría; las altas sensibles aceptan `Idempotency-Key` para que un doble clic no registre dos veces.
