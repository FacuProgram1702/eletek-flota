/**
 * Seguimiento: recorrido del barco y su actividad (pescando, navegando,
 * virada, a la capa, fondeado, en puerto), calculada desde el GPS que manda
 * el barco al panel de conectividad.
 *
 * No se guarda la actividad: se calcula al pedirla (ver servicios/actividad).
 * Lo único que se guarda son los ajustes por barco y los puertos.
 */

const express = require('express');
const db = require('../db/database');
const { ruta, numero, texto, idParam, ErrorUsuario, fecha, json } = require('../util');
const { requiere, verificarBarco, barcosVisibles, puede } = require('../middleware/auth');
const { auditar } = require('../servicios/auditoria');
const gps = require('../servicios/gps');
const act = require('../servicios/actividad');

const router = express.Router();
const HORA = 3600000;
const MAX_DIAS = 45;
// Se lee un poco antes del rango pedido: si el rango empieza en medio de un
// lance, sin este margen el lance aparecería cortado y mal clasificado.
const MARGEN_MS = 6 * HORA;

// ── Ajustes ─────────────────────────────────────────────────────────

/** Qué se puede ajustar, con límites razonables (evita valores absurdos). */
const LIMITES = {
  suavizado_min: [1, 30],
  fondeo_max_kn: [0, 3],
  pesca_min_kn: [0.3, 8],
  pesca_max_kn: [1, 12],
  lance_min_min: [5, 600],
  virada_max_min: [5, 600],
  tramo_corto_min: [1, 60],
  corte_sin_datos_min: [5, 240],
  fondeo_radio_m: [50, 5000],
  lance_largo_h: [1, 48],
};

function ajustesGuardados(empresaId, barcoId) {
  const r = db.uno('SELECT parametros FROM seguimiento_parametros WHERE empresa_id = ? AND barco_id = ?', empresaId, barcoId);
  return r ? json(r.parametros, {}) : {};
}

/** Defecto del sistema ← ajuste de la empresa ← ajuste del barco. */
function parametrosDe(empresaId, barcoId) {
  return Object.assign({}, act.PARAMETROS_DEFECTO, ajustesGuardados(empresaId, 0), ajustesGuardados(empresaId, barcoId));
}

/**
 * Puertos de la empresa. La primera vez se cargan los de fábrica, así
 * funciona de entrada y la empresa después corrige o agrega los suyos.
 */
function puertosDe(empresaId) {
  let filas = db.todos('SELECT * FROM seguimiento_puertos WHERE empresa_id = ? ORDER BY nombre', empresaId);
  if (!filas.length && !db.uno(`SELECT clave FROM migraciones WHERE clave = ?`, `puertos_${empresaId}`)) {
    db.transaccion(() => {
      for (const p of act.PUERTOS_DEFECTO) {
        db.ejecutar('INSERT INTO seguimiento_puertos (empresa_id, nombre, lat, lon, radio_km) VALUES (?, ?, ?, ?, ?)',
          empresaId, p.nombre, p.lat, p.lon, p.radio_km);
      }
      // Marca: si la empresa borra todos los puertos, no se vuelven a cargar
      db.ejecutar('INSERT INTO migraciones (clave, fecha) VALUES (?, ?)', `puertos_${empresaId}`, new Date().toISOString());
    });
    filas = db.todos('SELECT * FROM seguimiento_puertos WHERE empresa_id = ? ORDER BY nombre', empresaId);
  }
  return filas;
}

// ── Cálculo ─────────────────────────────────────────────────────────

/**
 * Clasifica un barco en un rango. Los segmentos que tocan el rango se
 * devuelven enteros (un lance que empezó antes del rango se ve completo).
 */
function calcular(empresaId, barco, desde, hasta) {
  const filas = gps.posiciones(barco.slug_conectividad, desde - MARGEN_MS, hasta);
  if (filas === null) throw new ErrorUsuario('No se puede leer el GPS de los barcos (falta CONECTIVIDAD_DB en el .env)', 503);
  const par = parametrosDe(empresaId, barco.id);
  const puertos = puertosDe(empresaId);
  const r = act.clasificar(filas, par, puertos);

  const dentro = (s) => new Date(s.fin).getTime() >= desde && new Date(s.inicio).getTime() <= hasta;
  r.segmentos = r.segmentos.filter(dentro);
  r.lances = r.lances.filter(dentro).map((l, i) => Object.assign(l, { numero: i + 1 }));
  r.resumen = resumenRango(r.segmentos, desde, hasta);
  r.puntos = r.puntos.filter((p) => p[2] >= desde);
  r.mareas = act.mareasDetectadas(r.segmentos);
  r.puertos = puertos;
  // Índices internos: no le sirven al navegador
  for (const s of r.segmentos) { delete s.ini; delete s.fin_idx; }
  return r;
}

/** Horas por estado contando solo lo que cae dentro del rango. */
function resumenRango(segmentos, desde, hasta) {
  const horas = {};
  for (const k of Object.keys(act.ESTADOS)) horas[k] = 0;
  let millas = 0;
  for (const s of segmentos) {
    const a = Math.max(desde, new Date(s.inicio).getTime());
    const b = Math.min(hasta, new Date(s.fin).getTime());
    if (b <= a) continue;
    horas[s.estado] += (b - a) / HORA;
    if (s.estado !== 'sin_datos' && s.duracion_min > 0) {
      millas += s.distancia_mn * ((b - a) / 60000) / s.duracion_min;
    }
  }
  for (const k of Object.keys(horas)) horas[k] = Math.round(horas[k] * 10) / 10;
  return { horas, millas: Math.round(millas), lances: segmentos.filter((s) => s.estado === 'pescando').length };
}

function leerRango(q) {
  const hasta = q.hasta ? new Date(q.hasta).getTime() : Date.now();
  const desde = q.desde ? new Date(q.desde).getTime() : hasta - 3 * 24 * HORA;
  if (!Number.isFinite(desde) || !Number.isFinite(hasta)) throw new ErrorUsuario('Fechas no válidas');
  if (hasta <= desde) throw new ErrorUsuario('La fecha "hasta" tiene que ser posterior a "desde"');
  if (hasta - desde > MAX_DIAS * 24 * HORA) throw new ErrorUsuario(`El rango máximo es de ${MAX_DIAS} días`);
  return { desde, hasta };
}

// ── Rutas ───────────────────────────────────────────────────────────

/** Flota: dónde está cada barco y qué está haciendo ahora. */
router.get('/barcos', requiere('seguimiento', 'ver'), ruta((req, res) => {
  const e = req.usuario.empresa_id;
  const ids = barcosVisibles(req);
  const barcos = ids.length
    ? db.todos(`SELECT id, nombre, slug_conectividad FROM barcos WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY nombre`, ...ids)
    : [];
  const ahora = Date.now();
  res.json(barcos.map((b) => {
    const out = { id: b.id, nombre: b.nombre, con_gps: !!b.slug_conectividad };
    if (!b.slug_conectividad) return out;
    out.posicion = gps.posicionActual(b.slug_conectividad);
    // Estado actual: las últimas 12 horas alcanzan para saber si está en un
    // lance o en una virada.
    try {
      const r = calcular(e, b, ahora - 12 * HORA, ahora);
      const ultimo = r.segmentos[r.segmentos.length - 1];
      if (ultimo) {
        const viejo = ahora - new Date(ultimo.fin).getTime() > 30 * 60000;
        out.actividad = viejo ? { estado: 'sin_datos', nombre: act.ESTADOS.sin_datos, desde: ultimo.fin }
          : { estado: ultimo.estado, nombre: ultimo.nombre, desde: ultimo.inicio, puerto: ultimo.puerto || null };
      }
      out.ultimas_12h = r.resumen;
    } catch (err) {
      out.error = err.message;
    }
    return out;
  }));
}));

/** Recorrido y actividad de un barco en un rango (por defecto, 3 días). */
router.get('/barcos/:id', requiere('seguimiento', 'ver'), ruta((req, res) => {
  const b = verificarBarco(req, idParam(req.params.id));
  if (!b.slug_conectividad) throw new ErrorUsuario('Este barco no está vinculado al panel de conectividad (falta el slug en Administración → Barcos)', 409);
  const { desde, hasta } = leerRango(req.query);
  const r = calcular(req.usuario.empresa_id, b, desde, hasta);
  r.barco = { id: b.id, nombre: b.nombre };
  r.desde = new Date(desde).toISOString();
  r.hasta = new Date(hasta).toISOString();
  r.estados = act.ESTADOS;
  r.puede_configurar = puede(req, 'seguimiento', 'configurar');
  r.puede_pasar_lances = puede(req, 'pesca', 'cargar');
  res.json(r);
}));

// ── Ajustes por barco ───────────────────────────────────────────────

router.get('/parametros/:barcoId', requiere('seguimiento', 'ver'), ruta((req, res) => {
  const id = Number(req.params.barcoId);
  if (id !== 0) verificarBarco(req, id);
  res.json({
    defecto: act.PARAMETROS_DEFECTO,
    empresa: ajustesGuardados(req.usuario.empresa_id, 0),
    barco: id ? ajustesGuardados(req.usuario.empresa_id, id) : {},
    efectivos: parametrosDe(req.usuario.empresa_id, id),
    limites: LIMITES,
  });
}));

/**
 * Guarda los ajustes. Un campo vacío vuelve al valor de la empresa (o al de
 * fábrica): así se ve qué se tocó a propósito para ese barco.
 */
router.put('/parametros/:barcoId', requiere('seguimiento', 'configurar'), ruta((req, res) => {
  const id = Number(req.params.barcoId);
  if (!Number.isInteger(id) || id < 0) throw new ErrorUsuario('Barco no válido');
  const barco = id ? verificarBarco(req, id) : null;
  const limpio = {};
  for (const [k, [min, max]] of Object.entries(LIMITES)) {
    const v = numero(req.body[k], { min, max, campo: k });
    if (v !== null) limpio[k] = v;
  }
  const efectivos = Object.assign({}, act.PARAMETROS_DEFECTO, id ? ajustesGuardados(req.usuario.empresa_id, 0) : {}, limpio);
  if (efectivos.pesca_min_kn >= efectivos.pesca_max_kn) {
    throw new ErrorUsuario('La velocidad mínima de pesca tiene que ser menor que la máxima');
  }
  if (efectivos.fondeo_max_kn >= efectivos.pesca_min_kn) {
    throw new ErrorUsuario('La velocidad de fondeado tiene que ser menor que la mínima de pesca');
  }
  db.ejecutar(
    `INSERT INTO seguimiento_parametros (empresa_id, barco_id, parametros) VALUES (?, ?, ?)
     ON CONFLICT (empresa_id, barco_id) DO UPDATE SET parametros = excluded.parametros`,
    req.usuario.empresa_id, id, JSON.stringify(limpio)
  );
  auditar(req, 'ajustar', 'seguimiento', id || null, barco ? barco.nombre : 'general');
  res.json({ ok: true });
}));

// ── Puertos ─────────────────────────────────────────────────────────

router.get('/puertos', requiere('seguimiento', 'ver'), ruta((req, res) => {
  res.json(puertosDe(req.usuario.empresa_id));
}));

function leerPuerto(b) {
  return {
    nombre: texto(b.nombre, { requerido: true, max: 80, campo: 'El nombre' }),
    lat: numero(b.lat, { requerido: true, min: -90, max: 90, campo: 'La latitud' }),
    lon: numero(b.lon, { requerido: true, min: -180, max: 180, campo: 'La longitud' }),
    radio_km: numero(b.radio_km, { min: 0.2, max: 30, campo: 'El radio' }) || 2.5,
  };
}

router.post('/puertos', requiere('seguimiento', 'configurar'), ruta((req, res) => {
  puertosDe(req.usuario.empresa_id); // asegura que estén los de fábrica antes de agregar
  const p = leerPuerto(req.body);
  const id = db.ejecutar('INSERT INTO seguimiento_puertos (empresa_id, nombre, lat, lon, radio_km) VALUES (?, ?, ?, ?, ?)',
    req.usuario.empresa_id, p.nombre, p.lat, p.lon, p.radio_km).id;
  auditar(req, 'crear', 'puerto', id, p.nombre);
  res.status(201).json({ id });
}));

router.put('/puertos/:id', requiere('seguimiento', 'configurar'), ruta((req, res) => {
  const p = leerPuerto(req.body);
  const r = db.ejecutar('UPDATE seguimiento_puertos SET nombre = ?, lat = ?, lon = ?, radio_km = ? WHERE id = ? AND empresa_id = ?',
    p.nombre, p.lat, p.lon, p.radio_km, idParam(req.params.id), req.usuario.empresa_id);
  if (!r.cambios) throw new ErrorUsuario('Puerto no encontrado', 404);
  auditar(req, 'editar', 'puerto', Number(req.params.id), p.nombre);
  res.json({ ok: true });
}));

router.delete('/puertos/:id', requiere('seguimiento', 'configurar'), ruta((req, res) => {
  const r = db.ejecutar('DELETE FROM seguimiento_puertos WHERE id = ? AND empresa_id = ?', idParam(req.params.id), req.usuario.empresa_id);
  if (!r.cambios) throw new ErrorUsuario('Puerto no encontrado', 404);
  auditar(req, 'borrar', 'puerto', Number(req.params.id));
  res.json({ ok: true });
}));

// ── Pasar lances detectados al parte de pesca ───────────────────────

/**
 * Crea en la marea abierta del barco los lances detectados que todavía no
 * están cargados. Un lance detectado que se superpone en el tiempo con uno
 * ya cargado se saltea (el cargado a mano manda). Después se renumeran por
 * hora de inicio, que es como se lee un parte.
 */
router.post('/barcos/:id/pasar-lances', requiere('seguimiento', 'ver'), requiere('pesca', 'cargar'), ruta((req, res) => {
  const b = verificarBarco(req, idParam(req.params.id));
  const m = db.uno(`SELECT * FROM mareas WHERE barco_id = ? AND empresa_id = ? AND estado = 'abierta'`, b.id, req.usuario.empresa_id);
  if (!m) throw new ErrorUsuario(`${b.nombre} no tiene una marea abierta en Partes de pesca`, 409);

  const desde = new Date(m.fecha_zarpada).getTime();
  const hasta = Date.now();
  if (hasta - desde > MAX_DIAS * 24 * HORA) throw new ErrorUsuario(`La marea abierta tiene más de ${MAX_DIAS} días: revisá la fecha de zarpada`);
  const r = calcular(req.usuario.empresa_id, b, desde, hasta);

  // Solo los que empezaron después de la zarpada y ya terminaron (el último
  // puede estar en curso: ese lo inicia el capitán o se pasa más tarde).
  const elegidos = Array.isArray(req.body.inicios) ? new Set(req.body.inicios.map(String)) : null;
  const ultimo = r.segmentos[r.segmentos.length - 1];
  const candidatos = r.lances.filter((l) =>
    new Date(l.inicio).getTime() >= desde &&
    !(ultimo && ultimo.estado === 'pescando' && ultimo.inicio === l.inicio) &&
    (!elegidos || elegidos.has(l.inicio)));

  const cargados = db.todos('SELECT id, inicio, fin FROM lances WHERE marea_id = ?', m.id);
  const pisa = (l) => cargados.some((c) => {
    const ci = c.inicio, cf = c.fin || new Date(hasta).toISOString();
    return l.inicio < cf && l.fin > ci;
  });
  const nuevos = candidatos.filter((l) => !pisa(l));
  if (!nuevos.length) return res.json({ creados: 0, salteados: candidatos.length });

  db.transaccion(() => {
    let n = (db.uno('SELECT MAX(numero) AS n FROM lances WHERE marea_id = ?', m.id).n || 0);
    for (const l of nuevos) {
      db.ejecutar(
        `INSERT INTO lances (marea_id, numero, inicio, fin, lat_inicio, lon_inicio, lat_fin, lon_fin,
           origen_pos_inicio, origen_pos_fin, observaciones)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'gps_barco', 'gps_barco', ?)`,
        m.id, ++n, l.inicio, l.fin, l.desde.lat, l.desde.lon, l.hasta.lat, l.hasta.lon,
        `Detectado por GPS: ${l.duracion_min} min, ${l.distancia_mn} mn a ${l.vel_media_kn} kn`
      );
    }
    // Renumerar por hora. En dos pasos por el UNIQUE (marea, número).
    const todos = db.todos('SELECT id FROM lances WHERE marea_id = ? ORDER BY inicio, id', m.id);
    todos.forEach((x, i) => db.ejecutar('UPDATE lances SET numero = ? WHERE id = ?', -(i + 1), x.id));
    db.ejecutar('UPDATE lances SET numero = -numero WHERE marea_id = ?', m.id);
  });
  auditar(req, 'pasar_lances', 'marea', m.id, `${nuevos.length} lances detectados por GPS`);
  res.json({ creados: nuevos.length, salteados: candidatos.length - nuevos.length, marea_id: m.id });
}));

module.exports = router;
