# Histórico Sierra Blanca

Portal de consulta del historial de consumo de Planta Baja y Planta Alta. El backend consulta **Turso (libSQL/SQLite)**.

## Tabla histórica unificada

El portal lee el histórico desde `historical_data`, que conserva en una misma tabla:

- `record_type = 'reading'`: lecturas originales, con `value` y su timestamp.
- `record_type = 'statistics'`: estadísticas de Home Assistant, conservando `mean`, `mean_weight`, `min`, `max`, `last_reset_at`, `state` y `sum`.

Las tablas antiguas `readings` y `energy_statistics` quedan **deprecadas** y se mantienen en Turso como respaldo; no deben recibir nuevas escrituras ni ser consultadas por el portal. No las borres. Home Assistant y la web deben usar exclusivamente `historical_data`. Consulta [la guía de integración de Home Assistant](docs/INTEGRACION-HOME-ASSISTANT-TURSO.md) para actualizar la automatización.

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

## Criterio de auditoría diaria

La auditoría debe separar dos dimensiones y no mezclarlas:

1. **Exactitud del sumatorio diario (criterio principal):** comparar, para cada planta y fecha local de Europe/Madrid, el consumo diario de Home Assistant con el consumo diario calculado por el portal. El día/planta pasa si la diferencia absoluta es menor o igual a 0,05 kWh. El total diario se calcula como Planta Baja + Planta Alta y se compara también con el total de Home Assistant.
2. **Cobertura de lecturas (diagnóstico secundario):** informar por separado del número de muestras y la última hora disponible en Home Assistant y Turso. Una cantidad distinta de muestras o una última lectura más temprana en Turso debe generar una advertencia de cobertura, no un fallo automático del sumatorio si la diferencia de energía diaria está dentro de tolerancia.

Estados recomendados:
- `OK`: sumatorio diario dentro de tolerancia y datos suficientes para calcular ambas plantas.
- `FALLO SUMATORIO`: una planta o el total diario supera la tolerancia de 0,05 kWh.
- `COBERTURA PARCIAL`: faltan muestras, el último dato queda demasiado lejos del cierre del día o no hay datos suficientes para validar el sumatorio. Debe mostrarse aparte del resultado numérico.
- `SIN DATOS`: no hay lecturas utilizables para una planta en ese día.

No se deben comparar como si fueran equivalentes los **recuentos de muestras** ni los acumulados derivados de series con distinta frecuencia. Home Assistant puede conservar más estados que la automatización que envía una muestra cada 15 minutos a Turso. La frecuencia de captura no debe aumentarse solo para igualar recuentos: primero se debe comprobar la diferencia del sumatorio diario y la cobertura del cierre del día.

**Ejemplo:** si Home Assistant suma 5,75 kWh y el portal 5,77 kWh, la diferencia es 0,02 kWh y pasa el umbral de 0,05 kWh. Si Turso tiene 96 muestras frente a 240 en Home Assistant, la cobertura debe señalarse como distinta, pero eso por sí solo no convierte el sumatorio en un fallo. Si el sumatorio está dentro de tolerancia pero faltan datos al cierre, el resultado global debe indicar «sumatorio OK; cobertura parcial», no ocultar la advertencia.
