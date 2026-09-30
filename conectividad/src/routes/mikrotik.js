/**
 * Endpoints máquina-a-máquina para los MikroTik.
 * Estos son el corazón del sistema de polling.
 *
 * GET  /api/v1/poll/:slug   — El barco pide órdenes pendientes
 * GET|POST /api/v1/result/:slug — El barco reporta resultado de una orden
 */

const express = require('express');
const db = require('../db/database');
const { requireVesselAuth } = require('../middleware/vesselAuth');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/v1/poll/:slug
 *
 * 1. Actualiza last_seen del barco.
 * 2. Busca commands pendientes (status='pending') para este barco.
 * 3. Las marca como 'sent'.
 * 4. Responde en JSON o texto plano según ?format=text.
 */
router.get('/poll/:slug', requireVesselAuth, (req, res) => {
  const vessel = req.vessel;

  // Actualizar last_seen
  db.prepare('UPDATE vessels SET last_seen = datetime(\'now\') WHERE id = ?').run(vessel.id);

  // Una sola orden por poll.
  //
  // El script del router (eletek_poll) procesa un único comando: parsea el
  // texto hasta el primer "|" como id y toma TODO el resto como script. Si le
  // mandáramos varias, las concatenaría en un script inválido — falla la
  // primera y las demás quedan marcadas como enviadas sin haberse ejecutado.
  // Como el poll corre cada 30s, una cola de N órdenes se drena igual de rápido.
  const pendingCommands = db.prepare(`
    SELECT id, raw_script FROM commands
    WHERE vessel_id = ? AND status = 'pending'
    ORDER BY created_at ASC
    LIMIT 1
  `).all(vessel.id);

  // Marcar como enviada
  if (pendingCommands.length > 0) {
    db.prepare("UPDATE commands SET status = 'sent' WHERE id = ?").run(pendingCommands[0].id);
  }

  logger.poll(vessel.slug, pendingCommands.length);

  // Responder según formato
  if (req.query.format === 'text') {
    // Formato texto plano: id|comando
    if (pendingCommands.length === 0) {
      return res.type('text/plain').send('');
    }
    const c = pendingCommands[0];
    return res.type('text/plain').send(`${c.id}|${c.raw_script}`);
  }

  // Formato JSON por defecto
  return res.json({
    commands: pendingCommands.map((c) => ({
      id: c.id,
      raw_script: c.raw_script,
    })),
  });
});

/**
 * GET|POST /api/v1/result/:slug
 *
 * El barco reporta el resultado de una orden ejecutada.
 * Acepta parámetros por query string (GET) o body JSON (POST).
 *
 * Params: id, status ("done"|"error"), result (texto)
 */
function handleResult(req, res) {
  const vessel = req.vessel;

  // Extraer params de query string o body
  const commandId = req.query.id || (req.body && req.body.id);
  const status = req.query.status || (req.body && req.body.status);
  const result = req.query.result || (req.body && req.body.result) || '';

  if (!commandId) {
    return res.status(400).json({ error: 'id es requerido' });
  }

  if (!status || !['done', 'error'].includes(status)) {
    return res.status(400).json({ error: 'status debe ser "done" o "error"' });
  }

  // Verificar que el command existe y pertenece a este barco
  const command = db.prepare(`
    SELECT id, vessel_id, status as current_status FROM commands WHERE id = ?
  `).get(commandId);

  if (!command) {
    return res.status(404).json({ error: 'Orden no encontrada' });
  }

  if (command.vessel_id !== vessel.id) {
    return res.status(403).json({ error: 'Esta orden no pertenece a este barco' });
  }

  // Actualizar la orden
  db.prepare(`
    UPDATE commands
    SET status = ?, result = ?, executed_at = datetime('now')
    WHERE id = ?
  `).run(status, result.toString().substring(0, 4096), commandId);

  logger.result(vessel.slug, commandId, status);

  return res.json({ ok: true });
}

router.get('/result/:slug', requireVesselAuth, handleResult);
router.post('/result/:slug', requireVesselAuth, handleResult);

/**
 * Convierte el uptime de RouterOS a segundos.
 * Formatos posibles: "10:34:04", "1d10:34:04", "2w3d10:34:04", "45s".
 * @returns {number|null} segundos, o null si no se pudo interpretar
 */
function parseUptime(str) {
  if (!str || typeof str !== 'string') return null;
  const m = str.match(/^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+):(\d+):(\d+))?(?:(\d+)s)?$/);
  if (!m) return null;
  const [, w, d, h, mi, s, soloSeg] = m;
  if (!w && !d && !h && !soloSeg) return null;
  return (parseInt(w || 0) * 604800) + (parseInt(d || 0) * 86400)
       + (parseInt(h || 0) * 3600) + (parseInt(mi || 0) * 60)
       + parseInt(s || 0) + parseInt(soloSeg || 0);
}

/**
 * Parsea el estado del router que manda la telemetría.
 * Formato: uptime;cpu;freeMem;totalMem;version;model;voltage;temperature
 * El separador es ';' y no ':' porque el uptime de RouterOS ya trae dos puntos
 * ("10:34:04"), que romperían el corte de campos.
 * Todos los campos son opcionales: un barco con el script viejo no manda nada.
 */
function parseRouterInfo(str) {
  if (!str || typeof str !== 'string') return null;
  const [uptime, cpu, freeMem, totalMem, version, model, voltage, temp] = str.split(';');
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  return {
    uptime: uptime || null,
    uptime_s: parseUptime(uptime),
    cpu_load: num(cpu),
    free_memory: num(freeMem),
    total_memory: num(totalMem),
    version: version || null,
    model: model || null,
    voltage: num(voltage),
    temperature: num(temp),
  };
}

/**
 * POST /api/v1/sync/:slug
 * 
 * El barco reporta su estado actual (usuarios activos, consumos, etc.)
 * Body JSON esperado: { "users": [...] } o similar.
 */
router.post('/sync/:slug', requireVesselAuth, (req, res) => {
  const vessel = req.vessel;
  let payloadStr = req.body && req.body.payload ? req.body.payload : null;
  const routerStr = req.body && req.body.router ? req.body.router : null;

  // Se acepta un sync que traiga solo el estado del router: el script de salud
  // (eletek_health) reporta aparte del de usuarios, para no tener que tocar la
  // telemetría que ya funciona en cada barco.
  if (!payloadStr && !routerStr) {
    return res.status(400).json({ error: 'Faltan datos de sincronización' });
  }

  // Parse custom format: name:bIn:bOut:limit:active[:profile[:password]]|...
  // El perfil es opcional: los barcos que todavía no actualizaron su script
  // de telemetría mandan 5 campos y se asumen en plan diario ('default').
  const users = [];
  try {
    const parts = (payloadStr || '').split('|');
    for (const part of parts) {
      if (!part) continue;
      const campos = part.split(':');
      const [name, bIn, bOut, limit, active, profile] = campos;
      // La contraseña puede contener ':', así que se toma todo el resto
      const password = campos.length > 6 ? campos.slice(6).join(':') : null;
      if (name) {
        users.push({
          name: name,
          bytes: (parseInt(bIn, 10) || 0) + (parseInt(bOut, 10) || 0),
          limit: parseInt(limit || 2147483648),
          active: active === 'true',
          profile: profile || 'default',
          password: password || null
        });
      }
    }
  } catch (e) {
    logger.error('Error parsing telemetry data:', e);
  }

  const routerInfo = parseRouterInfo(routerStr);

  // Los usuarios y el estado del router llegan por separado, así que cada sync
  // actualiza solo su parte: un reporte de salud no puede borrar la lista de
  // usuarios, ni un sync de usuarios borrar el estado del router.
  let prevData = {};
  try {
    const prev = db.prepare('SELECT sync_data FROM vessels WHERE id = ?').get(vessel.id);
    if (prev && prev.sync_data) prevData = JSON.parse(prev.sync_data) || {};
  } catch (e) { /* sync_data ilegible: arrancamos de cero */ }

  const syncData = { ...prevData };
  if (payloadStr) syncData.users = users;
  if (routerInfo) syncData.router = routerInfo;

  // Detección de reinicios: si el uptime bajó respecto del sync anterior, el
  // router se reinició en el medio. Es la señal que delata una fuente floja o
  // un falso contacto en la alimentación.
  let reinicio = null;
  if (routerInfo && routerInfo.uptime_s != null) {
    const prevUp = prevData.router && prevData.router.uptime_s;
    if (Number.isFinite(prevUp) && routerInfo.uptime_s < prevUp) {
      reinicio = { prev: prevUp, now: routerInfo.uptime_s };
    }
  }
  const today = new Date().toISOString().slice(0, 10);

  // Guardar en la DB. Todo en una sola transacción: o se graba el sync
  // completo o nada, y el disco se toca una vez -- ver database.js `batch()`.
  db.batch(() => {
    for (const u of users) {
      const counter = db.prepare(`
        SELECT last_bytes FROM usage_counters WHERE vessel_id = ? AND username = ?
      `).get(vessel.id, u.name);

      if (counter) {
        // Si el contador actual es menor al último visto, el router lo
        // reseteó (comando "Resetear cuota"): todo el valor actual es
        // consumo nuevo, no restamos un delta negativo.
        const delta = u.bytes >= counter.last_bytes ? u.bytes - counter.last_bytes : u.bytes;
        if (delta > 0) {
          db.prepare(`
            INSERT INTO usage_daily (vessel_id, username, day, bytes)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(vessel_id, username, day) DO UPDATE SET bytes = bytes + excluded.bytes
          `).run(vessel.id, u.name, today, delta);
        }
      }
      // Si no había contador previo, es la primera vez que vemos a este
      // usuario: solo establecemos la línea base, sin sumar consumo "de hoy".

      db.prepare(`
        INSERT INTO usage_counters (vessel_id, username, last_bytes, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(vessel_id, username) DO UPDATE SET last_bytes = excluded.last_bytes, updated_at = excluded.updated_at
      `).run(vessel.id, u.name, u.bytes);
    }

    db.prepare(`
      UPDATE vessels
      SET sync_data = ?, last_seen = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(syncData), vessel.id);

    if (reinicio) {
      db.prepare(`
        INSERT INTO vessel_reboots (vessel_id, prev_uptime_s, new_uptime_s)
        VALUES (?, ?, ?)
      `).run(vessel.id, reinicio.prev, reinicio.now);
    }
  });

  if (reinicio) {
    logger.info(`${vessel.name}: REINICIO del router detectado (uptime cayó de ${Math.round(reinicio.prev / 60)}min a ${Math.round(reinicio.now / 60)}min)`);
  }

  return res.json({ ok: true });
});

/**
 * GET /api/v1/identificar
 *
 * Devuelve a qué barco pertenece el token. Lo usa el agente GPS de a bordo:
 * así el operador pega un solo código en la PC y el programa le confirma el
 * nombre del barco, en vez de tener que cargar slug y token por separado.
 */
router.get('/identificar', requireVesselAuth, (req, res) => {
  return res.json({ name: req.vessel.name, slug: req.vessel.slug });
});

/**
 * POST /api/v1/posicion
 *
 * Posición reportada por el agente GPS de la PC de a bordo, leída del puerto
 * serie en NMEA. A diferencia del portal web, acá sí vienen rumbo y velocidad.
 * Body JSON o form: { lat, lon, speed_kn?, course_deg?, heading_deg? }
 */
router.post('/posicion', requireVesselAuth, (req, res) => {
  const vessel = req.vessel;
  const b = req.body || {};

  const lat = Number(b.lat);
  const lon = Number(b.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)
      || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ error: 'Coordenadas inválidas' });
  }

  // Los campos de navegación son opcionales: un GPS sin fix de rumbo, o un
  // equipo que solo manda GGA, no los incluye.
  const opc = (v, min, max) => {
    const n = Number(v);
    return (Number.isFinite(n) && n >= min && n <= max) ? n : null;
  };

  db.prepare(`
    INSERT INTO vessel_positions
      (vessel_id, lat, lon, accuracy, source, speed_kn, course_deg, heading_deg)
    VALUES (?, ?, ?, NULL, 'gps', ?, ?, ?)
  `).run(
    vessel.id, lat, lon,
    opc(b.speed_kn, 0, 200),
    opc(b.course_deg, 0, 360),
    opc(b.heading_deg, 0, 360)
  );

  logger.info(`Posición GPS de ${vessel.name}: ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
  return res.json({ ok: true });
});

module.exports = router;
