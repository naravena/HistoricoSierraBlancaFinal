const ENTITY_BAJA = "sensor.sierra_blanca_energia_consumida_a";
const ENTITY_ALTA = "sensor.sierra_blanca_energia_consumida_b";
const ZONE = "Europe/Madrid";
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function parseTimestamp(value) {
  const text = String(value);
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(text) ? text : text.replace(" ", "T") + "Z");
}

function localDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localMidnightUtc(day) {
  const [year, month, date] = day.split("-").map(Number);
  const target = Date.UTC(year, month - 1, date);
  let guess = target;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second));
    guess += target - represented;
  }
  return new Date(guess);
}

function nextDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

async function consultarConsumo(db, desde, hasta) {
  const inicio = localMidnightUtc(desde).toISOString();
  const fin = localMidnightUtc(nextDay(hasta)).toISOString();
  const { rows } = await db.execute({
    sql: `
      WITH fuentes AS (
        SELECT entity_id, recorded_at, value AS contador, 'reading' AS origen
        FROM historical_data
        WHERE record_type = 'reading' AND entity_id IN (?, ?)
        UNION ALL
        SELECT entity_id, recorded_at, sum AS contador, 'statistics' AS origen
        FROM historical_data
        WHERE record_type = 'statistics' AND entity_id IN (?, ?) AND sum IS NOT NULL
      ),
      previos AS (
        SELECT f.entity_id, f.recorded_at, f.contador, f.origen
        FROM fuentes f
        WHERE julianday(f.recorded_at) = (
          SELECT MAX(julianday(p.recorded_at)) FROM fuentes p
          WHERE p.entity_id = f.entity_id AND p.origen = f.origen
            AND julianday(p.recorded_at) < julianday(?)
        )
      ),
      seleccion AS (
        SELECT entity_id, recorded_at, contador, origen FROM previos
        UNION ALL
        SELECT entity_id, recorded_at, contador, origen FROM fuentes
        WHERE julianday(recorded_at) >= julianday(?) AND julianday(recorded_at) < julianday(?)
      )
      SELECT entity_id, recorded_at, contador, origen FROM seleccion
      ORDER BY entity_id, origen, julianday(recorded_at), recorded_at
    `,
    args: ["sensor.sierra_blanca_energia_consumida_a", "sensor.sierra_blanca_energia_consumida_b",
      "sensor.sierra_blanca_energia_consumida_a", "sensor.sierra_blanca_energia_consumida_b", inicio, inicio, fin],
  });

  const ordered = rows.map((r) => ({ ...r, instant: parseTimestamp(r.recorded_at) }))
    .filter((r) => Number.isFinite(r.instant.getTime()) && r.contador !== null && Number.isFinite(Number(r.contador)))
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id) ||
      a.origen.localeCompare(b.origen) || a.instant - b.instant);
  const bySourceDay = new Map();
  const previous = new Map();

  for (const r of ordered) {
    const key = `${r.entity_id}|${r.origen}`;
    const counter = Number(r.contador);
    const prior = previous.get(key);
    previous.set(key, { counter, instant: r.instant });
    const day = localDate(r.instant);
    if (day < desde || day > hasta || !prior) continue;
    const delta = counter >= prior.counter ? counter - prior.counter : 0;
    const groupKey = `${r.entity_id}|${day}|${r.origen}`;
    const entry = bySourceDay.get(groupKey) || { entity_id: r.entity_id, dia: day, origen: r.origen, consumo: 0, ultimo: null };
    entry.consumo += delta;
    if (!entry.ultimo || r.instant > entry.ultimo) entry.ultimo = r.instant;
    bySourceDay.set(groupKey, entry);
  }

  const sourceRows = [...bySourceDay.values()];
  const statsDays = new Set(sourceRows.filter((r) => r.origen === "statistics").map((r) => `${r.entity_id}|${r.dia}`));
  const selected = sourceRows.filter((r) => r.origen === "statistics" ||
    (r.origen === "reading" && !statsDays.has(`${r.entity_id}|${r.dia}`)));

  return selected.map((r) => ({
    entity_id: r.entity_id,
    dia: r.dia,
    consumo: r.consumo,
    incompleto: localMidnightUtc(nextDay(r.dia)).getTime() - r.ultimo.getTime() > 3600000 ? 1 : 0,
  }));
}

async function consumoDiarioPorPlanta(db, desde, hasta) {
  const rows = await consultarConsumo(db, desde, hasta);
  const porDia = new Map();
  for (const r of rows) {
    if (!porDia.has(r.dia)) porDia.set(r.dia, { baja: 0, alta: 0, incompleto: false });
    if (r.entity_id === "sensor.sierra_blanca_energia_consumida_a") porDia.get(r.dia).baja = Number(r.consumo || 0);
    if (r.entity_id === "sensor.sierra_blanca_energia_consumida_b") porDia.get(r.dia).alta = Number(r.consumo || 0);
    if (Number(r.incompleto) === 1) porDia.get(r.dia).incompleto = true;
  }
  const dias = [...porDia.keys()].sort();
  const plantaBaja = dias.map((d) => round2(porDia.get(d).baja));
  const plantaAlta = dias.map((d) => round2(porDia.get(d).alta));
  const baja = round2(plantaBaja.reduce((a, b) => a + b, 0));
  const alta = round2(plantaAlta.reduce((a, b) => a + b, 0));
  return { dias, plantaBaja, plantaAlta, diasIncompletos: dias.filter((d) => porDia.get(d).incompleto),
    totales: { baja, alta, total: round2(baja + alta) } };
}

async function consumoTotalPorPlanta(db, desde, hasta) {
  const rows = await consultarConsumo(db, desde, hasta);
  const result = { baja: 0, alta: 0 };
  for (const r of rows) {
    if (r.entity_id === "sensor.sierra_blanca_energia_consumida_a") result.baja += Number(r.consumo || 0);
    if (r.entity_id === "sensor.sierra_blanca_energia_consumida_b") result.alta += Number(r.consumo || 0);
  }
  return { baja: round2(result.baja), alta: round2(result.alta) };
}
module.exports = { consumoDiarioPorPlanta, consumoTotalPorPlanta };
