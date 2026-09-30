/**
 * Rutas CRUD de operadores del panel.
 * Solo accesibles para administradores.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/operators
 * Lista todos los operadores (sin exponer passwords).
 */
router.get('/operators', requireAuth, requireAdmin, (req, res) => {
  const operators = db.prepare(`
    SELECT id, username, role, scope, created_at
    FROM panel_users ORDER BY username ASC
  `).all();

  // Parsear scope de JSON string a array
  const result = operators.map((op) => {
    let scope = [];
    try { scope = JSON.parse(op.scope); } catch { scope = []; }
    return { ...op, scope };
  });

  return res.json(result);
});

/**
 * POST /api/operators
 * Crea un nuevo operador.
 * Body: { username, password, scope: ["slug1", "slug2"] }
 */
router.post('/operators', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, scope } = req.body;

    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'El nombre de usuario es requerido' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const slugs = Array.isArray(scope) ? scope : [];

    // Verificar que no exista ya ese username
    const existing = db.prepare('SELECT id FROM panel_users WHERE username = ?').get(username.trim());
    if (existing) {
      return res.status(409).json({ error: `Ya existe un operador con el usuario "${username.trim()}"` });
    }

    // Verificar que los slugs existen en la DB
    for (const slug of slugs) {
      const vessel = db.prepare('SELECT id FROM vessels WHERE slug = ?').get(slug);
      if (!vessel) {
        return res.status(400).json({ error: `El barco "${slug}" no existe` });
      }
    }

    const hash = await bcrypt.hash(password, 10);
    const scopeJson = JSON.stringify(slugs);

    const info = db.prepare(`
      INSERT INTO panel_users (username, password, role, scope)
      VALUES (?, ?, 'operador', ?)
    `).run(username.trim(), hash, scopeJson);

    const operator = db.prepare(
      'SELECT id, username, role, scope, created_at FROM panel_users WHERE id = ?'
    ).get(info.lastInsertRowid);

    let parsedScope = [];
    try { parsedScope = JSON.parse(operator.scope); } catch { parsedScope = []; }

    logger.info(`Operador creado: ${operator.username}`);
    return res.status(201).json({ ...operator, scope: parsedScope });
  } catch (err) {
    logger.error('Error creando operador:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

/**
 * PUT /api/operators/:id
 * Actualiza un operador: username, password (opcional) y/o scope.
 * Body: { username?, password?, scope?: ["slug1"] }
 */
router.put('/operators/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, scope } = req.body;

    const operator = db.prepare('SELECT * FROM panel_users WHERE id = ?').get(id);
    if (!operator) {
      return res.status(404).json({ error: 'Operador no encontrado' });
    }

    let newUsername = operator.username;
    let newHash = operator.password;
    let newScope = operator.scope;

    if (username && username.trim() && username.trim() !== operator.username) {
      const existing = db.prepare(
        'SELECT id FROM panel_users WHERE username = ? AND id != ?'
      ).get(username.trim(), id);
      if (existing) {
        return res.status(409).json({ error: `Ya existe un operador con el usuario "${username.trim()}"` });
      }
      newUsername = username.trim();
    }

    if (password) {
      if (password.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
      }
      newHash = await bcrypt.hash(password, 10);
    }

    if (scope !== undefined) {
      const slugs = Array.isArray(scope) ? scope : [];
      // Verificar que los slugs existen
      for (const slug of slugs) {
        const vessel = db.prepare('SELECT id FROM vessels WHERE slug = ?').get(slug);
        if (!vessel) {
          return res.status(400).json({ error: `El barco "${slug}" no existe` });
        }
      }
      newScope = JSON.stringify(slugs);
    }

    db.prepare(`
      UPDATE panel_users SET username = ?, password = ?, scope = ? WHERE id = ?
    `).run(newUsername, newHash, newScope, id);

    let parsedScope = [];
    try { parsedScope = JSON.parse(newScope); } catch { parsedScope = []; }

    logger.info(`Operador actualizado: ${newUsername} (id=${id})`);
    return res.json({ ok: true, id: Number(id), username: newUsername, scope: parsedScope });
  } catch (err) {
    logger.error('Error actualizando operador:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

/**
 * DELETE /api/operators/:id
 * Elimina un operador.
 */
router.delete('/operators/:id', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.params;

  const operator = db.prepare('SELECT * FROM panel_users WHERE id = ?').get(id);
  if (!operator) {
    return res.status(404).json({ error: 'Operador no encontrado' });
  }

  db.prepare('DELETE FROM panel_users WHERE id = ?').run(id);
  logger.info(`Operador eliminado: ${operator.username} (id=${id})`);
  return res.json({ ok: true });
});

module.exports = router;
