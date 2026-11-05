const { bridgeSecret } = require("./history");
const entities = [
  "sensor.sierra_blanca_energia_consumida_a",
  "sensor.sierra_blanca_energia_consumida_b",
];
const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function madridMidnight(day) {
  const target = Date.parse(day + "T00:00:00Z");
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const p = Object.fromEntries(formatter.formatToParts(guess).map(part => [part.type, part.value]));
    guess += target - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  }
  return new Date(guess).toISOString();
}

function range(query) {
  const valid = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    value >= "0100-01-01" && value < "9999-12-31" && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(query.desde) || !valid(query.hasta) || query.desde > query.hasta ||
      (Date.parse(query.hasta) - Date.parse(query.desde)) / 86400000 >= 366) return null;
  const following = new Date(Date.parse(query.hasta) + 86400000).toISOString().slice(0, 10);
  return { start: madridMidnight(query.desde), end: madridMidnight(following) };
}

// Only two fixed statistics IDs are accepted. A single short-lived connection
// carries both aggregate commands and is always closed on success or failure.
function totalsFromHA(base, token, dates, Socket = WebSocket) {
  return new Promise((resolve, reject) => {
    const url = new URL(base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      reject(new Error("invalid_configuration"));
      return;
    }
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = url.pathname.replace(/\/$/, "") + "/api/websocket";
    url.search = "";
    url.hash = "";
    const socket = new Socket(url);
    const results = new Map();
    let finished = false;
    let authenticated = false;
    const timer = setTimeout(() => finish(new Error("timeout")), 18000);
    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(entities.map((_, index) => results.get(index + 1)));
    }
    socket.addEventListener("error", () => finish(new Error("connection_failed")));
    socket.addEventListener("close", () => {
      if (!finished) finish(new Error("connection_closed"));
    });
    socket.addEventListener("message", event => {
      if (finished) return;
      try {
        if (typeof event.data !== "string" || event.data.length > 65536) throw new Error("invalid_response");
        const message = JSON.parse(event.data);
        if (message.type === "auth_required") {
          socket.send(JSON.stringify({ type: "auth", access_token: token }));
        } else if (message.type === "auth_invalid") {
          finish(new Error("authentication_failed"));
        } else if (message.type === "auth_ok" && !authenticated) {
          authenticated = true;
          entities.forEach((statistic_id, index) => socket.send(JSON.stringify({
            id: index + 1, type: "recorder/statistic_during_period", statistic_id,
            fixed_period: { start_time: dates.start, end_time: dates.end },
            types: ["change"], units: { energy: "kWh" },
          })));
        } else if (message.type === "result" && [1, 2].includes(message.id)) {
          if (!authenticated || !message.success || !message.result || typeof message.result !== "object") {
            throw new Error("statistics_unavailable");
          }
          const change = message.result.change;
          if (change !== undefined && change !== null && (typeof change !== "number" || !Number.isFinite(change))) {
            throw new Error("invalid_response");
          }
          results.set(message.id, change ?? null);
          if (results.size === 2) finish();
        }
      } catch (error) { finish(error); }
    });
  });
}

async function summary(req, res, bridgeMode = false) {
  res.set("Cache-Control", "private, no-store");
  const dates = range(req.query);
  if (!dates) return res.status(400).json({ error: "Usa fechas válidas y un máximo de 366 días inclusivos." });
  const { desde, hasta } = req.query;
  try {
    if (!bridgeMode && (process.env.HA_BRIDGE_URL || process.env.VERCEL)) {
      const secret = bridgeSecret();
      if (!secret || !process.env.HA_BRIDGE_URL) {
        return res.status(503).json({ error: "Configura HA_BRIDGE_URL y HA_BRIDGE_SECRET." });
      }
      const url = new URL(process.env.HA_BRIDGE_URL);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("invalid_configuration");
      url.pathname = "/api/ha/summary";
      url.search = new URLSearchParams({ desde, hasta }).toString();
      const reply = await fetch(url, {
        headers: { Authorization: "Bearer " + secret }, redirect: "error", signal: AbortSignal.timeout(23000),
      });
      if (reply.status === 404) {
        await reply.body?.cancel();
        return res.status(503).json({ error: "Actualiza Puente Sierra Blanca a la versión 1.1.0 para consultar sumatorios." });
      }
      if (!reply.ok) {
        await reply.body?.cancel();
        return res.status(reply.status === 429 ? 429 : 502).json({
          error: reply.status === 429 ? "Demasiadas consultas. Espera un minuto." : "El puente no pudo consultar las estadísticas de Home Assistant.",
        });
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of reply.body) {
        size += chunk.byteLength;
        if (size > 16384) throw new Error("invalid_response");
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (data.desde !== desde || data.hasta !== hasta || !data.totals ||
          !["a", "b"].every(key => data.totals[key] === null ||
            (typeof data.totals[key] === "number" && Number.isFinite(data.totals[key])))) {
        throw new Error("invalid_response");
      }
      return res.json(data);
    }
    if (!process.env.HA_BASE_URL || !process.env.HA_TOKEN) {
      return res.status(503).json({ error: "Configura HA_BASE_URL y HA_TOKEN en el puente." });
    }
    const [a, b] = await totalsFromHA(process.env.HA_BASE_URL, process.env.HA_TOKEN, dates);
    res.json({
      source: "Home Assistant Recorder statistics", timezone: "Europe/Madrid", desde, hasta,
      unit: "kWh", totals: { a, b }, queried_at: new Date().toISOString(),
      note: "Sumatorio calculado por Home Assistant con sus estadísticas disponibles. La cobertura completa del periodo no se ha verificado. El día actual puede llevar retraso.",
    });
  } catch (error) {
    const timeout = ["timeout", "TimeoutError", "AbortError"].includes(error.message) ||
      ["TimeoutError", "AbortError"].includes(error.name);
    res.status(timeout ? 504 : 502).json({
      error: timeout ? "Home Assistant tardó demasiado en calcular el sumatorio." :
        "No se pudieron consultar las estadísticas de Home Assistant. Revisa el token y las estadísticas de los dos sensores.",
    });
  }
}

module.exports = { summary, totalsFromHA, range };
