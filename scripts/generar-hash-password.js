const bcrypt = require("bcryptjs");
const password = process.argv[2];
if (!password) {
  console.error('Uso: node scripts/generar-hash-password.js "TuContraseña"');
  process.exit(1);
}
console.log("\nAñade esto a tu .env / variables de entorno de Vercel:\n");
console.log(`ADMIN_PASSWORD_HASH=${bcrypt.hashSync(password, 12)}\n`);
