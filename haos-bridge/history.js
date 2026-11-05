const { createHash, timingSafeEqual } = require("node:crypto");

function bridgeSecret() {
  const secret = process.env.HA_BRIDGE_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function requireBridgeSecret(req, res, next) {
  res.set("Cache-Control", "private, no-store");
  const hash = (value) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(hash(req.get("Authorization") || ""), hash("Bearer " + bridgeSecret()))) {
    return res.status(401).json({ error: "No autorizado." });
  }
  next();
}

async function readLimited(response, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function rawHistory(req, res, bridgeMode = false) {
  res.set("Cache-Control", "private, no-store");
  try {
    const { desde, hasta } = req.query;
    const validDate = (value) => typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "0100-01-01" && value < "9999-12-31" &&
      Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
      new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
    if (!validDate(desde) || !validDate(hasta)) {
      return res.status(400).json({ error: "Usa fechas válidas con formato YYYY-MM-DD." });
    }
    if (hasta < desde) return res.status(400).json({ error: "'hasta' no puede ser anterior a 'desde'." });
    const days = (Date.parse(hasta + "T00:00:00Z") - Date.parse(desde + "T00:00:00Z")) / 86400000 + 1;
    if (days > 31) return res.status(400).json({ error: "La prueba permite consultar un máximo de 31 días." });

    if (!bridgeMode && (process.env.HA_BRIDGE_URL || process.env.VERCEL)) {
      const secret = bridgeSecret();
      if (!process.env.HA_BRIDGE_URL || !secret) {
        return res.status(503).json({ error: "Configura HA_BRIDGE_URL y HA_BRIDGE_SECRET en el servidor." });
      }
      const bridge = new URL(process.env.HA_BRIDGE_URL);
      if (bridge.protocol !== "https:" || bridge.username || bridge.password) {
        return res.status(503).json({ error: "HA_BRIDGE_URL debe ser una URL HTTPS sin credenciales." });
      }
      bridge.pathname = "/api/ha/raw";
      bridge.search = new URLSearchParams({ desde, hasta }).toString();
      const reply = await fetch(bridge, {
        headers: { Authorization: "Bearer " + secret, Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(25_000),
      });
      if (!reply.ok) {
        await reply.body?.cancel();
        const errors = {
          413: "El historial supera 4 MB. Selecciona menos días.",
          429: "Demasiadas consultas. Espera un minuto.",
          504: "Home Assistant tardó demasiado en responder.",
        };
        return res.status(errors[reply.status] ? reply.status : 502).json({
          error: errors[reply.status] || "El puente no pudo consultar Home Assistant.",
        });
      }
      const body = await readLimited(reply, 4_010_000);
      if (!body || !Array.isArray(JSON.parse(body).raw)) {
        return res.status(502).json({ error: "El puente devolvió un historial inválido." });
      }
      return res.type("application/json").send(body);
    }

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
    const url = new URL((base.endsWith("/") ? base.slice(0, -1) : base) + "/api/history/period/" + encodeURIComponent(start.toISOString()));
    url.searchParams.set("end_time", end.toISOString());
    url.searchParams.set("filter_entity_id", entities.join(","));
    url.searchParams.set("skip_initial_state", "1");
    url.searchParams.set("significant_changes_only", "0");

    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      return res.status(503).json({ error: "HA_BASE_URL debe ser una URL HTTP(S) sin credenciales." });
    }
    const response = await fetch(url, {
      redirect: "error",
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return res.status(502).json({ error: "Home Assistant respondió HTTP " + response.status });
    }
    const text = await readLimited(response, 4_000_000);
    if (text === null) {
      return res.status(413).json({ error: "El historial supera 4 MB. Selecciona menos días." });
    }
    const raw = JSON.parse(text);
    if (!Array.isArray(raw) || !raw.every(Array.isArray)) {
      return res.status(502).json({ error: "Formato inesperado en el historial de Home Assistant." });
    }

    const metadata = JSON.stringify({
      source: "Home Assistant REST API /api/history/period",
      timezone: "Europe/Madrid",
      desde,
      hasta,
      entities,
      count: raw.reduce((sum, group) => sum + group.length, 0),
    });
    res.type("application/json").send(metadata.slice(0, -1) + ',"raw":' + text + "}");
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return res.status(504).json({ error: "Home Assistant tardó demasiado en responder." });
    }
    res.status(502).json({ error: "No se pudo obtener un historial válido de Home Assistant." });
  }
}

module.exports = { bridgeSecret, requireBridgeSecret, rawHistory };
