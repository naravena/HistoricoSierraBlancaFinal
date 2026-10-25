# Histórico Sierra Blanca

Portal de consulta del historial de consumo de Planta Baja y Planta Alta. El backend consulta **Turso (libSQL/SQLite)**.

## Tabla histórica unificada

El portal lee el histórico desde `historical_data`, que conserva en una misma tabla:

- `record_type = 'reading'`: lecturas originales, con `value` y su timestamp.
- `record_type = 'statistics'`: estadísticas de Home Assistant, conservando `mean`, `mean_weight`, `min`, `max`, `last_reset_at`, `state` y `sum`.

Las tablas antiguas `readings` y `energy_statistics` se mantienen como respaldo; el portal no las consulta. No las borres hasta completar las comprobaciones.

## Configuración local

1. Instala dependencias con `pnpm install`.
2. Copia `.env.example` a `.env` y completa `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_PASSWORD_HASH` y `JWT_SECRET`.
3. Ejecuta `pnpm turso:init` para crear la tabla histórica e índices si no existen.
4. Inicia con `pnpm dev` y abre http://localhost:3000.

## Importar nuevas lecturas CSV

El CSV debe estar en UTF-8 y contener estas cabeceras:

~~~csv
entity_id,recorded_at,value
sensor.sierra_blanca_energia_consumida_a,2026-01-01T00:00:00.000Z,1234.5
sensor.sierra_blanca_energia_consumida_b,2026-01-01T00:00:00.000Z,2345.6
~~~

Guárdalo como `readings.csv` en la raíz y ejecuta:

~~~bash
pnpm turso:importar -- readings.csv
~~~

El importador escribe en `historical_data`, omite entidades/timestamps ya existentes y no modifica las tablas antiguas. Conserva el CSV original hasta verificar el resultado. No compartas ni subas el token de Turso.

## Auditoría del histórico

Ejecuta:

~~~bash
pnpm turso:auditar
~~~

El informe muestra recuentos, fechas y valores nulos por entidad, timestamps duplicados y una comparación orientativa entre `energy_statistics.state` y la lectura más cercana de los sensores de energía que también tengan lecturas, con una tolerancia de cinco minutos.

**Límite importante:** esa comparación comprueba coherencia interna de los datos disponibles en Turso; no certifica por sí sola que los datos coincidan con Home Assistant. Para validar el origen hay que comparar contra una exportación de Home Assistant del mismo periodo.

Para detectar días sin lecturas de Planta Baja o Planta Alta:

~~~bash
pnpm turso:huecos
pnpm turso:huecos -- 2026-10-01 2026-10-25
~~~

Detecta días sin ninguna lectura; no detecta interrupciones de unas horas si ese día sí tiene alguna lectura.

## Despliegue en Vercel

En Project → Settings → Environment Variables configura `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_PASSWORD_HASH`, `JWT_SECRET` y `NODE_ENV=production`. Después, vuelve a desplegar.

## Cálculo del consumo

El portal calcula consumo como diferencias positivas entre lecturas consecutivas, ignorando resets del contador. Incluye una lectura anterior al comienzo del periodo para calcular el primer incremento. Las fechas seleccionadas en el portal son inclusivas, incluido el día final. La ordenación usa la fecha/hora interpretada por SQLite para no depender del orden lexicográfico de timestamps con diferentes offsets.
