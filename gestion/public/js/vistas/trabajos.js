/**
 * Pedidos de trabajo.
 */

/* global App, UI, API */

(function () {
  const { h } = UI;

  App.ruta('/trabajos', async (el) => {
    const q = App.query();
    const filtro = q.estado || 'abiertos';
    const estados = { abiertos: 'pendiente,aprobado,en_curso,realizado', pendiente: 'pendiente', todos: '' };
    const lista = await API.get('/api/trabajos' + API.qs({ estado: estados[filtro] ?? filtro, barco_id: q.barco }));
    el.appendChild(UI.cabecera('Pedidos de trabajo', {
      acciones: [App.puede('trabajos', 'cargar') ? h('a', { class: 'btn primario', href: '#/trabajos/nuevo' }, '+ Nuevo pedido') : null],
    }));
    el.appendChild(h('div', { class: 'filtros' },
      UI.pestanas([{ clave: 'abiertos', texto: 'Abiertos' }, { clave: 'pendiente', texto: 'Por aprobar' }, { clave: 'todos', texto: 'Todos' }],
        filtro, (x) => { location.hash = '#/trabajos' + API.qs({ ...q, estado: x }); }),
      UI.select(App.barcos.map((b) => ({ valor: b.id, texto: b.nombre })), q.barco || '', (v) => { location.hash = '#/trabajos' + API.qs({ ...q, barco: v }); }, { vacio: 'Todos los barcos' })));
    el.appendChild(UI.tarjeta(null, UI.tabla({
      columnas: [
        { titulo: 'N°', campo: 'numero' }, { titulo: 'Estado', valor: (t) => UI.estado(t.estado) },
        { titulo: 'Prioridad', valor: (t) => UI.estado(t.prioridad) }, { titulo: 'Barco', campo: 'barco' },
        { titulo: 'Trabajo', campo: 'titulo' }, { titulo: 'Equipo', campo: 'equipo' },
        { titulo: 'Quién', valor: (t) => (t.ejecutor === 'taller' ? t.proveedor || 'Taller' : 'Personal propio') },
        { titulo: 'Pedido', valor: (t) => `${UI.fecha(t.creado)} · ${t.solicitante || ''}` },
      ],
      filas: lista, buscar: ['titulo', 'barco', 'equipo', 'numero'], alClick: (t) => { location.hash = `#/trabajos/${t.id}`; },
      vacio: 'No hay pedidos con ese filtro',
    })));
  });

  App.ruta('/trabajos/nuevo', async (el) => {
    const q = App.query();
    el.classList.add('a-bordo');
    el.appendChild(UI.cabecera('Nuevo pedido de trabajo', { volver: '#/trabajos' }));
    const zonaEquipo = h('div');
    const f = UI.form([
      { nombre: 'barco_id', etiqueta: 'Barco', tipo: 'select', requerido: true, opciones: App.barcos.map((b) => ({ valor: b.id, texto: b.nombre })),
        defecto: q.barco || (App.barcos.length === 1 ? App.barcos[0].id : ''), alCambiar: () => cargarEquipos() },
      { nombre: 'titulo', etiqueta: 'Qué pasa / qué hay que hacer', requerido: true, placeholder: 'Ej.: Pérdida en bomba de agua salada' },
      { nombre: 'descripcion', etiqueta: 'Detalle', tipo: 'textarea', filas: 4 },
      { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', vacio: false, ancho: 'medio', opciones: [
        { valor: 'correctivo', texto: 'Correctivo (falla o rotura)' }, { valor: 'preventivo', texto: 'Preventivo (del plan)' }, { valor: 'mejora', texto: 'Mejora / modificación' }] },
      { nombre: 'prioridad', etiqueta: 'Prioridad', tipo: 'select', vacio: false, ancho: 'medio', defecto: 'normal', opciones: [
        { valor: 'baja', texto: 'Baja' }, { valor: 'normal', texto: 'Normal' }, { valor: 'alta', texto: 'Alta' }, { valor: 'urgente', texto: 'Urgente' }] },
    ]);
    let selEquipo = null;
    let selTarea = null;
    let equipos = [];
    async function cargarEquipos() {
      UI.vaciar(zonaEquipo);
      const b = f.campo('barco_id').value;
      if (!b || !App.puede('mantenimiento')) return;
      equipos = await API.get('/api/mantenimiento/equipos' + API.qs({ barco_id: b }));
      selTarea = h('select');
      selEquipo = UI.select(equipos.map((e) => ({ valor: e.id, texto: `${e.codigo ? e.codigo + ' ' : ''}${e.nombre}` })), q.equipo || '', async (v) => {
        UI.vaciar(selTarea).appendChild(h('option', { value: '' }, '— Ninguna —'));
        if (!v) return;
        const eq = await API.get(`/api/mantenimiento/equipos/${v}`);
        eq.tareas.forEach((t) => selTarea.appendChild(h('option', { value: t.id }, t.nombre)));
      }, { vacio: '— No es de un equipo en particular —' });
      selTarea.appendChild(h('option', { value: '' }, '— Ninguna —'));
      zonaEquipo.appendChild(h('div', { class: 'form' },
        h('div', { class: 'campo medio' }, h('label', null, 'Equipo'), selEquipo),
        h('div', { class: 'campo medio' }, h('label', null, 'Tarea del plan que involucra'), selTarea,
          h('small', null, 'Opcional. Si es un cambio anticipado, al terminar el trabajo se reinicia el conteo de esa tarea.'))));
      if (q.equipo) selEquipo.dispatchEvent(new Event('change'));
    }
    el.appendChild(UI.tarjeta(null, f.el, zonaEquipo, h('div', { class: 'acciones-fila' }, UI.boton('Enviar pedido', async () => {
      const v = f.valores();
      const r = await API.post('/api/trabajos', { ...v, equipo_id: selEquipo && selEquipo.value ? Number(selEquipo.value) : null, tarea_id: selTarea && selTarea.value ? Number(selTarea.value) : null });
      UI.aviso('Pedido enviado. Queda pendiente de aprobación.');
      location.hash = `#/trabajos/${r.id}`;
    }, 'primario grande'))));
    await cargarEquipos();
  });

  App.ruta('/trabajos/:id', async (el, { id }) => {
    const t = await API.get(`/api/trabajos/${id}`);
    const aprobar = App.puede('trabajos', 'aprobar');
    const cargar = App.puede('trabajos', 'cargar');
    const post = async (accion, datos, msj) => { await API.post(`/api/trabajos/${t.id}/${accion}`, datos); UI.aviso(msj); App.recargar(); };

    el.appendChild(UI.cabecera(`#${t.numero} · ${t.titulo}`, {
      volver: '#/trabajos', sub: `${t.barco}${t.equipo ? ` · ${t.equipo.nombre}` : ''}`,
      acciones: [
        t.estado === 'pendiente' && aprobar ? UI.boton('Aprobar', () => aprobarTrabajo(t), 'primario') : null,
        ['pendiente', 'aprobado'].includes(t.estado) && aprobar ? UI.boton('Rechazar', () => {
          const f = UI.form([{ nombre: 'motivo', etiqueta: 'Motivo', tipo: 'textarea', requerido: true }]);
          UI.modal({ titulo: 'Rechazar pedido', contenido: f.el, acciones: [{ texto: 'Cancelar' }, { texto: 'Rechazar', tipo: 'peligro', alClick: async (c) => { await post('rechazar', f.valores(), 'Pedido rechazado'); c(); } }] });
        }, 'peligro') : null,
        t.estado === 'aprobado' && cargar ? UI.boton('Iniciar', () => post('iniciar', {}, 'Trabajo en curso')) : null,
        ['aprobado', 'en_curso'].includes(t.estado) && cargar ? UI.boton('Registrar trabajo realizado', () => realizar(t), 'primario') : null,
        ['pendiente', 'aprobado', 'en_curso'].includes(t.estado) && App.puede('compras', 'cargar') ? UI.boton('Pedir material a Compras', () => pedirCompra(t)) : null,
        t.estado === 'realizado' && aprobar ? UI.boton('Cerrar', () => post('cerrar', {}, 'Pedido cerrado'), 'primario') : null,
      ],
    }));
    el.appendChild(h('div', { class: 'datos' },
      UI.dato('Estado', UI.estado(t.estado)), UI.dato('Prioridad', UI.estado(t.prioridad)),
      UI.dato('Tipo', { correctivo: 'Correctivo', preventivo: 'Preventivo', mejora: 'Mejora' }[t.tipo]),
      UI.dato('Lo hace', t.ejecutor === 'taller' ? (t.proveedor ? t.proveedor.nombre : 'Taller') : 'Personal propio'),
      t.presupuesto !== null ? UI.dato('Presupuesto', UI.pesos(t.presupuesto)) : null,
      t.fecha_comprometida ? UI.dato('Fecha comprometida', UI.fecha(t.fecha_comprometida)) : null,
      t.tarea ? UI.dato('Tarea del plan', t.tarea.nombre) : null,
      UI.dato('Costo de materiales', UI.pesos(t.costo_materiales))));
    el.appendChild(UI.tarjeta('Detalle', h('p', { class: 'texto-largo' }, t.descripcion || 'Sin detalle.'),
      t.equipo ? h('p', null, h('a', { href: `#/mantenimiento/equipo/${t.equipo.id}` }, `Ver equipo: ${t.equipo.nombre}`)) : null,
      t.motivo_rechazo ? h('p', { class: 'texto-rojo' }, `Rechazado: ${t.motivo_rechazo}`) : null));
    if (t.informe) el.appendChild(UI.tarjeta('Informe del trabajo realizado', h('p', { class: 'texto-largo' }, t.informe), h('small', { class: 'sub' }, `${t.realizador || ''} · ${UI.fechaHora(t.realizado)}`)));
    el.appendChild(UI.tarjeta('Material usado', UI.tabla({
      columnas: [{ titulo: 'Artículo', valor: (m) => `${m.codigo} — ${m.descripcion}` }, { titulo: 'Cantidad', valor: (m) => `${UI.num(m.cantidad, 3)} ${m.unidad}`, num: true },
        { titulo: 'Costo', valor: (m) => UI.pesos((m.costo_unitario || 0) * m.cantidad), num: true }],
      filas: t.materiales, vacio: 'Sin material registrado',
    })));
    if (t.compras.length) {
      el.appendChild(UI.tarjeta('Compras vinculadas', h('ul', { class: 'lista-simple' },
        t.compras.map((c) => h('li', null, h('a', { href: `#/compras/${c.id}` }, `Compra #${c.numero}`), ' ', UI.estado(c.estado))))));
    }
    el.appendChild(UI.tarjeta('Historial', UI.tabla({
      columnas: [{ titulo: 'Fecha', valor: (x) => UI.fechaHora(x.fecha) }, { titulo: 'Acción', campo: 'accion' }, { titulo: 'Detalle', campo: 'detalle' }, { titulo: 'Usuario', campo: 'usuario' }],
      filas: t.historial,
    })));
  });

  async function aprobarTrabajo(t) {
    const talleres = await API.get('/api/proveedores?tipo=taller');
    const f = UI.form([
      { nombre: 'ejecutor', etiqueta: '¿Quién lo hace?', tipo: 'select', vacio: false, opciones: [{ valor: 'propio', texto: 'Personal propio' }, { valor: 'taller', texto: 'Taller externo' }],
        alCambiar: (s) => { f.campo('proveedor_id').closest('.campo').style.display = s.value === 'taller' ? '' : 'none'; } },
      { nombre: 'proveedor_id', etiqueta: 'Taller', tipo: 'select', opciones: talleres.map((p) => ({ valor: p.id, texto: p.nombre })) },
      { nombre: 'presupuesto', etiqueta: 'Presupuesto ($)', tipo: 'number', ancho: 'medio' },
      { nombre: 'fecha_comprometida', etiqueta: 'Fecha comprometida', tipo: 'date', ancho: 'medio' },
    ]);
    f.campo('proveedor_id').closest('.campo').style.display = 'none';
    UI.modal({
      titulo: `Aprobar pedido #${t.numero}`, contenido: h('div', null, f.el, !talleres.length ? h('p', { class: 'sub' }, 'No hay talleres cargados en Proveedores y talleres.') : null),
      acciones: [{ texto: 'Cancelar' }, { texto: 'Aprobar', tipo: 'primario', alClick: async (c) => {
        await API.post(`/api/trabajos/${t.id}/aprobar`, f.valores()); c(); UI.aviso('Pedido aprobado'); App.recargar();
      } }],
    });
  }

  async function realizar(t) {
    const arts = await App.articulos();
    const f = UI.form([
      { nombre: 'informe', etiqueta: 'Qué se hizo', tipo: 'textarea', requerido: true, filas: 4 },
      t.equipo ? { nombre: 'causa', etiqueta: 'Causa de la falla', tipo: 'textarea', filas: 2 } : null,
      { nombre: 'fecha', etiqueta: 'Cuándo', tipo: 'datetime', defecto: new Date().toISOString(), ancho: 'medio' },
      t.equipo ? { nombre: 'horas', etiqueta: 'Horas del horómetro', tipo: 'number', ancho: 'medio' } : null,
    ]);
    const mats = arts.length ? UI.itemsArticulos({ articulos: arts, items: [] }) : null;
    UI.modal({
      titulo: 'Trabajo realizado', ancho: 'ancho',
      contenido: h('div', null, f.el, mats ? h('div', null, h('h4', { class: 'form-seccion' }, `Material usado (sale del stock a bordo de ${t.barco})`), mats.el) : null,
        t.ejecutor === 'taller' ? h('p', { class: 'sub' }, 'Si el taller puso los repuestos, no cargues material acá.') : null),
      acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', tipo: 'primario', alClick: async (c) => {
        const r = await API.post(`/api/trabajos/${t.id}/realizar`, { ...f.valores(), materiales: mats ? mats.items() : [] });
        c(); UI.aviso(r.anticipado ? 'Registrado. La tarea preventiva quedó reiniciada (cambio anticipado).' : 'Trabajo registrado'); App.recargar();
      } }],
    });
  }

  async function pedirCompra(t) {
    const arts = await App.articulos();
    const items = UI.itemsArticulos({ articulos: arts });
    UI.modal({
      titulo: 'Pedir material a Compras', ancho: 'ancho',
      contenido: h('div', null, h('p', { class: 'sub' }, `Lo recibido entra al stock a bordo de ${t.barco}.`), items.el),
      acciones: [{ texto: 'Cancelar' }, { texto: 'Enviar a Compras', tipo: 'primario', alClick: async (c) => {
        await API.post(`/api/trabajos/${t.id}/solicitar-compra`, { items: items.items() }); c(); UI.aviso('Solicitud enviada a Compras'); App.recargar();
      } }],
    });
  }
}());
