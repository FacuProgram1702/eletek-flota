/**
 * Autenticación, permisos y alcance por barco.
 *
 * En cada petición se arma `req.usuario` desde la base (no desde la sesión),
 * así un cambio de rol o una baja de usuario tienen efecto enseguida, sin
 * esperar a que la persona cierre sesión.
 *
 * Tres controles, siempre en este orden:
 *   1. ¿Está logueado?                       requiereLogin
 *   2. ¿Su empresa tiene el módulo y su rol  requiere('stock', 'cargar')
 *      la acción?
 *   3. ¿El barco está dentro de su alcance?  verificarBarco(req, barcoId)
 *
 * Y la regla de oro: toda consulta filtra por req.usuario.empresa_id.
 */

const db = require('../db/database');
const { json, ErrorUsuario } = require('../util');
const { PLANES, MODULOS, CLAVES } = require('../permisos');
const { opcionesDe } = require('../servicios/empresa');

function cargarUsuario(req, res, next) {
  req.usuario = null;
  const id = req.session && req.session.usuarioId;
  if (!id) return next();

  const u = db.uno('SELECT * FROM usuarios WHERE id = ? AND activo = 1', id);
  if (!u) {
    req.session.usuarioId = null;
    return next();
  }

  // El superadministrador de ELETEK entra a una empresa para dar soporte
  const empresaId = u.es_superadmin ? (req.session.empresaActiva || null) : u.empresa_id;
  const empresa = empresaId ? db.uno('SELECT * FROM empresas WHERE id = ?', empresaId) : null;

  const esAdmin = !!(u.es_superadmin || u.es_admin);
  const roles = u.es_superadmin ? [] : db.todos(
    `SELECT r.id, r.nombre, r.permisos, r.a_bordo FROM roles r
     JOIN usuario_roles ur ON ur.rol_id = r.id WHERE ur.usuario_id = ?`, u.id
  );

  // Permisos = unión de los de todos sus roles. El admin de la empresa tiene todos.
  const permisos = {};
  if (esAdmin) {
    for (const m of MODULOS) permisos[m.clave] = Object.keys(m.acciones);
  } else {
    for (const r of roles) {
      const p = json(r.permisos, {});
      for (const [mod, acciones] of Object.entries(p)) {
        permisos[mod] = [...new Set([...(permisos[mod] || []), ...acciones])];
      }
    }
  }

  // Módulos que el plan de la empresa habilita
  const habilitados = empresa ? (PLANES[empresa.plan] || PLANES.gestion).modulos : [];

  let barcos = null; // null = toda la flota
  if (!esAdmin && !u.toda_la_flota) {
    barcos = db.todos('SELECT barco_id FROM usuario_barcos WHERE usuario_id = ?', u.id).map((r) => r.barco_id);
  }

  req.usuario = {
    id: u.id,
    nombre: u.nombre,
    usuario: u.usuario,
    empresa_id: empresaId,
    empresa: empresa ? { id: empresa.id, nombre: empresa.nombre, plan: empresa.plan } : null,
    opciones: empresaId ? opcionesDe(empresaId) : {},
    es_superadmin: !!u.es_superadmin,
    es_admin: esAdmin,
    roles: roles.map((r) => ({ id: r.id, nombre: r.nombre, a_bordo: !!r.a_bordo })),
    solo_a_bordo: roles.length > 0 && roles.every((r) => r.a_bordo),
    permisos,
    modulos: habilitados,
    barcos,
  };
  next();
}

function requiereLogin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ error: 'Iniciá sesión para continuar' });
  if (!req.usuario.empresa_id && !req.usuario.es_superadmin) {
    return res.status(403).json({ error: 'El usuario no pertenece a ninguna empresa' });
  }
  next();
}

/** Hace falta una empresa activa (el superadmin tiene que elegir una). */
function requiereEmpresa(req, res, next) {
  if (!req.usuario) return res.status(401).json({ error: 'Iniciá sesión para continuar' });
  if (!req.usuario.empresa_id) return res.status(409).json({ error: 'Elegí una empresa para trabajar' });
  next();
}

function puede(req, modulo, accion = 'ver') {
  const u = req.usuario;
  if (!u || !u.empresa_id) return false;
  if (!u.modulos.includes(modulo)) return false;
  return (u.permisos[modulo] || []).includes(accion);
}

function requiere(modulo, accion = 'ver') {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'Iniciá sesión para continuar' });
    if (!req.usuario.empresa_id) return res.status(409).json({ error: 'Elegí una empresa para trabajar' });
    if (!req.usuario.modulos.includes(modulo)) {
      return res.status(403).json({ error: 'Este módulo no está incluido en el plan de la empresa' });
    }
    if (!puede(req, modulo, accion)) {
      return res.status(403).json({ error: 'No tenés permiso para esta acción' });
    }
    next();
  };
}

function requiereAdmin(req, res, next) {
  if (!req.usuario) return res.status(401).json({ error: 'Iniciá sesión para continuar' });
  if (!req.usuario.empresa_id) return res.status(409).json({ error: 'Elegí una empresa para trabajar' });
  if (!req.usuario.es_admin) return res.status(403).json({ error: 'Solo el administrador de la empresa puede hacer esto' });
  next();
}

function requiereSuper(req, res, next) {
  if (!req.usuario || !req.usuario.es_superadmin) return res.status(403).json({ error: 'Solo para ELETEK' });
  next();
}

/** Barcos que el usuario puede ver (ids), siempre dentro de su empresa. */
function barcosVisibles(req) {
  const u = req.usuario;
  const todos = db.todos('SELECT id FROM barcos WHERE empresa_id = ? AND activo = 1', u.empresa_id).map((r) => r.id);
  return u.barcos === null ? todos : todos.filter((id) => u.barcos.includes(id));
}

/**
 * El barco existe, es de la empresa y está en el alcance del usuario.
 * Devuelve el barco o tira error. Un barco de otra empresa responde 404,
 * no 403: no se confirma que exista.
 */
function verificarBarco(req, barcoId) {
  const b = db.uno('SELECT * FROM barcos WHERE id = ? AND empresa_id = ?', barcoId, req.usuario.empresa_id);
  if (!b) throw new ErrorUsuario('Barco no encontrado', 404);
  if (req.usuario.barcos !== null && !req.usuario.barcos.includes(b.id)) {
    throw new ErrorUsuario('No tenés acceso a ese barco', 403);
  }
  return b;
}

/**
 * Depósito de la empresa, y si es de un barco, dentro del alcance. Los
 * depósitos en tierra los ve cualquiera con permiso de stock.
 */
function verificarDeposito(req, depositoId) {
  const d = db.uno('SELECT * FROM depositos WHERE id = ? AND empresa_id = ?', depositoId, req.usuario.empresa_id);
  if (!d) throw new ErrorUsuario('Depósito no encontrado', 404);
  if (d.barco_id) verificarBarco(req, d.barco_id);
  return d;
}

/** Fragmento SQL "AND <col> IN (...)" según el alcance del usuario. */
function filtroBarcos(req, columna) {
  const ids = barcosVisibles(req);
  if (ids.length === 0) return { sql: ' AND 1 = 0', params: [] };
  return { sql: ` AND ${columna} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

module.exports = {
  cargarUsuario, requiereLogin, requiereEmpresa, requiere, requiereAdmin, requiereSuper,
  puede, barcosVisibles, verificarBarco, verificarDeposito, filtroBarcos, CLAVES,
};
