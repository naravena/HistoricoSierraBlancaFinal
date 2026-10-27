# Auditoría de consumo de Sierra Blanca

Hay dos workflows en GitHub Actions:

1. **Auditoría automática Sierra Blanca**: se ejecuta cada lunes a las 03:00 (Europe/Madrid) y audita el día natural anterior completo.
2. **Auditoría manual por fechas - Sierra Blanca**: permite elegir fecha inicial y final. Para auditar un solo día, usa la misma fecha en ambos campos.

## Cómo ejecutar la auditoría manual

1. Abre la pestaña **Actions** del repositorio.
2. Selecciona **Auditoría manual por fechas - Sierra Blanca**.
3. Pulsa **Run workflow**.
4. Introduce `fecha_inicio` y `fecha_fin` con formato `YYYY-MM-DD` (por ejemplo, `2026-10-01` en ambos campos para auditar el 1 de octubre).
5. Pulsa **Run workflow** y abre el resumen de la ejecución.

El intervalo admite hasta 366 días por ejecución. Se consideran días completos de calendario en `Europe/Madrid`; la fecha final está incluida.

## Qué se compara

- Consumo diario acumulado de Planta Baja (`sensor.sierra_blanca_energia_consumida_a`) y Planta Alta (`sensor.sierra_blanca_energia_consumida_b`).
- Total de Sierra Blanca calculado como Planta Baja + Planta Alta.
- Home Assistant frente a lecturas raw de Turso por consumo diario, tolerancia predeterminada ±0,05 kWh.
- Cálculo SQL mediante `src/queries.js` frente a la API de consumo del portal.
- Días marcados como incompletos por el cálculo del portal.

No se incluye energía producida porque Sierra Blanca no tiene paneles solares. Tampoco se exige que cada muestra individual de HA tenga una pareja exacta en Turso: las frecuencias de registro pueden ser diferentes.

## Secretos y variables

Los workflows usan los secretos existentes:

- `TS_OAUTH_CLIENT_ID`
- `TS_OAUTH_SECRET`
- `HA_BASE_URL`
- `HA_TOKEN`
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `PORTAL_PASSWORD`

Y la variable `PORTAL_BASE_URL` (URL del portal).

No añadas tokens ni contraseñas al repositorio. La auditoría es de solo lectura y usa Tailscale para acceder a Home Assistant sin exponerlo a Internet.

## Nota de interpretación

El cálculo raw estima el consumo sumando las variaciones no negativas del contador entre muestras consecutivas. Si hay reinicios del contador, huecos largos o diferencias en la cobertura del historial, el resultado puede necesitar revisión. El informe separa el acumulado diario de las comprobaciones de consistencia.
