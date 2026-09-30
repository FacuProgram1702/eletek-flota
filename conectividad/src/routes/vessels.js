/**
 * Rutas CRUD de barcos para el panel web.
 * Todas requieren autenticación de admin.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { requireAuth, requireAdmin, requireVesselAccess, isAdmin } = require('../middleware/auth');
const { validateSlug } = require('../utils/sanitize');
const config = require('../config');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/vessels
 * Lista todos los barcos con su estado online/offline.
 */
router.get('/vessels', requireAuth, (req, res) => {
  const scope = req.session.scope; // null = admin (todo), array = operador

  let vessels;

  if (scope === null || scope === undefined) {
    // Admin: ver todos los barcos
    vessels = db.prepare(`
      SELECT id, name, slug, api_token, last_seen, created_at
      FROM vessels ORDER BY name ASC
    `).all();
  } else if (Array.isArray(scope) && scope.length > 0) {
    // Operador con barcos asignados: filtrar por su lista de slugs
    const placeholders = scope.map(() => '?').join(', ');
    vessels = db.prepare(`
      SELECT id, name, slug, api_token, last_seen, created_at
      FROM vessels WHERE slug IN (${placeholders}) ORDER BY name ASC
    `).all(...scope);
  } else {
    // Operador sin barcos asignados
    vessels = [];
  }

  const now = Date.now();
  const admin = isAdmin(req);
  const result = vessels.map((v) => {
    const item = {
      ...v,
      online: v.last_seen
        ? (now - new Date(v.last_seen + 'Z').getTime()) < config.onlineThresholdMs
        : false,
    };
    // El token permite falsificar telemetría e interceptar órdenes: solo admin
    if (!admin) delete item.api_token;
    return item;
  });

  return res.json(result);
});

/**
 * POST /api/vessels
 * Crea un barco nuevo. Genera api_token automáticamente.
 * Body: { name, slug }
 */
router.post('/vessels', requireAuth, requireAdmin, (req, res) => {
  try {
    const { name, slug } = req.body;

    if (!name || !slug) {
      return res.status(400).json({ error: 'name y slug son requeridos' });
    }

    const slugCheck = validateSlug(slug);
    if (!slugCheck.valid) {
      return res.status(400).json({ error: slugCheck.error });
    }

    // Verificar slug único
    const existing = db.prepare('SELECT id FROM vessels WHERE slug = ?').get(slug);
    if (existing) {
      return res.status(409).json({ error: `Ya existe un barco con slug "${slug}"` });
    }

    const api_token = uuidv4();

    const stmt = db.prepare(`
      INSERT INTO vessels (name, slug, api_token) VALUES (?, ?, ?)
    `);
    const info = stmt.run(name.trim(), slug, api_token);

    const vessel = db.prepare('SELECT * FROM vessels WHERE id = ?').get(info.lastInsertRowid);

    logger.info(`Barco creado: ${name} (${slug})`);
    return res.status(201).json(vessel);
  } catch (err) {
    logger.error('Error creando barco:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

/**
 * GET /api/vessels/:slug
 * Detalle de un barco.
 */
router.get('/vessels/:slug', requireAuth, requireVesselAccess, (req, res) => {
  const vessel = db.prepare('SELECT * FROM vessels WHERE slug = ?').get(req.params.slug);
  if (!vessel) {
    return res.status(404).json({ error: 'Barco no encontrado' });
  }

  const now = Date.now();
  vessel.online = vessel.last_seen
    ? (now - new Date(vessel.last_seen + 'Z').getTime()) < config.onlineThresholdMs
    : false;

  // Contar comandos por estado
  const stats = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM commands WHERE vessel_id = ?
    GROUP BY status
  `).all(vessel.id);

  vessel.commandStats = {};
  stats.forEach((s) => { vessel.commandStats[s.status] = s.count; });

  // Orden que está trabando la cola, si la hay. El panel la usa para poder
  // cancelarla: si el router no pollea, quedaría pendiente para siempre y el
  // barco no aceptaría ninguna orden más.
  vessel.pendingCommand = db.prepare(`
    SELECT id, type, created_at FROM commands
    WHERE vessel_id = ? AND status = 'pending'
    ORDER BY created_at ASC LIMIT 1
  `).get(vessel.id) || null;

  try {
    vessel.sync_data = vessel.sync_data ? JSON.parse(vessel.sync_data) : {};
  } catch (e) {
    vessel.sync_data = {};
  }

  // Reinicios del router detectados por caída del uptime. Delatan problemas
  // de alimentación, que en un barco son la causa más común de cortes.
  vessel.reboots = {
    last24h: db.prepare(`
      SELECT COUNT(*) AS n FROM vessel_reboots
      WHERE vessel_id = ? AND detected_at > datetime('now', '-1 day')
    `).get(vessel.id).n,
    last7d: db.prepare(`
      SELECT COUNT(*) AS n FROM vessel_reboots
      WHERE vessel_id = ? AND detected_at > datetime('now', '-7 days')
    `).get(vessel.id).n,
    recent: db.prepare(`
      SELECT detected_at, prev_uptime_s FROM vessel_reboots
      WHERE vessel_id = ? ORDER BY detected_at DESC LIMIT 20
    `).all(vessel.id),
  };

  // El token permite falsificar telemetría e interceptar órdenes: solo admin
  if (!isAdmin(req)) delete vessel.api_token;

  return res.json(vessel);
});

/**
 * PUT /api/vessels/:slug
 * Actualiza el nombre de un barco.
 */
router.put('/vessels/:slug', requireAuth, requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'El nombre es requerido' });
  }

  const vessel = db.prepare('SELECT id FROM vessels WHERE slug = ?').get(req.params.slug);
  if (!vessel) {
    return res.status(404).json({ error: 'Barco no encontrado' });
  }

  db.prepare('UPDATE vessels SET name = ? WHERE id = ?').run(name.trim(), vessel.id);
  logger.info(`Barco actualizado: ${name} (${req.params.slug})`);
  return res.json({ ok: true, name: name.trim() });
});

/**
 * DELETE /api/vessels/:slug
 * Elimina un barco y todas sus órdenes.
 */
router.delete('/vessels/:slug', requireAuth, requireAdmin, (req, res) => {
  const vessel = db.prepare('SELECT * FROM vessels WHERE slug = ?').get(req.params.slug);
  if (!vessel) {
    return res.status(404).json({ error: 'Barco no encontrado' });
  }

  db.prepare('DELETE FROM vessels WHERE id = ?').run(vessel.id);
  logger.info(`Barco eliminado: ${vessel.name} (${vessel.slug})`);
  return res.json({ ok: true });
});

/**
 * GET /api/positions
 * Última posición conocida de cada barco visible por el usuario (según scope).
 * Solo incluye barcos que tengan al menos una posición registrada.
 */
router.get('/positions', requireAuth, (req, res) => {
  const scope = req.session.scope;

  let filtro = '';
  const params = [];
  if (Array.isArray(scope)) {
    if (scope.length === 0) return res.json([]);
    filtro = 'AND v.slug IN (' + scope.map(() => '?').join(', ') + ')';
    params.push(...scope);
  }

  // La última posición de cada barco: la fila más reciente por vessel_id
  const rows = db.prepare(`
    SELECT v.name, v.slug, p.lat, p.lon, p.accuracy, p.reported_at,
           p.source, p.speed_kn, p.course_deg, p.heading_deg
    FROM vessel_positions p
    JOIN vessels v ON v.id = p.vessel_id
    WHERE p.id IN (
      SELECT MAX(id) FROM vessel_positions GROUP BY vessel_id
    )
    ${filtro}
    ORDER BY v.name ASC
  `).all(...params);

  return res.json(rows);
});

module.exports = router;
