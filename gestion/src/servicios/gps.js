/**
 * Posición actual de un barco, tomada del panel de conectividad (API MIKRO).
 *
 * Se abre esa base en SOLO LECTURA: este sistema nunca escribe en ella. Si
 * no está configurada (CONECTIVIDAD_DB en el .env) o la última posición es
 * vieja, devuelve null y el parte usa el GPS del teléfono o la carga manual.
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const config = require('../config');

const VIGENCIA_MS = 15 * 60 * 1000; // una posición de hace más de 15 min no sirve para un lance

let conexion = null;

function abrir() {
  if (conexion) return conexion;
  if (!config.conectividadDbPath || !fs.existsSync(config.conectividadDbPath)) return null;
  try {
    conexion = new DatabaseSync(config.conectividadDbPath, { readOnly: true });
    conexion.exec('PRAGMA busy_timeout = 2000;');
  } catch (e) {
    console.error('[gps] no se pudo abrir la base de conectividad:', e.message);
    conexion = null;
  }
  return conexion;
}

/** Última posición de un barco por su slug de conectividad, o null. */
function posicionActual(slug) {
  if (!slug) return null;
  const c = abrir();
  if (!c) return null;
  try {
    const r = c.prepare(
      `SELECT p.lat, p.lon, p.reported_at, p.source, p.speed_kn, p.course_deg
       FROM vessel_positions p JOIN vessels v ON v.id = p.vessel_id
       WHERE v.slug = ? ORDER BY p.id DESC LIMIT 1`
    ).get(slug);
    if (!r) return null;
    // El panel guarda 'YYYY-MM-DD HH:MM:SS' en UTC
    const cuando = new Date(String(r.reported_at).replace(' ', 'T') + 'Z');
    const vieja = Date.now() - cuando.getTime() > VIGENCIA_MS;
    return {
      lat: r.lat, lon: r.lon, fecha: cuando.toISOString(), fuente: r.source,
      velocidad_kn: r.speed_kn, rumbo: r.course_deg, vigente: !vieja,
    };
  } catch (e) {
    // La base de conectividad puede estar ocupada un instante: no es grave
    return null;
  }
}

/** Fecha JS → formato del panel ('YYYY-MM-DD HH:MM:SS', UTC). */
function formatoPanel(d) {
  return new Date(d).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Todas las posiciones de un barco entre dos fechas, para el seguimiento.
 * Devuelve null si la base de conectividad no está disponible (distinto de
 * "no hay puntos", que es una lista vacía).
 */
function posiciones(slug, desde, hasta) {
  if (!slug) return [];
  const c = abrir();
  if (!c) return null;
  return c.prepare(
    `SELECT p.lat, p.lon, p.speed_kn, p.course_deg, p.heading_deg, p.reported_at
     FROM vessel_positions p JOIN vessels v ON v.id = p.vessel_id
     WHERE v.slug = ? AND p.reported_at >= ? AND p.reported_at <= ?
     ORDER BY p.reported_at`
  ).all(slug, formatoPanel(desde), formatoPanel(hasta)).map((r) => Object.assign({}, r));
}

module.exports = { posicionActual, posiciones };
