/**
 * Proveedores y talleres de la empresa.
 */

const express = require('express');
const db = require('../db/database');
const { ruta, texto, idParam, ErrorUsuario, opcion } = require('../util');
const { requiere } = require('../middleware/auth');
const { auditar } = require('../servicios/auditoria');

const router = express.Router();

router.get('/', requiere('proveedores', 'ver'), ruta((req, res) => {
  let sql = 'SELECT * FROM proveedores WHERE empresa_id = ?';
  const params = [req.usuario.empresa_id];
  if (req.query.tipo === 'taller') sql += ` AND tipo IN ('taller','ambos')`;
  if (req.query.tipo === 'proveedor') sql += ` AND tipo IN ('proveedor','ambos')`;
  if (req.query.inactivos !== '1') sql += ' AND activo = 1';
  res.json(db.todos(sql + ' ORDER BY nombre', ...params));
}));

function leer(req) {
  return {
    nombre: texto(req.body.nombre, { requerido: true, campo: 'El nombre', max: 150 }),
    tipo: opcion(req.body.tipo, ['proveedor', 'taller', 'ambos'], { campo: 'El tipo', defecto: 'proveedor' }),
    cuit: texto(req.body.cuit, { max: 20 }),
    contacto: texto(req.body.contacto, { max: 120 }),
    telefono: texto(req.body.telefono, { max: 60 }),
    email: texto(req.body.email, { max: 120 }),
    notas: texto(req.body.notas, { max: 2000 }),
  };
}

router.post('/', requiere('proveedores', 'administrar'), ruta((req, res) => {
  const p = leer(req);
  const id = db.ejecutar(
    `INSERT INTO proveedores (empresa_id, nombre, tipo, cuit, contacto, telefono, email, notas) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    req.usuario.empresa_id, p.nombre, p.tipo, p.cuit, p.contacto, p.telefono, p.email, p.notas
  ).id;
  auditar(req, 'crear', 'proveedor', id, p.nombre);
  res.status(201).json({ id });
}));

router.put('/:id', requiere('proveedores', 'administrar'), ruta((req, res) => {
  const id = idParam(req.params.id);
  const actual = db.uno('SELECT * FROM proveedores WHERE id = ? AND empresa_id = ?', id, req.usuario.empresa_id);
  if (!actual) throw new ErrorUsuario('Proveedor no encontrado', 404);
  const p = leer(req);
  db.ejecutar(
    `UPDATE proveedores SET nombre = ?, tipo = ?, cuit = ?, contacto = ?, telefono = ?, email = ?, notas = ?, activo = ? WHERE id = ?`,
    p.nombre, p.tipo, p.cuit, p.contacto, p.telefono, p.email, p.notas,
    req.body.activo === undefined ? actual.activo : !!req.body.activo, id
  );
  auditar(req, 'editar', 'proveedor', id, p.nombre);
  res.json({ ok: true });
}));

module.exports = router;
