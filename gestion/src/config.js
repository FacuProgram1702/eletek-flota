require('./cargarEnv');
const path = require('path');

const raiz = path.join(__dirname, '..');

module.exports = {
  // Puerto propio: el panel de conectividad (API MIKRO) sigue en el 3000 y
  // este sistema corre al lado sin tocarlo.
  port: parseInt(process.env.PORT, 10) || 3100,

  sessionSecret: process.env.SESSION_SECRET || 'cambiar-esta-clave-en-el-env',

  dbPath: path.resolve(raiz, process.env.DB_PATH || 'data/gestion.db'),

  // Base del panel de conectividad, SOLO LECTURA. De ahí se toma la última
  // posición GPS de cada barco para los partes de pesca. Es opcional: sin
  // esto, la posición del lance sale del teléfono o se carga a mano.
  conectividadDbPath: process.env.CONECTIVIDAD_DB
    ? path.resolve(raiz, process.env.CONECTIVIDAD_DB)
    : null,

  // Dirección del panel de conectividad, para el acceso directo del menú
  conectividadUrl: process.env.CONECTIVIDAD_URL || '',

  // Superadministrador de ELETEK que se crea en el primer arranque
  superUser: process.env.SUPER_USER || 'eletek',
  superPass: process.env.SUPER_PASS || '',
};
