/**
 * Rutas de autenticación del panel web.
 * Busca primero en config (admin hardcodeado) y luego en la DB (operadores).
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('../db/database');
const logger = require('../utils/logger');

const router = express.Router();

// Hash del admin hardcodeado (se genera al arrancar)
let adminHash = null;
(async () => {
  adminHash = await bcrypt.hash(config.adminPass, 10);
})();

/**
 * POST /auth/login
 * Body: { username, password }
 * Busca primero el admin hardcodeado, luego operadores en la DB.
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    // ── 1. Verificar admin hardcodeado ────────────────────────
    if (username === config.adminUser) {
      if (!adminHash) {
        return res.status(500).json({ error: 'Error interno' });
      }
      const match = await bcrypt.compare(password, adminHash);
      if (!match) {
        return res.status(401).json({ error: 'Credenciales inválidas' });
      }
      req.session.authenticated = true;
      req.session.user = config.adminUser;
      req.session.role = 'admin';
      req.session.scope = null; // admin ve todo
      logger.info(`Login exitoso: ${config.adminUser} (admin)`);
      return res.json({ ok: true, user: config.adminUser, role: 'admin', scope: null });
    }

    // ── 2. Buscar en la tabla panel_users (operadores) ────────
    const dbUser = db.prepare('SELECT * FROM panel_users WHERE username = ?').get(username);
    if (!dbUser) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const match = await bcrypt.compare(password, dbUser.password);
    if (!match) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Parsear scope (array JSON de slugs)
    let scope = [];
    try {
      scope = JSON.parse(dbUser.scope);
    } catch {
      scope = [];
    }

    req.session.authenticated = true;
    req.session.user = dbUser.username;
    req.session.role = dbUser.role;
    req.session.scope = scope;
    logger.info(`Login exitoso: ${dbUser.username} (${dbUser.role})`);

    return res.json({ ok: true, user: dbUser.username, role: dbUser.role, scope });
  } catch (err) {
    logger.error('Error en login:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

/**
 * POST /auth/logout
 */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Error cerrando sesión' });
    }
    res.clearCookie('connect.sid');
    return res.json({ ok: true });
  });
});

/**
 * GET /auth/check
 * Verifica si hay sesión activa (para el frontend).
 */
router.get('/check', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.json({
      authenticated: true,
      user: req.session.user,
      role: req.session.role,
      scope: req.session.scope,
    });
  }
  return res.json({ authenticated: false });
});

module.exports = router;
