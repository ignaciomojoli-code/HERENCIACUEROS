# Herencia Cuero · Sistema de gestión

Sistema de gestión para Herencia Cuero (Malabia 48, Villa Crespo). Corre en la compu del local y se usa desde el navegador de esa compu o desde cualquier celular o tablet conectado al mismo Wi-Fi.

## Qué incluye esta versión (entrega 1)

- **Ingreso con usuario y contraseña**, roles y permisos por módulo y acción (ver, crear, modificar, aprobar, anular, exportar). Siete roles de partida; el de Administrador no se puede modificar.
- **Catálogo**: productos con variantes por color y talle, código (SKU) y código de barras únicos, costo (vacío = pendiente), precios por lista (Efectivo / transferencia y Tarjeta), historial de costos y precios, duplicar, desactivar sin borrar, vista color × talle.
- **Precios**: cambios masivos (porcentaje, desde otra lista o precio fijo) con vista previa; aplicar requiere permiso de aprobación y motivo, y se rechaza si algo cambió desde la vista previa. Margen y markup siempre por separado.
- **Importar planilla** (.xlsx o .csv): detecta la fila de títulos, sugiere las columnas, muestra fila por fila qué va a pasar (nuevo, cambia, igual, duplicada, error) y solo actualiza lo existente si se tilda explícitamente. Todo en una transacción.
- **Exportar** catálogo a Excel o CSV eligiendo columnas (los costos solo salen para roles que pueden verlos).
- **Proveedores**, **configuración** (lo desconocido queda "pendiente"), **auditoría** de cada cambio con antes y después, **copias de seguridad** automáticas cada N horas con retención, descarga y restauración (con copia previa automática).
- Identidad del Manual de marca 2026: Playfair Display + Jost, negro carbón, marfil, crema, dorado arena, bordó y coñac. El rojo oferta queda reservado a ofertas.

Próximas entregas: stock y compras · ventas, cobros y caja · costos, producción y formación de precios · panel, reportes y alertas.

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
