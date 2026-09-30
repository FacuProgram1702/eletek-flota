/**
 * Partes de pesca: marea → lances → capturas.
 *
 * El capitán toca "Iniciar lance" y "Terminar lance"; la hora y la posición
 * se completan solas. Posición, por orden de preferencia:
 *   1. GPS del barco (panel de conectividad), si es reciente
 *   2. GPS del teléfono (lo manda el navegador)
 *   3. Carga manual
 */

const express = require('express');
const db = require('../db/database');
const { ruta, texto, numero, entero, idParam, ErrorUsuario, fecha, ahora, opcion } = require('../util');
const { requiere, verificarBarco, filtroBarcos } = require('../middleware/auth');
const { auditar } = require('../servicios/auditoria');
const gps = require('../servicios/gps');

const router = express.Router();

function mareaDe(req, id) {
  const m = db.uno('SELECT * FROM mareas WHERE id = ? AND empresa_id = ?', id, req.usuario.empresa_id);
  if (!m) throw new ErrorUsuario('Marea no encontrada', 404);
  verificarBarco(req, m.barco_id);
  return m;
}

function lanceDe(req, id) {
  const l = db.uno('SELECT * FROM lances WHERE id = ?', id);
  if (!l) throw new ErrorUsuario('Lance no encontrado', 404);
  const m = mareaDe(req, l.marea_id);
  return { lance: l, marea: m };
}

function exigirAbierta(m) {
  if (m.estado !== 'abierta') throw new ErrorUsuario('La marea está cerrada', 409);
}

/**
 * Decide la posición a guardar. `pos` es lo que mandó el navegador:
 * { lat, lon, origen: 'telefono' | 'manual' } o nada.
 */
function resolverPosicion(barco, pos) {
  const deBarco = gps.posicionActual(barco.slug_conectividad);
  if (deBarco && deBarco.vigente && (!pos || pos.origen !== 'manual')) {
    return { lat: deBarco.lat, lon: deBarco.lon, origen: 'gps_barco' };
  }
  if (pos && pos.lat !== undefined && pos.lat !== null && pos.lat !== '') {
    const lat = numero(pos.lat, { min: -90, max: 90, campo: 'La latitud' });
    const lon = numero(pos.lon, { min: -180, max: 180, campo: 'La longitud' });
    return { lat, lon, origen: pos.origen === 'telefono' ? 'telefono' : 'manual' };
  }
  return { lat: null, lon: null, origen: 'manual' };
}

function totalesPorEspecie(mareaId) {
  return db.todos(
    `SELECT c.especie, c.unidad, SUM(c.cantidad) AS cantidad, SUM(c.descarte) AS descarte
     FROM capturas c JOIN lances l ON l.id = c.lance_id WHERE l.marea_id = ?
     GROUP BY c.especie, c.unidad ORDER BY SUM(c.cantidad) DESC`, mareaId
  );
}

router.get('/mareas', requiere('pesca', 'ver'), ruta((req, res) => {
  const f = filtroBarcos(req, 'm.barco_id');
  let sql = `SELECT m.*, b.nombre AS barco, u.nombre AS capitan,
       (SELECT COUNT(*) FROM lances l WHERE l.marea_id = m.id) AS lances,
       (SELECT SUM(c.cantidad) FROM capturas c JOIN lances l ON l.id = c.lance_id WHERE l.marea_id = m.id AND c.unidad = 'kg') AS kg,
       (SELECT SUM(c.cantidad) FROM capturas c JOIN lances l ON l.id = c.lance_id WHERE l.marea_id = m.id AND c.unidad = 'cajones') AS cajones
     FROM mareas m JOIN barcos b ON b.id = m.barco_id LEFT JOIN usuarios u ON u.id = m.capitan_id
     WHERE m.empresa_id = ?${f.sql}`;
  const params = [req.usuario.empresa_id, ...f.params];
  if (req.query.barco_id) { sql += ' AND m.barco_id = ?'; params.push(Number(req.query.barco_id)); }
  if (req.query.estado) { sql += ' AND m.estado = ?'; params.push(String(req.query.estado)); }
  sql += ' ORDER BY m.fecha_zarpada DESC LIMIT 300';
  res.json(db.todos(sql, ...params));
}));

router.get('/mareas/:id', requiere('pesca', 'ver'), ruta((req, res) => {
  const m = mareaDe(req, idParam(req.params.id));
  const b = db.uno('SELECT nombre, matricula FROM barcos WHERE id = ?', m.barco_id);
  m.barco = b.nombre;
  m.matricula = b.matricula;
  m.capitan = m.capitan_id ? db.uno('SELECT nombre FROM usuarios WHERE id = ?', m.capitan_id).nombre : null;
  m.lances = db.todos('SELECT * FROM lances WHERE marea_id = ? ORDER BY numero', m.id);
  for (const l of m.lances) l.capturas = db.todos('SELECT * FROM capturas WHERE lance_id = ? ORDER BY id', l.id);
  m.totales = totalesPorEspecie(m.id);
  const dias = m.fecha_arribo ? (new Date(m.fecha_arribo) - new Date(m.fecha_zarpada)) / 86400000 : (Date.now() - new Date(m.fecha_zarpada)) / 86400000;
  m.dias = Math.max(1, Math.ceil(dias));
  res.json(m);
}));

router.get('/gps/:barcoId', requiere('pesca', 'ver'), ruta((req, res) => {
  const b = verificarBarco(req, idParam(req.params.barcoId));
  res.json(gps.posicionActual(b.slug_conectividad));
}));

router.post('/mareas', requiere('pesca', 'cargar'), ruta((req, res) => {
  const b = verificarBarco(req, idParam(req.body.barco_id, 'Barco'));
  if (db.uno(`SELECT id FROM mareas WHERE barco_id = ? AND estado = 'abierta'`, b.id)) {
    throw new ErrorUsuario(`${b.nombre} ya tiene una marea abierta. Cerrala antes de abrir otra.`, 409);
  }
  const num = (db.uno('SELECT MAX(numero) AS n FROM mareas WHERE barco_id = ?', b.id).n || 0) + 1;
  const id = db.ejecutar(
    `INSERT INTO mareas (empresa_id, barco_id, numero, puerto_zarpada, fecha_zarpada, especie_objetivo, tripulantes, observaciones, capitan_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    req.usuario.empresa_id, b.id, num,
    texto(req.body.puerto_zarpada, { requerido: true, campo: 'El puerto de zarpada', max: 80 }),
    fecha(req.body.fecha_zarpada) || ahora(),
    texto(req.body.especie_objetivo, { max: 120 }),
    entero(req.body.tripulantes, { min: 1, max: 200, campo: 'Los tripulantes' }),
    texto(req.body.observaciones, { max: 2000 }), req.usuario.id
  ).id;
  auditar(req, 'abrir', 'marea', id, `${b.nombre} marea ${num}`);
  res.status(201).json({ id, numero: num });
}));

router.put('/mareas/:id', requiere('pesca', 'cargar'), ruta((req, res) => {
  const m = mareaDe(req, idParam(req.params.id));
  exigirAbierta(m);
  db.ejecutar(
    `UPDATE mareas SET puerto_zarpada = ?, fecha_zarpada = ?, especie_objetivo = ?, tripulantes = ?, observaciones = ? WHERE id = ?`,
    texto(req.body.puerto_zarpada, { requerido: true, campo: 'El puerto de zarpada', max: 80 }),
    fecha(req.body.fecha_zarpada, { requerido: true, campo: 'La fecha de zarpada' }),
    texto(req.body.especie_objetivo, { max: 120 }),
    entero(req.body.tripulantes, { min: 1, max: 200, campo: 'Los tripulantes' }),
    texto(req.body.observaciones, { max: 2000 }), m.id
  );
  auditar(req, 'editar', 'marea', m.id);
  res.json({ ok: true });
}));

router.post('/mareas/:id/cerrar', requiere('pesca', 'cargar'), ruta((req, res) => {
  const m = mareaDe(req, idParam(req.params.id));
  exigirAbierta(m);
  if (db.uno('SELECT id FROM lances WHERE marea_id = ? AND fin IS NULL', m.id)) {
    throw new ErrorUsuario('Hay un lance sin terminar', 409);
  }
  const arribo = fecha(req.body.fecha_arribo) || ahora();
  if (arribo < m.fecha_zarpada) throw new ErrorUsuario('El arribo no puede ser antes de la zarpada');
  db.ejecutar(`UPDATE mareas SET estado = 'cerrada', puerto_arribo = ?, fecha_arribo = ?, observaciones = ? WHERE id = ?`,
    texto(req.body.puerto_arribo, { requerido: true, campo: 'El puerto de arribo', max: 80 }), arribo,
    texto(req.body.observaciones, { max: 2000 }) || m.observaciones, m.id);
  auditar(req, 'cerrar', 'marea', m.id);
  res.json({ ok: true });
}));

// ── Lances ───────────────────────────────────────────────────────────

router.post('/mareas/:id/lances', requiere('pesca', 'cargar'), ruta((req, res) => {
  const m = mareaDe(req, idParam(req.params.id));
  exigirAbierta(m);
  if (db.uno('SELECT id FROM lances WHERE marea_id = ? AND fin IS NULL', m.id)) {
    throw new ErrorUsuario('Hay un lance en curso. Terminalo antes de iniciar otro.', 409);
  }
  const b = db.uno('SELECT * FROM barcos WHERE id = ?', m.barco_id);
  const pos = resolverPosicion(b, req.body.posicion);
  const num = (db.uno('SELECT MAX(numero) AS n FROM lances WHERE marea_id = ?', m.id).n || 0) + 1;
  const inicio = fecha(req.body.inicio) || ahora();
  if (inicio < m.fecha_zarpada) throw new ErrorUsuario('El lance no puede empezar antes de la zarpada');
  const id = db.ejecutar(
    `INSERT INTO lances (marea_id, numero, inicio, lat_inicio, lon_inicio, origen_pos_inicio, profundidad, arte, observaciones)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    m.id, num, inicio, pos.lat, pos.lon, pos.origen,
    numero(req.body.profundidad, { min: 0, max: 12000, campo: 'La profundidad' }),
    texto(req.body.arte, { max: 80 }), texto(req.body.observaciones, { max: 1000 })
  ).id;
  auditar(req, 'iniciar_lance', 'marea', m.id, `Lance ${num}`);
  res.status(201).json({ id, numero: num, posicion: pos });
}));

router.post('/lances/:id/terminar', requiere('pesca', 'cargar'), ruta((req, res) => {
  const { lance, marea } = lanceDe(req, idParam(req.params.id));
  exigirAbierta(marea);
  if (lance.fin) throw new ErrorUsuario('El lance ya está terminado', 409);
  const b = db.uno('SELECT * FROM barcos WHERE id = ?', marea.barco_id);
  const pos = resolverPosicion(b, req.body.posicion);
  const fin = fecha(req.body.fin) || ahora();
  if (fin < lance.inicio) throw new ErrorUsuario('El fin del lance no puede ser antes del inicio');
  db.ejecutar('UPDATE lances SET fin = ?, lat_fin = ?, lon_fin = ?, origen_pos_fin = ? WHERE id = ?',
    fin, pos.lat, pos.lon, pos.origen, lance.id);
  auditar(req, 'terminar_lance', 'marea', marea.id, `Lance ${lance.numero}`);
  res.json({ ok: true, posicion: pos });
}));

/** Corrección manual de un lance (horas, posiciones, profundidad, arte). */
router.put('/lances/:id', requiere('pesca', 'cargar'), ruta((req, res) => {
  const { lance, marea } = lanceDe(req, idParam(req.params.id));
  exigirAbierta(marea);
  const b = req.body;
  const inicio = fecha(b.inicio, { requerido: true, campo: 'El inicio' });
  const fin = fecha(b.fin);
  if (fin && fin < inicio) throw new ErrorUsuario('El fin del lance no puede ser antes del inicio');
  const p = (v, campo, lim) => numero(v, { min: -lim, max: lim, campo });
  const latI = p(b.lat_inicio, 'La latitud de inicio', 90);
  const lonI = p(b.lon_inicio, 'La longitud de inicio', 180);
  const latF = p(b.lat_fin, 'La latitud de fin', 90);
  const lonF = p(b.lon_fin, 'La longitud de fin', 180);
  db.ejecutar(
    `UPDATE lances SET inicio = ?, fin = ?, lat_inicio = ?, lon_inicio = ?, lat_fin = ?, lon_fin = ?,
       origen_pos_inicio = CASE WHEN lat_inicio IS ? AND lon_inicio IS ? THEN origen_pos_inicio ELSE 'manual' END,
       origen_pos_fin = CASE WHEN lat_fin IS ? AND lon_fin IS ? THEN origen_pos_fin ELSE 'manual' END,
       profundidad = ?, arte = ?, observaciones = ? WHERE id = ?`,
    inicio, fin, latI, lonI, latF, lonF, latI, lonI, latF, lonF,
    numero(b.profundidad, { min: 0, max: 12000, campo: 'La profundidad' }),
    texto(b.arte, { max: 80 }), texto(b.observaciones, { max: 1000 }), lance.id
  );
  auditar(req, 'editar_lance', 'marea', marea.id, `Lance ${lance.numero}`);
  res.json({ ok: true });
}));

router.post('/lances/:id/capturas', requiere('pesca', 'cargar'), ruta((req, res) => {
  const { lance, marea } = lanceDe(req, idParam(req.params.id));
  exigirAbierta(marea);
  const id = db.ejecutar('INSERT INTO capturas (lance_id, especie, cantidad, unidad, descarte) VALUES (?, ?, ?, ?, ?)',
    lance.id, texto(req.body.especie, { requerido: true, campo: 'La especie', max: 120 }),
    numero(req.body.cantidad, { requerido: true, min: 0, campo: 'La cantidad' }),
    opcion(req.body.unidad, ['kg', 'cajones'], { campo: 'La unidad', defecto: 'kg' }),
    numero(req.body.descarte, { min: 0, campo: 'El descarte' }) || 0
  ).id;
  auditar(req, 'captura', 'marea', marea.id, `Lance ${lance.numero}`);
  res.status(201).json({ id });
}));

router.delete('/capturas/:id', requiere('pesca', 'cargar'), ruta((req, res) => {
  const c = db.uno('SELECT * FROM capturas WHERE id = ?', idParam(req.params.id));
  if (!c) throw new ErrorUsuario('Captura no encontrada', 404);
  const { marea } = lanceDe(req, c.lance_id);
  exigirAbierta(marea);
  db.ejecutar('DELETE FROM capturas WHERE id = ?', c.id);
  auditar(req, 'borrar_captura', 'marea', marea.id, `${c.especie} ${c.cantidad} ${c.unidad}`);
  res.json({ ok: true });
}));

module.exports = router;
