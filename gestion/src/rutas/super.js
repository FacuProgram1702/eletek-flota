/**
 * Rutas del superadministrador de ELETEK: alta de empresas y su primer
 * administrador. Todo lo demás lo maneja cada empresa.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { ruta, texto, opcion, idParam, ErrorUsuario } = require('../util');
const { requiereSuper } = require('../middleware/auth');
const { auditar } = require('../servicios/auditoria');
const { crearEmpresa } = require('../servicios/empresa');
const { PLANES } = require('../permisos');

const router = express.Router();
router.use(requiereSuper);

router.get('/empresas', ruta((req, res) => {
  res.json(db.todos(
    `SELECT e.id, e.nombre, e.plan, e.activa, e.creado,
       (SELECT COUNT(*) FROM barcos b WHERE b.empresa_id = e.id AND b.activo = 1) AS barcos,
       (SELECT COUNT(*) FROM usuarios u WHERE u.empresa_id = e.id AND u.activo = 1) AS usuarios
     FROM empresas e ORDER BY e.nombre`
  ));
}));

router.post('/empresas', ruta(async (req, res) => {
  const nombre = texto(req.body.nombre, { requerido: true, campo: 'El nombre de la empresa', max: 120 });
  const plan = opcion(req.body.plan, Object.keys(PLANES), { campo: 'El plan', defecto: 'gestion' });
  const adminUsuario = texto(req.body.admin_usuario, { requerido: true, campo: 'El usuario administrador', max: 60 }).toLowerCase();
  const adminNombre = texto(req.body.admin_nombre, { requerido: true, campo: 'El nombre del administrador', max: 120 });
  const adminClave = texto(req.body.admin_clave, { requerido: true, campo: 'La contraseña del administrador', max: 200 });
  if (adminClave.length < 8) throw new ErrorUsuario('La contraseña debe tener al menos 8 caracteres');
  if (!/^[a-z0-9._-]{3,60}$/.test(adminUsuario)) throw new ErrorUsuario('Usuario inválido');
  if (db.uno('SELECT id FROM usuarios WHERE lower(usuario) = ?', adminUsuario)) {
    throw new ErrorUsuario(`Ya existe el usuario "${adminUsuario}"`, 409);
  }
  const hash = await bcrypt.hash(adminClave, 10);
  const id = db.transaccion(() => {
    const empresaId = crearEmpresa({ nombre, plan });
    db.ejecutar(
      `INSERT INTO usuarios (empresa_id, nombre, usuario, clave_hash, es_admin, toda_la_flota, creado)
       VALUES (?, ?, ?, ?, 1, 1, ?)`, empresaId, adminNombre, adminUsuario, hash, new Date().toISOString()
    );
    return empresaId;
  });
  auditar(req, 'crear', 'empresa', id, nombre);
  res.status(201).json({ id });
}));

router.put('/empresas/:id', ruta((req, res) => {
  const id = idParam(req.params.id);
  const e = db.uno('SELECT * FROM empresas WHERE id = ?', id);
  if (!e) throw new ErrorUsuario('Empresa no encontrada', 404);
  db.ejecutar('UPDATE empresas SET nombre = ?, plan = ?, activa = ? WHERE id = ?',
    texto(req.body.nombre, { requerido: true, campo: 'El nombre', max: 120 }),
    opcion(req.body.plan, Object.keys(PLANES), { campo: 'El plan', defecto: e.plan }),
    req.body.activa === undefined ? e.activa : !!req.body.activa, id);
  auditar(req, 'editar', 'empresa', id);
  res.json({ ok: true });
}));

module.exports = router;
