# Histórico Sierra Blanca

Portal simple de consulta del historial de consumo (Planta Baja / Planta Alta). Requiere que la sincronización de Home Assistant → Supabase ya esté funcionando (`readings` con datos).

## Local

```bash
npm install
cp .env.example .env
npm run generar-hash "TuContraseñaSegura"   # copia el resultado a ADMIN_PASSWORD_HASH en .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # copia a JWT_SECRET
# rellena también SUPABASE_DB_URL en .env
npm run dev
```

Abre `http://localhost:3000` — te pedirá contraseña.

## GitHub + Vercel

```bash
git init && git add . && git commit -m "Histórico Sierra Blanca"
git remote add origin https://github.com/TU_USUARIO/historico-sierra-blanca.git
git branch -M main && git push -u origin main
```

En Vercel: **Add New → Project** → importa el repo → Framework: **Other** → antes de desplegar, añade en **Environment Variables**:

| Variable | Valor |
|---|---|
| `SUPABASE_DB_URL` | tu cadena de conexión de Supabase (o deja que la integración Vercel↔Supabase rellene `POSTGRES_URL`, también se acepta) |
| `ADMIN_PASSWORD_HASH` | el hash generado arriba |
| `JWT_SECRET` | el valor aleatorio generado arriba |
| `NODE_ENV` | `production` |

Deploy. Listo — solo tú puedes entrar, con tu contraseña.

## Qué hace y qué no hace (a propósito, para mantenerlo pequeño)

- Un único endpoint de datos (`/api/consumo`), una única pantalla.
- El consumo se calcula por deltas positivos (ignora resets del contador), igual que en el proyecto principal — es lo único "no trivial" del backend.
- Analiza facturas PDF de Repsol, extrae kWh, precio de energía €/kWh, periodo y total, y calcula el reparto del importe entre Planta Baja / Planta Alta usando el consumo real registrado.
- El cálculo del consumo incluye la lectura anterior al inicio del periodo para no perder el primer delta y respeta el día final de la factura.
