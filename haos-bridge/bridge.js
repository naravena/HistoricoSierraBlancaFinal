const { readFileSync } = require("node:fs");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { bridgeSecret, requireBridgeSecret, rawHistory } = require("./history");

const options = JSON.parse(readFileSync("/data/options.json", "utf8"));
process.env.HA_BASE_URL = options.ha_base_url || "";
process.env.HA_TOKEN = options.ha_token || "";
process.env.HA_BRIDGE_SECRET = options.ha_bridge_secret || "";
if (!process.env.HA_BASE_URL || !process.env.HA_TOKEN || !bridgeSecret()) {
  throw new Error("Configura ha_base_url, ha_token y ha_bridge_secret (mínimo 32 caracteres).");
}

const app = express();
app.disable("x-powered-by");
app.get("/api/ha/raw", requireBridgeSecret, rateLimit({
  windowMs: 60_000,
  limit: 20,
  keyGenerator: () => "ha-bridge",
  message: { error: "Demasiadas consultas. Espera un minuto." },
}), (req, res) => rawHistory(req, res, true));
app.listen(8787, "127.0.0.1", () => console.log("Puente HA en http://127.0.0.1:8787"));
