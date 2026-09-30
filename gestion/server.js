/**
 * ELETEK Gestión — sistema de gestión de flota por módulos.
 *
 * Corre al lado del panel de conectividad (API MIKRO), en otro puerto y con
 * su propia base. No toca nada de ese sistema: solo lee, si se configura,
 * la última posición GPS de cada barco para los partes de pesca.
 */

const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('./src/config');
const db = require('./src/db/database');
const { crearEsquema } = require('./src/db/esquema');
const { AlmacenSQLite, DURACION_MS, limpiarVencidas } = require('./src/sesiones');
const { cargarUsuario, requiereLogin } = require('./src/middleware/auth');

function registrarError(err, donde) {
  console.error(`[${new Date().toISOString()}] ERROR ${donde}:`, err && err.stack ? err.stack : err);
}

process.on('unhandledRejection', (e) => registrarError(e, 'promesa sin atrapar'));
process.on('uncaughtException', (e) => registrarError(e, 'excepción sin atrapar'));
process.on('warning', (w) => {
  // node:sqlite se marca experimental en Node; es esperable
  if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  console.warn(w.name + ': ' + w.message);
});

db.abrir();
crearEsquema();

// Primer arranque: crea el superadministrador de ELETEK
if (!db.uno('SELECT id FROM usuarios WHERE es_superadmin = 1')) {
  if (!config.superPass || config.superPass.length < 8) {
    console.error('Falta SUPER_PASS en el .env (mínimo 8 caracteres) para crear el usuario de ELETEK.');
    process.exit(1);
  }
  db.ejecutar(
    `INSERT INTO usuarios (empresa_id, nombre, usuario, clave_hash, es_superadmin, es_admin, creado)
     VALUES (NULL, 'ELETEK', ?, ?, 1, 1, ?)`,
    config.superUser.toLowerCase(), bcrypt.hashSync(config.superPass, 10), new Date().toISOString()
  );
  console.log(`Usuario de ELETEK creado: ${config.superUser}`);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // detrás de Caddy
app.use(express.json({ limit: '10mb' })); // la importación de planillas manda filas en JSON

app.use(session({
  name: 'eletek.sid',
  store: new AlmacenSQLite(),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  // secure 'auto': por HTTPS (Caddy) la cookie viaja solo cifrada; por
  // http://localhost sigue funcionando para usarlo desde esta misma PC.
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: DURACION_MS, secure: 'auto' },
}));

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));
app.use(cargarUsuario);

app.use('/auth', require('./src/rutas/auth'));
app.use('/api/super', require('./src/rutas/super'));
app.use('/api/admin', requiereLogin, require('./src/rutas/admin'));
app.use('/api/tablero', requiereLogin, require('./src/rutas/tablero'));
app.use('/api/stock', requiereLogin, require('./src/rutas/stock'));
app.use('/api/mantenimiento', requiereLogin, require('./src/rutas/mantenimiento'));
app.use('/api/trabajos', requiereLogin, require('./src/rutas/trabajos'));
app.use('/api/proveedores', requiereLogin, require('./src/rutas/proveedores'));
app.use('/api/compras', requiereLogin, require('./src/rutas/compras'));
app.use('/api/pesca', requiereLogin, require('./src/rutas/pesca'));
app.use('/api/viveres', requiereLogin, require('./src/rutas/viveres'));
app.use('/api/seguimiento', requiereLogin, require('./src/rutas/seguimiento'));

app.use('/api', (req, res) => res.status(404).json({ error: 'No existe esa dirección de la API' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Errores: los "de usuario" se muestran tal cual; el resto se registra
app.use((err, req, res, _next) => {
  if (err && err.esUsuario) return res.status(err.status || 400).json({ error: err.message });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'El archivo es demasiado grande' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Datos mal formados' });
  // Restricciones de la base que se escaparon a la validación
  if (err && /constraint failed/i.test(err.message || '')) {
    registrarError(err, `${req.method} ${req.originalUrl}`);
    return res.status(409).json({ error: 'La operación no es válida con los datos actuales' });
  }
  registrarError(err, `${req.method} ${req.originalUrl}`);
  res.status(500).json({ error: 'Error interno del servidor' });
});

require('./src/servicios/duckdns').iniciar();

const server = app.listen(config.port, () => {
  console.log(`ELETEK Gestión en http://localhost:${config.port}`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`El puerto ${config.port} ya está en uso: ¿hay otra copia corriendo?`);
  else registrarError(err, 'al abrir el puerto');
  process.exit(1);
});

// Control de la base: si deja de responder, salir para que iniciar.bat reinicie
let fallos = 0;
setInterval(() => {
  try { db.verificar(); fallos = 0; } catch (e) {
    fallos++;
    registrarError(e, `control de la base (${fallos}/3)`);
    if (fallos >= 3) { db.cerrar(); process.exit(1); }
  }
}, 60000).unref();
setInterval(limpiarVencidas, 3600000).unref();

function salir() {
  db.cerrar();
  process.exit(0);
}
process.on('SIGINT', salir);
process.on('SIGTERM', salir);
