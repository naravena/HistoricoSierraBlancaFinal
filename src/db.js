require("dotenv").config();

const databaseUrl = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!databaseUrl) throw new Error("Falta TURSO_DATABASE_URL en el entorno.");
if (!authToken) throw new Error("Falta TURSO_AUTH_TOKEN en el entorno.");

const pipelineUrl = `${databaseUrl.replace(/^libsql:/, "https:").replace(/\/$/, "")}/v2/pipeline`;

function encodeValue(value) {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "boolean" || Number.isInteger(value)) return { type: "integer", value: String(Number(value)) };
  if (typeof value === "number") return { type: "float", value };
  return { type: "text", value: String(value) };
}

function decodeValue(value) {
  if (!value || value.type === "null") return null;
  if (value.type === "integer") return Number(value.value);
  if (value.type === "float") return value.value;
  if (value.type === "text") return value.value;
  if (value.type === "blob") return Buffer.from(value.base64, "base64");
  return value.value ?? null;
}

async function execute({ sql, args = [] }) {
  const response = await fetch(pipelineUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [
      { type: "execute", stmt: { sql, args: args.map(encodeValue) } },
      { type: "close" },
    ] }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || `Error de Turso HTTP ${response.status}`);

  const first = payload?.results?.[0];
  if (!first || first.type !== "ok") throw new Error(first?.error?.message || "Turso devolvió una respuesta inesperada.");
  const result = first.response?.result;
  if (!result) throw new Error("Turso no devolvió el resultado de la consulta.");

  const columns = (result.cols || []).map((column) => column.name);
  const rows = (result.rows || []).map((row) => {
    const item = {};
    row.forEach((value, index) => { item[columns[index]] = decodeValue(value); });
    return item;
  });
  return { rows, rowsAffected: result.affected_row_count || 0 };
}

module.exports = { execute };
