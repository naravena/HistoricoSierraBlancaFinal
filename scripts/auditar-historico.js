require("dotenv").config();
const db = require("../src/db");

async function main() {
  const checks = [
    ["Resumen por origen", `
      SELECT record_type, COUNT(*) AS filas,
             COUNT(DISTINCT entity_id) AS entidades,
             MIN(recorded_at) AS primera_fecha,
             MAX(recorded_at) AS ultima_fecha
      FROM historical_data
      GROUP BY record_type
      ORDER BY record_type
    `],
    ["Lecturas por entidad", `
      SELECT entity_id, COUNT(*) AS filas,
             MIN(recorded_at) AS primera_fecha,
             MAX(recorded_at) AS ultima_fecha,
             COUNT(DISTINCT date(recorded_at)) AS dias_utc,
             SUM(CASE WHEN value IS NULL THEN 1 ELSE 0 END) AS valores_nulos
      FROM historical_data
      WHERE record_type = 'reading'
      GROUP BY entity_id
      ORDER BY entity_id
    `],
    ["Estadísticas por entidad", `
      SELECT statistic_id, COUNT(*) AS filas,
             MIN(recorded_at) AS primera_fecha,
             MAX(recorded_at) AS ultima_fecha,
             COUNT(DISTINCT date(recorded_at)) AS dias_utc,
             SUM(CASE WHEN state IS NULL THEN 1 ELSE 0 END) AS state_nulo,
             SUM(CASE WHEN sum IS NULL THEN 1 ELSE 0 END) AS sum_nulo
      FROM historical_data
      WHERE record_type = 'statistics'
      GROUP BY statistic_id
      ORDER BY statistic_id
    `],
    ["Duplicados de timestamp en lecturas", `
      SELECT entity_id, recorded_at, COUNT(*) AS filas
      FROM historical_data
      WHERE record_type = 'reading'
      GROUP BY entity_id, recorded_at
      HAVING COUNT(*) > 1
      ORDER BY filas DESC, entity_id, recorded_at
      LIMIT 100
    `],
    ["Comparación statistics.state vs lectura más cercana (5 min)", `
      SELECT s.statistic_id, COUNT(*) AS puntos_estadisticos,
             SUM(CASE WHEN r.value IS NOT NULL THEN 1 ELSE 0 END) AS con_lectura_cercana,
             ROUND(AVG(ABS(s.state - r.value)), 6) AS diferencia_media,
             ROUND(MAX(ABS(s.state - r.value)), 6) AS diferencia_maxima
      FROM historical_data s
      LEFT JOIN historical_data r
        ON r.id = (
          SELECT r2.id
          FROM historical_data r2
          WHERE r2.record_type = 'reading'
            AND r2.entity_id = s.statistic_id
            AND julianday(r2.recorded_at) IS NOT NULL
            AND ABS(julianday(r2.recorded_at) - julianday(s.recorded_at)) <= (5.0 / 1440.0)
          ORDER BY ABS(julianday(r2.recorded_at) - julianday(s.recorded_at)),
                   r2.recorded_at, r2.source_row_id
          LIMIT 1
        )
      WHERE s.record_type = 'statistics'
        AND s.statistic_id IN (
          'sensor.sierra_blanca_energia_consumida_a',
          'sensor.sierra_blanca_energia_consumida_b',
          'sensor.sierra_blanca_energia_producida_a',
          'sensor.sierra_blanca_energia_producida_b'
        )
      GROUP BY s.statistic_id
      ORDER BY s.statistic_id
    `],
  ];

  for (const [title, sql] of checks) {
    const { rows } = await db.execute({ sql });
    console.log(`\\n=== ${title} ===`);
    console.table(rows);
  }

  console.log("\\nNota: el informe comprueba coherencia interna y proximidad entre state y lecturas. Para certificar que Turso coincide con Home Assistant, hay que comparar además contra una exportación original de HA del mismo periodo.");
}

main().catch((error) => {
  console.error("No se pudo auditar el histórico:", error.message);
  process.exitCode = 1;
});
