const db = require('./database');
const bcrypt = require('bcryptjs');

function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vessels (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      slug        TEXT    NOT NULL UNIQUE,
      api_token   TEXT    NOT NULL UNIQUE,
      last_seen   TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS commands (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      vessel_id    INTEGER NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
      type         TEXT    NOT NULL,
      payload      TEXT    NOT NULL DEFAULT '{}',
      raw_script   TEXT    NOT NULL DEFAULT '',
      status       TEXT    NOT NULL DEFAULT 'pending',
      result       TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      executed_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS usage_counters (
      vessel_id   INTEGER NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
      username    TEXT    NOT NULL,
      last_bytes  INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (vessel_id, username)
    );

    CREATE TABLE IF NOT EXISTS usage_daily (
      vessel_id   INTEGER NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
      username    TEXT    NOT NULL,
      day         TEXT    NOT NULL,
      bytes       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (vessel_id, username, day)
    );

    CREATE TABLE IF NOT EXISTS panel_users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT    NOT NULL UNIQUE,
      password   TEXT    NOT NULL,
      role       TEXT    NOT NULL DEFAULT 'operador',
      scope      TEXT    NOT NULL DEFAULT '[]',
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_vessels_slug      ON vessels(slug);
    CREATE INDEX IF NOT EXISTS idx_vessels_token     ON vessels(api_token);
    CREATE INDEX IF NOT EXISTS idx_commands_vessel   ON commands(vessel_id, status);
    CREATE INDEX IF NOT EXISTS idx_commands_status   ON commands(status);
    CREATE TABLE IF NOT EXISTS vessel_positions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      vessel_id   INTEGER NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
      lat         REAL    NOT NULL,
      lon         REAL    NOT NULL,
      accuracy    REAL,
      source      TEXT    NOT NULL DEFAULT 'portal',
      reported_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Reinicios detectados del router: cuando el uptime reportado baja
    -- respecto del sync anterior, el router se reinició en el medio.
    CREATE TABLE IF NOT EXISTS vessel_reboots (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      vessel_id     INTEGER NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
      detected_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      prev_uptime_s INTEGER,
      new_uptime_s  INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_usage_daily_vessel_day ON usage_daily(vessel_id, day);
    CREATE INDEX IF NOT EXISTS idx_reboots_vessel ON vessel_reboots(vessel_id, detected_at);
    CREATE INDEX IF NOT EXISTS idx_positions_vessel ON vessel_positions(vessel_id, reported_at);
  `);

  try {
    db.exec(`ALTER TABLE vessels ADD COLUMN sync_data TEXT DEFAULT '{}';`);
  } catch (err) {
    // Column might already exist, ignore error
  }

  // Datos de navegación que aporta el agente GPS de a bordo (NMEA). El portal
  // web solo puede dar lat/lon, así que estas columnas quedan nulas ahí.
  for (const col of ['speed_kn REAL', 'course_deg REAL', 'heading_deg REAL']) {
    try {
      db.exec(`ALTER TABLE vessel_positions ADD COLUMN ${col};`);
    } catch (err) {
      // La columna ya existe: no hay nada que hacer.
    }
  }

  // Migrar operador desde .env si la tabla panel_users está vacía
  _migrateEnvOperator();

  console.log('[DB] Migraciones ejecutadas correctamente');
}

/**
 * Si existe OPERADOR_USER en el .env y la tabla panel_users está vacía,
 * migrar ese operador automáticamente para no perder acceso existente.
 */
async function _migrateEnvOperator() {
  try {
    const count = db.prepare('SELECT COUNT(*) as c FROM panel_users').get();
    if (count && count.c > 0) return;

    const user = process.env.OPERADOR_USER;
    const pass = process.env.OPERADOR_PASS;
    const scope = process.env.OPERADOR_SCOPE;

    if (!user || !pass) return;

    const hash = await bcrypt.hash(pass, 10);
    const scopeArr = scope ? JSON.stringify([scope]) : '[]';
    db.prepare(
      'INSERT OR IGNORE INTO panel_users (username, password, role, scope) VALUES (?, ?, ?, ?)'
    ).run(user, hash, 'operador', scopeArr);

    console.log(`[DB] Operador "${user}" migrado desde variables de entorno`);
  } catch (err) {
    console.error('[DB] Error al migrar operador desde .env:', err);
  }
}

module.exports = { runMigrations };
