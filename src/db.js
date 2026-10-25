const { Pool } = require("pg");
require("dotenv").config();

const connectionString = process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error("Falta SUPABASE_DB_URL en el entorno (ver .env.example)");
}

module.exports = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
