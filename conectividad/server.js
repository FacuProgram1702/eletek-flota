/**
 * ELETEK — Sistema de Administración Remota de MikroTiks
 * Entry point del servidor.
 */

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const morgan = require('morgan');
const path = require('path');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const salud = require('./src/utils/salud');

async function startServer() {
  // Inicializar base de datos (node:sqlite, ver src/db/database.js)
  const db = require('./src/db/database');
  await db.initDatabase();

  // Manejadores de errores del proceso. Van apenas la base está lista, para
  // que cualquier fallo posterior quede registrado en vez de tumbar el
  // servidor sin dejar rastro, y para que al cerrar se vuelque lo pendiente.
  salud.instalar(() => db.cerrar());

  // Ejecutar migraciones
  const { runMigrations } = require('./src/db/migrations');
  runMigrations();

  const app = express();

  // ── Middleware global ──────────────────────────────────────
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Logs HTTP
  app.use(morgan('short'));
  app.use(salud.middleware);

  // Sesiones
  app.use(session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 horas
      sameSite: 'lax',
    },
  }));

  // Archivos estáticos (panel web)
  app.use(express.static(path.join(__dirname, 'public')));

  // ── Rutas ──────────────────────────────────────────────────

  // Auth del panel
  app.use('/auth', require('./src/routes/auth'));

  // API máquina-a-máquina para MikroTik (auth por token)
  // IMPORTANTE: montar ANTES de las rutas del panel para que requireAuth no interfiera
  app.use('/api/v1', require('./src/routes/mikrotik'));

  // Portal de conexión (público, HTTPS) — captura de posición
  app.use('/', require('./src/routes/location'));

  // API del panel (requieren auth de sesión)
  app.use('/api', require('./src/routes/vessels'));
  app.use('/api', require('./src/routes/commands'));
  app.use('/api', require('./src/routes/usage'));
  app.use('/api', require('./src/routes/operators'));

  // SPA fallback: cualquier ruta no-API sirve el index.html
  app.get('*', (req, res) => {
    // No interferir con rutas de API
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
      return res.status(404).json({ error: 'Endpoint no encontrado' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // ── Manejo de errores global ──────────────────────────────
  app.use((err, req, res, _next) => {
    salud.contarError();
    salud.escribir('ERROR', 'Error en ' + req.method + ' ' + req.originalUrl + ': ' +
      ((err && err.stack) ? err.stack : String(err)));
    logger.error('Error no manejado:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  // ── Iniciar servidor ──────────────────────────────────────
  const server = app.listen(config.port, () => {
    logger.info(`🚀 ELETEK corriendo en http://localhost:${config.port}`);
    logger.info(`   Panel web: http://localhost:${config.port}`);
    logger.info(`   API M2M:   http://localhost:${config.port}/api/v1/poll/:slug`);
  });

  // Puerto ocupado = ya hay otro servidor corriendo. Antes este error lo
  // tragaba el manejador de excepciones y quedaba un segundo proceso a medio
  // arrancar (en salud.log se veía "Servidor iniciado" dos veces seguidas).
  // Ahora se registra y se sale: el que está atendiendo sigue intacto.
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      salud.escribir('ERROR', 'El puerto ' + config.port + ' ya está en uso: hay otro servidor ELETEK corriendo. Este se cierra.');
    } else {
      salud.escribir('ERROR', 'No se pudo abrir el puerto: ' + ((err && err.stack) || err));
    }
    process.exit(1);
  });

  // Control de salud de la base. Si deja de responder, seguir vivo no sirve
  // de nada: los barcos recibirían error 500 durante horas (lo que pasaba con
  // sql.js). Mejor salir, y que backend.bat vuelva a levantar el servidor en
  // segundos. Se tolera algún fallo aislado antes de decidir.
  let fallosSeguidos = 0;
  const control = setInterval(() => {
    try {
      db.verificar();
      fallosSeguidos = 0;
    } catch (err) {
      fallosSeguidos++;
      salud.escribir('ERROR', 'La base no responde (' + fallosSeguidos + '/3): ' + ((err && err.message) || err));
      if (fallosSeguidos >= 3) {
        salud.escribir('ERROR', 'Reiniciando el proceso para recuperar la base.');
        try { db.cerrar(); } catch (e) { /* nada que hacer */ }
        process.exit(1);
      }
    }
  }, 60000);
  if (control.unref) control.unref();
}

startServer().catch((err) => {
  console.error('Error fatal al iniciar ELETEK:', err);
  try { salud.escribir('ERROR', 'No pudo arrancar: ' + ((err && err.stack) || err)); } catch (e) { /* ya está */ }
  process.exit(1);
});
