require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const db = require("../src/db");

async function main() {
  const schemaPath = path.join(__dirname, "..", "turso", "schema.sql");
  const statements = fs.readFileSync(schemaPath, "utf8").split(";").map((s) => s.trim()).filter(Boolean);
  for (const sql of statements) await db.execute({ sql });
  console.log("Esquema de historical_data preparado en Turso.");
}

main().catch((error) => {
  console.error("No se pudo preparar el esquema histórico de Turso:", error.message);
  process.exitCode = 1;
});
