require("dotenv").config();
const db = require("../src/db");

const ENTITIES = [
  ["sensor.sierra_blanca_energia_consumida_a", "Planta Baja"],
  ["sensor.sierra_blanca_energia_consumida_b", "Planta Alta"],
];

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function addDays(date, count) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + count);
  return next.toISOString().slice(0, 10);
}

async function main() {
  const [, , desdeArg, hastaArg] = process.argv;
  const desde = desdeArg || null;
  const hasta = hastaArg || null;

  if ((desde && !validDate(desde)) || (hasta && !validDate(hasta))) {
    throw new Error("Formato de fechas incorrecto. Usa: pnpm turso:huecos -- AAAA-MM-DD AAAA-MM-DD");
  }
  if (desde && hasta && desde > hasta) throw new Error("La fecha inicial no puede ser posterior a la final.");

  const { rows } = await db.execute({
    sql: `
      SELECT entity_id, date(recorded_at) AS dia, COUNT(*) AS lecturas
      FROM readings
      WHERE entity_id IN (?, ?)
        AND (? IS NULL OR date(recorded_at) >= ?)
        AND (? IS NULL OR date(recorded_at) <= ?)
      GROUP BY entity_id, date(recorded_at)
      ORDER BY entity_id, dia
    `,
    args: [
      ENTITIES[0][0], ENTITIES[1][0],
      desde, desde, hasta, hasta,
    ],
  });

  const names = new Map(ENTITIES);
  let totalMissing = 0;

  for (const [entityId, label] of ENTITIES) {
    const dates = rows.filter((row) => row.entity_id === entityId).map((row) => String(row.dia).slice(0, 10)).filter(Boolean);
    let first = desde || dates[0];
    let last = hasta || dates[dates.length - 1];

    console.log(`\n${label} (${entityId})`);
    if (!first || !last) {
      console.log("  Sin lecturas en el rango consultado.");
      continue;
    }

    const present = new Set(dates);
    const missing = [];
    for (let day = first; day <= last; day = addDays(day, 1)) {
      if (!present.has(day)) missing.push(day);
    }

    if (missing.length === 0) console.log(`  Sin días vacíos entre ${first} y ${last}.`);
    else {
      totalMissing += missing.length;
      console.log(`  ${missing.length} días sin lecturas entre ${first} y ${last}:`);
      for (const day of missing) console.log(`  - ${day}`);
    }
    console.log(`  Días con lecturas: ${dates.length}`);
  }

  console.log(`\nTotal de días vacíos detectados por sensor: ${totalMissing}`);
  console.log("Nota: se detectan días sin ninguna lectura, no huecos de pocas horas dentro de un día.");
}

main().catch((error) => {
  console.error("No se pudieron auditar los huecos:", error.message);
  process.exitCode = 1;
});
