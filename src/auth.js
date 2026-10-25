const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const { ADMIN_PASSWORD_HASH, JWT_SECRET } = process.env;
if (!ADMIN_PASSWORD_HASH || !JWT_SECRET) {
  throw new Error(
    'Faltan ADMIN_PASSWORD_HASH o JWT_SECRET. Genera el hash con "npm run generar-hash" y añade ambos a tu .env.'
  );
}

const COOKIE_NAME = "session_token";
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
};

async function verificarPassword(password) {
  return bcrypt.compare(password, ADMIN_PASSWORD_HASH);
}

function emitirToken() {
  return jwt.sign({ auth: true }, JWT_SECRET, { expiresIn: "7d" });
}

function middleware(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "No autenticado" });
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Sesión inválida o caducada" });
  }
}

module.exports = { verificarPassword, emitirToken, middleware, COOKIE_NAME, cookieOptions };
