/**
 * Registro de auditoría: quién hizo qué y cuándo, en todos los módulos.
 * Nunca debe romper la operación que audita.
 */

const db = require('../db/database');
const { ahora } = require('../util');

function auditar(req, accion, entidad, entidadId, detalle = '') {
  try {
    const u = req && req.usuario;
    db.ejecutar(
      `INSERT INTO auditoria (empresa_id, usuario_id, fecha, accion, entidad, entidad_id, detalle)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      u ? u.empresa_id : null, u ? u.id : null, ahora(), accion, entidad, entidadId || null,
      typeof detalle === 'string' ? detalle.slice(0, 2000) : JSON.stringify(detalle).slice(0, 2000)
    );
  } catch (e) {
    console.error('[auditoría] no se pudo registrar:', e.message);
  }
}

module.exports = { auditar };
