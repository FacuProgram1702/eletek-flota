/**
 * Capa de base de datos: SQLite nativo de Node (`node:sqlite`).
 *
 * Misma idea que en el panel de conectividad: escribe directo al archivo, sin
 * copias en memoria (sql.js se corrompía; ver CLAUDE.md de API MIKRO).
 *
 * El SQL se escribe de forma portable (sin trucos propios de SQLite) para que
 * el pase a PostgreSQL, cuando se mude al VPS, sea cambiar esta capa y no las
 * rutas.
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const config = require('../config');

let conexion = null;
const cache = new Map();
let profundidad = 0;

/** node:sqlite rechaza undefined y booleanos: se convierten como SQL espera. */
function normalizar(params) {
  return params.map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number' && !Number.isFinite(v)) return null;
    return v;
  });
}

function fila(r) {
  return r === undefined ? undefined : Object.assign({}, r);
}

function sentencia(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = conexion.prepare(sql);
    if (cache.size > 800) cache.clear();
    cache.set(sql, s);
  }
  return s;
}

const db = {
  /** Una fila o undefined */
  uno(sql, ...params) {
    return fila(sentencia(sql).get(...normalizar(params)));
  },

  /** Todas las filas */
  todos(sql, ...params) {
    return sentencia(sql).all(...normalizar(params)).map(fila);
  },

  /** INSERT/UPDATE/DELETE → { cambios, id } */
  ejecutar(sql, ...params) {
    const r = sentencia(sql).run(...normalizar(params));
    return { cambios: Number(r.changes), id: Number(r.lastInsertRowid) };
  },

  /** SQL directo, varias sentencias (esquema). */
  exec(sql) {
    conexion.exec(sql);
    cache.clear();
  },

  /**
   * Transacción: o se graba todo o nada. Clave para el stock: un consumo de
   * cinco artículos no puede quedar grabado a medias.
   */
  transaccion(fn) {
    if (profundidad > 0) {
      profundidad++;
      try { return fn(); } finally { profundidad--; }
    }
    profundidad = 1;
    conexion.exec('BEGIN');
    try {
      const r = fn();
      conexion.exec('COMMIT');
      return r;
    } catch (err) {
      try { conexion.exec('ROLLBACK'); } catch (e) { /* ya cerrada */ }
      throw err;
    } finally {
      profundidad = 0;
    }
  },

  verificar() {
    sentencia('SELECT 1 AS ok').get();
  },

  cerrar() {
    if (!conexion) return;
    try { conexion.close(); } catch (e) { /* ya cerrada */ }
    conexion = null;
    cache.clear();
  },

  abrir() {
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
    conexion = new DatabaseSync(config.dbPath);
    conexion.exec('PRAGMA busy_timeout = 5000;');
    conexion.exec('PRAGMA foreign_keys = ON;');
    return db;
  },
};

module.exports = db;
