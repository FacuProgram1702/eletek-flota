/**
 * Portal de conexión (captive portal) y recepción de posición.
 *
 * FLUJO:
 * 1. Teléfono conecta al WiFi → MikroTik lo manda a login.html
 * 2. login.html redirige a GET /portal/:slug?login=http://192.168.88.1/login
 * 3. Usuario ingresa credenciales → JS manda a http://192.168.88.1/login?username=...&password=...&dst=/portal/:slug/gracias
 * 4. MikroTik autentica al usuario y redirige a GET /portal/:slug/gracias
 * 5. /gracias corre en el navegador real (ya tiene internet) y pide la ubicación
 * 6. Posición guardada
 *
 * NOTA: La geolocalización NO se pide en el formulario de login porque el
 * mini-browser del captive portal (CNA) la bloquea en Android e iOS.
 * Solo funciona después de la autenticación, en /gracias, donde el teléfono
 * ya tiene internet y el navegador real puede pedir el permiso.
 *
 * TIEMPOS: en alta mar no hay asistencia celular, así que el GPS arranca en
 * frío y puede tardar más de un minuto. Por eso se usa watchPosition con una
 * ventana larga (no getCurrentPosition con timeout corto) y NO se redirige
 * sola la página: la primera versión daba 8 s y se iba a Google, y de 28
 * logins reales no capturó ni una posición.
 */

const express = require('express');
const db = require('../db/database');
const logger = require('../utils/logger');

const router = express.Router();

function getVessel(slug) {
  return db.prepare('SELECT id, name FROM vessels WHERE slug = ?').get(slug);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]
  ));
}

// ── Dominio propio para construir la URL de /gracias ──────────────────────────
const OWN_DOMAIN = 'https://panel.tu-dominio.com';

/**
 * GET /portal/:slug
 * Página de login. Público — el teléfono todavía no está autenticado.
 */
router.get('/portal/:slug', (req, res) => {
  const vessel = getVessel(req.params.slug);
  if (!vessel) return res.status(404).send('Red no encontrada.');

  const slug = req.params.slug;
  const loginUrl = (typeof req.query.login === 'string' && /^https?:\/\//.test(req.query.login))
    ? req.query.login : '';

  // URL a la que el MikroTik mandará al usuario después de autenticarlo.
  // En /gracias el teléfono ya tiene internet → geolocalización funciona.
  const graciasDst = `${OWN_DOMAIN}/portal/${slug}/gracias`;

  res.type('html').send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>Conectar al WiFi</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(160deg, #0e3a5f 0%, #14496a 100%); color: #fff; padding: 24px;
    }
    .card { width: 100%; max-width: 360px; text-align: center; }
    .logo {
      width: 56px; height: 56px; border-radius: 14px; margin: 0 auto 20px;
      background: rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: center;
      font-size: 26px; font-weight: 700;
    }
    h1 { font-size: 22px; font-weight: 600; margin: 0 0 6px; }
    p  { font-size: 15px; opacity: .75; margin: 0 0 28px; line-height: 1.5; }
    input {
      width: 100%; padding: 15px; font-size: 16px; border: none; border-radius: 12px;
      margin-bottom: 12px; font-family: inherit; background: rgba(255,255,255,0.95); color: #0e3a5f;
    }
    input::placeholder { color: #7a94a8; }
    button {
      width: 100%; padding: 16px; font-size: 17px; font-weight: 600; color: #0e3a5f;
      background: #fff; border: none; border-radius: 12px; cursor: pointer; font-family: inherit;
      transition: transform .1s, opacity .2s;
    }
    button:active  { transform: scale(0.98); }
    button:disabled { opacity: .6; cursor: default; }
    .status { margin-top: 18px; font-size: 14px; min-height: 20px; opacity: .85; }
    .spinner {
      display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(255,255,255,.3);
      border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite;
      vertical-align: middle; margin-right: 8px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">E</div>
    <h1>${esc(vessel.name)}</h1>
    <p>Ingresá tu usuario y contraseña para conectarte a internet.</p>

    <form id="login" onsubmit="entrar(event)">
      <input id="u" placeholder="Usuario" autocapitalize="none" autocomplete="username" required>
      <input id="p" type="password" placeholder="Contraseña" autocomplete="current-password" required>
      <button id="btn" type="submit">Ingresar a Internet</button>
    </form>

    <div class="status" id="status"></div>
  </div>

  <script>
    var LOGIN_URL  = ${JSON.stringify(loginUrl)};
    var GRACIAS_DST = ${JSON.stringify(graciasDst)};
    var statusEl = document.getElementById('status');
    var btn      = document.getElementById('btn');

    function entrar(e) {
      e.preventDefault();
      var u = document.getElementById('u').value.trim();
      var p = document.getElementById('p').value;
      if (!u || !p) return;

      btn.disabled = true;
      statusEl.innerHTML = '<span class="spinner"></span>Iniciando sesión...';

      if (LOGIN_URL) {
        // Mandamos al MikroTik con dst = nuestra página /gracias (HTTPS).
        // El router autentica al usuario y lo redirige ahí; en /gracias ya
        // hay internet real y la geolocalización funciona.
        var url = LOGIN_URL
          + '?username=' + encodeURIComponent(u)
          + '&password=' + encodeURIComponent(p)
          + '&dst='      + encodeURIComponent(GRACIAS_DST);
        window.location.href = url;
      } else {
        // Modo prueba (sin router)
        statusEl.textContent = 'Autenticado correctamente (modo prueba)';
        btn.textContent = 'Conectado ✓';
      }
    }
  </script>
</body>
</html>`);
});

/**
 * GET /portal/:slug/gracias
 *
 * El MikroTik redirige aquí después de autenticar al usuario: el teléfono ya
 * tiene internet y el navegador puede pedir el permiso de ubicación.
 *
 * La página se queda esperando el fix del GPS (hasta 2 minutos) en vez de
 * redirigir sola. El usuario puede irse cuando quiera con el botón, pero la
 * pantalla no lo empuja a hacerlo antes de tiempo.
 */
router.get('/portal/:slug/gracias', (req, res) => {
  const vessel = getVessel(req.params.slug);
  if (!vessel) return res.status(404).send('Red no encontrada.');
  const slug = req.params.slug;

  res.type('html').send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Conectado</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(160deg, #0e3a5f 0%, #14496a 100%); color: #fff; padding: 24px;
      text-align: center;
    }
    .card { width: 100%; max-width: 340px; }
    .icon { font-size: 52px; margin-bottom: 14px; line-height: 1; }
    h1 { font-size: 23px; font-weight: 700; margin: 0 0 10px; }
    p  { font-size: 15px; opacity: .8; margin: 0 0 8px; line-height: 1.55; }
    .hint { font-size: 13px; opacity: .6; margin-top: 14px; line-height: 1.5; }
    .spinner {
      display: inline-block; width: 15px; height: 15px; border: 2px solid rgba(255,255,255,.3);
      border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite;
      vertical-align: -2px; margin-right: 8px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    button {
      width: 100%; padding: 15px; font-size: 16px; font-weight: 600; color: #0e3a5f;
      background: #fff; border: none; border-radius: 12px; cursor: pointer;
      font-family: inherit; margin-top: 26px; transition: transform .1s, opacity .25s;
    }
    button:active { transform: scale(0.98); }
    .ghost {
      background: transparent; color: #fff; border: 1px solid rgba(255,255,255,.35);
      font-weight: 500; opacity: .85;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon" id="icon">✓</div>
    <h1 id="titulo">¡Conectado!</h1>
    <p id="msg"><span class="spinner"></span>Registrando la posición de la embarcación...</p>
    <p class="hint" id="hint">Puede tardar hasta un minuto. Dejá esta pantalla abierta.</p>
    <button id="btn" class="ghost" onclick="salir()">Continuar</button>
  </div>

  <script>
    // Relativas a propósito: la página ya se sirve desde el dominio propio,
    // así siempre son del mismo origen (sin CORS ni preflight que pueda fallar).
    var SLUG         = ${JSON.stringify(slug)};
    var POSITION_URL = '/portal/' + SLUG + '/position';
    var DIAG_URL     = '/portal/' + SLUG + '/diag';

    var t0        = Date.now();
    var enviado   = false;
    var mejorAcc  = Infinity;
    var watchId   = null;
    var cerrado   = false;

    var iconEl  = document.getElementById('icon');
    var tituloEl= document.getElementById('titulo');
    var msgEl   = document.getElementById('msg');
    var hintEl  = document.getElementById('hint');
    var btnEl   = document.getElementById('btn');

    // Diagnóstico: queda en el log del servidor para saber POR QUÉ falla
    // (permiso denegado, GPS sin señal, timeout o navegador sin soporte).
    function diag(ev, extra) {
      try {
        var u = DIAG_URL + '?ev=' + encodeURIComponent(ev)
              + '&s=' + Math.round((Date.now() - t0) / 1000)
              + (extra != null ? '&d=' + encodeURIComponent(extra) : '');
        var img = new Image();
        img.src = u;
      } catch (e) { /* nunca romper la pantalla por el diagnóstico */ }
    }

    function detener() {
      if (watchId !== null) {
        try { navigator.geolocation.clearWatch(watchId); } catch (e) {}
        watchId = null;
      }
    }

    function salir() {
      cerrado = true;
      detener();
      window.location.replace('https://www.google.com');
    }

    function listo(acc) {
      iconEl.textContent = '✓';
      tituloEl.textContent = '¡Listo!';
      msgEl.textContent = 'Ya tenés internet.';
      hintEl.textContent = 'Podés cerrar esta pantalla.';
      btnEl.textContent = 'Continuar';
      btnEl.className = '';
      diag('ok', Math.round(acc));
    }

    function sinUbicacion(motivo) {
      // El usuario igual quedó con internet: nunca bloquear por esto.
      iconEl.textContent = '✓';
      tituloEl.textContent = '¡Conectado!';
      msgEl.textContent = 'Ya tenés internet.';
      hintEl.textContent = 'Podés cerrar esta pantalla.';
      btnEl.textContent = 'Continuar';
      btnEl.className = '';
      diag(motivo);
    }

    function enviar(pos) {
      var acc = pos.coords.accuracy;
      fetch(POSITION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: acc
        })
      }).then(function () {
        if (!enviado) { enviado = true; listo(acc); }
      }).catch(function () {
        diag('fetch_error');
      });
    }

    function onPos(pos) {
      if (cerrado) return;
      var acc = pos.coords.accuracy;
      if (!enviado) {
        // Primer fix: mandarlo ya, aunque sea impreciso. Si el usuario se va,
        // al menos quedó registrado algo.
        enviar(pos);
      } else if (acc < mejorAcc / 2) {
        // Mejoró mucho la precisión: actualizar una vez más.
        enviar(pos);
      }
      if (acc < mejorAcc) mejorAcc = acc;
      // Con precisión de GPS real ya alcanza: dejar de consumir batería.
      if (acc <= 50) detener();
    }

    function onErr(err) {
      if (cerrado) return;
      detener();
      if (err && err.code === 1)      sinUbicacion('permiso_denegado');
      else if (err && err.code === 2) sinUbicacion('sin_senal_gps');
      else if (err && err.code === 3) sinUbicacion('timeout');
      else                            sinUbicacion('error_desconocido');
    }

    if (navigator.geolocation) {
      diag('inicio');
      // Ventana larga: en alta mar el GPS arranca en frío y tarda.
      watchId = navigator.geolocation.watchPosition(onPos, onErr, {
        enableHighAccuracy: true,
        timeout: 120000,
        maximumAge: 0
      });
      // Corte duro a los 2 minutos por si el navegador nunca llama a onErr.
      setTimeout(function () {
        if (!enviado && !cerrado) { detener(); sinUbicacion('sin_fix_2min'); }
      }, 125000);
    } else {
      sinUbicacion('sin_soporte_geo');
    }
  </script>
</body>
</html>`);
});

/**
 * GET /portal/:slug/diag
 * Baliza de diagnóstico del portal. Sin cuerpo: todo viaja en la query, así
 * queda visible en el log de acceso y se puede leer sin entrar a la base.
 */
router.get('/portal/:slug/diag', (req, res) => {
  const vessel = getVessel(req.params.slug);
  const ev = String(req.query.ev || '').slice(0, 40);
  const seg = String(req.query.s || '').slice(0, 6);
  const extra = String(req.query.d || '').slice(0, 20);
  if (vessel) {
    logger.info(`Portal ${vessel.name}: ${ev}${extra ? ' (' + extra + ')' : ''} a los ${seg}s`);
  }
  return res.status(204).end();
});

/**
 * POST /portal/:slug/position
 * Recibe la posición del dispositivo y la guarda como posición del barco.
 */
router.post('/portal/:slug/position', (req, res) => {
  const vessel = getVessel(req.params.slug);
  if (!vessel) {
    return res.status(404).json({ error: 'Red no encontrada' });
  }

  const lat = Number(req.body && req.body.lat);
  const lon = Number(req.body && req.body.lon);
  const acc = req.body && req.body.accuracy != null ? Number(req.body.accuracy) : null;

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ error: 'Coordenadas inválidas' });
  }

  db.prepare(`
    INSERT INTO vessel_positions (vessel_id, lat, lon, accuracy, source)
    VALUES (?, ?, ?, ?, 'portal')
  `).run(vessel.id, lat, lon, Number.isFinite(acc) ? acc : null);

  logger.info(`Posición recibida de ${vessel.name}: ${lat.toFixed(5)}, ${lon.toFixed(5)} (±${acc ? Math.round(acc) : '?'}m)`);
  return res.json({ ok: true });
});

module.exports = router;
