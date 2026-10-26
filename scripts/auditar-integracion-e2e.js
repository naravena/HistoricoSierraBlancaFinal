/* Auditoría E2E de solo lectura: HA -> Turso -> API del portal. */
const { consumoDiarioPorPlanta } = require("../src/queries");
const ZONE = "Europe/Madrid";
const ENTITIES = [
  "sensor.sierra_blanca_energia_consumida_a",
  "sensor.sierra_blanca_energia_consumida_b",
];
const LABEL = { [ENTITIES[0]]: "Planta baja", [ENTITIES[1]]: "Planta alta" };
const KWH_TOL = Number(process.env.AUDIT_TOLERANCE_KWH || "0.05");
const POINT_TOL = 0.01;
const TIME_TOL_MS = 90000;
const need = (key) => {
  if (!process.env[key]) throw new Error("Falta configurar " + key);
  return process.env[key];
};
function localDate(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return p.year + "-" + p.month + "-" + p.day;
}
function midnightUtc(day) {
  const [y, m, d] = day.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  let guess = target;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let i = 0; i < 4; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    guess += target - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  }
  return new Date(guess);
}
function lastSunday() {
  const [y, m, d] = localDate(new Date()).split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return new Date(Date.UTC(y, m - 1, d - (weekday || 7))).toISOString().slice(0, 10);
}
function timestamp(value) {
  const s = String(value);
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : s.replace(" ", "T") + "Z");
}
function num(v) {
  if (v === null || v === undefined || v === "" || ["unknown", "unavailable", "none"].includes(String(v).toLowerCase())) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
async function jsonRequest(url, options) {
  const response = await fetch(url, { ...(options || {}), signal: AbortSignal.timeout(30000) });
  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
  if (!response.ok) {
    const msg = body && typeof body === "object" ? (body.message || body.error || JSON.stringify(body)) : String(body || "");
    throw new Error("HTTP " + response.status + ": " + msg.slice(0, 300));
  }
  return { response, body };
}
async function haHistory(base, token, day, start, end) {
  const url = new URL(base.replace(/\/+$/, "") + "/api/history/period/" + encodeURIComponent(start.toISOString()));
  url.searchParams.set("filter_entity_id", ENTITIES.join(","));
  url.searchParams.set("end_time", end.toISOString());
  url.searchParams.set("minimal_response", "1");
  url.searchParams.set("significant_changes_only", "0");
  const result = await jsonRequest(url, { headers: { Authorization: "Bearer " + token, Accept: "application/json" } });
  if (!Array.isArray(result.body)) throw new Error("Respuesta inesperada de la API de historial de HA.");
  const out = {};
  ENTITIES.forEach((entity, index) => {
    out[entity] = (Array.isArray(result.body[index]) ? result.body[index] : [])
      .map((x) => ({ ts: timestamp(x.last_changed || x.last_updated), value: num(x.state) }))
      .filter((x) => Number.isFinite(x.ts.getTime()) && x.value !== null && localDate(x.ts) === day)
      .sort((a, b) => a.ts - b.ts);
  });
  return out;
}
async function tursoQuery(dbUrl, token, sql, args) {
  const url = dbUrl.replace(/^libsql:/, "https:").replace(/\/+$/, "") + "/v2/pipeline";
  const enc = (v) => v === null || v === undefined ? { type: "null" }
    : typeof v === "number" ? (Number.isInteger(v) ? { type: "integer", value: String(v) } : { type: "float", value: v })
    : { type: "text", value: String(v) };
  const result = await jsonRequest(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [
      { type: "execute", stmt: { sql: sql, args: (args || []).map(enc) } },
      { type: "close" },
    ] }),
  });
  const first = result.body && result.body.results && result.body.results[0];
  if (!first || first.type !== "ok") throw new Error((first && first.error && first.error.message) || "Respuesta SQL inesperada de Turso.");
  const data = first.response && first.response.result;
  if (!data) throw new Error("Turso no devolvió resultado SQL.");
  const cols = (data.cols || []).map((c) => c.name);
  return (data.rows || []).map((row) => {
    const obj = {};
    row.forEach((cell, i) => {
      let v = cell && cell.value;
      if (!cell || cell.type === "null") v = null;
      else if (cell.type === "integer" || cell.type === "float") v = Number(v);
      obj[cols[i]] = v;
    });
    return obj;
  });
}
async function tursoReadings(dbUrl, token, start, end) {
  const sql = "SELECT entity_id, recorded_at, value FROM historical_data " +
    "WHERE record_type='reading' AND entity_id IN (?, ?) " +
    "AND julianday(recorded_at)>=julianday(?) AND julianday(recorded_at)<julianday(?) " +
    "ORDER BY entity_id, julianday(recorded_at), recorded_at";
  const rows = await tursoQuery(dbUrl, token, sql, [ENTITIES[0], ENTITIES[1], start.toISOString(), end.toISOString()]);
  return rows.map((r) => ({ entity_id: r.entity_id, ts: timestamp(r.recorded_at), value: num(r.value) }))
    .filter((r) => Number.isFinite(r.ts.getTime()) && r.value !== null);
}
function daily(rows, day) {
  const points = rows.filter((r) => localDate(r.ts) === day).slice().sort((a, b) => a.ts - b.ts);
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const delta = points[i].value - points[i - 1].value;
    total += delta >= 0 ? delta : 0;
  }
  return { total: round2(total), count: points.length, points };
}
function comparePoints(source, destination) {
  const used = new Set(), errors = [];
  for (const a of source) {
    let best = -1, distance = Infinity;
    for (let i = 0; i < destination.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs(destination[i].ts - a.ts);
      if (d < distance) { best = i; distance = d; }
    }
    if (best < 0 || distance > TIME_TOL_MS) {
      errors.push("falta en Turso la muestra de " + a.ts.toISOString());
      continue;
    }
    used.add(best);
    if (Math.abs(destination[best].value - a.value) > POINT_TOL) {
      errors.push("valor distinto en " + a.ts.toISOString() + ": HA=" + a.value + ", Turso=" + destination[best].value);
    }
  }
  return { matched: used.size, sourceCount: source.length, destinationCount: destination.length,
    extras: destination.length - used.size, errors };
}
async function portalConsumption(base, password, day) {
  base = base.replace(/\/+$/, "");
  await jsonRequest(base + "/api/health", { headers: { Accept: "application/json" } });
  const login = await jsonRequest(base + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!login.body || login.body.ok !== true) throw new Error("El portal no confirmó el login.");
  const cookie = (login.response.headers.get("set-cookie") || "").split(";")[0];
  if (!cookie.startsWith("session_token=")) throw new Error("No se recibió la cookie session_token.");
  const url = new URL(base + "/api/consumo");
  url.searchParams.set("desde", day);
  url.searchParams.set("hasta", day);
  return (await jsonRequest(url, { headers: { Cookie: cookie, Accept: "application/json" } })).body;
}
async function main() {
  const day = lastSunday();
  const [y, m, d] = day.split("-").map(Number);
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  const start = midnightUtc(day), end = midnightUtc(nextDay);
  const haBase = need("HA_BASE_URL"), haToken = need("HA_TOKEN");
  const dbUrl = need("TURSO_DATABASE_URL"), dbToken = need("TURSO_AUTH_TOKEN");
  const portalBase = need("PORTAL_BASE_URL"), portalPassword = need("PORTAL_PASSWORD");
  const failures = [], notes = [];
  let ha = null, readings = null, direct = null, portal = null;
  const report = [
    "# Auditoría Home Assistant → Turso → Portal", "",
    "- **Día:** " + day + " (Europe/Madrid)",
    "- **Ventana UTC:** " + start.toISOString() + " — " + end.toISOString(),
    "- **Tolerancia diaria:** ±" + KWH_TOL + " kWh", "",
  ];
  try { ha = await haHistory(haBase, haToken, day, start, end); notes.push("Historial de HA consultado."); }
  catch (e) { failures.push("Home Assistant: " + e.message); }
  try { readings = await tursoReadings(dbUrl, dbToken, start, end); notes.push("Lecturas raw consultadas directamente en Turso."); }
  catch (e) { failures.push("Turso readings: " + e.message); }
  const db = { execute: async ({ sql, args }) => ({ rows: await tursoQuery(dbUrl, dbToken, sql, args || []) }) };
  try { direct = await consumoDiarioPorPlanta(db, day, day); notes.push("Cálculo SQL directo ejecutado con src/queries.js."); }
  catch (e) { failures.push("SQL directo de Turso: " + e.message); }
  try { portal = await portalConsumption(portalBase, portalPassword, day); notes.push("API web: health, login y consumo comprobados."); }
  catch (e) { failures.push("API web: " + e.message); }

  const portalIndex = portal && Array.isArray(portal.dias) ? portal.dias.indexOf(day) : -1;
  report.push("## Comparación por sensor", "");
  report.push("| Sensor | Puntos HA | Puntos Turso | Coincidencias | HA kWh | Turso raw kWh | Turso SQL kWh | Portal kWh | Estado |");
  report.push("|---|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const entity of ENTITIES) {
    const errors = [];
    const haDay = ha ? daily(ha[entity] || [], day) : null;
    const dbPoints = readings ? readings.filter((r) => r.entity_id === entity) : null;
    const dbDay = dbPoints ? daily(dbPoints, day) : null;
    const matches = haDay && dbDay ? comparePoints(haDay.points, dbPoints) : null;
    if (haDay && haDay.count < 2) errors.push("menos de 2 puntos en HA");
    if (dbDay && dbDay.count < 2) errors.push("menos de 2 lecturas en Turso");
    if (matches) {
      errors.push.apply(errors, matches.errors.slice(0, 5));
      if (matches.extras > 0) errors.push(matches.extras + " lecturas Turso extra sin pareja en HA");
      if (matches.sourceCount !== matches.destinationCount) errors.push("cantidad de puntos distinta en origen/destino");
    }
    if (haDay && dbDay && Math.abs(haDay.total - dbDay.total) > KWH_TOL) {
      errors.push("consumo diario HA/Turso raw difiere más de " + KWH_TOL + " kWh");
    }
    let sqlValue = null, webValue = null;
    if (direct) {
      const idx = direct.dias.indexOf(day);
      if (idx < 0) errors.push("el SQL directo no devuelve el día");
      else sqlValue = entity === ENTITIES[0] ? Number(direct.plantaBaja[idx]) : Number(direct.plantaAlta[idx]);
      if (Array.isArray(direct.diasIncompletos) && direct.diasIncompletos.includes(day)) errors.push("Turso SQL marca el día incompleto");
    }
    if (portal) {
      if (portalIndex < 0) errors.push("la API del portal no devuelve el día");
      else {
        webValue = entity === ENTITIES[0] ? Number(portal.plantaBaja[portalIndex]) : Number(portal.plantaAlta[portalIndex]);
        if (!Number.isFinite(webValue)) errors.push("la API del portal devuelve un valor no numérico");
        else if (sqlValue !== null && Math.abs(webValue - sqlValue) > 0.01) errors.push("API web distinta del SQL directo de Turso");
      }
      if (Array.isArray(portal.diasIncompletos) && portal.diasIncompletos.includes(day)) errors.push("la API del portal marca el día incompleto");
    }
    const fmt = (n) => n === null || n === undefined || !Number.isFinite(n) ? "N/D" : Number(n).toFixed(2);
    report.push("| " + LABEL[entity] + " | " + (haDay ? haDay.count : "N/D") + " | " +
      (dbDay ? dbDay.count : "N/D") + " | " + (matches ? matches.matched + "/" + matches.sourceCount : "N/D") +
      " | " + fmt(haDay && haDay.total) + " | " + fmt(dbDay && dbDay.total) + " | " +
      fmt(sqlValue) + " | " + fmt(webValue) + " | " + (errors.length ? "FALLO" : "OK") + " |");
    errors.forEach((e) => failures.push(LABEL[entity] + ": " + e));
  }
  if (portal && portalIndex >= 0 && direct) {
    const expected = round2(Number(direct.totales.baja) + Number(direct.totales.alta));
    const actual = num(portal.totales && portal.totales.total);
    if (actual === null || Math.abs(actual - expected) > 0.01) failures.push("Total portal=" + actual + " kWh; SQL Turso=" + expected + " kWh.");
  }
  report.push("", "## Comprobaciones", "");
  notes.forEach((x) => report.push("- ✅ " + x));
  failures.forEach((x) => report.push("- ❌ " + x));
  if (!failures.length) report.push("- ✅ Todas las comprobaciones han pasado.");
  report.push("", "**Resultado final: " + (failures.length ? "FALLO" : "OK") + "**", "");
  const markdown = report.join("\n");
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) require("node:fs").appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");
  if (failures.length) process.exitCode = 1;
}
main().catch((e) => { console.error("Fallo fatal: " + e.message); process.exitCode = 1; });
