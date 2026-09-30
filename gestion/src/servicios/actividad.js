/**
 * Actividad del barco a partir del GPS: pescando, navegando, virada,
 * a la capa, fondeado, en puerto.
 *
 * Los puntos vienen del panel de conectividad (API MIKRO), que guarda uno por
 * minuto aprox. con velocidad y rumbo. No se guarda nada nuevo: la actividad
 * se calcula cada vez que se pide, así un cambio en los umbrales se ve en el
 * acto sobre toda la historia.
 *
 * Idea general (pensada para arrastre, que es lo de Pesquera Atlántico Sur):
 *   1. La velocidad de cada punto se suaviza con la mediana de unos minutos
 *      alrededor: el GPS tira picos sueltos (un 7 kn en medio de un lance).
 *   2. Cada punto cae en una franja: lento / arrastre / navegación.
 *   3. Se arman tramos seguidos de la misma franja y los tramos cortos se
 *      absorben (un bajón de 3 minutos no corta un lance).
 *   4. Cada tramo se etiqueta mirando su duración, dónde está y qué tiene
 *      antes y después (lo lento entre dos lances es la virada).
 *
 * Todo lo que es número está en PARAMETROS_DEFECTO y se puede cambiar por
 * barco: un potero pesca casi quieto de noche y un tangonero a otra
 * velocidad que un arrastrero de fondo.
 */

const PARAMETROS_DEFECTO = {
  suavizado_min: 5,        // ventana de la mediana de velocidad
  fondeo_max_kn: 0.6,      // por debajo: quieto
  pesca_min_kn: 2.5,       // franja de arrastre
  pesca_max_kn: 5.5,
  lance_min_min: 30,       // un arrastre más corto no es un lance (es maniobra)
  virada_max_min: 90,      // lento entre dos lances y más corto que esto: virada
  tramo_corto_min: 8,      // tramos más cortos se absorben en los vecinos
  corte_sin_datos_min: 20, // un hueco mayor corta la historia ("sin datos")
  fondeo_radio_m: 600,     // quieto dentro de este radio: fondeado
  lance_largo_h: 8,        // un "lance" más largo se marca para revisar
};

/**
 * Puertos: si el barco está lento o quieto dentro del radio, está en puerto.
 * Coordenadas aproximadas de la boca/dársena; la empresa las corrige.
 */
const PUERTOS_DEFECTO = [
  { nombre: 'Mar del Plata', lat: -38.045, lon: -57.535, radio_km: 2.5 },
  { nombre: 'Quequén', lat: -38.575, lon: -58.705, radio_km: 2.5 },
  { nombre: 'Bahía Blanca', lat: -38.790, lon: -62.270, radio_km: 4 },
  { nombre: 'Puerto Madryn', lat: -42.765, lon: -65.030, radio_km: 3 },
  { nombre: 'Rawson', lat: -43.340, lon: -65.050, radio_km: 2 },
  { nombre: 'Caleta Paula', lat: -46.440, lon: -67.520, radio_km: 2 },
  { nombre: 'Puerto Deseado', lat: -47.755, lon: -65.900, radio_km: 3 },
  { nombre: 'Ushuaia', lat: -54.810, lon: -68.300, radio_km: 3 },
  { nombre: 'Montevideo', lat: -34.900, lon: -56.210, radio_km: 4 },
];

const ESTADOS = {
  pescando: 'Pescando',
  virada: 'Virada / largada',
  maniobra: 'Maniobra',
  navegando: 'Navegando',
  capa: 'A la capa',
  fondeado: 'Fondeado',
  puerto: 'En puerto',
  sin_datos: 'Sin datos',
};

const MIN = 60 * 1000;

// ---------- geometría ----------

/** Distancia en metros entre dos puntos (haversine). */
function distancia(a, b) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Rumbo medio (los ángulos no se promedian directo: 350° y 10° dan 0°). */
function rumboMedio(angulos) {
  let x = 0, y = 0, n = 0;
  for (const g of angulos) {
    if (g == null || !Number.isFinite(g)) continue;
    x += Math.cos(g * Math.PI / 180);
    y += Math.sin(g * Math.PI / 180);
    n++;
  }
  if (!n) return null;
  // Qué tan parejos son (1 = todos iguales, 0 = para cualquier lado)
  const constancia = Math.sqrt(x * x + y * y) / n;
  let r = Math.atan2(y, x) * 180 / Math.PI;
  if (r < 0) r += 360;
  return { rumbo: Math.round(r), constancia: Math.round(constancia * 100) / 100 };
}

function mediana(nums) {
  const a = nums.filter((v) => v != null && Number.isFinite(v)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function puertoDe(p, puertos) {
  for (const pu of puertos) {
    if (distancia(p, pu) <= pu.radio_km * 1000) return pu.nombre;
  }
  return null;
}

// ---------- preparación ----------

/**
 * Normaliza las filas de vessel_positions: fecha a milisegundos y, si falta
 * la velocidad (posiciones del portal), la calcula con el punto anterior.
 */
function prepararPuntos(filas) {
  const pts = [];
  for (const f of filas) {
    const lat = Number(f.lat), lon = Number(f.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    const t = new Date(String(f.reported_at).replace(' ', 'T') + (String(f.reported_at).endsWith('Z') ? '' : 'Z')).getTime();
    if (!Number.isFinite(t)) continue;
    pts.push({
      t, lat, lon,
      v: f.speed_kn != null ? Number(f.speed_kn) : null,
      rumbo: f.course_deg != null ? Number(f.course_deg) : null,
      proa: f.heading_deg != null ? Number(f.heading_deg) : null,
    });
  }
  pts.sort((a, b) => a.t - b.t);
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].v == null && i > 0) {
      const dt = (pts[i].t - pts[i - 1].t) / 3600000;
      pts[i].v = dt > 0 && dt < 0.5 ? distancia(pts[i - 1], pts[i]) / 1852 / dt : 0;
    }
    if (pts[i].v == null) pts[i].v = 0;
  }
  return pts;
}

/** Mediana de velocidad en una ventana de tiempo centrada en cada punto. */
function suavizar(pts, minutos) {
  const medio = (minutos * MIN) / 2;
  let ini = 0, fin = 0;
  const ventana = [];
  for (let i = 0; i < pts.length; i++) {
    while (pts[ini].t < pts[i].t - medio) ini++;
    while (fin < pts.length && pts[fin].t <= pts[i].t + medio) fin++;
    ventana.length = 0;
    for (let j = ini; j < fin; j++) ventana.push(pts[j].v);
    pts[i].vs = mediana(ventana);
  }
}

function franja(v, par) {
  if (v < par.pesca_min_kn) return 'L';      // lento o quieto
  if (v <= par.pesca_max_kn) return 'A';     // velocidad de arrastre
  return 'N';                                 // navegación
}

// ---------- tramos ----------

function nuevoTramo(clase, i) {
  return { clase, ini: i, fin: i };
}

/** Tramos seguidos de la misma franja. Un hueco grande abre un "sin datos". */
function armarTramos(pts, par) {
  const tramos = [];
  let actual = null;
  for (let i = 0; i < pts.length; i++) {
    const c = franja(pts[i].vs, par);
    const hueco = i > 0 && pts[i].t - pts[i - 1].t > par.corte_sin_datos_min * MIN;
    if (hueco) {
      if (actual) tramos.push(actual);
      tramos.push({ clase: 'X', ini: i - 1, fin: i }); // del último punto al primero después del hueco
      actual = nuevoTramo(c, i);
      continue;
    }
    if (!actual || actual.clase !== c) {
      if (actual) tramos.push(actual);
      // El tramo nuevo empieza en el último punto del anterior: así no quedan
      // minutos sin asignar entre tramos.
      actual = nuevoTramo(c, i > 0 ? i - 1 : i);
      actual.fin = i;
    } else {
      actual.fin = i;
    }
  }
  if (actual) tramos.push(actual);
  return tramos;
}

function duracionMin(pts, tr) {
  return (pts[tr.fin].t - pts[tr.ini].t) / MIN;
}

/**
 * Absorbe tramos cortos: siempre el más corto primero, así un bajón de dos
 * minutos dentro de un lance desaparece antes de decidir nada más.
 * Si los dos vecinos son de la misma clase se unen los tres; si no, el corto
 * se suma al vecino más largo. Nunca se cruza un "sin datos".
 */
function absorberCortos(pts, tramos, minMin) {
  for (;;) {
    let peor = -1, peorDur = Infinity;
    for (let k = 0; k < tramos.length; k++) {
      const tr = tramos[k];
      if (tr.clase === 'X') continue;
      const d = duracionMin(pts, tr);
      if (d >= minMin || d >= peorDur) continue;
      const prev = tramos[k - 1], next = tramos[k + 1];
      const hayPrev = prev && prev.clase !== 'X';
      const hayNext = next && next.clase !== 'X';
      if (!hayPrev && !hayNext) continue;
      peor = k; peorDur = d;
    }
    if (peor < 0) return tramos;
    const k = peor;
    const prev = tramos[k - 1] && tramos[k - 1].clase !== 'X' ? tramos[k - 1] : null;
    const next = tramos[k + 1] && tramos[k + 1].clase !== 'X' ? tramos[k + 1] : null;
    if (prev && next && prev.clase === next.clase) {
      prev.fin = next.fin;
      tramos.splice(k, 2);
    } else if (prev && (!next || duracionMin(pts, prev) >= duracionMin(pts, next))) {
      prev.fin = tramos[k].fin;
      tramos.splice(k, 1);
    } else {
      next.ini = tramos[k].ini;
      tramos.splice(k, 1);
    }
  }
}

// ---------- etiquetas ----------

function datosTramo(pts, tr) {
  const sub = pts.slice(tr.ini, tr.fin + 1);
  let dist = 0;
  for (let i = 1; i < sub.length; i++) dist += distancia(sub[i - 1], sub[i]);
  const centro = {
    lat: sub.reduce((s, p) => s + p.lat, 0) / sub.length,
    lon: sub.reduce((s, p) => s + p.lon, 0) / sub.length,
  };
  const radio = Math.max(0, ...sub.map((p) => distancia(p, centro)));
  const rm = rumboMedio(sub.filter((p) => p.v > 1).map((p) => p.rumbo));
  return {
    sub, dist, centro, radio,
    vMediana: mediana(sub.map((p) => p.v)) || 0,
    vMedia: sub.length ? sub.reduce((s, p) => s + p.v, 0) / sub.length : 0,
    rumbo: rm ? rm.rumbo : null,
    constancia: rm ? rm.constancia : null,
  };
}

/**
 * Etiqueta cada tramo. El orden de las preguntas importa: primero "¿está en
 * puerto?", porque un barco atracado también está quieto y lento.
 */
function etiquetar(pts, tramos, par, puertos) {
  const segs = tramos.map((tr) => {
    const d = datosTramo(pts, tr);
    return { tr, d, dur: duracionMin(pts, tr) };
  });

  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    const { clase } = s.tr;
    if (clase === 'X') { s.estado = 'sin_datos'; continue; }
    if (clase === 'N') {
      s.estado = puertoDe(s.d.centro, puertos) ? 'puerto' : 'navegando';
      continue;
    }
    if (clase === 'A') {
      s.estado = s.dur >= par.lance_min_min ? 'pescando' : 'maniobra';
      continue;
    }
    // Lento o quieto
    const puerto = puertoDe(s.d.centro, puertos);
    if (puerto) { s.estado = 'puerto'; s.puerto = puerto; continue; }
    if (s.d.vMediana < par.fondeo_max_kn && s.d.radio <= par.fondeo_radio_m) {
      s.estado = 'fondeado'; continue;
    }
    s.estado = 'capa'; // se revisa abajo: entre dos lances es virada
  }

  // Lo lento entre dos lances (o antes del primero de una serie) es la
  // maniobra de pesca: virar la red y volver a largarla.
  const esPesca = (x) => x && (x.estado === 'pescando' || x.estado === 'maniobra');
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    if (s.estado !== 'capa' || s.dur > par.virada_max_min) continue;
    if (esPesca(segs[k - 1]) && esPesca(segs[k + 1])) s.estado = 'virada';
    else if (esPesca(segs[k - 1]) || esPesca(segs[k + 1])) {
      // Al final o al principio de una serie de lances: también es virada si
      // es corto (menos de una hora), si no se queda como capa.
      if (s.dur <= 60) s.estado = 'virada';
    }
  }
  // Una maniobra (arrastre corto) pegada a viradas es parte de la virada
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    if (s.estado !== 'maniobra') continue;
    const v = (x) => x && x.estado === 'virada';
    if (v(segs[k - 1]) || v(segs[k + 1])) s.estado = 'virada';
  }
  return segs;
}

/** Une segmentos vecinos con la misma etiqueta (dos "virada" seguidas, etc.). */
function unirIguales(pts, segs) {
  const out = [];
  for (const s of segs) {
    const u = out[out.length - 1];
    if (u && u.estado === s.estado && s.estado !== 'sin_datos') {
      u.tr = { clase: u.tr.clase, ini: u.tr.ini, fin: s.tr.fin };
      u.d = datosTramo(pts, u.tr);
      u.dur = duracionMin(pts, u.tr);
    } else {
      out.push(s);
    }
  }
  return out;
}

// ---------- salida ----------

const r1 = (x) => Math.round(x * 10) / 10;
const iso = (t) => new Date(t).toISOString();

/**
 * Clasifica una lista de filas de vessel_positions.
 * Devuelve segmentos (la línea de tiempo), lances y un resumen por estado.
 */
function clasificar(filas, parametros = {}, puertos = PUERTOS_DEFECTO) {
  const par = Object.assign({}, PARAMETROS_DEFECTO, parametros || {});
  const pts = prepararPuntos(filas);
  if (pts.length < 2) return { parametros: par, segmentos: [], lances: [], resumen: resumir([]), puntos: [] };

  suavizar(pts, par.suavizado_min);
  let tramos = armarTramos(pts, par);
  tramos = absorberCortos(pts, tramos, par.tramo_corto_min);
  let segs = etiquetar(pts, tramos, par, puertos);
  segs = unirIguales(pts, segs);

  const segmentos = segs.map((s) => {
    const a = pts[s.tr.ini], b = pts[s.tr.fin];
    const seg = {
      estado: s.estado,
      nombre: ESTADOS[s.estado],
      inicio: iso(a.t), fin: iso(b.t),
      duracion_min: Math.round(s.dur),
      distancia_mn: r1(s.d.dist / 1852),
      vel_media_kn: r1(s.d.vMedia),
      vel_mediana_kn: r1(s.d.vMediana),
      rumbo: s.d.rumbo,
      constancia_rumbo: s.d.constancia,
      desde: { lat: a.lat, lon: a.lon },
      hasta: { lat: b.lat, lon: b.lon },
      ini: s.tr.ini, fin_idx: s.tr.fin,
    };
    if (s.estado === 'puerto') seg.puerto = s.puerto || puertoDe(s.d.centro, puertos);
    if (s.estado === 'pescando' && s.dur > par.lance_largo_h * 60) {
      seg.revisar = 'Muy largo para un lance: puede ser navegación lenta o lances sin virada marcada';
    }
    return seg;
  });

  let n = 0;
  const lances = segmentos
    .filter((s) => s.estado === 'pescando')
    .map((s) => ({
      numero: ++n,
      inicio: s.inicio, fin: s.fin,
      duracion_min: s.duracion_min,
      distancia_mn: s.distancia_mn,
      vel_media_kn: s.vel_media_kn,
      rumbo: s.rumbo,
      desde: s.desde, hasta: s.hasta,
      revisar: s.revisar || null,
    }));

  return {
    parametros: par,
    segmentos,
    lances,
    resumen: resumir(segmentos),
    // Puntos livianos para dibujar el track (índice de segmento incluido)
    puntos: puntosTrack(pts, segmentos),
  };
}

function resumir(segmentos) {
  const horas = {};
  for (const k of Object.keys(ESTADOS)) horas[k] = 0;
  let millas = 0;
  for (const s of segmentos) {
    horas[s.estado] += s.duracion_min / 60;
    if (s.estado !== 'sin_datos') millas += s.distancia_mn;
  }
  for (const k of Object.keys(horas)) horas[k] = r1(horas[k]);
  return {
    horas,
    millas: Math.round(millas),
    lances: segmentos.filter((s) => s.estado === 'pescando').length,
  };
}

/**
 * Puntos para el mapa, con el estado del segmento al que pertenecen. Se
 * reducen a uno cada 2 minutos: una marea de 15 días son 20.000 puntos y el
 * navegador del celular a bordo no los necesita todos.
 */
function puntosTrack(pts, segmentos) {
  const out = [];
  let ultimo = -Infinity;
  for (const seg of segmentos) {
    for (let i = seg.ini; i <= seg.fin_idx; i++) {
      const p = pts[i];
      const bordeSeg = i === seg.ini || i === seg.fin_idx;
      if (!bordeSeg && p.t - ultimo < 2 * MIN) continue;
      out.push([Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5, p.t, r1(p.v), seg.estado]);
      ultimo = p.t;
    }
  }
  return out;
}

/**
 * Mareas detectadas: de una salida de puerto a la vuelta siguiente. Sirve
 * para proponer las fechas de la marea en el parte de pesca.
 */
function mareasDetectadas(segmentos) {
  const mareas = [];
  let actual = null;
  let vistoPuerto = false; // sin puerto antes, la salida quedó fuera del rango
  for (const s of segmentos) {
    if (s.estado === 'puerto') {
      vistoPuerto = true;
      if (actual) { actual.llegada = s.inicio; actual.puerto_llegada = s.puerto; mareas.push(actual); actual = null; }
      continue;
    }
    // Un hueco de datos con el barco en puerto (router apagado en muelle) no
    // es una salida: la marea arranca con el primer movimiento real.
    if (!actual && s.estado === 'sin_datos') continue;
    if (!actual) {
      actual = { salida: vistoPuerto ? s.inicio : null, llegada: null, lances: 0, horas_pesca: 0, millas: 0 };
    }
    if (s.estado === 'pescando') { actual.lances++; actual.horas_pesca += s.duracion_min / 60; }
    if (s.estado !== 'sin_datos') actual.millas += s.distancia_mn;
  }
  if (actual) mareas.push(actual); // en curso
  for (const m of mareas) { m.horas_pesca = r1(m.horas_pesca); m.millas = Math.round(m.millas); }
  return mareas;
}

module.exports = {
  PARAMETROS_DEFECTO, PUERTOS_DEFECTO, ESTADOS,
  clasificar, mareasDetectadas, distancia,
};
