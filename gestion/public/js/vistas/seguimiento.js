/**
 * Seguimiento: dónde está cada barco y qué estuvo haciendo (pescando,
 * navegando, virada, a la capa, fondeado, en puerto), sacado del GPS.
 *
 * El mapa usa Leaflet (en /vendor, sin depender de otra página) y se carga
 * solo al entrar acá: el resto del panel no lo necesita.
 */

/* global App, UI, API, L */

(function () {
  const { h } = UI;

  const COLORES = {
    pescando: '#16a34a', virada: '#f59e0b', maniobra: '#eab308', navegando: '#2563eb',
    capa: '#9333ea', fondeado: '#0891b2', puerto: '#64748b', sin_datos: '#cbd5e1',
  };
  const NOMBRES = {
    pescando: 'Pescando', virada: 'Virada / largada', maniobra: 'Maniobra', navegando: 'Navegando',
    capa: 'A la capa', fondeado: 'Fondeado', puerto: 'En puerto', sin_datos: 'Sin datos',
  };
  const ORDEN = ['pescando', 'virada', 'navegando', 'capa', 'fondeado', 'puerto', 'sin_datos'];

  const HORA = 3600000;

  // ── Utilidades ──────────────────────────────────────────────────────

  let leafletCargado = null;
  function cargarLeaflet() {
    if (window.L) return Promise.resolve();
    if (leafletCargado) return leafletCargado;
    leafletCargado = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = '/vendor/leaflet/leaflet.css';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = '/vendor/leaflet/leaflet.js';
      s.onload = resolve;
      s.onerror = () => { leafletCargado = null; reject(new Error('No se pudo cargar el mapa')); };
      document.head.appendChild(s);
    });
    return leafletCargado;
  }

  function nuevoMapa(div) {
    const mapa = L.map(div, { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 17, attribution: '© OpenStreetMap',
    }).addTo(mapa);
    return mapa;
  }

  function insigniaEstado(estado, texto) {
    return h('span', { class: 'insignia-act', style: { background: COLORES[estado] || '#94a3b8' } }, texto || NOMBRES[estado] || estado);
  }

  /** 245 → "4 h 05 min" */
  function duracion(min) {
    if (min === null || min === undefined) return '—';
    min = Math.round(min);
    if (min < 60) return `${min} min`;
    const hs = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${hs} h ${String(m).padStart(2, '0')} min` : `${hs} h`;
  }

  function horas(hs) {
    if (!hs) return '0 h';
    return hs >= 10 ? `${Math.round(hs)} h` : `${UI.num(hs, 1)} h`;
  }

  function hace(iso) {
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'recién';
    if (min < 60) return `hace ${min} min`;
    if (min < 48 * 60) return `hace ${duracion(min)}`;
    return `hace ${Math.round(min / 1440)} días`;
  }

  function leyenda() {
    return h('div', { class: 'leyenda-act' }, ORDEN.map((e) => h('span', null,
      h('i', { style: { background: COLORES[e] } }), NOMBRES[e])));
  }

  // ── Flota ───────────────────────────────────────────────────────────

  App.ruta('/seguimiento', async (el) => {
    const barcos = await API.get('/api/seguimiento/barcos');
    el.appendChild(UI.cabecera('Seguimiento', {
      sub: 'Qué está haciendo cada barco, calculado con el GPS de a bordo',
      acciones: [App.puede('seguimiento', 'configurar') ? h('a', { class: 'btn', href: '#/seguimiento/ajustes' }, 'Ajustes y puertos') : null],
    }));

    const tarjetas = h('div', { class: 'grilla-barcos' });
    for (const b of barcos) {
      const a = b.actividad;
      const p = b.posicion;
      const r = p ? b.ultimas_12h : null; // sin posiciones no hay nada que resumir
      tarjetas.appendChild(h('a', { class: 'tarjeta barco-act', href: b.con_gps ? `#/seguimiento/${b.id}` : null },
        h('div', { class: 'barco-act-titulo' }, h('strong', null, b.nombre),
          a ? insigniaEstado(a.estado, a.puerto ? `En puerto · ${a.puerto}` : a.nombre) : insigniaEstado('sin_datos', b.con_gps ? 'Sin datos' : 'Sin GPS vinculado')),
        a && a.estado !== 'sin_datos' ? h('small', null, `desde ${UI.fechaHora(a.desde)} (${duracion((Date.now() - new Date(a.desde)) / 60000)})`) : null,
        p ? h('small', null, `Última posición ${hace(p.fecha)} · ${p.velocidad_kn != null ? UI.num(p.velocidad_kn, 1) + ' kn' : ''}`) : null,
        r ? h('div', { class: 'mini-resumen' },
          h('span', null, `Últimas 12 h: `),
          h('span', { style: { color: COLORES.pescando } }, `${horas(r.horas.pescando)} pescando`), ' · ',
          h('span', { style: { color: COLORES.navegando } }, `${horas(r.horas.navegando)} navegando`), ' · ',
          `${r.lances} lance${r.lances === 1 ? '' : 's'}`) : null,
        b.error ? h('small', { class: 'error' }, b.error) : null));
    }
    el.appendChild(tarjetas);

    const conPos = barcos.filter((b) => b.posicion);
    if (!conPos.length) return;
    const div = h('div', { class: 'mapa-act' });
    el.appendChild(UI.tarjeta('Posición actual', div, leyenda()));
    await cargarLeaflet();
    // El div tiene que estar en la página para que Leaflet mida el tamaño
    requestAnimationFrame(() => {
      const mapa = nuevoMapa(div);
      const limites = [];
      for (const b of conPos) {
        const est = b.actividad ? b.actividad.estado : 'sin_datos';
        const m = L.circleMarker([b.posicion.lat, b.posicion.lon], {
          radius: 8, color: '#fff', weight: 2, fillColor: COLORES[est], fillOpacity: 1,
        }).addTo(mapa);
        m.bindTooltip(`${b.nombre} · ${NOMBRES[est]}`, { permanent: true, direction: 'right', offset: [8, 0] });
        m.on('click', () => { location.hash = `#/seguimiento/${b.id}`; });
        limites.push([b.posicion.lat, b.posicion.lon]);
      }
      if (limites.length === 1) mapa.setView(limites[0], 8);
      else mapa.fitBounds(limites, { padding: [40, 40], maxZoom: 9 });
    });
  });

  // La ruta de ajustes va antes que '/seguimiento/:id' (la primera que coincide gana)
  App.ruta('/seguimiento/ajustes', async (el) => {
    const [barcos, puertos] = await Promise.all([API.get('/api/seguimiento/barcos'), API.get('/api/seguimiento/puertos')]);
    el.appendChild(UI.cabecera('Seguimiento · Ajustes', { volver: '#/seguimiento' }));

    el.appendChild(UI.tarjeta('Velocidades',
      h('p', { class: 'nota' }, 'Con qué velocidades se decide si un barco está pescando, navegando, virando o a la capa. ' +
        'Vienen pensadas para arrastre; cada barco se puede ajustar aparte (un tangonero o un potero pescan a otra velocidad).'),
      h('div', { class: 'acciones-fila' },
        UI.boton('General de la flota', () => ajustesBarco(null)),
        barcos.filter((b) => b.con_gps).map((b) => UI.boton(b.nombre, () => ajustesBarco(b))))));

    el.appendChild(UI.tarjeta('Puertos',
      h('p', { class: 'nota' }, 'Un barco lento o quieto dentro del radio de un puerto figura "En puerto". ' +
        'Las coordenadas de fábrica son aproximadas: corregilas o agregá las que uses.'),
      h('div', { class: 'acciones-fila' }, UI.boton('+ Agregar puerto', () => editarPuerto(null))),
      UI.tabla({
        columnas: [
          { titulo: 'Puerto', campo: 'nombre' },
          { titulo: 'Posición', valor: (p) => UI.coord(p.lat, p.lon) },
          { titulo: 'Radio', valor: (p) => `${UI.num(p.radio_km, 1)} km`, num: true },
        ],
        filas: puertos, alClick: (p) => editarPuerto(p), vacio: 'No hay puertos cargados',
      })));
  });

  // ── Detalle de un barco ─────────────────────────────────────────────

  const RANGOS = [
    { clave: '12h', texto: '12 h', horas: 12 }, { clave: '1d', texto: '24 h', horas: 24 },
    { clave: '3d', texto: '3 días', horas: 72 }, { clave: '7d', texto: '7 días', horas: 168 },
    { clave: '15d', texto: '15 días', horas: 360 }, { clave: '30d', texto: '30 días', horas: 720 },
  ];

  App.ruta('/seguimiento/:id', async (el, { id }) => {
    const q = App.query();
    const rango = RANGOS.find((r) => r.clave === q.rango) || (q.desde ? null : RANGOS[2]);
    const desde = q.desde ? new Date(q.desde) : new Date(Date.now() - rango.horas * HORA);
    const hasta = q.hasta ? new Date(q.hasta) : new Date();
    const d = await API.get(`/api/seguimiento/barcos/${id}` + API.qs({ desde: desde.toISOString(), hasta: hasta.toISOString() }));
    let enfocar = null; // se completa cuando el mapa está dibujado

    el.appendChild(UI.cabecera(`${d.barco.nombre} · Seguimiento`, {
      volver: '#/seguimiento',
      sub: `${UI.fechaHora(d.desde)} → ${UI.fechaHora(d.hasta)}`,
      acciones: [
        d.puede_configurar ? UI.boton('Ajustar velocidades', () => ajustesBarco(d.barco)) : null,
        d.puede_pasar_lances && d.lances.length ? UI.boton('Pasar lances al parte de pesca', () => pasarLances(d)) : null,
      ],
    }));

    // Selector de rango
    const irA = (params) => { location.hash = `#/seguimiento/${id}` + API.qs(params); };
    const inDesde = h('input', { type: 'datetime-local', value: UI.aInputFechaHora(d.desde) });
    const inHasta = h('input', { type: 'datetime-local', value: UI.aInputFechaHora(d.hasta) });
    el.appendChild(h('div', { class: 'filtros rango-act' },
      RANGOS.map((r) => h('button', {
        type: 'button', class: `btn chico ${rango && rango.clave === r.clave ? 'primario' : ''}`,
        onclick: () => irA({ rango: r.clave }),
      }, r.texto)),
      h('span', { class: 'separador' }),
      inDesde, inHasta,
      h('button', { type: 'button', class: 'btn chico', onclick: () => {
        if (!inDesde.value || !inHasta.value) return;
        irA({ desde: new Date(inDesde.value).toISOString(), hasta: new Date(inHasta.value).toISOString() });
      } }, 'Ver')));

    // Resumen
    const r = d.resumen;
    el.appendChild(h('div', { class: 'cifras' },
      UI.cifra(String(r.lances), 'lances'),
      UI.cifra(horas(r.horas.pescando), 'pescando', { tono: 'verde' }),
      UI.cifra(horas(r.horas.navegando), 'navegando'),
      UI.cifra(horas(r.horas.virada + (r.horas.maniobra || 0)), 'viradas y maniobras'),
      UI.cifra(horas(r.horas.capa), 'a la capa'),
      UI.cifra(horas(r.horas.fondeado + r.horas.puerto), 'fondeado / en puerto'),
      UI.cifra(`${UI.num(r.millas, 0)} mn`, 'recorridas'),
      r.horas.sin_datos >= 1 ? UI.cifra(horas(r.horas.sin_datos), 'sin datos', { tono: 'gris' }) : null));

    if (!d.segmentos.length) {
      el.appendChild(UI.tarjeta(null, h('p', null, 'No hay posiciones del GPS en este rango.')));
      return;
    }

    // Mapa
    const divMapa = h('div', { class: 'mapa-act grande' });
    el.appendChild(UI.tarjeta('Recorrido', divMapa, leyenda()));

    // Línea de tiempo por día
    el.appendChild(UI.tarjeta('Actividad por día', lineaDeTiempo(d)));

    // Lances
    const revisar = d.lances.filter((l) => l.revisar).length;
    el.appendChild(UI.tarjeta(`Lances detectados (${d.lances.length})`,
      revisar ? h('p', { class: 'aviso-inline' }, `${revisar} marcado(s) para revisar: son muy largos para un lance.`) : null,
      UI.tabla({
        columnas: [
          { titulo: 'N°', campo: 'numero', num: true },
          { titulo: 'Inicio', valor: (l) => UI.fechaHora(l.inicio) },
          { titulo: 'Fin', valor: (l) => UI.fechaHora(l.fin) },
          { titulo: 'Duración', valor: (l) => duracion(l.duracion_min) },
          { titulo: 'Distancia', valor: (l) => `${UI.num(l.distancia_mn, 1)} mn`, num: true },
          { titulo: 'Vel. media', valor: (l) => `${UI.num(l.vel_media_kn, 1)} kn`, num: true },
          { titulo: 'Rumbo', valor: (l) => (l.rumbo === null ? '—' : `${l.rumbo}°`), num: true },
          { titulo: 'Posición inicio', valor: (l) => UI.coord(l.desde.lat, l.desde.lon) },
          { titulo: 'Posición fin', valor: (l) => UI.coord(l.hasta.lat, l.hasta.lon) },
          { titulo: '', valor: (l) => (l.revisar ? h('span', { class: 'insignia naranja', title: l.revisar }, 'Revisar') : '') },
        ],
        filas: d.lances,
        alClick: (l) => enfocar && enfocar(l.inicio, l.fin),
        vacio: 'No se detectaron lances en este rango',
      })));

    // Detalle de actividad
    const tablaSeg = UI.tabla({
      columnas: [
        { titulo: 'Actividad', valor: (s) => insigniaEstado(s.estado, s.puerto ? `En puerto · ${s.puerto}` : s.nombre) },
        { titulo: 'Desde', valor: (s) => UI.fechaHora(s.inicio) },
        { titulo: 'Hasta', valor: (s) => UI.fechaHora(s.fin) },
        { titulo: 'Duración', valor: (s) => duracion(s.duracion_min) },
        { titulo: 'Distancia', valor: (s) => `${UI.num(s.distancia_mn, 1)} mn`, num: true },
        { titulo: 'Vel. media', valor: (s) => (s.estado === 'sin_datos' ? '—' : `${UI.num(s.vel_media_kn, 1)} kn`), num: true },
        { titulo: 'Rumbo', valor: (s) => (s.rumbo === null || s.estado === 'sin_datos' ? '—' : `${s.rumbo}°`), num: true },
      ],
      filas: d.segmentos.slice().reverse(),
      alClick: (s) => enfocar && enfocar(s.inicio, s.fin),
    });
    el.appendChild(h('details', { class: 'tarjeta' }, h('summary', null, h('strong', null, `Detalle de actividad (${d.segmentos.length} tramos)`)), tablaSeg));

    // Mareas detectadas (salida y vuelta a puerto)
    if (d.mareas.length) {
      el.appendChild(UI.tarjeta('Mareas detectadas', UI.tabla({
        columnas: [
          { titulo: 'Salida', valor: (m) => (m.salida ? UI.fechaHora(m.salida) : 'Antes del rango elegido') },
          { titulo: 'Llegada', valor: (m) => (m.llegada ? `${UI.fechaHora(m.llegada)} · ${m.puerto_llegada}` : 'En el mar') },
          { titulo: 'Lances', campo: 'lances', num: true },
          { titulo: 'Horas de pesca', valor: (m) => horas(m.horas_pesca), num: true },
          { titulo: 'Millas', valor: (m) => UI.num(m.millas, 0), num: true },
        ],
        filas: d.mareas.slice().reverse(),
      })));
    }

    el.appendChild(h('p', { class: 'nota' },
      'La actividad se calcula con la velocidad y el rumbo del GPS: es una estimación. Si algo no coincide con lo que pasó a bordo, ',
      d.puede_configurar ? 'ajustá las velocidades del barco.' : 'avisá a quien administra el sistema.'));

    // El mapa se arma cuando la página ya está en pantalla
    await cargarLeaflet();
    requestAnimationFrame(() => { enfocar = dibujarRecorrido(divMapa, d); });
  });

  /**
   * Recorrido coloreado por actividad. Devuelve una función para hacer zoom
   * a un tramo (se usa al tocar un lance o una fila del detalle).
   */
  function dibujarRecorrido(div, d) {
    const mapa = nuevoMapa(div);
    const pts = d.puntos; // [lat, lon, t, v, estado]
    const lineas = [];
    let actual = null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!actual || actual.estado !== p[4]) {
        // Cada línea arranca en el último punto de la anterior: sin cortes
        actual = { estado: p[4], coords: actual ? [actual.coords[actual.coords.length - 1]] : [] };
        lineas.push(actual);
      }
      actual.coords.push([p[0], p[1]]);
    }
    for (const l of lineas) {
      if (l.coords.length < 2) continue;
      L.polyline(l.coords, {
        color: COLORES[l.estado], weight: l.estado === 'pescando' ? 4 : 3,
        opacity: l.estado === 'sin_datos' ? 0.8 : 0.9, dashArray: l.estado === 'sin_datos' ? '6 6' : null,
      }).addTo(mapa).bindTooltip(NOMBRES[l.estado], { sticky: true });
    }
    // Número de lance en el punto donde empezó
    for (const l of d.lances) {
      L.marker([l.desde.lat, l.desde.lon], {
        icon: L.divIcon({ className: 'marca-lance', html: String(l.numero), iconSize: [22, 22] }),
      }).addTo(mapa).bindTooltip(`Lance ${l.numero} · ${UI.fechaHora(l.inicio)} · ${duracion(l.duracion_min)}`);
    }
    // Posición final: dónde está (o estaba) el barco
    const u = pts[pts.length - 1];
    if (u) {
      L.circleMarker([u[0], u[1]], { radius: 7, color: '#fff', weight: 2, fillColor: '#0f2a44', fillOpacity: 1 })
        .addTo(mapa).bindTooltip(`Última posición · ${UI.fechaHora(new Date(u[2]).toISOString())} · ${UI.num(u[3], 1)} kn`);
    }
    const todo = pts.map((p) => [p[0], p[1]]);
    if (todo.length) mapa.fitBounds(todo, { padding: [30, 30] });

    let resaltado = null;
    return (inicio, fin) => {
      const a = new Date(inicio).getTime(), b = new Date(fin).getTime();
      const sub = pts.filter((p) => p[2] >= a && p[2] <= b).map((p) => [p[0], p[1]]);
      if (!sub.length) return;
      if (resaltado) resaltado.remove();
      resaltado = L.polyline(sub, { color: '#111827', weight: 7, opacity: 0.35 }).addTo(mapa);
      mapa.fitBounds(sub, { padding: [60, 60], maxZoom: 13 });
      div.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
  }

  /** Una barra por día (hora local), con los tramos de actividad a escala. */
  function lineaDeTiempo(d) {
    const caja = h('div', { class: 'linea-tiempo' });
    const ini = new Date(d.desde);
    const primerDia = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate()).getTime();
    const fin = new Date(d.hasta).getTime();
    const segs = d.segmentos.map((s) => ({ s, a: new Date(s.inicio).getTime(), b: new Date(s.fin).getTime() }));
    const dias = [];
    for (let dia = primerDia; dia < fin; ) {
      const f = new Date(dia);
      const sig = new Date(f.getFullYear(), f.getMonth(), f.getDate() + 1).getTime(); // respeta cambios de hora
      dias.push([dia, sig]);
      dia = sig;
    }
    // Más reciente arriba: es lo primero que se quiere ver
    for (const [a, b] of dias.reverse()) {
      const barra = h('div', { class: 'lt-barra' });
      const largo = b - a;
      const hsDia = {};
      for (const x of segs) {
        const i = Math.max(a, x.a), j = Math.min(b, x.b);
        if (j <= i) continue;
        hsDia[x.s.estado] = (hsDia[x.s.estado] || 0) + (j - i) / HORA;
        barra.appendChild(h('span', {
          style: { left: `${((i - a) / largo) * 100}%`, width: `${((j - i) / largo) * 100}%`, background: COLORES[x.s.estado] },
          title: `${x.s.nombre} · ${UI.fechaHora(x.s.inicio)} → ${UI.fechaHora(x.s.fin)} (${duracion(x.s.duracion_min)})`,
        }));
      }
      const pesca = hsDia.pescando ? `${horas(hsDia.pescando)} pesca` : '';
      caja.appendChild(h('div', { class: 'lt-fila' },
        h('span', { class: 'lt-dia' }, new Date(a).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric' })),
        barra,
        h('span', { class: 'lt-total' }, pesca)));
    }
    caja.appendChild(h('div', { class: 'lt-fila lt-horas' }, h('span', { class: 'lt-dia' }),
      h('div', { class: 'lt-escala' }, ['0', '6', '12', '18', '24'].map((x) => h('span', null, x))), h('span', { class: 'lt-total' })));
    return caja;
  }

  // ── Pasar lances al parte de pesca ──────────────────────────────────

  async function pasarLances(d) {
    const ok = await UI.confirmar('Pasar lances al parte de pesca',
      `Se van a crear en la marea abierta de ${d.barco.nombre} los lances detectados desde la zarpada que todavía no estén cargados ` +
      '(con hora y posición de inicio y fin). Los que se superponen con un lance ya cargado se saltean. Las capturas se cargan después en cada lance.',
      { boton: 'Pasar lances' });
    if (!ok) return;
    const r = await API.post(`/api/seguimiento/barcos/${d.barco.id}/pasar-lances`, {});
    UI.aviso(r.creados
      ? `${r.creados} lance(s) creados${r.salteados ? `, ${r.salteados} ya estaban cargados` : ''}`
      : 'No había lances nuevos para pasar');
    if (r.marea_id) location.hash = `#/pesca/marea/${r.marea_id}`;
  }

  // ── Ajustes ─────────────────────────────────────────────────────────

  const CAMPOS = [
    { nombre: 'pesca_min_kn', etiqueta: 'Pesca: velocidad mínima (kn)', ayuda: 'Por debajo, el barco está lento (virada, capa o quieto)' },
    { nombre: 'pesca_max_kn', etiqueta: 'Pesca: velocidad máxima (kn)', ayuda: 'Por encima, está navegando' },
    { nombre: 'lance_min_min', etiqueta: 'Duración mínima de un lance (min)', ayuda: 'Un arrastre más corto cuenta como maniobra' },
    { nombre: 'virada_max_min', etiqueta: 'Duración máxima de una virada (min)', ayuda: 'Lento entre dos lances y más largo que esto: a la capa' },
    { nombre: 'fondeo_max_kn', etiqueta: 'Fondeado: velocidad máxima (kn)' },
    { nombre: 'fondeo_radio_m', etiqueta: 'Fondeado: radio máximo (m)', ayuda: 'Quieto dentro de este radio: fondeado. Si se mueve más, deriva (a la capa)' },
    { nombre: 'suavizado_min', etiqueta: 'Suavizado de la velocidad (min)', ayuda: 'Mediana de estos minutos: filtra los saltos del GPS' },
    { nombre: 'tramo_corto_min', etiqueta: 'Tramo mínimo (min)', ayuda: 'Un cambio más corto que esto no corta la actividad' },
    { nombre: 'corte_sin_datos_min', etiqueta: 'Hueco para "sin datos" (min)' },
    { nombre: 'lance_largo_h', etiqueta: 'Lance largo para revisar (h)' },
  ];

  /** Ventana con los umbrales. Vacío = usa el valor general. */
  async function ajustesBarco(barco) {
    const p = await API.get(`/api/seguimiento/parametros/${barco ? barco.id : 0}`);
    const propios = barco ? p.barco : p.empresa;
    const base = Object.assign({}, p.defecto, barco ? p.empresa : {});
    const f = UI.form(CAMPOS.map((c) => Object.assign({}, c, {
      tipo: 'number', ancho: 'medio',
      ayuda: `${c.ayuda ? c.ayuda + '. ' : ''}${barco ? 'General' : 'De fábrica'}: ${base[c.nombre]}`,
    })), propios);
    UI.modal({
      titulo: barco ? `Velocidades de ${barco.nombre}` : 'Velocidades generales de la flota',
      contenido: h('div', null,
        h('p', { class: 'nota' }, barco
          ? 'Dejá vacío lo que quieras que siga el valor general. Los cambios se aplican a toda la historia del barco.'
          : 'Valen para todos los barcos, salvo lo que se ajuste en cada uno.'),
        f.el),
      ancho: 'ancho',
      acciones: [{ texto: 'Cancelar' }, {
        texto: 'Guardar', tipo: 'primario',
        alClick: async (cerrar) => {
          await API.put(`/api/seguimiento/parametros/${barco ? barco.id : 0}`, f.valores());
          cerrar();
          UI.aviso('Ajustes guardados');
          App.recargar();
        },
      }],
    });
  }

  function editarPuerto(p) {
    const f = UI.form([
      { nombre: 'nombre', etiqueta: 'Nombre', requerido: true },
      { nombre: 'lat', etiqueta: 'Latitud', tipo: 'number', requerido: true, ancho: 'medio', ayuda: 'Negativa al sur. Ej: -38.045' },
      { nombre: 'lon', etiqueta: 'Longitud', tipo: 'number', requerido: true, ancho: 'medio', ayuda: 'Negativa al oeste. Ej: -57.535' },
      { nombre: 'radio_km', etiqueta: 'Radio (km)', tipo: 'number', ancho: 'medio' },
    ], p || { radio_km: 2.5 });
    UI.modal({
      titulo: p ? `Puerto ${p.nombre}` : 'Nuevo puerto', contenido: f.el,
      acciones: [
        p ? { texto: 'Borrar', tipo: 'peligro', alClick: async (cerrar) => {
          if (!(await UI.confirmar('Borrar puerto', `¿Borrar ${p.nombre}?`, { boton: 'Borrar', peligro: true }))) return;
          await API.del(`/api/seguimiento/puertos/${p.id}`); cerrar(); App.recargar();
        } } : null,
        { texto: 'Cancelar' },
        { texto: 'Guardar', tipo: 'primario', alClick: async (cerrar) => {
          if (p) await API.put(`/api/seguimiento/puertos/${p.id}`, f.valores());
          else await API.post('/api/seguimiento/puertos', f.valores());
          cerrar(); UI.aviso('Puerto guardado'); App.recargar();
        } },
      ].filter(Boolean),
    });
  }
}());
