# Histórico Sierra Blanca

Portal de consulta del historial de consumo de Planta Baja y Planta Alta. El backend consulta **Turso (libSQL/SQLite)**; ya no necesita Supabase ni PostgreSQL.

## Requisitos

- Node.js 20 o superior (incluye fetch nativo).
- Una base de datos Turso creada.
- Las lecturas históricas de readings exportadas para su importación.

## Configuración local

1. Instala dependencias con pnpm install.
2. Copia .env.example a .env y completa TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, ADMIN_PASSWORD_HASH y JWT_SECRET.
3. Genera el hash de contraseña y copia el resultado a ADMIN_PASSWORD_HASH:

   ~~~bash
   pnpm generar-hash "TuContraseñaSegura"
   ~~~

4. Crea la tabla e índice en Turso:

   ~~~bash
   pnpm turso:init
   ~~~

5. Inicia el portal:

   ~~~bash
   pnpm dev
   ~~~

Abre http://localhost:3000.

## Migrar los datos históricos

La aplicación necesita una tabla readings con las columnas entity_id, recorded_at y value. El esquema se define en turso/schema.sql.

Exporta desde el origen los datos de readings a un CSV UTF-8 con estas cabeceras exactas:

~~~csv
entity_id,recorded_at,value
sensor.sierra_blanca_energia_consumida_a,2026-01-01T00:00:00.000Z,1234.5
sensor.sierra_blanca_energia_consumida_b,2026-01-01T00:00:00.000Z,2345.6
~~~

Guárdalo como readings.csv en la raíz y ejecuta:

~~~bash
pnpm turso:importar -- readings.csv
~~~

El importador inserta lotes y evita duplicar una lectura con la misma entidad y fecha. Conserva una copia del CSV original hasta verificar los resultados. No compartas el token de Turso ni lo subas al repositorio.

## Detectar días sin lecturas

No hace falta volver a importar datos si ya están en Turso. Para listar los días en los que no existe ninguna lectura de Planta Baja o Planta Alta, ejecuta:

~~~bash
pnpm turso:huecos
~~~

Por defecto revisa desde el primer hasta el último día con datos de cada sensor. También puedes indicar un rango inclusivo:

~~~bash
pnpm turso:huecos -- 2025-01-01 2026-10-25
~~~

El informe lista por separado los días vacíos de cada sensor. Detecta días sin ninguna lectura; no detecta interrupciones de unas horas si ese día sí tiene alguna lectura.

## Despliegue en Vercel

En Project → Settings → Environment Variables, configura:

| Variable | Descripción |
|---|---|
| TURSO_DATABASE_URL | URL libsql://... de Turso |
| TURSO_AUTH_TOKEN | Token de acceso de Turso |
| ADMIN_PASSWORD_HASH | Hash de la contraseña de acceso |
| JWT_SECRET | Secreto aleatorio para JWT |
| NODE_ENV | production |

Después, vuelve a desplegar. No configures variables de Supabase o PostgreSQL para esta versión.

## Funcionamiento

- El consumo se calcula como diferencias positivas entre lecturas consecutivas; se ignoran los resets del contador.
- Las consultas incluyen la lectura anterior al inicio del periodo para no perder el primer incremento.
- Analiza facturas PDF de Repsol y reparte el importe según el consumo registrado.
- El último día de una factura se incluye completo.
