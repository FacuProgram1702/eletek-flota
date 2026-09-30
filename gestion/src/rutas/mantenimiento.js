/**
 * Mantenimiento: equipos por barco, tareas, planes modelo, horómetro,
 * vencimientos y registros.
 */

const express = require('express');
const db = require('../db/database');
const { ruta, texto, numero, entero, idParam, ErrorUsuario, fecha, json } = require('../util');
const { requiere, verificarBarco, barcosVisibles, filtroBarcos } = require('../middleware/auth');
const { auditar } = require('../servicios/auditoria');
const mant = require('../servicios/mantenimiento');

const router = express.Router();

function equipoDe(req, id) {
  const e = db.uno('SELECT * FROM equipos WHERE id = ? AND empresa_id = ?', id, req.usuario.empresa_id);
  if (!e) throw new ErrorUsuario('Equipo no encontrado', 404);
  verificarBarco(req, e.barco_id);
  return e;
}

function modeloDe(req, id) {
  const m = db.uno('SELECT * FROM planes_modelo WHERE id = ? AND empresa_id = ?', id, req.usuario.empresa_id);
  if (!m) throw new ErrorUsuario('Plan modelo no encontrado', 404);
  return m;
}

/** Materiales de una tarea: solo artículos de la empresa, cantidades > 0. */
function leerMateriales(req, lista) {
  if (!Array.isArray(lista)) return [];
  return lista.filter((m) => m && m.articulo_id && Number(m.cantidad) > 0).map((m) => {
    const a = db.uno('SELECT id FROM articulos WHERE id = ? AND empresa_id = ?', Number(m.articulo_id), req.usuario.empresa_id);
    if (!a) throw new ErrorUsuario('Artículo inválido en los materiales');
    return { articulo_id: a.id, cantidad: Number(m.cantidad) };
  });
}

// ── Equipos ──────────────────────────────────────────────────────────

router.get('/equipos', requiere('mantenimiento', 'ver'), ruta((req, res) => {
  const f = filtroBarcos(req, 'e.barco_id');
  let sql = `SELECT e.*, b.nombre AS barco, p.nombre AS plan_modelo FROM equipos e
     JOIN barcos b ON b.id = e.barco_id LEFT JOIN planes_modelo p ON p.id = e.plan_modelo_id
     WHERE e.empresa_id = ? AND e.activo = 1${f.sql}`;
  const params = [req.usuario.empresa_id, ...f.params];
  if (req.query.barco_id) { sql += ' AND e.barco_id = ?'; params.push(Number(req.query.barco_id)); }
  sql += ' ORDER BY b.nombre, e.codigo, e.nombre';
  const equipos = db.todos(sql, ...params);
  const op = req.usuario.opciones;
  for (const e of equipos) {
    const estados = mant.tareasDeEquipo(e).map((t) => mant.estadoTarea(e, t, { margenDias: op.margen_dias, margenHoras: op.margen_horas }));
    e.tareas = estados.length;
    e.vencidas = estados.filter((s) => s.estado === 'vencida').length;
    e.proximas = estados.filter((s) => s.estado === 'proxima').length;
  }
  res.json(equipos);
}));

function leerEquipo(req) {
  return {
    nombre: texto(req.body.nombre, { requerido: true, campo: 'El nombre del equipo', max: 120 }),
    codigo: texto(req.body.codigo, { max: 30 }),
    marca: texto(req.body.marca, { max: 80 }),
    modelo: texto(req.body.modelo, { max: 80 }),
    serie: texto(req.body.serie, { max: 80 }),
    ubicacion: texto(req.body.ubicacion, { max: 120 }),
    usa_horometro: !!req.body.usa_horometro,
    padre_id: req.body.padre_id ? Number(req.body.padre_id) : null,
  };
}

router.post('/equipos', requiere('mantenimiento', 'planificar'), ruta((req, res) => {
  const barco = verificarBarco(req, idParam(req.body.barco_id, 'Barco'));
  const e = leerEquipo(req);
  if (e.padre_id) {
    const padre = equipoDe(req, e.padre_id);
    if (padre.barco_id !== barco.id) throw new ErrorUsuario('El equipo padre es de otro barco');
  }
  const id = db.ejecutar(
    `INSERT INTO equipos (empresa_id, barco_id, padre_id, codigo, nombre, marca, modelo, serie, ubicacion, usa_horometro)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    req.usuario.empresa_id, barco.id, e.padre_id, e.codigo, e.nombre, e.marca, e.modelo, e.serie, e.ubicacion, e.usa_horometro
  ).id;
  const h = numero(req.body.horas_actuales, { min: 0, campo: 'Las horas' });
  if (h !== null && e.usa_horometro) {
    mant.leerHorometro({ equipo: equipoDe(req, id), horas: h, nota: 'Lectura inicial', usuario_id: req.usuario.id });
  }
  auditar(req, 'crear', 'equipo', id, e.nombre);
  res.status(201).json({ id });
}));

router.put('/equipos/:id', requiere('mantenimiento', 'planificar'), ruta((req, res) => {
  const actual = equipoDe(req, idParam(req.params.id));
  const e = leerEquipo(req);
  if (e.padre_id) {
    if (e.padre_id === actual.id) throw new ErrorUsuario('Un equipo no puede ser su propio padre');
    const padre = equipoDe(req, e.padre_id);
    if (padre.barco_id !== actual.barco_id) throw new ErrorUsuario('El equipo padre es de otro barco');
    // Evita ciclos: el padre no puede ser un descendiente
    let p = padre;
    while (p && p.padre_id) {
      if (p.padre_id === actual.id) throw new ErrorUsuario('El padre elegido está dentro de este equipo');
      p = db.uno('SELECT * FROM equipos WHERE id = ?', p.padre_id);
    }
  }
  db.ejecutar(
    `UPDATE equipos SET padre_id = ?, codigo = ?, nombre = ?, marca = ?, modelo = ?, serie = ?, ubicacion = ?,
       usa_horometro = ?, activo = ? WHERE id = ?`,
    e.padre_id, e.codigo, e.nombre, e.marca, e.modelo, e.serie, e.ubicacion, e.usa_horometro,
    req.body.activo === undefined ? actual.activo : !!req.body.activo, actual.id
  );
  auditar(req, 'editar', 'equipo', actual.id, e.nombre);
  res.json({ ok: true });
}));

router.get('/equipos/:id', requiere('mantenimiento', 'ver'), ruta((req, res) => {
  const e = equipoDe(req, idParam(req.params.id));
  const op = req.usuario.opciones;
  e.barco = db.uno('SELECT nombre FROM barcos WHERE id = ?', e.barco_id).nombre;
  e.plan_modelo = e.plan_modelo_id ? db.uno('SELECT id, nombre FROM planes_modelo WHERE id = ?', e.plan_modelo_id) : null;
  e.tareas = mant.tareasDeEquipo(e).map((t) => ({
    ...t, ...mant.estadoTarea(e, t, { margenDias: op.margen_dias, margenHoras: op.margen_horas }),
  }));
  e.historial = db.todos(
    `SELECT r.*, t.nombre AS tarea, u.nombre AS usuario FROM registros_mantenimiento r
     LEFT JOIN tareas t ON t.id = r.tarea_id LEFT JOIN usuarios u ON u.id = r.usuario_id
     WHERE r.equipo_id = ? ORDER BY r.fecha DESC LIMIT 200`, e.id
  );
  e.lecturas = db.todos(
    `SELECT l.*, u.nombre AS usuario FROM lecturas_horometro l LEFT JOIN usuarios u ON u.id = l.usuario_id
     WHERE l.equipo_id = ? ORDER BY l.fecha DESC LIMIT 50`, e.id
  );
  e.hijos = db.todos('SELECT id, nombre, codigo FROM equipos WHERE padre_id = ? AND activo = 1 ORDER BY codigo, nombre', e.id);
  res.json(e);
}));

router.post('/equipos/:id/horometro', requiere('mantenimiento', 'cargar'), ruta((req, res) => {
  const e = equipoDe(req, idParam(req.params.id));
  try {
    mant.leerHorometro({
      equipo: e, horas: numero(req.body.horas, { requerido: true, min: 0, campo: 'La lectura' }),
      nota: texto(req.body.nota, { max: 300 }), usuario_id: req.usuario.id, confirmar: req.body.confirmar === true,
    });
  } catch (err) {
    if (err.requiereConfirmacion) return res.status(409).json({ error: err.message, requiere_confirmacion: true });
    throw err;
  }
  auditar(req, 'horometro', 'equipo', e.id, String(req.body.horas));
  res.json({ ok: true });
}));

// ── Tareas del plan ──────────────────────────────────────────────────

function leerTarea(req) {
  const t = {
    nombre: texto(req.body.nombre, { requerido: true, campo: 'El nombre de la tarea', max: 150 }),
    descripcion: texto(req.body.descripcion, { max: 2000 }),
    cada_horas: numero(req.body.cada_horas, { min: 1, campo: 'Cada cuántas horas' }),
    cada_dias: entero(req.body.cada_dias, { min: 1, campo: 'Cada cuántos días' }),
    cada_mareas: entero(req.body.cada_mareas, { min: 1, campo: 'Cada cuántas mareas' }),
    materiales: leerMateriales(req, req.body.materiales),
  };
  if (!t.cada_horas && !t.cada_dias && !t.cada_mareas) {
    throw new ErrorUsuario('Indicá cada cuántas horas, días o mareas se hace la tarea');
  }
  return t;
}

router.post('/tareas', requiere('mantenimiento', 'planificar'), ruta((req, res) => {
  const t = leerTarea(req);
  let equipoId = null;
  let modeloId = null;
  if (req.body.equipo_id) equipoId = equipoDe(req, Number(req.body.equipo_id)).id;
  else if (req.body.plan_modelo_id) modeloId = modeloDe(req, Number(req.body.plan_modelo_id)).id;
  else throw new ErrorUsuario('La tarea tiene que ser de un equipo o de un plan modelo');
  const id = db.ejecutar(
    `INSERT INTO tareas (empresa_id, equipo_id, plan_modelo_id, nombre, descripcion, cada_horas, cada_dias, cada_mareas, materiales)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    req.usuario.empresa_id, equipoId, modeloId, t.nombre, t.descripcion, t.cada_horas, t.cada_dias, t.cada_mareas, JSON.stringify(t.materiales)
  ).id;
  auditar(req, 'crear', 'tarea', id, t.nombre);
  res.status(201).json({ id });
}));

function tareaDe(req, id) {
  const t = db.uno('SELECT * FROM tareas WHERE id = ? AND empresa_id = ?', id, req.usuario.empresa_id);
  if (!t) throw new ErrorUsuario('Tarea no encontrada', 404);
  if (t.equipo_id) equipoDe(req, t.equipo_id);
  return t;
}

router.put('/tareas/:id', requiere('mantenimiento', 'planificar'), ruta((req, res) => {
  const actual = tareaDe(req, idParam(req.params.id));
  const t = leerTarea(req);
  db.ejecutar(
    'UPDATE tareas SET nombre = ?, descripcion = ?, cada_horas = ?, cada_dias = ?, cada_mareas = ?, materiales = ? WHERE id = ?',
    t.nombre, t.descripcion, t.cada_horas, t.cada_dias, t.cada_mareas, JSON.stringify(t.materiales), actual.id
  );
  auditar(req, 'editar', 'tarea', actual.id, t.nombre);
  res.json({ ok: true });
}));

router.delete('/tareas/:id', requiere('mantenimiento', 'planificar'), ruta((req, res) => {
  const t = tareaDe(req, idParam(req.params.id));
  // Se desactiva, no se borra: el historial sigue apuntando a ella
  db.ejecutar('UPDATE tareas SET activa = 0 WHERE id = ?', t.id);
  auditar(req, 'borrar', 'tarea', t.id, t.nombre);
  res.json({ ok: true });
}));

/**
 * Punto de partida de una tarea que nunca se registró: cuándo se hizo por
 * última vez (fecha y horas), sin generar un registro de mantenimiento.
 */
router.post('/tareas/:id/punto-de-partida', requiere('mantenimiento', 'planificar'), ruta((req, res) => {
  const t = tareaDe(req, idParam(req.params.id));
  const e = equipoDe(req, idParam(req.body.equipo_id, 'Equipo'));
  if (!mant.tareasDeEquipo(e).some((x) => x.id === t.id)) throw new ErrorUsuario('La tarea no es de ese equipo');
  const f = fecha(req.body.fecha, { requerido: true, campo: 'La fecha' });
  const h = numero(req.body.horas, { min: 0, campo: 'Las horas' });
  db.ejecutar(
    `INSERT INTO tareas_estado (equipo_id, tarea_id, ultima_fecha, ultimas_horas, ultima_marea) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(equipo_id, tarea_id) DO UPDATE SET ultima_fecha = excluded.ultima_fecha,
       ultimas_horas = excluded.ultimas_horas, ultima_marea = excluded.ultima_marea`,
    e.id, t.id, f, h, mant.mareasCerradas(e.barco_id)
  );
  auditar(req, 'punto_partida', 'tarea', t.id, `${e.nombre}: ${f} ${h ?? ''}h`);
  res.json({ ok: true });
}));

// ── Planes modelo (igualar) y copias ─────────────────────────────────

router.get('/planes', requiere('mantenimiento', 'ver'), ruta((req, res) => {
  const planes = db.todos('SELECT * FROM planes_modelo WHERE empresa_id = ? ORDER BY nombre', req.usuario.empresa_id);
  const f = filtroBarcos(req, 'e.barco_id');
  for (const p of planes) {
    p.tareas = db.todos('SELECT * FROM tareas WHERE plan_modelo_id = ? AND activa = 1 ORDER BY nombre', p.id)
      .map((t) => ({ ...t, materiales: json(t.materiales, []) }));
    p.equipos = db.todos(
      `SELECT e.id, e.nombre, b.nombre AS barco FROM equipos e JOIN barcos b ON b.id = e.barco_id
       WHERE e.plan_modelo_id = ? AND e.activo = 1${f.sql} ORDER BY b.nombre`, p.id, ...f.params
    );
  }
  res.json(planes);
}));

router.post('/planes', requiere('mantenimiento', 'planificar'), ruta((req, res) => {
  const nombre = texto(req.body.nombre, { requerido: true, campo: 'El nombre del plan', max: 120 });
  let id;
  if (req.body.desde_equipo_id) {
    const e = equipoDe(req, Number(req.body.desde_equipo_id));
    if (e.plan_modelo_id) throw new ErrorUsuario('Ese equipo ya está igualado a un plan');
    id = mant.crearModeloDesdeEquipo(req.usuario.empresa_id, e, nombre);
  } else {
    id = db.ejecutar('INSERT INTO planes_modelo (empresa_id, nombre, descripcion) VALUES (?, ?, ?)',
      req.usuario.empresa_id, nombre, texto(req.body.descripcion, { max: 500 })).id;
  }
  auditar(req, 'crear', 'plan_modelo', id, nombre);
  res.status(201).json({ id });
}));

router.put('/planes/:id', requiere('mantenimiento', 'planificar'), ruta((req, res) => {
  const p = modeloDe(req, idParam(req.params.id));
  db.ejecutar('UPDATE planes_modelo SET nombre = ?, descripcion = ? WHERE id = ?',
    texto(req.body.nombre, { requerido: true, campo: 'El nombre', max: 120 }), texto(req.body.descripcion, { max: 500 }), p.id);
  res.json({ ok: true });
}));

/** Iguala equipos a un plan modelo: desde ahí comparten sus tareas. */
router.post('/planes/:id/igualar', requiere('mantenimiento', 'planificar'), ruta((req, res) => {
  const p = modeloDe(req, idParam(req.params.id));
  const ids = Array.isArray(req.body.equipos) ? req.body.equipos.map(Number) : [];
  if (!ids.length) throw new ErrorUsuario('Elegí al menos un equipo');
  db.transaccion(() => {
    for (const id of ids) {
      const e = equipoDe(req, id);
      if (e.plan_modelo_id && e.plan_modelo_id !== p.id) {
        throw new ErrorUsuario(`"${e.nombre}" ya está igualado a otro plan. Desvinculalo primero.`);
      }
      mant.igualar(e, p.id);
    }
  });
  auditar(req, 'igualar', 'plan_modelo', p.id, ids.join(','));
  res.json({ ok: true });
}));

router.post('/equipos/:id/desvincular', requiere('mantenimiento', 'planificar'), ruta((req, res) => {
  const e = equipoDe(req, idParam(req.params.id));
  mant.desvincular(req.usuario.empresa_id, e, req.body.conservar_tareas !== false);
  auditar(req, 'desvincular', 'equipo', e.id);
  res.json({ ok: true });
}));

/** Copia las tareas propias de un equipo a otros equipos. */
router.post('/copiar-tareas', requiere('mantenimiento', 'planificar'), ruta((req, res) => {
  const origen = equipoDe(req, idParam(req.body.origen_id, 'Equipo de origen'));
  const destinos = (Array.isArray(req.body.destinos) ? req.body.destinos : []).map((d) => equipoDe(req, Number(d)).id)
    .filter((d) => d !== origen.id);
  if (!destinos.length) throw new ErrorUsuario('Elegí al menos un equipo de destino');
  const n = mant.copiarTareas(req.usuario.empresa_id, origen.id, destinos);
  auditar(req, 'copiar_tareas', 'equipo', origen.id, destinos.join(','));
  res.json({ copiadas: n });
}));

/** Copia todos los equipos y planes de un barco a otro barco parecido. */
router.post('/copiar-barco', requiere('mantenimiento', 'planificar'), ruta((req, res) => {
  const origen = verificarBarco(req, idParam(req.body.origen_barco_id, 'Barco de origen'));
  const destino = verificarBarco(req, idParam(req.body.destino_barco_id, 'Barco de destino'));
  if (origen.id === destino.id) throw new ErrorUsuario('Elegí dos barcos distintos');
  const n = mant.copiarBarco(req.usuario.empresa_id, origen.id, destino.id);
  auditar(req, 'copiar_barco', 'barco', destino.id, `desde ${origen.nombre}: ${n} equipos`);
  res.json({ equipos: n });
}));

// ── Vencimientos y registros ─────────────────────────────────────────

router.get('/vencimientos', requiere('mantenimiento', 'ver'), ruta((req, res) => {
  let barcos = barcosVisibles(req);
  if (req.query.barco_id) barcos = barcos.filter((b) => b === Number(req.query.barco_id));
  let lista = mant.vencimientos(req.usuario.empresa_id, barcos, req.usuario.opciones);
  if (req.query.estado) lista = lista.filter((v) => req.query.estado.split(',').includes(v.estado));
  res.json(lista);
}));

router.get('/registros', requiere('mantenimiento', 'ver'), ruta((req, res) => {
  const f = filtroBarcos(req, 'r.barco_id');
  let sql = `SELECT r.*, e.nombre AS equipo, b.nombre AS barco, t.nombre AS tarea, u.nombre AS usuario
     FROM registros_mantenimiento r JOIN equipos e ON e.id = r.equipo_id JOIN barcos b ON b.id = r.barco_id
     LEFT JOIN tareas t ON t.id = r.tarea_id LEFT JOIN usuarios u ON u.id = r.usuario_id
     WHERE r.empresa_id = ?${f.sql}`;
  const params = [req.usuario.empresa_id, ...f.params];
  if (req.query.barco_id) { sql += ' AND r.barco_id = ?'; params.push(Number(req.query.barco_id)); }
  if (req.query.equipo_id) { sql += ' AND r.equipo_id = ?'; params.push(Number(req.query.equipo_id)); }
  if (req.query.tipo) { sql += ' AND r.tipo = ?'; params.push(String(req.query.tipo)); }
  sql += ' ORDER BY r.fecha DESC LIMIT ?';
  params.push(Math.min(Number(req.query.limite) || 200, 1000));
  res.json(db.todos(sql, ...params));
}));

router.post('/registros', requiere('mantenimiento', 'cargar'), ruta((req, res) => {
  const e = equipoDe(req, idParam(req.body.equipo_id, 'Equipo'));
  const r = mant.registrar({
    empresa_id: req.usuario.empresa_id, usuario_id: req.usuario.id, equipo: e,
    tarea_id: req.body.tarea_id ? Number(req.body.tarea_id) : null,
    tipo: req.body.tipo, fecha: fecha(req.body.fecha), horas: numero(req.body.horas, { min: 0, campo: 'Las horas' }),
    descripcion: texto(req.body.descripcion, { max: 2000 }), causa: texto(req.body.causa, { max: 1000 }),
    materiales: leerMateriales(req, req.body.materiales),
  });
  auditar(req, 'registrar', 'mantenimiento', r.id, `${req.body.tipo} ${e.nombre}${r.anticipado ? ' (anticipado)' : ''}`);
  res.status(201).json(r);
}));

module.exports = router;
