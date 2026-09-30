/**
 * Administración de la empresa: usuarios, roles, barcos, opciones y listas.
 * Solo el administrador de la empresa (o ELETEK entrando como soporte).
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { ruta, texto, numero, idParam, json, ErrorUsuario, opcion } = require('../util');
const { requiereAdmin, requiereEmpresa } = require('../middleware/auth');
const { auditar } = require('../servicios/auditoria');
const { limpiarPermisos, OPCIONES_DEFECTO } = require('../permisos');
const { crearBarco, opcionesDe } = require('../servicios/empresa');

const router = express.Router();

// ── Usuarios ─────────────────────────────────────────────────────────

router.get('/usuarios', requiereAdmin, ruta((req, res) => {
  const e = req.usuario.empresa_id;
  const usuarios = db.todos(
    `SELECT id, nombre, usuario, es_admin, toda_la_flota, activo, creado FROM usuarios
     WHERE empresa_id = ? ORDER BY activo DESC, nombre`, e
  );
  for (const u of usuarios) {
    u.roles = db.todos('SELECT rol_id FROM usuario_roles WHERE usuario_id = ?', u.id).map((r) => r.rol_id);
    u.barcos = db.todos('SELECT barco_id FROM usuario_barcos WHERE usuario_id = ?', u.id).map((r) => r.barco_id);
  }
  res.json(usuarios);
}));

function leerUsuario(req, parcial = false) {
  const e = req.usuario.empresa_id;
  const b = req.body;
  const datos = {
    nombre: texto(b.nombre, { requerido: !parcial, campo: 'El nombre', max: 120 }),
    es_admin: !!b.es_admin,
    toda_la_flota: b.toda_la_flota === undefined ? true : !!b.toda_la_flota,
    roles: Array.isArray(b.roles) ? b.roles.map(Number) : [],
    barcos: Array.isArray(b.barcos) ? b.barcos.map(Number) : [],
  };
  // Solo roles y barcos de esta empresa
  for (const r of datos.roles) {
    if (!db.uno('SELECT id FROM roles WHERE id = ? AND empresa_id = ?', r, e)) throw new ErrorUsuario('Rol inválido');
  }
  for (const bc of datos.barcos) {
    if (!db.uno('SELECT id FROM barcos WHERE id = ? AND empresa_id = ?', bc, e)) throw new ErrorUsuario('Barco inválido');
  }
  if (!datos.toda_la_flota && datos.barcos.length === 0 && !datos.es_admin) {
    throw new ErrorUsuario('Elegí al menos un barco, o marcá "toda la flota"');
  }
  return datos;
}

function guardarRelaciones(usuarioId, datos) {
  db.ejecutar('DELETE FROM usuario_roles WHERE usuario_id = ?', usuarioId);
  for (const r of datos.roles) db.ejecutar('INSERT INTO usuario_roles (usuario_id, rol_id) VALUES (?, ?)', usuarioId, r);
  db.ejecutar('DELETE FROM usuario_barcos WHERE usuario_id = ?', usuarioId);
  if (!datos.toda_la_flota) {
    for (const bc of datos.barcos) db.ejecutar('INSERT INTO usuario_barcos (usuario_id, barco_id) VALUES (?, ?)', usuarioId, bc);
  }
}

router.post('/usuarios', requiereAdmin, ruta(async (req, res) => {
  const datos = leerUsuario(req);
  const usuario = texto(req.body.usuario, { requerido: true, campo: 'El usuario', max: 60 }).toLowerCase();
  if (!/^[a-z0-9._-]{3,60}$/.test(usuario)) {
    throw new ErrorUsuario('El usuario solo puede tener letras, números, punto, guion y guion bajo (mínimo 3)');
  }
  const clave = texto(req.body.clave, { requerido: true, campo: 'La contraseña', max: 200 });
  if (clave.length < 8) throw new ErrorUsuario('La contraseña debe tener al menos 8 caracteres');
  if (db.uno('SELECT id FROM usuarios WHERE lower(usuario) = ?', usuario)) {
    throw new ErrorUsuario(`Ya existe el usuario "${usuario}"`, 409);
  }
  const hash = await bcrypt.hash(clave, 10);
  const id = db.transaccion(() => {
    const nuevo = db.ejecutar(
      `INSERT INTO usuarios (empresa_id, nombre, usuario, clave_hash, es_admin, toda_la_flota, creado)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      req.usuario.empresa_id, datos.nombre, usuario, hash, datos.es_admin, datos.toda_la_flota, new Date().toISOString()
    ).id;
    guardarRelaciones(nuevo, datos);
    return nuevo;
  });
  auditar(req, 'crear', 'usuario', id, usuario);
  res.status(201).json({ id });
}));

router.put('/usuarios/:id', requiereAdmin, ruta(async (req, res) => {
  const id = idParam(req.params.id);
  const u = db.uno('SELECT * FROM usuarios WHERE id = ? AND empresa_id = ?', id, req.usuario.empresa_id);
  if (!u) throw new ErrorUsuario('Usuario no encontrado', 404);
  const datos = leerUsuario(req);
  const activo = req.body.activo === undefined ? !!u.activo : !!req.body.activo;
  if (id === req.usuario.id && (!datos.es_admin || !activo)) {
    throw new ErrorUsuario('No podés quitarte a vos mismo el rol de administrador ni desactivarte');
  }
  let hash = null;
  if (req.body.clave) {
    const clave = texto(req.body.clave, { max: 200 });
    if (clave.length < 8) throw new ErrorUsuario('La contraseña debe tener al menos 8 caracteres');
    hash = await bcrypt.hash(clave, 10);
  }
  db.transaccion(() => {
    db.ejecutar(
      'UPDATE usuarios SET nombre = ?, es_admin = ?, toda_la_flota = ?, activo = ? WHERE id = ?',
      datos.nombre, datos.es_admin, datos.toda_la_flota, activo, id
    );
    if (hash) db.ejecutar('UPDATE usuarios SET clave_hash = ? WHERE id = ?', hash, id);
    guardarRelaciones(id, datos);
    // Un usuario desactivado pierde sus sesiones abiertas en el acto
    // (cargarUsuario ya lo rechaza por inactivo; esto además limpia la tabla)
    if (!activo) {
      db.ejecutar(`DELETE FROM sesiones WHERE datos LIKE ? OR datos LIKE ?`,
        `%"usuarioId":${id},%`, `%"usuarioId":${id}}%`);
    }
  });
  auditar(req, 'editar', 'usuario', id, hash ? 'con cambio de contraseña' : '');
  res.json({ ok: true });
}));

// ── Roles ────────────────────────────────────────────────────────────

router.get('/roles', requiereEmpresa, ruta((req, res) => {
  const roles = db.todos(
    `SELECT r.*, (SELECT COUNT(*) FROM usuario_roles ur WHERE ur.rol_id = r.id) AS usuarios
     FROM roles r WHERE empresa_id = ? ORDER BY nombre`, req.usuario.empresa_id
  );
  roles.forEach((r) => { r.permisos = json(r.permisos, {}); });
  res.json(roles);
}));

function leerRol(req) {
  return {
    nombre: texto(req.body.nombre, { requerido: true, campo: 'El nombre del rol', max: 60 }),
    descripcion: texto(req.body.descripcion, { max: 300 }),
    permisos: limpiarPermisos(req.body.permisos),
    a_bordo: !!req.body.a_bordo,
  };
}

router.post('/roles', requiereAdmin, ruta((req, res) => {
  const r = leerRol(req);
  if (db.uno('SELECT id FROM roles WHERE empresa_id = ? AND nombre = ?', req.usuario.empresa_id, r.nombre)) {
    throw new ErrorUsuario('Ya existe un rol con ese nombre', 409);
  }
  const id = db.ejecutar(
    'INSERT INTO roles (empresa_id, nombre, descripcion, permisos, a_bordo) VALUES (?, ?, ?, ?, ?)',
    req.usuario.empresa_id, r.nombre, r.descripcion, JSON.stringify(r.permisos), r.a_bordo
  ).id;
  auditar(req, 'crear', 'rol', id, r.nombre);
  res.status(201).json({ id });
}));

router.put('/roles/:id', requiereAdmin, ruta((req, res) => {
  const id = idParam(req.params.id);
  if (!db.uno('SELECT id FROM roles WHERE id = ? AND empresa_id = ?', id, req.usuario.empresa_id)) {
    throw new ErrorUsuario('Rol no encontrado', 404);
  }
  const r = leerRol(req);
  const otro = db.uno('SELECT id FROM roles WHERE empresa_id = ? AND nombre = ? AND id <> ?', req.usuario.empresa_id, r.nombre, id);
  if (otro) throw new ErrorUsuario('Ya existe un rol con ese nombre', 409);
  db.ejecutar('UPDATE roles SET nombre = ?, descripcion = ?, permisos = ?, a_bordo = ? WHERE id = ?',
    r.nombre, r.descripcion, JSON.stringify(r.permisos), r.a_bordo, id);
  auditar(req, 'editar', 'rol', id, JSON.stringify(r.permisos));
  res.json({ ok: true });
}));

router.delete('/roles/:id', requiereAdmin, ruta((req, res) => {
  const id = idParam(req.params.id);
  const r = db.uno(
    `SELECT r.id, (SELECT COUNT(*) FROM usuario_roles ur WHERE ur.rol_id = r.id) AS n
     FROM roles r WHERE r.id = ? AND r.empresa_id = ?`, id, req.usuario.empresa_id
  );
  if (!r) throw new ErrorUsuario('Rol no encontrado', 404);
  if (r.n > 0) throw new ErrorUsuario(`El rol lo tienen ${r.n} usuario(s). Quitáselo antes de borrarlo.`, 409);
  db.ejecutar('DELETE FROM roles WHERE id = ?', id);
  auditar(req, 'borrar', 'rol', id);
  res.json({ ok: true });
}));

// ── Barcos ───────────────────────────────────────────────────────────

router.get('/barcos', requiereAdmin, ruta((req, res) => {
  res.json(db.todos('SELECT * FROM barcos WHERE empresa_id = ? ORDER BY activo DESC, nombre', req.usuario.empresa_id));
}));

router.post('/barcos', requiereAdmin, ruta((req, res) => {
  const nombre = texto(req.body.nombre, { requerido: true, campo: 'El nombre del barco', max: 80 });
  const id = crearBarco(req.usuario.empresa_id, {
    nombre,
    matricula: texto(req.body.matricula, { max: 40 }),
    slug_conectividad: texto(req.body.slug_conectividad, { max: 60 }),
  });
  auditar(req, 'crear', 'barco', id, nombre);
  res.status(201).json({ id });
}));

router.put('/barcos/:id', requiereAdmin, ruta((req, res) => {
  const id = idParam(req.params.id);
  const b = db.uno('SELECT * FROM barcos WHERE id = ? AND empresa_id = ?', id, req.usuario.empresa_id);
  if (!b) throw new ErrorUsuario('Barco no encontrado', 404);
  const nombre = texto(req.body.nombre, { requerido: true, campo: 'El nombre del barco', max: 80 });
  db.transaccion(() => {
    db.ejecutar('UPDATE barcos SET nombre = ?, matricula = ?, slug_conectividad = ?, activo = ? WHERE id = ?',
      nombre, texto(req.body.matricula, { max: 40 }), texto(req.body.slug_conectividad, { max: 60 }),
      req.body.activo === undefined ? b.activo : !!req.body.activo, id);
    db.ejecutar(`UPDATE depositos SET nombre = ? WHERE barco_id = ? AND tipo = 'barco'`, `A bordo — ${nombre}`, id);
  });
  auditar(req, 'editar', 'barco', id, nombre);
  res.json({ ok: true });
}));

// ── Opciones de la empresa ───────────────────────────────────────────

router.get('/opciones', requiereAdmin, ruta((req, res) => {
  res.json(opcionesDe(req.usuario.empresa_id));
}));

router.put('/opciones', requiereAdmin, ruta((req, res) => {
  const e = req.usuario.empresa_id;
  const b = req.body;
  const actual = opcionesDe(e);
  const nuevas = {
    ...actual,
    acceso_abordo: b.acceso_abordo === undefined ? actual.acceso_abordo : !!b.acceso_abordo,
    aprobacion_monto: b.aprobacion_monto === undefined ? actual.aprobacion_monto : !!b.aprobacion_monto,
    monto_umbral: b.monto_umbral === undefined ? actual.monto_umbral : numero(b.monto_umbral, { min: 0, campo: 'El monto' }) || 0,
    rol_segunda_aprobacion: b.rol_segunda_aprobacion === undefined ? actual.rol_segunda_aprobacion
      : (b.rol_segunda_aprobacion ? Number(b.rol_segunda_aprobacion) : null),
    margen_dias: b.margen_dias === undefined ? actual.margen_dias : numero(b.margen_dias, { min: 0, max: 365, campo: 'El margen en días' }),
    margen_horas: b.margen_horas === undefined ? actual.margen_horas : numero(b.margen_horas, { min: 0, max: 5000, campo: 'El margen en horas' }),
  };
  if (nuevas.aprobacion_monto) {
    if (!nuevas.rol_segunda_aprobacion) throw new ErrorUsuario('Elegí qué rol da la segunda aprobación');
    if (!db.uno('SELECT id FROM roles WHERE id = ? AND empresa_id = ?', nuevas.rol_segunda_aprobacion, e)) {
      throw new ErrorUsuario('Rol inválido');
    }
  }
  const limpias = {};
  for (const k of Object.keys(OPCIONES_DEFECTO)) limpias[k] = nuevas[k];
  db.ejecutar('UPDATE empresas SET opciones = ? WHERE id = ?', JSON.stringify(limpias), e);
  auditar(req, 'editar', 'opciones', e, JSON.stringify(limpias));
  res.json(limpias);
}));

// ── Listas (categorías, unidades, especies, artes, puertos) ──────────

const LISTAS = ['categoria', 'unidad', 'especie', 'arte', 'puerto'];

router.get('/listas', requiereEmpresa, ruta((req, res) => {
  const filas = db.todos('SELECT id, lista, valor FROM listas WHERE empresa_id = ? ORDER BY lista, valor', req.usuario.empresa_id);
  const out = {};
  for (const l of LISTAS) out[l] = [];
  for (const f of filas) (out[f.lista] = out[f.lista] || []).push({ id: f.id, valor: f.valor });
  res.json(out);
}));

router.post('/listas', requiereAdmin, ruta((req, res) => {
  const lista = opcion(req.body.lista, LISTAS, { campo: 'La lista' });
  const valor = texto(req.body.valor, { requerido: true, campo: 'El valor', max: 80 });
  db.ejecutar(`INSERT INTO listas (empresa_id, lista, valor) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
    req.usuario.empresa_id, lista, valor);
  res.status(201).json({ ok: true });
}));

router.delete('/listas/:id', requiereAdmin, ruta((req, res) => {
  db.ejecutar('DELETE FROM listas WHERE id = ? AND empresa_id = ?', idParam(req.params.id), req.usuario.empresa_id);
  res.json({ ok: true });
}));

// ── Auditoría ────────────────────────────────────────────────────────

router.get('/auditoria', requiereAdmin, ruta((req, res) => {
  const limite = Math.min(Number(req.query.limite) || 200, 1000);
  res.json(db.todos(
    `SELECT a.fecha, a.accion, a.entidad, a.entidad_id, a.detalle, u.nombre AS usuario
     FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
     WHERE a.empresa_id = ? ORDER BY a.id DESC LIMIT ?`, req.usuario.empresa_id, limite
  ));
}));

module.exports = router;
