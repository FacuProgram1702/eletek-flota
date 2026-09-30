/**
 * Mantenimiento: vencimientos, equipos por barco, planes modelo, registros
 * y horómetros.
 */

/* global App, UI, API, Vistas */

(function () {
  const { h } = UI;
  const puedePlanificar = () => App.puede('mantenimiento', 'planificar');
  const puedeCargar = () => App.puede('mantenimiento', 'cargar');

  function selectorBarco(valor, alCambiar, { todos = true } = {}) {
    return UI.select(App.barcos.map((b) => ({ valor: b.id, texto: b.nombre })), valor, alCambiar, { vacio: todos ? 'Todos los barcos' : null });
  }

  /** Árbol de equipos: los hijos van indentados debajo del padre. */
  function ordenarArbol(equipos) {
    const hijos = new Map();
    for (const e of equipos) {
      const k = e.padre_id || 0;
      if (!hijos.has(k)) hijos.set(k, []);
      hijos.get(k).push(e);
    }
    const ids = new Set(equipos.map((e) => e.id));
    const out = [];
    const recorrer = (padre, nivel) => {
      for (const e of hijos.get(padre) || []) {
        out.push({ ...e, nivel });
        recorrer(e.id, nivel + 1);
      }
    };
    recorrer(0, 0);
    // Huérfanos (padre en otro barco o inactivo)
    for (const e of equipos) if (e.padre_id && !ids.has(e.padre_id) && !out.find((x) => x.id === e.id)) out.push({ ...e, nivel: 0 });
    return out;
  }

  // ── Página principal ───────────────────────────────────────────────

  App.ruta('/mantenimiento', async (el) => {
    const q = App.query();
    const pestana = q.p || 'vencimientos';
    const barco = q.barco || '';
    const ir = (p, b = barco) => { location.hash = `#/mantenimiento?p=${p}${b ? `&barco=${b}` : ''}`; };

    el.appendChild(UI.cabecera('Mantenimiento', {
      acciones: [
        puedeCargar() ? h('a', { class: 'btn', href: '#/mantenimiento/horometros' }, 'Cargar horómetros') : null,
        puedeCargar() ? h('a', { class: 'btn primario', href: '#/mantenimiento/registrar' }, 'Registrar mantenimiento') : null,
      ],
    }));
    el.appendChild(h('div', { class: 'filtros' },
      UI.pestanas([
        { clave: 'vencimientos', texto: 'Vencimientos' }, { clave: 'equipos', texto: 'Equipos y planes' },
        { clave: 'modelos', texto: 'Planes modelo' }, { clave: 'historial', texto: 'Historial' },
      ], pestana, (p) => ir(p)),
      pestana !== 'modelos' ? selectorBarco(barco, (b) => ir(pestana, b)) : null));

    if (pestana === 'vencimientos') {
      const lista = await API.get('/api/mantenimiento/vencimientos' + API.qs({ barco_id: barco }));
      const filtro = q.estado || 'pendientes';
      const vistos = filtro === 'todas' ? lista : lista.filter((v) => v.estado !== 'ok');
      el.appendChild(h('div', { class: 'filtros' }, UI.select([
        { valor: 'pendientes', texto: 'Vencidas, por vencer y sin punto de partida' }, { valor: 'todas', texto: 'Todas las tareas' },
      ], filtro, (v) => { location.hash = `#/mantenimiento?p=vencimientos${barco ? `&barco=${barco}` : ''}&estado=${v}`; })));
      el.appendChild(UI.tarjeta(null, Vistas.tablaVencimientos(vistos)));
    }

    if (pestana === 'equipos') {
      const equipos = await API.get('/api/mantenimiento/equipos' + API.qs({ barco_id: barco }));
      const acciones = h('div', { class: 'acciones-fila' },
        puedePlanificar() ? UI.boton('+ Nuevo equipo', () => editarEquipo(null, barco)) : null,
        puedePlanificar() ? UI.boton('Copiar equipos y planes de un barco a otro', () => copiarBarco()) : null);
      el.appendChild(acciones);
      const porBarco = new Map();
      for (const e of equipos) {
        if (!porBarco.has(e.barco)) porBarco.set(e.barco, []);
        porBarco.get(e.barco).push(e);
      }
      if (!equipos.length) el.appendChild(UI.tarjeta(null, h('p', { class: 'vacio' }, 'Todavía no hay equipos cargados. Empezá por "Nuevo equipo", o copiá los de un barco parecido.')));
      for (const [nombre, lista] of porBarco) {
        el.appendChild(UI.tarjeta(nombre, UI.tabla({
          columnas: [
            { titulo: 'Código', campo: 'codigo' },
            { titulo: 'Equipo', valor: (e) => h('span', { style: { paddingLeft: `${e.nivel * 1.25}rem` } }, e.nivel ? '└ ' : '', e.nombre) },
            { titulo: 'Marca / modelo', valor: (e) => [e.marca, e.modelo].filter(Boolean).join(' ') },
            { titulo: 'Horas', valor: (e) => (e.usa_horometro ? UI.num(e.horas_actuales, 0) : ''), num: true },
            { titulo: 'Plan', valor: (e) => (e.plan_modelo ? h('span', { class: 'insignia azul', title: 'Igualado a un plan modelo' }, `= ${e.plan_modelo}`) : (e.tareas ? `${e.tareas} tareas` : '')) },
            { titulo: 'Situación', valor: (e) => [e.vencidas ? h('span', { class: 'insignia rojo' }, `${e.vencidas} vencidas`) : null, ' ', e.proximas ? h('span', { class: 'insignia naranja' }, `${e.proximas} por vencer`) : null] },
          ],
          filas: ordenarArbol(lista), alClick: (e) => { location.hash = `#/mantenimiento/equipo/${e.id}`; },
        })));
      }
    }

    if (pestana === 'modelos') await pintarModelos(el);

    if (pestana === 'historial') {
      const regs = await API.get('/api/mantenimiento/registros' + API.qs({ barco_id: barco }));
      el.appendChild(UI.tarjeta(null, UI.tabla({
        columnas: [
          { titulo: 'Fecha', valor: (r) => UI.fecha(r.fecha) }, { titulo: 'Tipo', valor: (r) => (r.tipo === 'preventivo' ? 'Preventivo' : 'Correctivo') },
          { titulo: 'Barco', campo: 'barco' }, { titulo: 'Equipo', campo: 'equipo' },
          { titulo: 'Tarea / descripción', valor: (r) => [r.tarea || r.descripcion, r.anticipado ? h('span', { class: 'insignia naranja' }, ' anticipado') : null] },
          { titulo: 'Horas', valor: (r) => UI.num(r.horas, 0), num: true }, { titulo: 'Materiales', valor: (r) => UI.pesos(r.costo_materiales), num: true },
          { titulo: 'Cargó', campo: 'usuario' },
        ],
        filas: regs, alClick: (r) => { location.hash = `#/mantenimiento/equipo/${r.equipo_id}`; }, buscar: ['equipo', 'tarea', 'descripcion', 'barco'],
      })));
    }
  });

  async function pintarModelos(el) {
    const planes = await API.get('/api/mantenimiento/planes');
    el.appendChild(h('div', { class: 'ayuda-caja' },
      h('strong', null, '¿Para qué sirve? '),
      'Un plan modelo se comparte entre equipos iguales (por ejemplo, el mismo motor en tres barcos). ',
      'Si cambiás una tarea del modelo, cambia en todos los equipos igualados. Cada equipo lleva su propio historial y sus vencimientos.'));
    if (puedePlanificar()) {
      el.appendChild(h('div', { class: 'acciones-fila' }, UI.boton('+ Nuevo plan modelo vacío', async () => {
        const f = UI.form([{ nombre: 'nombre', etiqueta: 'Nombre del plan', requerido: true, placeholder: 'Ej.: Caterpillar 3508' }, { nombre: 'descripcion', etiqueta: 'Descripción' }]);
        UI.modal({ titulo: 'Nuevo plan modelo', contenido: f.el, acciones: [{ texto: 'Cancelar' }, { texto: 'Crear', tipo: 'primario', alClick: async (c) => { await API.post('/api/mantenimiento/planes', f.valores()); c(); App.recargar(); } }] });
      })));
    }
    if (!planes.length) el.appendChild(UI.tarjeta(null, h('p', { class: 'vacio' }, 'No hay planes modelo. Se crean desde un equipo que ya tenga sus tareas ("Convertir en plan modelo") o vacíos desde acá.')));
    for (const p of planes) {
      el.appendChild(UI.tarjeta(p.nombre,
        p.descripcion ? h('p', { class: 'sub' }, p.descripcion) : null,
        tablaTareas(p.tareas, { modeloId: p.id }),
        h('h4', null, `Equipos igualados (${p.equipos.length})`),
        h('ul', { class: 'lista-simple' }, p.equipos.map((e) => h('li', null, h('a', { href: `#/mantenimiento/equipo/${e.id}` }, `${e.nombre} — ${e.barco}`)))),
        puedePlanificar() ? h('div', { class: 'acciones-fila' },
          UI.boton('+ Tarea al modelo', () => editarTarea(null, { plan_modelo_id: p.id })),
          UI.boton('Igualar equipos a este plan', () => igualar(p))) : null));
    }
  }

  async function igualar(plan) {
    const equipos = (await API.get('/api/mantenimiento/equipos')).filter((e) => !e.plan_modelo_id);
    const checks = equipos.map((e) => {
      const c = h('input', { type: 'checkbox', value: e.id });
      return { c, el: h('label', { class: 'campo check' }, c, h('span', null, `${e.barco} — ${e.nombre} ${[e.marca, e.modelo].filter(Boolean).join(' ')}`)) };
    });
    UI.modal({
      titulo: `Igualar equipos a "${plan.nombre}"`,
      contenido: h('div', null, h('p', { class: 'sub' }, 'Los equipos elegidos van a compartir las tareas del modelo. Sus tareas propias se mantienen.'),
        checks.length ? checks.map((x) => x.el) : h('p', null, 'No hay equipos libres para igualar.')),
      acciones: [{ texto: 'Cancelar' }, {
        texto: 'Igualar', tipo: 'primario',
        alClick: async (c) => {
          const ids = checks.filter((x) => x.c.checked).map((x) => Number(x.c.value));
          await API.post(`/api/mantenimiento/planes/${plan.id}/igualar`, { equipos: ids });
          c(); UI.aviso('Equipos igualados'); App.recargar();
        },
      }],
    });
  }

  async function copiarBarco() {
    const opciones = App.barcos.map((b) => ({ valor: b.id, texto: b.nombre }));
    const f = UI.form([
      { nombre: 'origen_barco_id', etiqueta: 'Copiar desde', tipo: 'select', opciones, requerido: true },
      { nombre: 'destino_barco_id', etiqueta: 'Hacia', tipo: 'select', opciones, requerido: true },
    ]);
    UI.modal({
      titulo: 'Copiar equipos y planes',
      contenido: h('div', null, f.el, h('p', { class: 'sub' }, 'Se copian los equipos con su estructura, sus tareas y sus vínculos a planes modelo. Los contadores del barco nuevo arrancan de cero.')),
      acciones: [{ texto: 'Cancelar' }, { texto: 'Copiar', tipo: 'primario', alClick: async (c) => {
        const r = await API.post('/api/mantenimiento/copiar-barco', f.valores());
        c(); UI.aviso(`${r.equipos} equipos copiados`); App.recargar();
      } }],
    });
  }

  // ── Equipo ─────────────────────────────────────────────────────────

  async function editarEquipo(equipo, barcoDefecto) {
    const barcoId = equipo ? equipo.barco_id : Number(barcoDefecto) || (App.barcos[0] && App.barcos[0].id);
    const posibles = (await API.get('/api/mantenimiento/equipos' + API.qs({ barco_id: barcoId })))
      .filter((e) => !equipo || e.id !== equipo.id);
    const f = UI.form([
      equipo ? null : { nombre: 'barco_id', etiqueta: 'Barco', tipo: 'select', requerido: true, opciones: App.barcos.map((b) => ({ valor: b.id, texto: b.nombre })), defecto: barcoId },
      { nombre: 'nombre', etiqueta: 'Nombre', requerido: true, placeholder: 'Ej.: Motor principal' },
      { nombre: 'codigo', etiqueta: 'Código', ancho: 'tercio', placeholder: 'Ej.: 601' },
      { nombre: 'padre_id', etiqueta: 'Dentro de', tipo: 'select', vacio: '— Ninguno (primer nivel) —', ancho: 'medio', opciones: posibles.map((e) => ({ valor: e.id, texto: `${e.codigo ? e.codigo + ' ' : ''}${e.nombre}` })) },
      { nombre: 'marca', etiqueta: 'Marca', ancho: 'tercio' }, { nombre: 'modelo', etiqueta: 'Modelo', ancho: 'tercio' },
      { nombre: 'serie', etiqueta: 'N° de serie', ancho: 'tercio' },
      { nombre: 'ubicacion', etiqueta: 'Ubicación a bordo' },
      { nombre: 'usa_horometro', etiqueta: 'Lleva horómetro', tipo: 'checkbox' },
      equipo ? null : { nombre: 'horas_actuales', etiqueta: 'Horas actuales del horómetro', tipo: 'number', ancho: 'medio' },
    ], equipo || {});
    UI.modal({
      titulo: equipo ? 'Editar equipo' : 'Nuevo equipo', contenido: f.el, ancho: 'ancho',
      acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', tipo: 'primario', alClick: async (c) => {
        const v = f.valores();
        if (equipo) await API.put(`/api/mantenimiento/equipos/${equipo.id}`, v);
        else { const r = await API.post('/api/mantenimiento/equipos', v); location.hash = `#/mantenimiento/equipo/${r.id}`; }
        c(); UI.aviso('Equipo guardado'); if (equipo) App.recargar();
      } }],
    });
  }

  App.ruta('/mantenimiento/equipo/:id', async (el, { id }) => {
    const e = await API.get(`/api/mantenimiento/equipos/${id}`);
    el.appendChild(UI.cabecera(e.nombre, {
      volver: '#/mantenimiento?p=equipos', sub: `${e.barco}${e.codigo ? ` · ${e.codigo}` : ''}${e.ubicacion ? ` · ${e.ubicacion}` : ''}`,
      acciones: [
        puedeCargar() && e.usa_horometro ? UI.boton('Cargar horómetro', () => cargarHorometro(e)) : null,
        puedeCargar() ? UI.boton('Registrar mantenimiento', () => { location.hash = `#/mantenimiento/registrar?equipo=${e.id}`; }, 'primario') : null,
        puedePlanificar() ? UI.boton('Editar', () => editarEquipo(e)) : null,
      ],
    }));

    el.appendChild(h('div', { class: 'datos' },
      UI.dato('Marca / modelo', [e.marca, e.modelo].filter(Boolean).join(' ') || '—'),
      UI.dato('N° de serie', e.serie || '—'),
      e.usa_horometro ? UI.dato('Horómetro', e.horas_actuales !== null ? `${UI.num(e.horas_actuales, 0)} h (${UI.fecha(e.horas_fecha)})` : 'Sin lecturas') : null,
      UI.dato('Plan', e.plan_modelo ? `Igualado a "${e.plan_modelo.nombre}"` : 'Propio')));

    const acc = puedePlanificar() ? h('div', { class: 'acciones-fila' },
      UI.boton('+ Tarea', () => editarTarea(null, { equipo_id: e.id })),
      !e.plan_modelo ? UI.boton('Copiar sus tareas a otros equipos', () => copiarTareas(e)) : null,
      !e.plan_modelo ? UI.boton('Convertir en plan modelo', () => convertirEnModelo(e)) : null,
      e.plan_modelo ? UI.boton('Desvincular del plan modelo', async () => {
        if (!await UI.confirmar('Desvincular', 'Las tareas del modelo pasan a ser propias de este equipo, con su historial. Desde ahí se editan por separado.')) return;
        await API.post(`/api/mantenimiento/equipos/${e.id}/desvincular`, { conservar_tareas: true });
        App.recargar();
      }) : null) : null;

    el.appendChild(UI.tarjeta('Plan de mantenimiento', acc, tablaTareas(e.tareas, { equipo: e })));

    if (e.hijos.length) {
      el.appendChild(UI.tarjeta('Componentes', h('ul', { class: 'lista-simple' },
        e.hijos.map((x) => h('li', null, h('a', { href: `#/mantenimiento/equipo/${x.id}` }, `${x.codigo ? x.codigo + ' ' : ''}${x.nombre}`))))));
    }
    el.appendChild(UI.tarjeta('Historial', UI.tabla({
      columnas: [
        { titulo: 'Fecha', valor: (r) => UI.fecha(r.fecha) }, { titulo: 'Tipo', valor: (r) => (r.tipo === 'preventivo' ? 'Preventivo' : 'Correctivo') },
        { titulo: 'Tarea / descripción', valor: (r) => [r.tarea ? `${r.tarea}. ` : '', r.descripcion, r.anticipado ? h('span', { class: 'insignia naranja' }, ' anticipado') : null] },
        { titulo: 'Causa', campo: 'causa' }, { titulo: 'Horas', valor: (r) => UI.num(r.horas, 0), num: true },
        { titulo: 'Materiales', valor: (r) => UI.pesos(r.costo_materiales), num: true }, { titulo: 'Cargó', campo: 'usuario' },
        { titulo: 'Pedido', valor: (r) => (r.trabajo_id ? h('a', { href: `#/trabajos/${r.trabajo_id}` }, 'ver') : '') },
      ],
      filas: e.historial, vacio: 'Sin registros todavía',
    })));
    if (e.usa_horometro) {
      el.appendChild(UI.tarjeta('Lecturas del horómetro', UI.tabla({
        columnas: [{ titulo: 'Fecha', valor: (l) => UI.fechaHora(l.fecha) }, { titulo: 'Horas', valor: (l) => UI.num(l.horas, 1), num: true }, { titulo: 'Nota', campo: 'nota' }, { titulo: 'Cargó', campo: 'usuario' }],
        filas: e.lecturas, vacio: 'Sin lecturas',
      })));
    }
  });

  function tablaTareas(tareas, { equipo = null, modeloId = null } = {}) {
    return UI.tabla({
      columnas: [
        equipo ? { titulo: 'Estado', valor: (t) => UI.estado(t.estado) } : null,
        { titulo: 'Tarea', valor: (t) => [t.nombre, t.de_modelo ? h('small', { class: 'sub' }, ' (del modelo)') : null] },
        { titulo: 'Cada', valor: Vistas.frecuencia },
        equipo ? { titulo: 'Última vez', valor: (t) => (t.ultima_fecha ? `${UI.fecha(t.ultima_fecha)}${t.ultimas_horas !== null ? ` · ${UI.num(t.ultimas_horas, 0)} h` : ''}` : '—') } : null,
        equipo ? { titulo: 'Situación', valor: Vistas.restante } : null,
        { titulo: 'Materiales', valor: (t) => (t.materiales && t.materiales.length ? `${t.materiales.length} artículo(s)` : '') },
        { titulo: '', valor: (t) => h('div', { class: 'botones-fila' },
          equipo && puedeCargar() ? UI.boton('Hecho', () => { location.hash = `#/mantenimiento/registrar?equipo=${equipo.id}&tarea=${t.id}`; }, 'chico') : null,
          equipo && puedePlanificar() && t.estado === 'sin_registro' ? UI.boton('Punto de partida', () => puntoDePartida(equipo, t), 'chico') : null,
          puedePlanificar() && (!t.de_modelo || modeloId) ? UI.boton('Editar', () => editarTarea(t, {}), 'chico') : null) },
      ].filter(Boolean),
      filas: tareas, vacio: 'Sin tareas cargadas',
    });
  }

  async function editarTarea(tarea, destino) {
    const arts = await App.articulos();
    const f = UI.form([
      { nombre: 'nombre', etiqueta: 'Tarea', requerido: true, placeholder: 'Ej.: Cambio de aceite y filtro' },
      { nombre: 'descripcion', etiqueta: 'Instrucciones', tipo: 'textarea' },
      { seccion: 'Frecuencia (lo que ocurra primero)' },
      { nombre: 'cada_horas', etiqueta: 'Cada … horas', tipo: 'number', ancho: 'tercio' },
      { nombre: 'cada_dias', etiqueta: 'Cada … días', tipo: 'number', ancho: 'tercio' },
      { nombre: 'cada_mareas', etiqueta: 'Cada … mareas', tipo: 'number', ancho: 'tercio' },
    ], tarea || {});
    const mats = arts.length ? UI.itemsArticulos({ articulos: arts, items: tarea ? tarea.materiales : [] }) : null;
    UI.modal({
      titulo: tarea ? 'Editar tarea' : 'Nueva tarea', ancho: 'ancho',
      contenido: h('div', null, f.el, mats ? h('div', null, h('h4', { class: 'form-seccion' }, 'Materiales que usa (se descuentan del stock del barco al registrarla)'), mats.el) : null),
      acciones: [
        tarea ? { texto: 'Dar de baja', tipo: 'peligro', alClick: async (c) => {
          if (!await UI.confirmar('Dar de baja la tarea', `"${tarea.nombre}" deja de aparecer en el plan. El historial se conserva.`, { peligro: true, boton: 'Dar de baja' })) return;
          await API.del(`/api/mantenimiento/tareas/${tarea.id}`); c(); App.recargar();
        } } : null,
        { texto: 'Cancelar' },
        { texto: 'Guardar', tipo: 'primario', alClick: async (c) => {
          const v = { ...f.valores(), ...destino, materiales: mats ? mats.items() : [] };
          if (tarea) await API.put(`/api/mantenimiento/tareas/${tarea.id}`, v);
          else await API.post('/api/mantenimiento/tareas', v);
          c(); UI.aviso('Tarea guardada'); App.recargar();
        } },
      ].filter(Boolean),
    });
  }

  function puntoDePartida(equipo, tarea) {
    const f = UI.form([
      { nombre: 'fecha', etiqueta: 'Última vez que se hizo', tipo: 'date', requerido: true },
      equipo.usa_horometro ? { nombre: 'horas', etiqueta: 'Horas del horómetro en ese momento', tipo: 'number' } : null,
    ]);
    UI.modal({
      titulo: `Punto de partida: ${tarea.nombre}`,
      contenido: h('div', null, h('p', { class: 'sub' }, 'Para que el sistema calcule el próximo vencimiento. No genera un registro en el historial.'), f.el),
      acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', tipo: 'primario', alClick: async (c) => {
        await API.post(`/api/mantenimiento/tareas/${tarea.id}/punto-de-partida`, { ...f.valores(), equipo_id: equipo.id });
        c(); App.recargar();
      } }],
    });
  }

  async function copiarTareas(equipo) {
    const equipos = (await API.get('/api/mantenimiento/equipos')).filter((x) => x.id !== equipo.id);
    const checks = equipos.map((x) => {
      const c = h('input', { type: 'checkbox', value: x.id });
      return { c, el: h('label', { class: 'campo check' }, c, h('span', null, `${x.barco} — ${x.nombre}`)) };
    });
    UI.modal({
      titulo: `Copiar las tareas de "${equipo.nombre}"`,
      contenido: h('div', null, h('p', { class: 'sub' }, 'Cada equipo recibe una copia independiente: después se edita por separado. Si querés que queden sincronizados, usá "Convertir en plan modelo".'), checks.map((x) => x.el)),
      acciones: [{ texto: 'Cancelar' }, { texto: 'Copiar', tipo: 'primario', alClick: async (c) => {
        const r = await API.post('/api/mantenimiento/copiar-tareas', { origen_id: equipo.id, destinos: checks.filter((x) => x.c.checked).map((x) => Number(x.c.value)) });
        c(); UI.aviso(`${r.copiadas} tareas copiadas`);
      } }],
    });
  }

  function convertirEnModelo(equipo) {
    const f = UI.form([{ nombre: 'nombre', etiqueta: 'Nombre del plan modelo', requerido: true, defecto: [equipo.marca, equipo.modelo].filter(Boolean).join(' ') || equipo.nombre }]);
    UI.modal({
      titulo: 'Convertir en plan modelo',
      contenido: h('div', null, h('p', { class: 'sub' }, 'Las tareas de este equipo pasan a un plan modelo que después podés igualar en otros equipos iguales. El historial se conserva.'), f.el),
      acciones: [{ texto: 'Cancelar' }, { texto: 'Crear plan', tipo: 'primario', alClick: async (c) => {
        await API.post('/api/mantenimiento/planes', { ...f.valores(), desde_equipo_id: equipo.id });
        c(); UI.aviso('Plan modelo creado'); App.recargar();
      } }],
    });
  }

  async function cargarHorometro(equipo, alGuardar) {
    const f = UI.form([
      { nombre: 'horas', etiqueta: `Lectura actual (última: ${equipo.horas_actuales !== null ? UI.num(equipo.horas_actuales, 0) + ' h' : 'ninguna'})`, tipo: 'number', requerido: true },
      { nombre: 'nota', etiqueta: 'Nota' },
    ]);
    UI.modal({
      titulo: `Horómetro — ${equipo.nombre}`, contenido: f.el,
      acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', tipo: 'primario', alClick: async (c) => {
        const v = f.valores();
        try {
          await API.post(`/api/mantenimiento/equipos/${equipo.id}/horometro`, v);
        } catch (err) {
          if (err.datos && err.datos.requiere_confirmacion) {
            if (!await UI.confirmar('Lectura menor a la anterior', err.message, { boton: 'Guardar igual' })) return;
            await API.post(`/api/mantenimiento/equipos/${equipo.id}/horometro`, { ...v, confirmar: true });
          } else throw err;
        }
        c(); UI.aviso('Lectura guardada'); if (alGuardar) alGuardar(); else App.recargar();
      } }],
    });
  }

  // ── Horómetros (carga rápida de todos los equipos) ─────────────────

  App.ruta('/mantenimiento/horometros', async (el) => {
    const equipos = (await API.get('/api/mantenimiento/equipos')).filter((e) => e.usa_horometro);
    el.classList.add('a-bordo');
    el.appendChild(UI.cabecera('Cargar horómetros', { volver: '#/mis-tareas' }));
    if (!equipos.length) { el.appendChild(UI.tarjeta(null, h('p', null, 'No hay equipos con horómetro.'))); return; }
    const inputs = [];
    const lista = h('div', { class: 'lista-horometros' }, equipos.map((e) => {
      const inp = h('input', { type: 'text', inputmode: 'decimal', placeholder: e.horas_actuales !== null ? `Última: ${UI.num(e.horas_actuales, 0)}` : 'Horas' });
      inputs.push({ e, inp });
      return h('label', { class: 'horometro' }, h('span', null, h('strong', null, e.nombre), h('small', null, `${e.barco}${e.horas_fecha ? ` · leído ${UI.fecha(e.horas_fecha)}` : ''}`)), inp);
    }));
    el.appendChild(UI.tarjeta(null, lista, h('div', { class: 'acciones-fila' }, UI.boton('Guardar lecturas', async () => {
      let n = 0;
      for (const { e, inp } of inputs) {
        if (!inp.value.trim()) continue;
        const horas = inp.value.trim();
        try {
          await API.post(`/api/mantenimiento/equipos/${e.id}/horometro`, { horas });
        } catch (err) {
          if (err.datos && err.datos.requiere_confirmacion && await UI.confirmar(`${e.nombre}: lectura menor`, err.message, { boton: 'Guardar igual' })) {
            await API.post(`/api/mantenimiento/equipos/${e.id}/horometro`, { horas, confirmar: true });
          } else if (!(err.datos && err.datos.requiere_confirmacion)) throw new Error(`${e.nombre}: ${err.message}`);
          else continue;
        }
        n++;
      }
      UI.aviso(`${n} lectura(s) guardada(s)`);
      App.recargar();
    }, 'primario grande'))));
  });

  // ── Registrar mantenimiento ────────────────────────────────────────

  App.ruta('/mantenimiento/registrar', async (el) => {
    const q = App.query();
    el.classList.add('a-bordo');
    el.appendChild(UI.cabecera('Registrar mantenimiento', { volver: q.equipo ? `#/mantenimiento/equipo/${q.equipo}` : '#/mis-tareas' }));
    const equipos = await API.get('/api/mantenimiento/equipos');
    const arts = await App.articulos();
    const cont = h('div');
    el.appendChild(UI.tarjeta(null, cont));

    let equipo = null;
    let matsCtrl = null;
    const zonaMats = h('div');
    const zonaDetalle = h('div');

    const selEquipo = UI.select(equipos.map((e) => ({ valor: e.id, texto: `${e.barco} — ${e.codigo ? e.codigo + ' ' : ''}${e.nombre}` })), q.equipo || '', () => cargarEquipo(), { vacio: '— Elegí el equipo —' });
    cont.appendChild(h('div', { class: 'campo' }, h('label', null, 'Equipo'), selEquipo));
    cont.appendChild(zonaDetalle);

    async function cargarEquipo() {
      UI.vaciar(zonaDetalle);
      if (!selEquipo.value) return;
      equipo = await API.get(`/api/mantenimiento/equipos/${selEquipo.value}`);
      const tareas = equipo.tareas.map((t) => ({ valor: t.id, texto: `${t.nombre} (${Vistas.frecuencia(t)})` }));
      const f = UI.form([
        { nombre: 'tipo', etiqueta: '¿Qué se hizo?', tipo: 'select', vacio: false, opciones: [
          { valor: 'preventivo', texto: 'Una tarea del plan preventivo' }, { valor: 'correctivo', texto: 'Una reparación o cambio por falla (correctivo)' }],
          defecto: q.tarea ? 'preventivo' : 'preventivo', alCambiar: () => ajustar() },
        { nombre: 'tarea_id', etiqueta: 'Tarea del plan', tipo: 'select', opciones: tareas, defecto: q.tarea || '',
          ayuda: 'En un correctivo, si reemplaza una tarea del plan (ej.: sello cambiado antes de tiempo por rotura), elegila: su conteo se reinicia.',
          alCambiar: () => precargar() },
        { nombre: 'fecha', etiqueta: 'Fecha', tipo: 'datetime', defecto: new Date().toISOString(), ancho: 'medio' },
        equipo.usa_horometro ? { nombre: 'horas', etiqueta: 'Horas del horómetro', tipo: 'number', defecto: equipo.horas_actuales, ancho: 'medio' } : null,
        { nombre: 'descripcion', etiqueta: 'Qué se hizo', tipo: 'textarea' },
        { nombre: 'causa', etiqueta: 'Causa de la falla (si fue correctivo)', tipo: 'textarea', filas: 2 },
      ]);
      const ajustar = () => {
        const esPrev = f.campo('tipo').value === 'preventivo';
        f.campo('causa').closest('.campo').style.display = esPrev ? 'none' : '';
      };
      const precargar = () => {
        const t = equipo.tareas.find((x) => String(x.id) === f.campo('tarea_id').value);
        UI.vaciar(zonaMats);
        matsCtrl = arts.length ? UI.itemsArticulos({ articulos: arts, items: t ? t.materiales : [] }) : null;
        if (matsCtrl) zonaMats.appendChild(h('div', null, h('h4', { class: 'form-seccion' }, `Material usado (sale del stock de ${equipo.barco})`), matsCtrl.el));
      };
      zonaDetalle.appendChild(f.el);
      zonaDetalle.appendChild(zonaMats);
      zonaDetalle.appendChild(h('div', { class: 'acciones-fila' }, UI.boton('Guardar', async () => {
        const v = f.valores();
        const r = await API.post('/api/mantenimiento/registros', { ...v, equipo_id: equipo.id, materiales: matsCtrl ? matsCtrl.items() : [] });
        UI.aviso(r.anticipado ? 'Registrado. Quedó marcado como cambio anticipado y se reinició el conteo de la tarea.' : 'Mantenimiento registrado');
        location.hash = `#/mantenimiento/equipo/${equipo.id}`;
      }, 'primario grande')));
      ajustar();
      precargar();
    }
    if (q.equipo) await cargarEquipo();
  });

  Vistas.cargarHorometro = cargarHorometro;
}());
