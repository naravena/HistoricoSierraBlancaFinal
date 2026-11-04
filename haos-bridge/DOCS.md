# Puente Sierra Blanca

Copia esta carpeta completa a `/local_apps/haos-bridge` desde Terminal & SSH 10.5.0 en Home Assistant OS. Versiones antiguas del complemento SSH pueden montar la carpeta local en `/addons`. En la tienda de complementos, recarga la lista e instala **Puente Sierra Blanca** desde los complementos locales.

En Configuración, introduce un token nuevo de Home Assistant en `ha_token` y el secreto compartido con Vercel en `ha_bridge_secret`. El origen por defecto es `http://127.0.0.1:8123`. Inicia el complemento y activa **Iniciar al arrancar**.

El puente escucha en el puerto 8787 del loopback del equipo. Configura Funnel en el complemento Tailscale con destino `http://127.0.0.1:8787`, si esa dirección es alcanzable desde su entorno. Mantén desactivada la publicación de Home Assistant completo. Copia la URL HTTPS de Funnel, incluido su puerto si lo muestra, en `HA_BRIDGE_URL` de Vercel Preview. Usa el mismo secreto en `HA_BRIDGE_SECRET` y redepliega.

Desde fuera de Tailscale, una consulta a `/api/ha/raw` sin el secreto debe responder HTTP 401. Prueba después un día reciente en `/ha-raw.html` con una sesión del portal.

## Actualización a 1.1.0

Vuelve a copiar los archivos de esta carpeta al complemento local y recarga la tienda. Actualiza **Puente Sierra Blanca** y reinícialo. Esta versión añade `/api/ha/summary`, conserva la configuración y usa el mismo puerto y secreto.

El sumatorio pide a Home Assistant `recorder/statistic_during_period` con `types: ["change"]`, para cada uno de los dos sensores en una sola conexión WebSocket. Solicita kWh y convierte los extremos inclusivos de Europe/Madrid a UTC. La primera carga devuelve solo dos valores, con un máximo de 366 días. No devuelve todas las lecturas.

Las estadísticas deben existir para los sensores y las fechas seleccionadas. Una serie ausente se devuelve como `null`; el consumo cero se conserva como cero. El sumatorio usa las estadísticas disponibles y no certifica por sí solo la cobertura completa. El detalle de estados se consulta solo cuando el usuario abre un día.
