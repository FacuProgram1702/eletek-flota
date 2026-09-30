/**
 * Capa de base de datos: SQLite nativo de Node (`node:sqlite`).
 *
 * POR QUÉ NO sql.js (lo que se usaba hasta sept. 2026):
 * sql.js es SQLite compilado a WebAssembly y vive en memoria. Para guardar,
 * cierra la base, copia el archivo entero fuera de su memoria y la vuelve a
 * abrir — miles de veces por día con la flota reportando. Después de uno o
 * dos días de funcionamiento su memoria interna se corrompía
 * ("RuntimeError: memory access out of bounds") y a partir de ahí TODA
 * consulta fallaba: el proceso seguía vivo, pero los barcos y el panel solo
 * recibían error 500 hasta reiniciar a mano. Eso era el "se tilda todos los
 * días" (ver salud.log del 21/09/2026 y los 500 masivos en eletek-access.log).
 *
 * `node:sqlite` viene incluido en Node (>= 22.13), no necesita compilar nada
 * en Windows y escribe directo al archivo, de a poco, como cualquier SQLite.
 * No hay copia en memoria que se pueda desincronizar ni guardados diferidos.
 *
 * Se mantiene la misma API que usaba el resto del código (estilo
 * better-sqlite3): prepare(sql) → { run, get, all }, exec(sql), batch(fn).
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// Asegurar que el directorio de datos exista
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let sqliteDb = null;

// Sentencias preparadas reutilizables. Las rutas llaman db.prepare() en cada
// petición con el mismo SQL; compilarlo una sola vez ahorra trabajo.
const cache = new Map();
const CACHE_MAX = 500;

// Profundidad de batch() anidados: solo el externo abre/cierra la transacción.
let profundidadBatch = 0;

/**
 * node:sqlite es más estricto que sql.js al recibir parámetros: rechaza
 * `undefined` y los booleanos. sql.js los convertía solo (undefined → NULL,
 * true/false → 1/0), y hay código que cuenta con eso.
 */
function normalizar(params) {
  for (let i = 0; i < params.length; i++) {
    const v = params[i];
    if (v === undefined) params[i] = null;
    else if (typeof v === 'boolean') params[i] = v ? 1 : 0;
  }
  return params;
}

/** node:sqlite devuelve filas sin prototipo; se pasan a objeto común. */
function fila(r) {
  return r === undefined ? undefined : Object.assign({}, r);
}

function obtenerSentencia(sql) {
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = sqliteDb.prepare(sql);
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(sql, stmt);
  }
  return stmt;
}

const db = {
  /** @returns {boolean} si la DB está inicializada */
  get ready() {
    return sqliteDb !== null;
  },

  /**
   * Prepara una sentencia SQL.
   * @param {string} sql
   * @returns {{ run: Function, get: Function, all: Function }}
   */
  prepare(sql) {
    const stmt = obtenerSentencia(sql);
    return {
      /** INSERT/UPDATE/DELETE → { changes, lastInsertRowid } */
      run(...params) {
        const r = stmt.run(...normalizar(params));
        return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
      },
      /** Una fila o undefined */
      get(...params) {
        return fila(stmt.get(...normalizar(params)));
      },
      /** Todas las filas */
      all(...params) {
        return stmt.all(...normalizar(params)).map(fila);
      },
    };
  },

  /**
   * Ejecuta SQL directo (DDL, varias sentencias juntas).
   * @param {string} sql
   */
  exec(sql) {
    sqliteDb.exec(sql);
    // Un ALTER/CREATE puede invalidar sentencias ya compiladas
    cache.clear();
  },

  /**
   * Ejecuta varias operaciones dentro de una transacción: o se graban todas
   * o ninguna, y el disco se toca una sola vez al final (mucho más rápido
   * que una escritura por cada usuario del sync).
   * @param {Function} fn
   */
  batch(fn) {
    if (profundidadBatch > 0) {
      profundidadBatch++;
      try { return fn(); } finally { profundidadBatch--; }
    }
    profundidadBatch = 1;
    sqliteDb.exec('BEGIN');
    try {
      const r = fn();
      sqliteDb.exec('COMMIT');
      return r;
    } catch (err) {
      try { sqliteDb.exec('ROLLBACK'); } catch (e) { /* ya estaba cerrada */ }
      throw err;
    } finally {
      profundidadBatch = 0;
    }
  },

  /** Compatibilidad: antes era un no-op. */
  pragma(stmt) {
    sqliteDb.exec('PRAGMA ' + stmt);
  },

  /**
   * Consulta mínima para el control de salud. Si la base dejó de responder
   * tira excepción, y server.js decide reiniciar el proceso.
   */
  verificar() {
    obtenerSentencia('SELECT 1 AS ok').get();
  },

  /** Cierre ordenado (SIGINT/SIGTERM). Las escrituras ya están en disco. */
  cerrar() {
    if (!sqliteDb) return;
    try { sqliteDb.close(); } catch (e) { /* ya cerrada */ }
    sqliteDb = null;
    cache.clear();
  },
};

/**
 * Inicializa la base de datos. Queda async para no cambiar server.js, aunque
 * node:sqlite abre de forma sincrónica.
 */
async function initDatabase() {
  const existia = fs.existsSync(config.dbPath);
  sqliteDb = new DatabaseSync(config.dbPath);

  // Si otro proceso tiene la base ocupada un instante, esperar en vez de
  // fallar enseguida con "database is locked".
  sqliteDb.exec('PRAGMA busy_timeout = 5000;');
  sqliteDb.exec('PRAGMA foreign_keys = ON;');

  console.log(existia
    ? '[DB] Base de datos abierta: ' + config.dbPath
    : '[DB] Nueva base de datos creada: ' + config.dbPath);

  return db;
}

module.exports = db;
module.exports.initDatabase = initDatabase;
