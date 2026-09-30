/**
 * Endpoints de lectura del historial de consumo por barco.
 * Los datos se acumulan en cada /api/v1/sync/:slug (ver src/routes/mikrotik.js),
 * un registro por usuario/día en usage_daily.
 */

const express = require('express');
const db = require('../db/database');
const { requireAuth, requireVesselAccess } = require('../middleware/auth');

const router = express.Router();

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const GRANULARITIES = {
  day:   { defaultCount: 30, maxCount: 90 },
  week:  { defaultCount: 12, maxCount: 52 },
  month: { defaultCount: 12, maxCount: 24 },
  year:  { defaultCount: 5,  maxCount: 10 },
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toDayStr(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Genera `count` buckets [start,end] terminando en el bucket que contiene
 * "hoy" (UTC, mismo criterio que usa src/routes/mikrotik.js para escribir
 * `day` en usage_daily vía toISOString()).
 */
function buildBuckets(granularity, count) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const buckets = [];

  if (granularity === 'day') {
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const key = toDayStr(d);
      buckets.push({ key, start: key, end: key, label: `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}` });
    }
  } else if (granularity === 'week') {
    const dow = today.getUTCDay(); // 0=domingo..6=sábado
    const diffToMonday = (dow + 6) % 7;
    const currentMonday = new Date(today);
    currentMonday.setUTCDate(currentMonday.getUTCDate() - diffToMonday);

    for (let i = count - 1; i >= 0; i--) {
      const start = new Date(currentMonday);
      start.setUTCDate(start.getUTCDate() - i * 7);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 6);
      const key = toDayStr(start);
      buckets.push({
        key,
        start: key,
        end: toDayStr(end),
        label: `${start.getUTCDate()} ${MONTH_NAMES[start.getUTCMonth()]} – ${end.getUTCDate()} ${MONTH_NAMES[end.getUTCMonth()]}`,
      });
    }
  } else if (granularity === 'month') {
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
      const endD = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
      const key = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
      buckets.push({
        key,
        start: toDayStr(d),
        end: toDayStr(endD),
        label: `${MONTH_NAMES[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`,
      });
    }
  } else if (granularity === 'year') {
    for (let i = count - 1; i >= 0; i--) {
      const y = today.getUTCFullYear() - i;
      buckets.push({ key: String(y), start: `${y}-01-01`, end: `${y}-12-31`, label: String(y) });
    }
  }

  return buckets;
}

function getVesselBySlug(slug) {
  return db.prepare('SELECT id FROM vessels WHERE slug = ?').get(slug);
}

/**
 * GET /api/vessels/:slug/usage/trend?granularity=day|week|month|year&count=N
 * Consumo total del barco (todos los usuarios sumados), agrupado en buckets
 * de la granularidad elegida. Siempre devuelve `count` buckets consecutivos
 * terminando en el que contiene "hoy", con 0 en los que no tuvieron consumo.
 */
router.get('/vessels/:slug/usage/trend', requireAuth, requireVesselAccess, (req, res) => {
  const vessel = getVesselBySlug(req.params.slug);
  if (!vessel) {
    return res.status(404).json({ error: 'Barco no encontrado' });
  }

  const granularity = GRANULARITIES[req.query.granularity] ? req.query.granularity : 'month';
  const { defaultCount, maxCount } = GRANULARITIES[granularity];
  const count = Math.min(maxCount, Math.max(1, parseInt(req.query.count) || defaultCount));

  const buckets = buildBuckets(granularity, count);

  const rows = db.prepare(`
    SELECT day, SUM(bytes) as bytes
    FROM usage_daily
    WHERE vessel_id = ? AND day >= ? AND day <= ?
    GROUP BY day
    ORDER BY day ASC
  `).all(vessel.id, buckets[0].start, buckets[buckets.length - 1].end);

  const values = buckets.map((b) => {
    let sum = 0;
    for (const r of rows) {
      if (r.day >= b.start && r.day <= b.end) sum += r.bytes;
    }
    return sum;
  });

  return res.json({ granularity, buckets, values });
});

/**
 * GET /api/vessels/:slug/usage/by-user?start=YYYY-MM-DD&end=YYYY-MM-DD
 * Consumo de cada usuario en un rango de fechas dado (default: hoy).
 * El frontend pasa el `start`/`end` de un bucket devuelto por /usage/trend.
 */
router.get('/vessels/:slug/usage/by-user', requireAuth, requireVesselAccess, (req, res) => {
  const vessel = getVesselBySlug(req.params.slug);
  if (!vessel) {
    return res.status(404).json({ error: 'Barco no encontrado' });
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const today = new Date().toISOString().slice(0, 10);
  const start = dateRe.test(req.query.start) ? req.query.start : today;
  const end = dateRe.test(req.query.end) ? req.query.end : today;

  // LEFT JOIN contra usage_counters (todo usuario que alguna vez sincronizó)
  // para que los usuarios sin consumo en el rango aparezcan igual, con 0
  // bytes, en vez de desaparecer del listado.
  const users = db.prepare(`
    SELECT uc.username as name, COALESCE(m.bytes, 0) as bytes
    FROM usage_counters uc
    LEFT JOIN (
      SELECT username, SUM(bytes) as bytes
      FROM usage_daily
      WHERE vessel_id = ? AND day >= ? AND day <= ?
      GROUP BY username
    ) m ON m.username = uc.username
    WHERE uc.vessel_id = ?
    ORDER BY bytes DESC
  `).all(vessel.id, start, end, vessel.id);

  return res.json({ start, end, users });
});

module.exports = router;
