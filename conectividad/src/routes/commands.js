/**
 * Rutas de órdenes (commands) para el panel web.
 * Todas requieren autenticación de admin.
 */

const express = require('express');
const db = require('../db/database');
const { requireAuth, requireAdmin, requireVesselAccess, isAdmin } = require('../middleware/auth');
const { translate, COMMAND_TYPES } = require('../services/commandTranslator');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Tipos de orden que puede mandar un operador.
 * Lista blanca a propósito: cualquier tipo nuevo queda denegado por omisión.
 * Nunca incluir 'raw_command' — ejecuta scripts RouterOS arbitrarios y
 * anularía el resto de las restricciones.
 */
const OPERADOR_ALLOWED_TYPES = ['create_user', 'delete_user', 'update_user', 'reset_quota', 'set_quota_mode'];

/**
 * Campos del payload que un operador puede mandar en cada tipo de orden.
 * No incluye 'profile' (todos los usuarios van al perfil por defecto) ni
 * 'password' al editar (no cambia credenciales de la tripulación).
 */
const OPERADOR_PAYLOAD_FIELDS = {
  create_user: ['name', 'password', 'limit_bytes_total'],
  update_user: ['name', 'limit_bytes_total'],
  delete_user: ['name'],
  reset_quota: ['name'],
  // 'mode' se valida contra los planes definidos, así que puede mover
  // usuarios entre diario y mensual sin poder elegir un perfil arbitrario
  set_quota_mode: ['name', 'mode', 'limit_bytes_total'],
};


/**
 * GET /api/command-types
 * Lista los tipos de comando soportados (para el formulario del frontend).
 */
router.get('/command-types', requireAuth, (req, res) => {
  if (isAdmin(req)) return res.json(COMMAND_TYPES);
  return res.json(COMMAND_TYPES.filter((t) => OPERADOR_ALLOWED_TYPES.includes(t.value)));
});

/**
 * GET /api/vessels/:slug/commands
 * Historial de órdenes de un barco (más recientes primero).
 * Query params: ?limit=50&offset=0&status=pending
 */
router.get('/vessels/:slug/commands', requireAuth, requireAdmin, requireVesselAccess, (req, res) => {
  const vessel = db.prepare('SELECT id FROM vessels WHERE slug = ?').get(req.params.slug);
  if (!vessel) {
    return res.status(404).json({ error: 'Barco no encontrado' });
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;

  let query = `
    SELECT * FROM commands
    WHERE vessel_id = ?
  `;
  const params = [vessel.id];

  if (req.query.status) {
    query += ' AND status = ?';
    params.push(req.query.status);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const commands = db.prepare(query).all(...params);

  // Parsear payload de JSON string a objeto
  const result = commands.map((c) => ({
    ...c,
    payload: JSON.parse(c.payload || '{}'),
  }));

  // Total para paginación
  let countQuery = 'SELECT COUNT(*) as total FROM commands WHERE vessel_id = ?';
  const countParams = [vessel.id];
  if (req.query.status) {
    countQuery += ' AND status = ?';
    countParams.push(req.query.status);
  }
  const { total } = db.prepare(countQuery).get(...countParams);

  return res.json({ commands: result, total, limit, offset });
});

/**
 * POST /api/vessels/:slug/commands
 * Crea una orden nueva. El backend traduce tipo+payload a raw_script.
 * Body: { type, payload }
 */
router.post('/vessels/:slug/commands', requireAuth, requireVesselAccess, (req, res) => {
  try {
    const vessel = db.prepare('SELECT id, name FROM vessels WHERE slug = ?').get(req.params.slug);
    if (!vessel) {
      return res.status(404).json({ error: 'Barco no encontrado' });
    }

    const { type, payload } = req.body;

    if (!type) {
      return res.status(400).json({ error: 'El tipo de orden es requerido' });
    }

    // Una sola orden en cola por barco: mientras haya una sin entregar, no se
    // aceptan nuevas. El router procesa de a una, así que acumular pendientes
    // hacía que se pisaran entre sí. Se libera en cuanto el barco la recibe.
    const pending = db.prepare(`
      SELECT id FROM commands WHERE vessel_id = ? AND status = 'pending' LIMIT 1
    `).get(vessel.id);

    if (pending) {
      return res.status(409).json({
        error: `Hay una orden pendiente (#${pending.id}) que el barco todavía no recibió. Esperá a que la tome y volvé a intentar.`,
      });
    }

    // Un operador solo puede mandar los tipos de la lista blanca
    if (!isAdmin(req)) {
      if (!OPERADOR_ALLOWED_TYPES.includes(type)) {
        logger.info(`Orden "${type}" rechazada para ${req.session.user} (sin permisos)`);
        return res.status(403).json({ error: 'No tenés permisos para este tipo de orden' });
      }

      // Solo los campos habilitados para ese tipo de orden
      const allowed = OPERADOR_PAYLOAD_FIELDS[type] || [];
      const extra = Object.keys(payload || {}).filter((k) => !allowed.includes(k));
      if (extra.length > 0) {
        return res.status(403).json({
          error: `No podés modificar estos campos: ${extra.join(', ')}`,
        });
      }
    }

    // Traducir a raw_script
    const { raw_script } = translate(type, payload || {});

    const stmt = db.prepare(`
      INSERT INTO commands (vessel_id, type, payload, raw_script, status)
      VALUES (?, ?, ?, ?, 'pending')
    `);
    const info = stmt.run(vessel.id, type, JSON.stringify(payload || {}), raw_script);

    const command = db.prepare('SELECT * FROM commands WHERE id = ?').get(info.lastInsertRowid);
    command.payload = JSON.parse(command.payload);

    logger.info(`Orden creada: #${command.id} [${type}] para ${vessel.name}`);
    return res.status(201).json(command);
  } catch (err) {
    // Errores de validación del traductor
    if (err.message && !err.message.includes('SQLITE')) {
      return res.status(400).json({ error: err.message });
    }
    logger.error('Error creando orden:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

/**
 * DELETE /api/commands/:id
 * Cancela una orden pendiente.
 */
router.delete('/commands/:id', requireAuth, requireAdmin, (req, res) => {
  const command = db.prepare('SELECT * FROM commands WHERE id = ?').get(req.params.id);
  if (!command) {
    return res.status(404).json({ error: 'Orden no encontrada' });
  }

  if (command.status !== 'pending') {
    return res.status(400).json({
      error: `No se puede cancelar una orden en estado "${command.status}". Solo se pueden cancelar órdenes pendientes.`,
    });
  }

  db.prepare('DELETE FROM commands WHERE id = ?').run(command.id);
  logger.info(`Orden cancelada: #${command.id}`);
  return res.json({ ok: true });
});

module.exports = router;
