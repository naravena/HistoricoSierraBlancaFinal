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
  const lines = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("El CSV está vacío o solo contiene cabeceras.");

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const required = ["entity_id", "recorded_at", "value"];
  for (const name of required) if (!headers.includes(name)) throw new Error(`Falta la columna obligatoria: ${name}`);
  const indexes = required.map((name) => headers.indexOf(name));
  const batchSize = 100;
  let imported = 0;
  let skipped = 0;

  for (let start = 1; start < lines.length; start += batchSize) {
    const batch = lines.slice(start, start + batchSize).map((line, offset) => {
      const values = parseCsvLine(line);
      const row = indexes.map((index) => (values[index] ?? "").trim());
      const lineNumber = start + offset + 1;
      if (!row[0] || !row[1] || row[2] === "" || !Number.isFinite(Number(row[2]))) {
        throw new Error(`Fila ${lineNumber}: entity_id, recorded_at y value son obligatorios; value debe ser numérico.`);
      }
      return row;
    });
    const placeholders = batch.map(() => "(?, ?, ?)").join(", ");
    const args = batch.flatMap((row) => [row[0], row[1], Number(row[2])]);
    const result = await db.execute({
      sql: `INSERT OR IGNORE INTO readings (entity_id, recorded_at, value) VALUES ${placeholders}`,
      args,
    });
    imported += result.rowsAffected;
    skipped += batch.length - result.rowsAffected;
    console.log(`Procesadas ${Math.min(start + batchSize - 1, lines.length - 1)} / ${lines.length - 1} filas`);
  }

  console.log(`Importación terminada. Insertadas: ${imported}. Duplicadas omitidas: ${skipped}.`);
}

main().catch((error) => {
  console.error("No se pudo importar readings:", error.message);
  process.exitCode = 1;
});
