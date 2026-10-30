const express = require("express");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const pdfParse = require("pdf-parse");

const pool = require("./db");
const auth = require("./auth");
const { consumoDiarioPorPlanta, consumoTotalPorPlanta } = require("./queries");
const { extraerDatosFactura } = require("./parseFactura");
const { repartirFactura } = require("./repartoFactura");

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(cookieParser());
app.use(express.static("frontend"));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera unos minutos." },
});

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.post("/api/auth/login", loginLimiter, async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: "Falta la contraseña" });

  const valido = await auth.verificarPassword(password);
  if (!valido) return res.status(401).json({ error: "Contraseña incorrecta" });

  res.cookie(auth.COOKIE_NAME, auth.emitirToken(), auth.cookieOptions);
  res.json({ ok: true });
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie(auth.COOKIE_NAME, auth.cookieOptions);
  res.json({ ok: true });
});

app.get("/api/auth/me", auth.middleware, (_req, res) => res.json({ ok: true }));

// Prueba de lectura cruda desde Home Assistant. Solo lectura; no consulta Turso.
app.get("/api/ha/raw", auth.middleware, async (req, res, next) => {
  try {
    const { desde, hasta } = req.query;
    const validDate = (value) => typeof value === "string" &&
      /^\\d{4}-\\d{2}-\\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
      new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
    if (!validDate(desde) || !validDate(hasta)) {
      return res.status(400).json({ error: "Usa fechas válidas con formato YYYY-MM-DD." });
    }
    if (hasta < desde) return res.status(400).json({ error: "'hasta' no puede ser anterior a 'desde'." });
    const days = (Date.parse(hasta + "T00:00:00Z") - Date.parse(desde + "T00:00:00Z")) / 86400000 + 1;
    if (days > 31) return res.status(400).json({ error: "La prueba permite consultar un máximo de 31 días." });

    const base = process.env.HA_BASE_URL;
    const token = process.env.HA_TOKEN;
    if (!base || !token) {
      return res.status(503).json({ error: "Configura HA_BASE_URL y HA_TOKEN en el entorno del servidor." });
    }

    // Convierte medianoche de Europe/Madrid a UTC, respetando horario de verano/invierno.
    const midnightMadrid = (day) => {
      const [y, m, d] = day.split("-").map(Number);
      const target = Date.UTC(y, m - 1, d);
      let guess = target;
      const formatter = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
      });
      for (let i = 0; i < 4; i++) {
        const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(p => [p.type, p.value]));
        guess += target - Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
      }
      return new Date(guess);
    };
    const [y, m, d] = hasta.split("-").map(Number);
    const nextDay = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    const start = midnightMadrid(desde);
    const end = midnightMadrid(nextDay);
    const entities = [
      "sensor.sierra_blanca_energia_consumida_a",
      "sensor.sierra_blanca_energia_consumida_b",
    ];
    const url = new URL(base.replace(/\\/+$/, "") + "/api/history/period/" + encodeURIComponent(start.toISOString()));
    url.searchParams.set("end_time", end.toISOString());
    url.searchParams.set("filter_entity_id", entities.join(","));
    url.searchParams.set("minimal_response", "0");
    url.searchParams.set("significant_changes_only", "0");

    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({
        error: "Home Assistant respondió HTTP " + response.status,
        detail: text.slice(0, 1000),
      });
    }
    let raw;
    try { raw = JSON.parse(text); } catch { throw new Error("Home Assistant devolvió una respuesta que no es JSON."); }
    if (!Array.isArray(raw)) throw new Error("Formato inesperado en la respuesta de historial de Home Assistant.");

    res.json({
      source: "Home Assistant REST API /api/history/period",
      timezone: "Europe/Madrid",
      desde,
      hasta,
      entities,
      count: raw.reduce((sum, group) => sum + (Array.isArray(group) ? group.length : 0), 0),
      raw,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/consumo", auth.middleware, async (req, res, next) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) {
      return res.status(400).json({ error: "Los parámetros 'desde' y 'hasta' son obligatorios" });
    }
    const datos = await consumoDiarioPorPlanta(pool, desde, hasta);
    res.json(datos);
  } catch (err) {
    next(err);
  }
});

app.post("/api/factura/analizar", auth.middleware, upload.single("factura"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Falta el fichero PDF (campo 'factura')" });
    }

    const { text } = await pdfParse(req.file.buffer);
    const factura = extraerDatosFactura(text);

    // "hasta" en la factura incluye ese día entero. Hacemos la suma
    // en UTC para evitar que la zona horaria de Vercel/Málaga cambie
    // accidentalmente la fecha al usar Date + toISOString().
    const [y, m, d] = factura.hasta.split("-").map(Number);
    const siguiente = new Date(Date.UTC(y, m - 1, d + 1));
    const hastaExclusivaStr = siguiente.toISOString().slice(0, 10);

    const medido = await consumoTotalPorPlanta(pool, factura.desde, hastaExclusivaStr);
    const reparto = repartirFactura(factura, medido);

    res.json({ factura, reparto });
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.debug) console.error("Factura PDF debug:", err.debug);
  res.status(err.status || 500).json({ error: err.message || "Error interno" });
});

module.exports = app;
