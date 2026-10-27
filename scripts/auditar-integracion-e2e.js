/* Auditoría de consumo diario acumulado: Home Assistant -> Turso -> Portal. Solo lectura. */
const { consumoDiarioPorPlanta } = require("../src/queries");
const ZONE = "Europe/Madrid";
const ENTITIES = [
  "sensor.sierra_blanca_energia_consumida_a",
  "sensor.sierra_blanca_energia_consumida_b",
];
const LABEL = { [ENTITIES[0]]: "Planta baja", [ENTITIES[1]]: "Planta alta" };
const KWH_TOL = Number(process.env.AUDIT_TOLERANCE_KWH || "0.05");
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
function shiftDay(day, amount) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + amount)).toISOString().slice(0, 10);
}
function yesterdayLocal() {
  return shiftDay(localDate(new Date()), -1);
}
function validDate(s, key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s + "T00:00:00Z")) ||
      new Date(s + "T00:00:00Z").toISOString().slice(0, 10) !== s) {
    throw new Error(key + " debe tener formato YYYY-MM-DD.");
  }
  return s;
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
async function haHistory(base, token, start, end) {
  // Trae también el día anterior para disponer de una lectura base antes de la medianoche inicial.
  const queryStart = midnightUtc(shiftDay(localDate(start), -1));
  const url = new URL(base.replace(/\/+$/, "") + "/api/history/period/" + encodeURIComponent(queryStart.toISOString()));
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
      .filter((x) => Number.isFinite(x.ts.getTime()) && x.value !== null && x.ts < end)
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
      { type: "execute", stmt: { sql, args: (args || []).map(enc) } },
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
function dailyTotals(rows, startDay, endDay) {
  const sorted = rows.slice().sort((a, b) => a.ts - b.ts);
  const result = new Map();
  let prior = null;
  for (const r of sorted) {
    const day = localDate(r.ts);
    if (prior && localDate(prior.ts) === day && day >= startDay && day <= endDay) {
      // Mismo criterio que el cálculo del portal: no atribuir al día el delta desde el día anterior.
      const delta = r.value >= prior.value ? r.value - prior.value : 0;
      const entry = result.get(day) || { total: 0, count: 0, first: null, last: null };
      entry.total += delta;
      entry.count++;
      if (!entry.first) entry.first = r.ts;
      entry.last = r.ts;
      result.set(day, entry);
    }
    prior = r;
  }
  for (const value of result.values()) value.total = round2(value.total);
  return result;
}
async function portalConsumption(base, password, startDay, endDay) {
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
  url.searchParams.set("desde", startDay);
  url.searchParams.set("hasta", endDay);
  return (await jsonRequest(url, { headers: { Cookie: cookie, Accept: "application/json" } })).body;
}
async function main() {
  const startDay = validDate(process.env.AUDIT_START_DATE || yesterdayLocal(), "AUDIT_START_DATE");
  const endDay = validDate(process.env.AUDIT_END_DATE || startDay, "AUDIT_END_DATE");
  if (endDay < startDay) throw new Error("La fecha final no puede ser anterior a la inicial.");
  const dayCount = Math.round((Date.parse(endDay + "T00:00:00Z") - Date.parse(startDay + "T00:00:00Z")) / 86400000) + 1;
  if (dayCount > 366) throw new Error("El intervalo máximo por ejecución es de 366 días.");
  const start = midnightUtc(startDay), end = midnightUtc(shiftDay(endDay, 1));
  const haBase = need("HA_BASE_URL"), haToken = need("HA_TOKEN");
  const dbUrl = need("TURSO_DATABASE_URL"), dbToken = need("TURSO_AUTH_TOKEN");
  const portalBase = need("PORTAL_BASE_URL"), portalPassword = need("PORTAL_PASSWORD");
  const failures = [], notes = [];
  let ha = null, readings = null, direct = null, portal = null;
  const report = [
    "# Auditoría de consumo acumulado: Home Assistant → Turso → Portal", "",
    "- **Período:** " + startDay + " a " + endDay + " (Europe/Madrid; días completos)",
    "- **Ventana UTC:** " + start.toISOString() + " — " + end.toISOString(),
    "- **Tolerancia diaria:** ±" + KWH_TOL + " kWh",
    "- **Criterio:** acumulado diario por contador; no se exige igualdad de timestamps ni número de muestras.",
    "- **Total Sierra Blanca:** Planta Baja + Planta Alta. No se incluye energía producida.", "",
  ];
  try { ha = await haHistory(haBase, haToken, start, end); notes.push("Historial de Home Assistant consultado."); }
  catch (e) { failures.push("Home Assistant: " + e.message); }
  const rawStart = midnightUtc(shiftDay(startDay, -1));
  try { readings = await tursoReadings(dbUrl, dbToken, rawStart, end); notes.push("Lecturas raw de Turso consultadas, incluyendo una base previa al inicio."); }
  catch (e) { failures.push("Turso raw: " + e.message); }
  const db = { execute: async ({ sql, args }) => ({ rows: await tursoQuery(dbUrl, dbToken, sql, args || []) }) };
  try { direct = await consumoDiarioPorPlanta(db, startDay, endDay); notes.push("Cálculo SQL del portal ejecutado con src/queries.js."); }
  catch (e) { failures.push("SQL directo de Turso: " + e.message); }
  try { portal = await portalConsumption(portalBase, portalPassword, startDay, endDay); notes.push("API del portal: health, login y consumo comprobados."); }
  catch (e) { failures.push("API web: " + e.message); }

  const haDaily = {}, rawDaily = {};
  for (const entity of ENTITIES) {
    haDaily[entity] = ha ? dailyTotals(ha[entity] || [], startDay, endDay) : new Map();
    rawDaily[entity] = readings ? dailyTotals(readings.filter((r) => r.entity_id === entity), startDay, endDay) : new Map();
  }
  const portalIndex = (day) => portal && Array.isArray(portal.dias) ? portal.dias.indexOf(day) : -1;
  const directIndex = (day) => direct && Array.isArray(direct.dias) ? direct.dias.indexOf(day) : -1;
  const fmt = (n) => n === null || n === undefined || !Number.isFinite(n) ? "N/D" : Number(n).toFixed(2);
  report.push("## Comparación por día y planta", "");
  report.push("| Día | Planta | HA kWh | Turso raw kWh | Turso SQL kWh | Portal kWh | Estado |");
  report.push("|---|---|---:|---:|---:|---:|---|");
  report.push("", "## Diagnóstico de cobertura de lecturas", "");
  report.push("| Día | Planta | Muestras HA | Última muestra HA (Madrid) | Muestras Turso raw | Última muestra Turso (Madrid) |");
  report.push("|---|---|---:|---|---:|---|");
  const localStamp = (date) => date ? new Intl.DateTimeFormat("es-ES", {
    timeZone: ZONE, dateStyle: "short", timeStyle: "medium", hour12: false,
  }).format(date) : "Sin datos";
  let checkedDays = 0;
  for (let day = startDay; day <= endDay; day = shiftDay(day, 1)) {
    const di = directIndex(day), pi = portalIndex(day);
    const dayFailures = [];
    for (const entity of ENTITIES) {
      const label = LABEL[entity];
      const h = haDaily[entity].get(day), t = rawDaily[entity].get(day);
      const haPoints = (ha && ha[entity] || []).filter((r) => localDate(r.ts) === day);
      const tursoPoints = (readings || []).filter((r) => r.entity_id === entity && localDate(r.ts) === day);
      const lastHa = haPoints.length ? haPoints[haPoints.length - 1].ts : null;
      const lastTurso = tursoPoints.length ? tursoPoints[tursoPoints.length - 1].ts : null;
      report.push("| " + day + " | " + LABEL[entity] + " | " + haPoints.length + " | " + localStamp(lastHa) + " | " + tursoPoints.length + " | " + localStamp(lastTurso) + " |");
      const sqlValue = di < 0 ? null : Number(entity === ENTITIES[0] ? direct.plantaBaja[di] : direct.plantaAlta[di]);
      const webValue = pi < 0 ? null : Number(entity === ENTITIES[0] ? portal.plantaBaja[pi] : portal.plantaAlta[pi]);
      const errors = [];
      if (!h || h.count < 1) errors.push("sin suficientes cambios de contador en HA");
      if (!t || t.count < 1) errors.push("sin suficientes cambios de contador en Turso raw");
      if (h && t && Math.abs(h.total - t.total) > KWH_TOL) errors.push("HA/Turso raw difieren más de " + KWH_TOL + " kWh");
      if (sqlValue === null || !Number.isFinite(sqlValue)) errors.push("SQL no devuelve valor diario");
      if (webValue === null || !Number.isFinite(webValue)) errors.push("portal no devuelve valor diario");
      if (Number.isFinite(sqlValue) && Number.isFinite(webValue) && Math.abs(sqlValue - webValue) > 0.01) errors.push("portal y SQL no coinciden");
      if (direct && Array.isArray(direct.diasIncompletos) && direct.diasIncompletos.includes(day)) errors.push("SQL marca el día incompleto");
      if (portal && Array.isArray(portal.diasIncompletos) && portal.diasIncompletos.includes(day)) errors.push("portal marca el día incompleto");
      report.push("| " + day + " | " + label + " | " + fmt(h && h.total) + " | " + fmt(t && t.total) + " | " + fmt(sqlValue) + " | " + fmt(webValue) + " | " + (errors.length ? "FALLO" : "OK") + " |");
      errors.forEach((e) => dayFailures.push(day + " · " + label + ": " + e));
    }
    const totalHa = ENTITIES.every((e) => haDaily[e].has(day)) ? round2(haDaily[ENTITIES[0]].get(day).total + haDaily[ENTITIES[1]].get(day).total) : null;
    const totalRaw = ENTITIES.every((e) => rawDaily[e].has(day)) ? round2(rawDaily[ENTITIES[0]].get(day).total + rawDaily[ENTITIES[1]].get(day).total) : null;
    const totalSql = di < 0 ? null : num(direct.totales && direct.totales.total);
    const totalPortal = pi < 0 ? null : num(portal.totales && portal.totales.total);
    const totalErrors = [];
    if (totalHa === null) totalErrors.push("total HA no disponible");
    if (totalRaw === null) totalErrors.push("total Turso raw no disponible");
    if (totalHa !== null && totalRaw !== null && Math.abs(totalHa - totalRaw) > KWH_TOL) totalErrors.push("total HA/Turso raw difiere más de " + KWH_TOL + " kWh");
    if (totalSql === null || totalPortal === null || Math.abs(totalSql - totalPortal) > 0.01) totalErrors.push("total SQL/portal no coincide o no está disponible");
    report.push("| " + day + " | **Total Sierra Blanca** | **" + fmt(totalHa) + "** | **" + fmt(totalRaw) + "** | **" + fmt(totalSql) + "** | **" + fmt(totalPortal) + "** | **" + (totalErrors.length ? "FALLO" : "OK") + "** |");
    totalErrors.forEach((e) => dayFailures.push(day + " · Total Sierra Blanca: " + e));
    if (dayFailures.length) failures.push.apply(failures, dayFailures);
    checkedDays++;
  }
  report.push("", "## Comprobaciones", "");
  notes.forEach((x) => report.push("- ✅ " + x));
  report.push("- Días evaluados: " + checkedDays + ".");
  report.push("- Sensores incluidos: energía consumida Planta Baja (A) y Planta Alta (B).");
  report.push("- El total se calcula como A + B; la energía producida queda excluida.");
  failures.forEach((x) => report.push("- ❌ " + x));
  if (!failures.length) report.push("- ✅ Todas las comprobaciones han pasado.");
  report.push("", "**Resultado final: " + (failures.length ? "FALLO" : "OK") + "**", "");
  const markdown = report.join("\n");
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) require("node:fs").appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");
  if (failures.length) process.exitCode = 1;
}
main().catch((e) => { console.error("Fallo fatal: " + e.message); process.exitCode = 1; });
