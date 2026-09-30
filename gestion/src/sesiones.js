/**
 * Almacén de sesiones en la base.
 *
 * express-session guarda por defecto en memoria: cada reinicio desloguea a
 * todos (pasó en el panel de conectividad). Acá se guardan en la tabla
 * `sesiones`, así un reinicio no afecta a nadie.
 */

const session = require('express-session');
const db = require('./db/database');

const DURACION_MS = 7 * 24 * 60 * 60 * 1000; // una semana

class AlmacenSQLite extends session.Store {
  get(sid, cb) {
    try {
      const r = db.uno('SELECT datos, vence FROM sesiones WHERE sid = ?', sid);
      if (!r || r.vence < Date.now()) return cb(null, null);
      cb(null, JSON.parse(r.datos));
    } catch (err) { cb(err); }
  }

  set(sid, datos, cb) {
    try {
      const vence = datos.cookie && datos.cookie.expires
        ? new Date(datos.cookie.expires).getTime()
        : Date.now() + DURACION_MS;
      db.ejecutar(
        `INSERT INTO sesiones (sid, datos, vence) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET datos = excluded.datos, vence = excluded.vence`,
        sid, JSON.stringify(datos), vence
      );
      cb && cb(null);
    } catch (err) { cb && cb(err); }
  }

  destroy(sid, cb) {
    try {
      db.ejecutar('DELETE FROM sesiones WHERE sid = ?', sid);
      cb && cb(null);
    } catch (err) { cb && cb(err); }
  }

  touch(sid, datos, cb) {
    this.set(sid, datos, cb);
  }
}

/** Borra sesiones vencidas. Se llama una vez por hora. */
function limpiarVencidas() {
  try { db.ejecutar('DELETE FROM sesiones WHERE vence < ?', Date.now()); } catch (e) { /* no crítico */ }
}

module.exports = { AlmacenSQLite, DURACION_MS, limpiarVencidas };
