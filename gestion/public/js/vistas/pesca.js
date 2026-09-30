/**
 * Partes de pesca y víveres.
 */

/* global App, UI, API */

(function () {
  const { h } = UI;

  App.ruta('/pesca', async (el) => {
    const q = App.query();
    const mareas = await API.get('/api/pesca/mareas' + API.qs({ barco_id: q.barco }));
    el.appendChild(UI.cabecera('Partes de pesca', {
      acciones: [App.puede('pesca', 'cargar') ? h('a', { class: 'btn primario', href: '#/pesca/nueva' }, '+ Abrir marea') : null],
    }));
    el.appendChild(h('div', { class: 'filtros' }, UI.select(App.barcos.map((b) => ({ valor: b.id, texto: b.nombre })), q.barco || '',
      (v) => { location.hash = '#/pesca' + API.qs({ barco: v }); }, { vacio: 'Todos los barcos' })));
    el.appendChild(UI.tarjeta(null, UI.tabla({
      columnas: [
        { titulo: 'Barco', campo: 'barco' }, { titulo: 'Marea', campo: 'numero' },
        { titulo: 'Estado', valor: (m) => UI.estado(m.estado === 'abierta' ? 'abierta' : 'cerrada_marea') },
        { titulo: 'Zarpada', valor: (m) => `${UI.fecha(m.fecha_zarpada)} · ${m.puerto_zarpada}` },
        { titulo: 'Arribo', valor: (m) => (m.fecha_arribo ? `${UI.fecha(m.fecha_arribo)} · ${m.puerto_arribo}` : '') },
        { titulo: 'Lances', campo: 'lances', num: true },
        { titulo: 'Captura', valor: (m) => [m.kg ? `${UI.num(m.kg, 0)} kg` : null, m.cajones ? `${UI.num(m.cajones, 0)} cajones` : null].filter(Boolean).join(' + '), num: true },
      ],
      filas: mareas, alClick: (m) => { location.hash = `#/pesca/marea/${m.id}`; }, vacio: 'Todavía no hay mareas cargadas',
    })));
  });

  App.ruta('/pesca/nueva', async (el) => {
    const listas = await App.obtenerListas();
    el.classList.add('a-bordo');
    el.appendChild(UI.cabecera('Abrir marea', { volver: '#/pesca' }));
    const f = UI.form([
      { nombre: 'barco_id', etiqueta: 'Barco', tipo: 'select', requerido: true, opciones: App.barcos.map((b) => ({ valor: b.id, texto: b.nombre })), defecto: App.barcos.length === 1 ? App.barcos[0].id : '' },
      { nombre: 'puerto_zarpada', etiqueta: 'Puerto de zarpada', tipo: 'select', requerido: true, opciones: listas.puerto.map((p) => p.valor), defecto: 'Mar del Plata' },
      { nombre: 'fecha_zarpada', etiqueta: 'Zarpada', tipo: 'datetime', defecto: new Date().toISOString(), ancho: 'medio' },
      { nombre: 'tripulantes', etiqueta: 'Tripulantes', tipo: 'number', ancho: 'medio' },
      { nombre: 'especie_objetivo', etiqueta: 'Especie objetivo', tipo: 'select', opciones: listas.especie.map((p) => p.valor) },
      { nombre: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea', filas: 2 },
    ]);
    el.appendChild(UI.tarjeta(null, f.el, h('div', { class: 'acciones-fila' }, UI.boton('Abrir marea', async () => {
      const r = await API.post('/api/pesca/mareas', f.valores());
      location.hash = `#/pesca/marea/${r.id}`;
    }, 'primario grande'))));
  });

  const origenPos = { gps_barco: 'GPS del barco', telefono: 'GPS del teléfono', manual: 'manual' };

  App.ruta('/pesca/marea/:id', async (el, { id }) => {
    const [m, listas] = await Promise.all([API.get(`/api/pesca/mareas/${id}`), App.obtenerListas()]);
    const abierta = m.estado === 'abierta';
    const cargar = App.puede('pesca', 'cargar') && abierta;
    const enCurso = m.lances.find((l) => !l.fin);
    el.classList.add('a-bordo');

    el.appendChild(UI.cabecera(`${m.barco} · Marea ${m.numero}`, {
      volver: '#/pesca', sub: `Zarpó ${UI.fechaHora(m.fecha_zarpada)} de ${m.puerto_zarpada}${m.fecha_arribo ? ` · Arribó ${UI.fechaHora(m.fecha_arribo)} a ${m.puerto_arribo}` : ''}`,
      acciones: [
        h('a', { class: 'btn', href: `#/pesca/marea/${m.id}/parte` }, 'Parte para imprimir'),
        cargar ? UI.boton('Cerrar marea', () => cerrarMarea(m, listas)) : null,
      ],
    }));

    if (cargar) {
      const bloque = enCurso
        ? h('div', { class: 'lance-activo' },
          h('div', null, h('strong', null, `Lance ${enCurso.numero} en curso`), h('small', null, ` desde ${UI.fechaHora(enCurso.inicio)} · ${UI.coord(enCurso.lat_inicio, enCurso.lon_inicio)}`)),
          UI.boton('Terminar lance', async () => {
            const pos = await UI.posicionTelefono();
            const r = await API.post(`/api/pesca/lances/${enCurso.id}/terminar`, { posicion: pos });
            UI.aviso(`Lance terminado · posición: ${origenPos[r.posicion.origen]}${r.posicion.lat === null ? ' (sin datos, cargala a mano)' : ''}`);
            App.recargar();
          }, 'primario grande'))
        : h('div', { class: 'lance-activo' }, UI.boton('Iniciar lance', () => iniciarLance(m, listas), 'primario grande'));
      el.appendChild(bloque);
    }

    el.appendChild(h('div', { class: 'datos' },
      UI.dato('Días', m.dias), UI.dato('Lances', m.lances.length), UI.dato('Tripulantes', m.tripulantes || '—'),
      UI.dato('Especie objetivo', m.especie_objetivo || '—'), UI.dato('Capitán', m.capitan || '—')));

    el.appendChild(UI.tarjeta('Captura total', UI.tabla({
      columnas: [{ titulo: 'Especie', campo: 'especie' }, { titulo: 'Cantidad', valor: (t) => `${UI.num(t.cantidad, 1)} ${t.unidad}`, num: true },
        { titulo: 'Descarte', valor: (t) => UI.num(t.descarte, 1), num: true }],
      filas: m.totales, vacio: 'Sin capturas cargadas',
    })));

    for (const l of [...m.lances].reverse()) {
      el.appendChild(UI.tarjeta(`Lance ${l.numero}`,
        h('div', { class: 'datos' },
          UI.dato('Inicio', `${UI.fechaHora(l.inicio)}`), UI.dato('Posición inicio', `${UI.coord(l.lat_inicio, l.lon_inicio)} (${origenPos[l.origen_pos_inicio]})`),
          UI.dato('Fin', l.fin ? UI.fechaHora(l.fin) : 'en curso'), UI.dato('Posición fin', l.fin ? `${UI.coord(l.lat_fin, l.lon_fin)} (${origenPos[l.origen_pos_fin]})` : '—'),
          UI.dato('Duración', l.fin ? `${UI.num((new Date(l.fin) - new Date(l.inicio)) / 3600000, 1)} h` : '—'),
          UI.dato('Profundidad', l.profundidad !== null ? `${UI.num(l.profundidad, 0)} m` : '—'), UI.dato('Arte', l.arte || '—')),
        l.observaciones ? h('p', { class: 'sub' }, l.observaciones) : null,
        UI.tabla({
          columnas: [
            { titulo: 'Especie', campo: 'especie' }, { titulo: 'Cantidad', valor: (c) => `${UI.num(c.cantidad, 1)} ${c.unidad}`, num: true },
            { titulo: 'Descarte', valor: (c) => UI.num(c.descarte, 1), num: true },
            cargar ? { titulo: '', valor: (c) => UI.boton('Quitar', async () => {
              if (!await UI.confirmar('Quitar captura', `${c.especie}: ${c.cantidad} ${c.unidad}`, { peligro: true, boton: 'Quitar' })) return;
              await API.del(`/api/pesca/capturas/${c.id}`); App.recargar();
            }, 'chico') } : null,
          ].filter(Boolean),
          filas: l.capturas, vacio: 'Sin capturas',
        }),
        cargar ? h('div', { class: 'acciones-fila' },
          UI.boton('+ Captura', () => agregarCaptura(l, listas), 'primario'),
          UI.boton('Corregir lance', () => editarLance(l, listas))) : null));
    }
  });

  function iniciarLance(m, listas) {
    const f = UI.form([
      { nombre: 'arte', etiqueta: 'Arte de pesca', tipo: 'select', opciones: listas.arte.map((a) => a.valor) },
      { nombre: 'profundidad', etiqueta: 'Profundidad (m)', tipo: 'number' },
    ]);
    UI.modal({
      titulo: 'Iniciar lance', contenido: h('div', null, f.el, h('p', { class: 'sub' }, 'La hora y la posición se toman solas: del GPS del barco o, si no hay, del teléfono.')),
      acciones: [{ texto: 'Cancelar' }, { texto: 'Iniciar', tipo: 'primario', alClick: async (c) => {
        const pos = await UI.posicionTelefono();
        const r = await API.post(`/api/pesca/mareas/${m.id}/lances`, { ...f.valores(), posicion: pos });
        c(); UI.aviso(`Lance ${r.numero} iniciado · posición: ${origenPos[r.posicion.origen]}${r.posicion.lat === null ? ' (sin datos, cargala a mano)' : ''}`);
        App.recargar();
      } }],
    });
  }

  function agregarCaptura(l, listas) {
    const f = UI.form([
      { nombre: 'especie', etiqueta: 'Especie', tipo: 'select', requerido: true, opciones: listas.especie.map((a) => a.valor) },
      { nombre: 'cantidad', etiqueta: 'Cantidad', tipo: 'number', requerido: true, ancho: 'medio' },
      { nombre: 'unidad', etiqueta: 'Unidad', tipo: 'select', vacio: false, ancho: 'medio', opciones: [{ valor: 'kg', texto: 'kg' }, { valor: 'cajones', texto: 'cajones' }] },
      { nombre: 'descarte', etiqueta: 'Descarte (misma unidad)', tipo: 'number' },
    ]);
    UI.modal({
      titulo: `Captura del lance ${l.numero}`, contenido: f.el,
      acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', tipo: 'primario', alClick: async (c) => {
        await API.post(`/api/pesca/lances/${l.id}/capturas`, f.valores()); c(); App.recargar();
      } }],
    });
  }

  function editarLance(l, listas) {
    const f = UI.form([
      { nombre: 'inicio', etiqueta: 'Inicio', tipo: 'datetime', requerido: true, ancho: 'medio' },
      { nombre: 'fin', etiqueta: 'Fin', tipo: 'datetime', ancho: 'medio' },
      { nombre: 'lat_inicio', etiqueta: 'Latitud inicio', tipo: 'number', ancho: 'medio', ayuda: 'Decimal, sur negativo (ej.: -38.1234)' },
      { nombre: 'lon_inicio', etiqueta: 'Longitud inicio', tipo: 'number', ancho: 'medio', ayuda: 'Oeste negativo (ej.: -57.5432)' },
      { nombre: 'lat_fin', etiqueta: 'Latitud fin', tipo: 'number', ancho: 'medio' },
      { nombre: 'lon_fin', etiqueta: 'Longitud fin', tipo: 'number', ancho: 'medio' },
      { nombre: 'profundidad', etiqueta: 'Profundidad (m)', tipo: 'number', ancho: 'medio' },
      { nombre: 'arte', etiqueta: 'Arte', tipo: 'select', ancho: 'medio', opciones: listas.arte.map((a) => a.valor) },
      { nombre: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea', filas: 2 },
    ], l);
    UI.modal({
      titulo: `Corregir lance ${l.numero}`, contenido: f.el, ancho: 'ancho',
      acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', tipo: 'primario', alClick: async (c) => {
        await API.put(`/api/pesca/lances/${l.id}`, f.valores()); c(); App.recargar();
      } }],
    });
  }

  function cerrarMarea(m, listas) {
    const f = UI.form([
      { nombre: 'puerto_arribo', etiqueta: 'Puerto de arribo', tipo: 'select', requerido: true, opciones: listas.puerto.map((p) => p.valor), defecto: m.puerto_zarpada },
      { nombre: 'fecha_arribo', etiqueta: 'Arribo', tipo: 'datetime', defecto: new Date().toISOString() },
      { nombre: 'observaciones', etiqueta: 'Observaciones', tipo: 'textarea', filas: 2 },
    ], { observaciones: m.observaciones });
    UI.modal({
      titulo: `Cerrar marea ${m.numero}`, contenido: f.el,
      acciones: [{ texto: 'Cancelar' }, { texto: 'Cerrar marea', tipo: 'primario', alClick: async (c) => {
        await API.post(`/api/pesca/mareas/${m.id}/cerrar`, f.valores()); c(); UI.aviso('Marea cerrada'); App.recargar();
      } }],
    });
  }

  /** Parte de pesca para imprimir o guardar en PDF. */
  App.ruta('/pesca/marea/:id/parte', async (el, { id }) => {
    const m = await API.get(`/api/pesca/mareas/${id}`);
    el.classList.add('documento');
    el.appendChild(h('div', { class: 'no-imprimir acciones-fila' },
      h('a', { class: 'btn', href: `#/pesca/marea/${m.id}` }, '← Volver'), UI.boton('Imprimir / guardar PDF', () => window.print(), 'primario')));
    el.appendChild(h('div', { class: 'hoja' },
      h('div', { class: 'hoja-cab' }, h('div', null, h('h1', null, 'Parte de pesca'), h('p', null, App.sesion.empresa.nombre)),
        h('div', { class: 'derecha' }, h('h2', null, `${m.barco}`), h('p', null, `${m.matricula ? `Matrícula ${m.matricula} · ` : ''}Marea ${m.numero}`))),
      h('div', { class: 'hoja-datos' },
        h('div', null, h('strong', null, 'Zarpada: '), `${UI.fechaHora(m.fecha_zarpada)} — ${m.puerto_zarpada}`),
        h('div', null, h('strong', null, 'Arribo: '), m.fecha_arribo ? `${UI.fechaHora(m.fecha_arribo)} — ${m.puerto_arribo}` : 'en curso'),
        h('div', null, h('strong', null, 'Capitán: '), m.capitan || '—', ' · ', h('strong', null, 'Tripulantes: '), m.tripulantes || '—'),
        h('div', null, h('strong', null, 'Especie objetivo: '), m.especie_objetivo || '—')),
      h('h3', null, 'Lances'),
      h('table', { class: 'tabla hoja-tabla' },
        h('thead', null, h('tr', null, ['N°', 'Inicio', 'Pos. inicio', 'Fin', 'Pos. fin', 'Prof. (m)', 'Arte', 'Captura'].map((x) => h('th', null, x)))),
        h('tbody', null, m.lances.map((l) => h('tr', null,
          h('td', null, l.numero), h('td', null, UI.fechaHora(l.inicio)), h('td', null, UI.coord(l.lat_inicio, l.lon_inicio)),
          h('td', null, UI.fechaHora(l.fin)), h('td', null, UI.coord(l.lat_fin, l.lon_fin)), h('td', null, UI.num(l.profundidad, 0)),
          h('td', null, l.arte), h('td', null, l.capturas.map((c) => `${c.especie}: ${UI.num(c.cantidad, 1)} ${c.unidad}`).join('; ')))))),
      h('h3', null, 'Totales por especie'),
      h('table', { class: 'tabla hoja-tabla' },
        h('thead', null, h('tr', null, ['Especie', 'Cantidad', 'Descarte'].map((x) => h('th', null, x)))),
        h('tbody', null, m.totales.map((t) => h('tr', null, h('td', null, t.especie), h('td', null, `${UI.num(t.cantidad, 1)} ${t.unidad}`), h('td', null, UI.num(t.descarte, 1)))))),
      m.observaciones ? h('p', null, h('strong', null, 'Observaciones: '), m.observaciones) : null,
      h('div', { class: 'firmas' }, h('div', null, 'Firma del capitán'))));
  });

  // ── Víveres ────────────────────────────────────────────────────────

  App.ruta('/viveres', async (el) => {
    const mareas = await API.get('/api/viveres/mareas');
    el.appendChild(UI.cabecera('Víveres por marea', { sub: 'Los víveres son los artículos de stock de la categoría "Víveres".' }));
    el.appendChild(UI.tarjeta(null, UI.tabla({
      columnas: [
        { titulo: 'Barco', campo: 'barco' }, { titulo: 'Marea', campo: 'numero' },
        { titulo: 'Estado', valor: (m) => (m.viveres_cerrados ? h('span', { class: 'insignia verde' }, 'Cerrado') : UI.estado(m.estado === 'abierta' ? 'abierta' : 'pendiente')) },
        { titulo: 'Zarpada', valor: (m) => UI.fecha(m.fecha_zarpada) }, { titulo: 'Días', campo: 'dias', num: true },
        { titulo: 'Tripulantes', campo: 'tripulantes', num: true }, { titulo: 'Consumo', valor: (m) => UI.pesos(m.costo_consumo), num: true },
        { titulo: 'Por día', valor: (m) => UI.pesos(m.costo_dia), num: true },
        { titulo: 'Por tripulante/día', valor: (m) => UI.pesos(m.costo_tripulante_dia), num: true },
      ],
      filas: mareas, alClick: (m) => { location.hash = `#/viveres/marea/${m.id}`; }, vacio: 'No hay mareas. Se abren desde Partes de pesca.',
    })));
  });

  App.ruta('/viveres/marea/:id', async (el, { id }) => {
    const m = await API.get(`/api/viveres/mareas/${id}`);
    const cargar = App.puede('viveres', 'cargar') && !m.viveres_cerrados;
    el.appendChild(UI.cabecera(`Víveres · ${m.barco} · Marea ${m.numero}`, {
      volver: '#/viveres', sub: `${m.dias} días${m.tripulantes ? ` · ${m.tripulantes} tripulantes` : ''}`,
      acciones: [
        cargar ? UI.boton('Cargar víveres al barco', () => cargarViveres(m), 'primario') : null,
        cargar ? UI.boton('Cierre: contar lo que sobró', () => cerrarViveres(m)) : null,
      ],
    }));
    el.appendChild(h('div', { class: 'cifras' },
      UI.cifra(UI.pesos(m.costo_consumo), 'consumo de la marea'),
      UI.cifra(UI.pesos(m.costo_consumo / m.dias), 'por día'),
      m.tripulantes ? UI.cifra(UI.pesos(m.costo_consumo / m.dias / m.tripulantes), 'por tripulante por día') : null));
    el.appendChild(UI.tarjeta(null, UI.tabla({
      columnas: [
        { titulo: 'Artículo', valor: (i) => `${i.codigo} — ${i.descripcion}` },
        { titulo: 'Cargado en la marea', valor: (i) => `${UI.num(i.cargado, 3)} ${i.unidad}`, num: true },
        { titulo: 'A bordo ahora', valor: (i) => `${UI.num(i.a_bordo, 3)} ${i.unidad}`, num: true },
        { titulo: 'Consumido', valor: (i) => `${UI.num(i.consumido, 3)} ${i.unidad}`, num: true },
        { titulo: 'Costo', valor: (i) => UI.pesos(i.costo), num: true },
      ],
      filas: m.items, vacio: 'Todavía no se cargaron víveres para esta marea',
    })));
  });

  async function cargarViveres(m) {
    const [deps, arts] = await Promise.all([API.get('/api/stock/depositos'), App.articulos()]);
    const viveres = arts.filter((a) => a.categoria === 'Víveres');
    const origen = UI.select(deps.filter((d) => d.id !== m.deposito_id).map((d) => ({ valor: d.id, texto: `Desde ${d.nombre}` })),
      deps.find((d) => d.tipo === 'tierra') ? deps.find((d) => d.tipo === 'tierra').id : '', () => pintar(), { vacio: 'Compra directa (no sale de un depósito)' });
    const zona = h('div');
    let items;
    const pintar = () => {
      UI.vaciar(zona);
      items = UI.itemsArticulos({ articulos: viveres, extra: origen.value ? null : { campo: 'costo_unitario', etiqueta: 'Costo unit. $' } });
      zona.appendChild(items.el);
    };
    pintar();
    UI.modal({
      titulo: `Cargar víveres · Marea ${m.numero}`, ancho: 'ancho',
      contenido: h('div', null, h('div', { class: 'campo' }, h('label', null, 'Origen'), origen), zona,
        !viveres.length ? h('p', { class: 'texto-rojo' }, 'No hay artículos en la categoría "Víveres". Crealos en Stock.') : null),
      acciones: [{ texto: 'Cancelar' }, { texto: 'Cargar', tipo: 'primario', alClick: async (c) => {
        await API.post(`/api/viveres/mareas/${m.id}/cargar`, { origen_id: origen.value || null, items: items.items() });
        c(); UI.aviso('Víveres cargados al barco'); App.recargar();
      } }],
    });
  }

  function cerrarViveres(m) {
    const inputs = m.items.filter((i) => i.a_bordo > 0).map((i) => {
      const inp = h('input', { type: 'text', inputmode: 'decimal', class: 'corto', placeholder: 'Sobró' });
      return { i, inp, el: h('div', { class: 'item' }, h('span', { class: 'crece' }, i.descripcion), inp, h('span', { class: 'unidad' }, `de ${UI.num(i.a_bordo, 3)} ${i.unidad}`)) };
    });
    UI.modal({
      titulo: `Cierre de víveres · Marea ${m.numero}`, ancho: 'ancho',
      contenido: h('div', null, h('p', { class: 'sub' }, 'Contá lo que quedó a bordo. La diferencia se registra como consumo de la marea; lo que sobra queda para la próxima.'), inputs.map((x) => x.el)),
      acciones: [{ texto: 'Cancelar' }, { texto: 'Cerrar víveres', tipo: 'primario', alClick: async (c) => {
        const vacios = inputs.filter((x) => !x.inp.value.trim());
        if (vacios.length) throw new Error(`Falta contar: ${vacios.map((x) => x.i.descripcion).join(', ')}`);
        const r = await API.post(`/api/viveres/mareas/${m.id}/cerrar`, { items: inputs.map(({ i, inp }) => ({ articulo_id: i.articulo_id, contado: inp.value.replace(',', '.') })) });
        c(); UI.aviso(`Víveres cerrados. Consumo: ${UI.pesos(r.costo)}`); App.recargar();
      } }],
    });
  }
}());
