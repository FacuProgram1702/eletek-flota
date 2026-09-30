/**
 * Inicio y cierre de sesión, datos del usuario actual y cambio de clave.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { ruta, texto, ErrorUsuario } = require('../util');
const { requiereLogin, requiereSuper } = require('../middleware/auth');
const { auditar } = require('../servicios/auditoria');
const { MODULOS, PLANES } = require('../permisos');
const config = require('../config');

const router = express.Router();

const HASH_FALSO = bcrypt.hashSync('usuario-inexistente', 10);

// Freno a la fuerza bruta: 8 intentos fallidos por usuario cada 15 minutos.
// En memoria alcanza: se reinicia con el proceso, y eso está bien.
const intentos = new Map();
const VENTANA_MS = 15 * 60 * 1000;
function bloqueado(clave) {
  const r = intentos.get(clave);
  if (!r) return false;
  if (Date.now() - r.desde > VENTANA_MS) { intentos.delete(clave); return false; }
  return r.n >= 8;
}
function fallo(clave) {
  const r = intentos.get(clave);
  if (!r || Date.now() - r.desde > VENTANA_MS) intentos.set(clave, { n: 1, desde: Date.now() });
  else r.n++;
}

router.post('/login', ruta(async (req, res) => {
  const usuario = texto(req.body.usuario, { requerido: true, campo: 'El usuario', max: 80 }).toLowerCase();
  const clave = texto(req.body.clave, { requerido: true, campo: 'La contraseña', max: 200 });

  if (bloqueado(usuario)) {
    throw new ErrorUsuario('Demasiados intentos fallidos. Esperá 15 minutos y probá de nuevo.', 429);
  }

  const u = db.uno('SELECT * FROM usuarios WHERE lower(usuario) = ? AND activo = 1', usuario);
  // Se compara contra un hash aunque el usuario no exista, para que el tiempo
  // de respuesta no delate qué usuarios existen.
  const hash = u ? u.clave_hash : HASH_FALSO;
  const ok = await bcrypt.compare(clave, hash);
  if (!u || !ok) {
    fallo(usuario);
    throw new ErrorUsuario('Usuario o contraseña incorrectos', 401);
  }

  if (!u.es_superadmin) {
    const empresa = db.uno('SELECT * FROM empresas WHERE id = ?', u.empresa_id);
    if (!empresa || !empresa.activa) throw new ErrorUsuario('La empresa no está activa. Consultá con ELETEK.', 403);

    // La tripulación solo entra si la empresa habilitó el acceso a bordo
    const roles = db.todos(
      'SELECT r.a_bordo FROM roles r JOIN usuario_roles ur ON ur.rol_id = r.id WHERE ur.usuario_id = ?', u.id
    );
    const soloABordo = !u.es_admin && roles.length > 0 && roles.every((r) => r.a_bordo);
    const opciones = JSON.parse(empresa.opciones || '{}');
    if (soloABordo && !opciones.acceso_abordo) {
      throw new ErrorUsuario('El acceso a bordo no está habilitado en tu empresa. Consultá con el administrador.', 403);
    }
  }

  intentos.delete(usuario);
  // Sesión nueva al loguearse: evita reutilizar un identificador anterior
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'No se pudo iniciar la sesión' });
    req.session.usuarioId = u.id;
    req.usuario = { id: u.id, empresa_id: u.empresa_id };
    auditar(req, 'login', 'usuario', u.id);
    res.json({ ok: true });
  });
}));

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('eletek.sid');
    res.json({ ok: true });
  });
});

/** Todo lo que el panel necesita para armarse: usuario, permisos, menú. */
router.get('/yo', (req, res) => {
  if (!req.usuario) return res.json({ autenticado: false });
  const u = req.usuario;
  res.json({
    autenticado: true,
    usuario: {
      id: u.id, nombre: u.nombre, usuario: u.usuario,
      es_superadmin: u.es_superadmin, es_admin: u.es_admin,
      roles: u.roles, solo_a_bordo: u.solo_a_bordo,
    },
    empresa: u.empresa,
    opciones: u.opciones,
    permisos: u.permisos,
    modulos: u.modulos,
    barcos: u.empresa_id
      ? db.todos(
        `SELECT id, nombre, matricula FROM barcos WHERE empresa_id = ? AND activo = 1 ORDER BY nombre`, u.empresa_id
      ).filter((b) => u.barcos === null || u.barcos.includes(b.id))
      : [],
    catalogo: { modulos: MODULOS, planes: PLANES },
    conectividad_url: config.conectividadUrl,
  });
});

router.post('/cambiar-clave', requiereLogin, ruta(async (req, res) => {
  const actual = texto(req.body.actual, { requerido: true, campo: 'La contraseña actual', max: 200 });
  const nueva = texto(req.body.nueva, { requerido: true, campo: 'La contraseña nueva', max: 200 });
  if (nueva.length < 8) throw new ErrorUsuario('La contraseña nueva debe tener al menos 8 caracteres');
  const u = db.uno('SELECT clave_hash FROM usuarios WHERE id = ?', req.usuario.id);
  if (!(await bcrypt.compare(actual, u.clave_hash))) throw new ErrorUsuario('La contraseña actual no es correcta');
  db.ejecutar('UPDATE usuarios SET clave_hash = ? WHERE id = ?', await bcrypt.hash(nueva, 10), req.usuario.id);
  auditar(req, 'cambiar_clave', 'usuario', req.usuario.id);
  res.json({ ok: true });
}));

/** El superadmin elige en qué empresa trabajar. */
router.post('/empresa-activa', requiereSuper, ruta((req, res) => {
  const id = Number(req.body.empresa_id);
  if (!id) { req.session.empresaActiva = null; return res.json({ ok: true }); }
  const e = db.uno('SELECT id FROM empresas WHERE id = ?', id);
  if (!e) throw new ErrorUsuario('Empresa no encontrada', 404);
  req.session.empresaActiva = id;
  res.json({ ok: true });
}));

module.exports = router;
