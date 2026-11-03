const { bridgeSecret, requireBridgeSecret, rawHistory } = require("../haos-bridge/history");
require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const pdfParse = require("pdf-parse");

const bridgeMode = require.main === module && process.argv.includes("--ha-bridge");
const pool = bridgeMode ? null : require("./db");
const auth = bridgeMode ? null : require("./auth");
const { consumoDiarioPorPlanta, consumoTotalPorPlanta } = require("./queries");
const { extraerDatosFactura } = require("./parseFactura");
const { repartirFactura } = require("./repartoFactura");

const app = express();
if (bridgeMode) {
  if (!process.env.HA_BASE_URL || !process.env.HA_TOKEN || !bridgeSecret()) {
    throw new Error("Configura HA_BASE_URL, HA_TOKEN y HA_BRIDGE_SECRET (mínimo 32 caracteres).");
  }
  app.get("/api/ha/raw", requireBridgeSecret, rateLimit({
    windowMs: 60_000,
    limit: 20,
    keyGenerator: () => "ha-bridge",
    message: { error: "Demasiadas consultas. Espera un minuto." },
  }), (req, res) => rawHistory(req, res, true));
  app.listen(8787, "127.0.0.1", () => console.log("Puente HA en http://127.0.0.1:8787"));
  return;
}
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
app.get("/api/ha/raw", auth.middleware, (req, res) => rawHistory(req, res));

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
