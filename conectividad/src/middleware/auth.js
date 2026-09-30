/**
 * Middlewares de autenticación y permisos del panel web.
 *
 * Roles:
 *   admin    — acceso total a toda la flota
 *   operador — solo gestiona usuarios del hotspot, y solo en los barcos asignados
 *
 * El scope de la sesión:
 *   - null  = toda la flota (solo admin)
 *   - array = lista de slugs accesibles (operador)
 */

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.status(401).json({ error: 'No autenticado. Iniciá sesión primero.' });
}

/**
 * Solo para administradores: crear/editar/eliminar barcos, ver tokens,
 * mandar comandos manuales, gestionar operadores.
 */
function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'No tenés permisos para esta acción' });
}

/**
 * Verifica que el barco de la ruta (:slug) esté dentro del scope del usuario.
 * - scope null (admin): permite cualquier barco.
 * - scope array (operador): el slug debe estar en el array.
 */
function requireVesselAccess(req, res, next) {
  if (!req.session) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  const scope = req.session.scope;

  // Admin (scope null) tiene acceso a todo
  if (scope === null || scope === undefined) {
    return next();
  }

  // Operador: verificar que el slug esté en su array de acceso
  const slugs = Array.isArray(scope) ? scope : [];
  if (slugs.includes(req.params.slug)) {
    return next();
  }

  return res.status(403).json({ error: 'No tenés acceso a este barco' });
}

/** @returns {boolean} si la sesión es de un administrador */
function isAdmin(req) {
  return !!(req.session && req.session.role === 'admin');
}

module.exports = { requireAuth, requireAdmin, requireVesselAccess, isAdmin };
