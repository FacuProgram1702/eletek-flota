/**
 * Middleware de autenticación para los endpoints máquina-a-máquina (MikroTik).
 * Acepta token por:
 *   1. Query string: ?token=xxx
 *   2. Header: Authorization: Bearer xxx
 *
 * Busca el barco correspondiente al token y lo adjunta a req.vessel.
 */

const db = require('../db/database');

function requireVesselAuth(req, res, next) {
  // Extraer token de query string o header
  let token = req.query.token;

  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  // Buscar el barco por token
  const vessel = db.prepare('SELECT * FROM vessels WHERE api_token = ?').get(token);

  if (!vessel) {
    return res.status(403).json({ error: 'Token inválido' });
  }

  // Verificar que el slug del URL coincida con el barco del token
  if (req.params.slug && req.params.slug !== vessel.slug) {
    return res.status(403).json({ error: 'Token no corresponde a este barco' });
  }

  req.vessel = vessel;
  next();
}

module.exports = { requireVesselAuth };
