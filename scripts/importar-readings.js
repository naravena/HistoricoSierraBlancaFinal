require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const db = require("../src/db");

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

async function main() {
  const file = process.argv[2] || path.join(process.cwd(), "readings.csv");
  if (!fs.existsSync(file)) throw new Error(`No existe el CSV: ${file}`);
  const lines = fs.readFileSync(file, "utf8").replace(/^\\uFEFF/, "").split(/\\r?\\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("El CSV está vacío o solo contiene cabeceras.");

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const required = ["entity_id", "recorded_at", "value"];
  for (const name of required) if (!headers.includes(name)) throw new Error(`Falta la columna obligatoria: ${name}`);
  const indexes = required.map((name) => headers.indexOf(name));
  const batchSize = 80;
  let imported = 0;
  let skipped = 0;
  let nextSourceId = 1;

  const maxResult = await db.execute({
    sql: "SELECT COALESCE(MAX(source_row_id), 0) AS max_id FROM historical_data WHERE record_type = 'reading'",
  });
  nextSourceId = Number(maxResult.rows[0]?.max_id || 0) + 1;

  // Deduplicar también dentro del propio CSV. La clave conserva el timestamp
  // exacto de origen para no normalizar ni alterar el histórico importado.
  const seen = new Set();
  const parsed = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = indexes.map((index) => (values[index] ?? "").trim());
    if (!row[0] || !row[1] || row[2] === "" || !Number.isFinite(Number(row[2]))) {
      throw new Error(`Fila ${i + 1}: entity_id, recorded_at y value son obligatorios; value debe ser numérico.`);
    }
    const key = JSON.stringify([row[0], row[1]]);
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    parsed.push(row);
  }

  for (let start = 0; start < parsed.length; start += batchSize) {
    const batch = parsed.slice(start, start + batchSize);
    const valuesSql = batch.map(() => "(?, ?, ?, ?)").join(", ");
    const args = [];
    for (const row of batch) {
      args.push(nextSourceId++, row[0], row[1], Number(row[2]));
    }

    const result = await db.execute({
      sql: `
        WITH incoming(source_row_id, entity_id, recorded_at, value) AS (
          VALUES ${valuesSql}
        )
        INSERT INTO historical_data (
          record_type, source_row_id, entity_id, recorded_at, value
        )
        SELECT 'reading', incoming.source_row_id, incoming.entity_id,
               incoming.recorded_at, incoming.value
        FROM incoming
        WHERE NOT EXISTS (
          SELECT 1
          FROM historical_data existing
          WHERE existing.record_type = 'reading'
            AND existing.entity_id = incoming.entity_id
            AND existing.recorded_at = incoming.recorded_at
        )
      `,
      args,
    });
    imported += result.rowsAffected;
    skipped += batch.length - result.rowsAffected;
    console.log(`Procesadas ${Math.min(start + batchSize, parsed.length)} / ${parsed.length} filas nuevas/únicas del CSV`);
  }

  console.log(`Importación terminada en historical_data. Insertadas: ${imported}. Duplicadas omitidas: ${skipped}.`);
}

main().catch((error) => {
  console.error("No se pudo importar el histórico:", error.message);
  process.exitCode = 1;
});
