# Puente Sierra Blanca

Copia esta carpeta completa a `/addons/haos-bridge` en Home Assistant OS. En la tienda de complementos, recarga la lista e instala **Puente Sierra Blanca** desde los complementos locales.

En Configuración, introduce un token nuevo de Home Assistant en `ha_token` y el secreto compartido con Vercel en `ha_bridge_secret`. El origen por defecto es `http://127.0.0.1:8123`. Inicia el complemento y activa **Iniciar al arrancar**.

El puente escucha en el puerto 8787 del loopback del equipo. Configura Funnel en el complemento Tailscale con destino `http://127.0.0.1:8787`, si esa dirección es alcanzable desde su entorno. Mantén desactivada la publicación de Home Assistant completo. Copia la URL HTTPS de Funnel, incluido su puerto si lo muestra, en `HA_BRIDGE_URL` de Vercel Preview. Usa el mismo secreto en `HA_BRIDGE_SECRET` y redepliega.

Desde fuera de Tailscale, una consulta a `/api/ha/raw` sin el secreto debe responder HTTP 401. Prueba después un día reciente en `/ha-raw.html` con una sesión del portal.
