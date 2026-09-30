require('dotenv').config();
const path = require('path');

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',

  // Administrador del panel (hardcodeado — nunca se guarda en la DB)
  adminUser: process.env.ADMIN_USER || 'admin',
  // Sin valor por defecto: la contraseña del admin va SOLO en el .env
  adminPass: process.env.ADMIN_PASS || '',

  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'eletek.db'),

  // Un barco se considera "online" si hizo polling en los últimos 5 minutos
  onlineThresholdMs: 5 * 60 * 1000,
};
