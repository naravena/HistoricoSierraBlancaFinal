require("dotenv").config();
const db = require("../src/db");

const rows = [
  ["2026102601", "sensor.sierra_blanca_energia_consumida_a", "2026-10-26T23:59:32+01:00", 924.91],
  ["2026102602", "sensor.sierra_blanca_energia_consumida_b", "2026-10-26T23:59:32+01:00", 651.02],
  ["2026102701", "sensor.sierra_blanca_energia_consumida_a", "2026-10-27T23:45:14+01:00", 928.36],
  ["2026102702", "sensor.sierra_blanca_energia_consumida_b", "2026-10-27T23:58:32+01:00", 656.04],
  ["2026102801", "sensor.sierra_blanca_energia_consumida_a", "2026-10-28T23:48:27+01:00", 930.11],
  ["2026102802", "sensor.sierra_blanca_energia_consumida_b", "2026-10-28T23:54:26+01:00", 662.86],
  ["2026102901", "sensor.sierra_blanca_energia_consumida_a", "2026-10-29T23:48:19+01:00", 932.52],
  ["2026102902", "sensor.sierra_blanca_energia_consumida_b", "2026-10-29T23:59:24+01:00", 667.08],
];

async function main() {
  for (const [sourceId, entityId, recordedAt, value] of rows) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO historical_data
        (record_type, source_row_id, entity_id, recorded_at, value)
        VALUES ('daily_recovery', ?, ?, ?, ?)`,
      args: [Number(sourceId), entityId, recordedAt, value],
    });
  }

  const { rows: inserted } = await db.execute({
    sql: `SELECT entity_id, recorded_at, value
      FROM historical_data
      WHERE record_type = 'daily_recovery'
        AND recorded_at >= '2026-10-26T00:00:00+01:00'
        AND recorded_at < '2026-10-30T00:00:00+01:00'
      ORDER BY recorded_at, entity_id`,
  });

  console.log(`Cierres diarios recuperados: ${inserted.length}/8`);
  console.table(inserted);
  if (inserted.length !== 8) {
    throw new Error("La verificación no encontró los 8 cierres diarios esperados.");
  }
  console.log("Recuperación insertada y verificada. Las filas originales reading/statistics no se han modificado.");
}

main().catch((error) => {
  console.error("No se pudo recuperar el histórico diario:", error.message);
  process.exitCode = 1;
});
