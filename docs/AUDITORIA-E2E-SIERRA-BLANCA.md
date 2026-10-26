# Auditoría E2E de Sierra Blanca

El workflow .github/workflows/auditoria-sierra-blanca-e2e.yml ejecuta el test cada lunes a las 03:00 de Europe/Madrid y también permite ejecución manual desde Actions.

## GitHub: secretos y variables

En Settings → Secrets and variables → Actions, crea estos Repository secrets:

- TS_OAUTH_CLIENT_ID: OAuth Client ID de Tailscale.
- TS_OAUTH_SECRET: OAuth Client secret de Tailscale.
- HA_BASE_URL: URL de HA accesible por Tailscale, por ejemplo http://100.x.y.z:8123.
- HA_TOKEN: token de Home Assistant.
- TURSO_DATABASE_URL: libsql://sierra-blanca-consumo-naravena.aws-eu-west-1.turso.io
- TURSO_AUTH_TOKEN: token de Turso con permisos de lectura.
- PORTAL_PASSWORD: contraseña usada para iniciar sesión en el portal.

Crea también la Repository variable PORTAL_BASE_URL con el valor:
https://historico-sierra-blanca-final.vercel.app

No subas tokens ni contraseñas al repositorio.

## Tailscale

1. Configura la etiqueta tag:ci en la consola de administración de Tailscale.
2. Crea un OAuth client con permisos auth_keys y autorización para asignar tag:ci.
3. En la política de acceso de Tailscale permite a tag:ci acceder únicamente al dispositivo Home Assistant por TCP 8123.
4. Usa la IP Tailscale de HA en HA_BASE_URL. No expongas el puerto de HA a Internet.
5. Guarda el Client ID y el Client secret como secretos de GitHub.

Usa un token de Home Assistant asociado a un usuario dedicado con los permisos mínimos que permitan consultar el historial.

## Qué valida

- Consulta el histórico de ambos sensores directamente desde la API de Home Assistant.
- Consulta las lecturas raw del día en la tabla historical_data de Turso y compara timestamps, valores, cantidad de puntos y consumo diario.
- Ejecuta la función de consulta del portal contra Turso directamente, sin pasar por la API web.
- Inicia sesión en el portal y compara /api/consumo con el resultado SQL directo.
- Falla el workflow si encuentra diferencias y publica el informe en el resumen de GitHub Actions.

El test es de solo lectura. La tolerancia por defecto del consumo diario es 0.05 kWh.

## Primera ejecución

Tras guardar secretos y variable, ve a Actions → Auditoría E2E Sierra Blanca → Run workflow. Revisa el resumen de ejecución. Si falla, el mensaje indicará la comprobación que no coincide.
