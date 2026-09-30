/**
 * Tablero de inicio y "Mis tareas" (vista a bordo).
 * Cada bloque aparece solo si el usuario tiene permiso sobre ese módulo.
 */

const express = require('express');
const db = require('../db/database');
const { ruta } = require('../util');
const { requiereEmpresa, puede, barcosVisibles, filtroBarcos } = require('../middleware/auth');
const mant = require('../servicios/mantenimiento');

const router = express.Router();
const DIA_MS = 86400000;

router.get('/', requiereEmpresa, ruta((req, res) => {
  const e = req.usuario.empresa_id;
  const out = {};
  const barcos = barcosVisibles(req);

  if (puede(req, 'mantenimiento', 'ver')) {
    const v = mant.vencimientos(e, barcos, req.usuario.opciones);
    out.mantenimiento = {
      vencidas: v.filter((x) => x.estado === 'vencida').length,
      proximas: v.filter((x) => x.estado === 'proxima').length,
      sin_registro: v.filter((x) => x.estado === 'sin_registro').length,
      lista: v.filter((x) => x.estado === 'vencida' || x.estado === 'proxima').slice(0, 10),
    };
  }
  if (puede(req, 'trabajos', 'ver')) {
    const f = filtroBarcos(req, 'barco_id');
    const filas = db.todos(`SELECT estado, COUNT(*) AS n FROM trabajos WHERE empresa_id = ?${f.sql} GROUP BY estado`, e, ...f.params);
    out.trabajos = Object.fromEntries(filas.map((r) => [r.estado, r.n]));
  }
  if (puede(req, 'compras', 'ver')) {
    const filas = db.todos(`SELECT estado, COUNT(*) AS n FROM compras WHERE empresa_id = ? GROUP BY estado`, e);
    out.compras = Object.fromEntries(filas.map((r) => [r.estado, r.n]));
  }
  if (puede(req, 'stock', 'ver')) {
    const mins = db.todos(
      `SELECT sm.articulo_id, sm.deposito_id, sm.minimo, d.barco_id, d.tipo FROM stock_minimos sm
       JOIN depositos d ON d.id = sm.deposito_id WHERE d.empresa_id = ?`, e
    ).filter((m) => m.tipo === 'tierra' || barcos.includes(m.barco_id));
    const stock = require('../servicios/stock');
    out.stock = { bajo_minimo: mins.filter((m) => stock.existencia(m.articulo_id, m.deposito_id) < m.minimo).length };
  }
  if (puede(req, 'pesca', 'ver')) {
    const f = filtroBarcos(req, 'm.barco_id');
    out.pesca = {
      abiertas: db.todos(
        `SELECT m.id, m.numero, m.fecha_zarpada, b.nombre AS barco,
           (SELECT COUNT(*) FROM lances l WHERE l.marea_id = m.id) AS lances
         FROM mareas m JOIN barcos b ON b.id = m.barco_id WHERE m.empresa_id = ? AND m.estado = 'abierta'${f.sql}`,
        e, ...f.params
      ),
    };
  }
  res.json(out);
}));

/** Lo que tiene que hacer hoy la gente a bordo, para su(s) barco(s). */
router.get('/mis-tareas', requiereEmpresa, ruta((req, res) => {
  const e = req.usuario.empresa_id;
  const barcos = barcosVisibles(req);
  const out = { mantenimiento: [], trabajos: [], horometros: [], marea: null };

  if (puede(req, 'mantenimiento', 'ver')) {
    out.mantenimiento = mant.vencimientos(e, barcos, req.usuario.opciones)
      .filter((v) => ['vencida', 'proxima', 'sin_registro'].includes(v.estado));
    if (barcos.length) {
      // Horómetros sin leer en la última semana
      const hace7 = new Date(Date.now() - 7 * DIA_MS).toISOString();
      out.horometros = db.todos(
        `SELECT e.id, e.nombre, e.horas_actuales, e.horas_fecha, b.nombre AS barco FROM equipos e JOIN barcos b ON b.id = e.barco_id
         WHERE e.empresa_id = ? AND e.activo = 1 AND e.usa_horometro = 1 AND e.barco_id IN (${barcos.map(() => '?').join(',')})
           AND (e.horas_fecha IS NULL OR e.horas_fecha < ?) ORDER BY b.nombre, e.nombre`, e, ...barcos, hace7
      );
    }
  }
  if (puede(req, 'trabajos', 'ver')) {
    const f = filtroBarcos(req, 't.barco_id');
    out.trabajos = db.todos(
      `SELECT t.id, t.numero, t.titulo, t.estado, t.prioridad, b.nombre AS barco FROM trabajos t JOIN barcos b ON b.id = t.barco_id
       WHERE t.empresa_id = ? AND t.estado IN ('pendiente','aprobado','en_curso')${f.sql}
       ORDER BY CASE t.prioridad WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 ELSE 2 END, t.numero`, e, ...f.params
    );
  }
  if (puede(req, 'pesca', 'ver') && barcos.length) {
    out.marea = db.uno(
      `SELECT m.id, m.numero, b.nombre AS barco FROM mareas m JOIN barcos b ON b.id = m.barco_id
       WHERE m.empresa_id = ? AND m.estado = 'abierta' AND m.barco_id IN (${barcos.map(() => '?').join(',')})
       ORDER BY m.fecha_zarpada DESC LIMIT 1`, e, ...barcos
    ) || null;
  }
  res.json(out);
}));

module.exports = router;
