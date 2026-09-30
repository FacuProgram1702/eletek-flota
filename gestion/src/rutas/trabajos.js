/**
 * Pedidos de trabajo: nacen a bordo, los aprueba el área técnica, se hacen
 * con personal propio o en un taller, consumen stock y quedan en el
 * historial del barco (y del equipo, si corresponde).
 *
 * Estados: pendiente → aprobado → en_curso → realizado → cerrado
 *                    ↘ rechazado
 */

const express = require('express');
const db = require('../db/database');
const { ruta, texto, numero, idParam, ErrorUsuario, opcion, fecha, ahora, siguienteNumero } = require('../util');
const { requiere, puede, verificarBarco, filtroBarcos } = require('../middleware/auth');
const { auditar } = require('../servicios/auditoria');
const stock = require('../servicios/stock');
const mant = require('../servicios/mantenimiento');

const router = express.Router();

function trabajoDe(req, id) {
  const t = db.uno('SELECT * FROM trabajos WHERE id = ? AND empresa_id = ?', id, req.usuario.empresa_id);
  if (!t) throw new ErrorUsuario('Pedido de trabajo no encontrado', 404);
  verificarBarco(req, t.barco_id);
  return t;
}

function exigirEstado(t, estados, accion) {
  if (!estados.includes(t.estado)) {
    throw new ErrorUsuario(`No se puede ${accion} un pedido en estado "${t.estado.replace('_', ' ')}"`, 409);
  }
}

router.get('/', requiere('trabajos', 'ver'), ruta((req, res) => {
  const f = filtroBarcos(req, 't.barco_id');
  let sql = `SELECT t.*, b.nombre AS barco, e.nombre AS equipo, p.nombre AS proveedor,
       us.nombre AS solicitante, ua.nombre AS aprobador
     FROM trabajos t JOIN barcos b ON b.id = t.barco_id LEFT JOIN equipos e ON e.id = t.equipo_id
     LEFT JOIN proveedores p ON p.id = t.proveedor_id LEFT JOIN usuarios us ON us.id = t.solicitado_por
     LEFT JOIN usuarios ua ON ua.id = t.aprobado_por
     WHERE t.empresa_id = ?${f.sql}`;
  const params = [req.usuario.empresa_id, ...f.params];
  if (req.query.estado) {
    const est = String(req.query.estado).split(',');
    sql += ` AND t.estado IN (${est.map(() => '?').join(',')})`;
    params.push(...est);
  }
  if (req.query.barco_id) { sql += ' AND t.barco_id = ?'; params.push(Number(req.query.barco_id)); }
  if (req.query.equipo_id) { sql += ' AND t.equipo_id = ?'; params.push(Number(req.query.equipo_id)); }
  sql += ` ORDER BY CASE t.estado WHEN 'pendiente' THEN 0 WHEN 'aprobado' THEN 1 WHEN 'en_curso' THEN 2 WHEN 'realizado' THEN 3 ELSE 4 END,
           CASE t.prioridad WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.numero DESC LIMIT 500`;
  res.json(db.todos(sql, ...params));
}));

router.get('/:id', requiere('trabajos', 'ver'), ruta((req, res) => {
  const t = trabajoDe(req, idParam(req.params.id));
  t.barco = db.uno('SELECT nombre FROM barcos WHERE id = ?', t.barco_id).nombre;
  t.equipo = t.equipo_id ? db.uno('SELECT id, nombre FROM equipos WHERE id = ?', t.equipo_id) : null;
  t.tarea = t.tarea_id ? db.uno('SELECT id, nombre FROM tareas WHERE id = ?', t.tarea_id) : null;
  t.proveedor = t.proveedor_id ? db.uno('SELECT id, nombre FROM proveedores WHERE id = ?', t.proveedor_id) : null;
  for (const [campo, col] of [['solicitante', 'solicitado_por'], ['aprobador', 'aprobado_por'], ['realizador', 'realizado_por']]) {
    t[campo] = t[col] ? db.uno('SELECT nombre FROM usuarios WHERE id = ?', t[col]).nombre : null;
  }
  const registros = db.todos('SELECT id FROM registros_mantenimiento WHERE trabajo_id = ?', t.id).map((r) => r.id);
  t.materiales = db.todos(
    `SELECT m.fecha, m.cantidad, m.costo_unitario, a.codigo, a.descripcion, a.unidad
     FROM movimientos m JOIN articulos a ON a.id = m.articulo_id
     WHERE (m.ref_tipo = 'trabajo' AND m.ref_id = ?)
        OR (m.ref_tipo = 'mantenimiento' AND m.ref_id IN (${registros.length ? registros.map(() => '?').join(',') : 'NULL'}))
     ORDER BY m.fecha`, t.id, ...registros
  );
  t.costo_materiales = Math.round(t.materiales.reduce((s, m) => s + (m.costo_unitario || 0) * m.cantidad, 0) * 100) / 100;
  t.compras = db.todos('SELECT id, numero, estado FROM compras WHERE trabajo_id = ? ORDER BY numero', t.id);
  t.historial = db.todos(
    `SELECT a.fecha, a.accion, a.detalle, u.nombre AS usuario FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
     WHERE a.entidad = 'trabajo' AND a.entidad_id = ? AND a.empresa_id = ? ORDER BY a.id`, t.id, req.usuario.empresa_id
  );
  res.json(t);
}));

router.post('/', requiere('trabajos', 'cargar'), ruta((req, res) => {
  const barco = verificarBarco(req, idParam(req.body.barco_id, 'Barco'));
  let equipoId = null;
  let tareaId = null;
  if (req.body.equipo_id) {
    const e = db.uno('SELECT * FROM equipos WHERE id = ? AND barco_id = ? AND empresa_id = ?', Number(req.body.equipo_id), barco.id, req.usuario.empresa_id);
    if (!e) throw new ErrorUsuario('El equipo no es de ese barco');
    equipoId = e.id;
    if (req.body.tarea_id) {
      const t = mant.tareasDeEquipo(e).find((x) => x.id === Number(req.body.tarea_id));
      if (!t) throw new ErrorUsuario('La tarea no es de ese equipo');
      tareaId = t.id;
    }
  }
  const e = req.usuario.empresa_id;
  const id = db.transaccion(() => db.ejecutar(
    `INSERT INTO trabajos (empresa_id, numero, barco_id, equipo_id, tarea_id, titulo, descripcion, tipo, prioridad, solicitado_por, creado)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    e, siguienteNumero('trabajos', e), barco.id, equipoId, tareaId,
    texto(req.body.titulo, { requerido: true, campo: 'El título', max: 150 }),
    texto(req.body.descripcion, { max: 4000 }),
    opcion(req.body.tipo, ['correctivo', 'preventivo', 'mejora'], { campo: 'El tipo', defecto: 'correctivo' }),
    opcion(req.body.prioridad, ['baja', 'normal', 'alta', 'urgente'], { campo: 'La prioridad', defecto: 'normal' }),
    req.usuario.id, ahora()
  ).id);
  auditar(req, 'crear', 'trabajo', id, texto(req.body.titulo, { max: 150 }));
  res.status(201).json({ id });
}));

router.post('/:id/aprobar', requiere('trabajos', 'aprobar'), ruta((req, res) => {
  const t = trabajoDe(req, idParam(req.params.id));
  exigirEstado(t, ['pendiente'], 'aprobar');
  const ejecutor = opcion(req.body.ejecutor, ['propio', 'taller'], { campo: 'Quién lo hace', defecto: 'propio' });
  let proveedorId = null;
  if (ejecutor === 'taller') {
    const p = db.uno(`SELECT id FROM proveedores WHERE id = ? AND empresa_id = ? AND tipo IN ('taller','ambos')`,
      Number(req.body.proveedor_id), req.usuario.empresa_id);
    if (!p) throw new ErrorUsuario('Elegí el taller');
    proveedorId = p.id;
  }
  db.ejecutar(
    `UPDATE trabajos SET estado = 'aprobado', ejecutor = ?, proveedor_id = ?, presupuesto = ?, fecha_comprometida = ?,
       aprobado_por = ?, aprobado = ? WHERE id = ?`,
    ejecutor, proveedorId, numero(req.body.presupuesto, { min: 0, campo: 'El presupuesto' }),
    fecha(req.body.fecha_comprometida), req.usuario.id, ahora(), t.id
  );
  auditar(req, 'aprobar', 'trabajo', t.id, ejecutor === 'taller' ? 'En taller' : 'Personal propio');
  res.json({ ok: true });
}));

router.post('/:id/rechazar', requiere('trabajos', 'aprobar'), ruta((req, res) => {
  const t = trabajoDe(req, idParam(req.params.id));
  exigirEstado(t, ['pendiente', 'aprobado'], 'rechazar');
  const motivo = texto(req.body.motivo, { requerido: true, campo: 'El motivo', max: 1000 });
  db.ejecutar(`UPDATE trabajos SET estado = 'rechazado', motivo_rechazo = ?, aprobado_por = ?, cerrado = ? WHERE id = ?`,
    motivo, req.usuario.id, ahora(), t.id);
  auditar(req, 'rechazar', 'trabajo', t.id, motivo);
  res.json({ ok: true });
}));

router.post('/:id/iniciar', requiere('trabajos', 'cargar'), ruta((req, res) => {
  const t = trabajoDe(req, idParam(req.params.id));
  exigirEstado(t, ['aprobado'], 'iniciar');
  db.ejecutar(`UPDATE trabajos SET estado = 'en_curso' WHERE id = ?`, t.id);
  auditar(req, 'iniciar', 'trabajo', t.id);
  res.json({ ok: true });
}));

/**
 * Trabajo realizado: informe + material usado. El material se descuenta del
 * depósito del barco. Si el trabajo es sobre un equipo, queda además en el
 * historial de mantenimiento del equipo (y reinicia la tarea preventiva).
 */
router.post('/:id/realizar', requiere('trabajos', 'cargar'), ruta((req, res) => {
  const t = trabajoDe(req, idParam(req.params.id));
  exigirEstado(t, ['aprobado', 'en_curso'], 'marcar como realizado');
  const informe = texto(req.body.informe, { requerido: true, campo: 'El informe del trabajo', max: 4000 });
  const materiales = (Array.isArray(req.body.materiales) ? req.body.materiales : [])
    .filter((m) => m && m.articulo_id && Number(m.cantidad) > 0)
    .map((m) => ({ articulo_id: Number(m.articulo_id), cantidad: Number(m.cantidad) }));
  const cuando = fecha(req.body.fecha) || ahora();

  const r = db.transaccion(() => {
    let registro = null;
    if (t.equipo_id) {
      const e = db.uno('SELECT * FROM equipos WHERE id = ?', t.equipo_id);
      registro = mant.registrar({
        empresa_id: req.usuario.empresa_id, usuario_id: req.usuario.id, equipo: e,
        tarea_id: t.tarea_id, tipo: t.tipo === 'preventivo' && t.tarea_id ? 'preventivo' : 'correctivo',
        fecha: cuando, horas: numero(req.body.horas, { min: 0, campo: 'Las horas' }),
        descripcion: `Pedido #${t.numero}: ${t.titulo}. ${informe}`, causa: texto(req.body.causa, { max: 1000 }),
        materiales, trabajo_id: t.id,
      });
    } else if (materiales.length) {
      const dep = stock.depositoDeBarco(t.barco_id);
      stock.consumir({
        empresa_id: req.usuario.empresa_id, usuario_id: req.usuario.id, deposito_id: dep.id, items: materiales,
        ref_tipo: 'trabajo', ref_id: t.id, motivo: `Pedido de trabajo #${t.numero}: ${t.titulo}`,
      });
    }
    db.ejecutar(`UPDATE trabajos SET estado = 'realizado', informe = ?, realizado_por = ?, realizado = ? WHERE id = ?`,
      informe, req.usuario.id, cuando, t.id);
    return registro;
  });
  auditar(req, 'realizar', 'trabajo', t.id, `${materiales.length} material(es)${r && r.anticipado ? ', preventivo anticipado' : ''}`);
  res.json({ ok: true, anticipado: r ? r.anticipado : false });
}));

router.post('/:id/cerrar', requiere('trabajos', 'aprobar'), ruta((req, res) => {
  const t = trabajoDe(req, idParam(req.params.id));
  exigirEstado(t, ['realizado'], 'cerrar');
  db.ejecutar(`UPDATE trabajos SET estado = 'cerrado', cerrado = ? WHERE id = ?`, ahora(), t.id);
  auditar(req, 'cerrar', 'trabajo', t.id, texto(req.body.comentario, { max: 500 }));
  res.json({ ok: true });
}));

/** Pide a Compras lo que falta para el trabajo. Entra al depósito del barco. */
router.post('/:id/solicitar-compra', requiere('trabajos', 'cargar'), ruta((req, res) => {
  const t = trabajoDe(req, idParam(req.params.id));
  exigirEstado(t, ['pendiente', 'aprobado', 'en_curso'], 'pedir compras para');
  if (!puede(req, 'compras', 'cargar')) throw new ErrorUsuario('No tenés permiso para solicitar compras', 403);
  const items = (Array.isArray(req.body.items) ? req.body.items : []).filter((i) => i && i.articulo_id && Number(i.cantidad) > 0);
  if (!items.length) throw new ErrorUsuario('Agregá al menos un artículo');
  const dep = stock.depositoDeBarco(t.barco_id);
  const e = req.usuario.empresa_id;
  const id = db.transaccion(() => {
    const c = db.ejecutar(
      `INSERT INTO compras (empresa_id, numero, deposito_id, trabajo_id, notas, solicitado_por, creado)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, e, siguienteNumero('compras', e), dep.id, t.id,
      `Para el pedido de trabajo #${t.numero}: ${t.titulo}`, req.usuario.id, ahora()
    ).id;
    for (const it of items) {
      if (!db.uno('SELECT id FROM articulos WHERE id = ? AND empresa_id = ?', Number(it.articulo_id), e)) throw new ErrorUsuario('Artículo inválido');
      db.ejecutar('INSERT INTO compra_items (compra_id, articulo_id, cantidad) VALUES (?, ?, ?)', c, Number(it.articulo_id), Number(it.cantidad));
    }
    return c;
  });
  auditar(req, 'solicitar_compra', 'trabajo', t.id, `Compra #${id}`);
  auditar(req, 'crear', 'compra', id, `Desde pedido de trabajo #${t.numero}`);
  res.status(201).json({ id });
}));

module.exports = router;
