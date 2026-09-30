/**
 * Compras y proveedores.
 */

/* global App, UI, API */

(function () {
  const { h } = UI;

  App.ruta('/compras', async (el) => {
    const q = App.query();
    const filtro = q.estado || 'abiertas';
    const estados = { abiertas: 'solicitada,cotizada,pendiente_segunda,aprobada,recibida_parcial', todas: '' };
    const lista = await API.get('/api/compras' + API.qs({ estado: estados[filtro] ?? filtro }));
    el.appendChild(UI.cabecera('Compras', {
      acciones: [App.puede('compras', 'cargar') ? UI.boton('+ Solicitud de compra', () => nuevaCompra(), 'primario') : null],
    }));
    el.appendChild(h('div', { class: 'filtros' }, UI.pestanas([
      { clave: 'abiertas', texto: 'En curso' }, { clave: 'solicitada', texto: 'Solicitadas' }, { clave: 'pendiente_segunda', texto: 'Falta 2ª aprobación' },
      { clave: 'aprobada', texto: 'Por recibir' }, { clave: 'todas', texto: 'Todas' },
    ], filtro, (x) => { location.hash = `#/compras?estado=${x}`; })));
    el.appendChild(UI.tarjeta(null, UI.tabla({
      columnas: [
        { titulo: 'N°', campo: 'numero' }, { titulo: 'Estado', valor: (c) => UI.estado(c.estado) }, { titulo: 'Proveedor', campo: 'proveedor' },
        { titulo: 'Destino', campo: 'deposito' }, { titulo: 'Total', valor: (c) => (c.sin_precio ? '—' : UI.moneda(c.total, c.moneda)), num: true },
        { titulo: 'Pedido de trabajo', valor: (c) => (c.trabajo_numero ? `#${c.trabajo_numero}` : '') },
        { titulo: 'Solicitó', valor: (c) => `${c.solicitante || ''} · ${UI.fecha(c.creado)}` },
      ],
      filas: lista, buscar: ['numero', 'proveedor', 'deposito', 'notas'], alClick: (c) => { location.hash = `#/compras/${c.id}`; },
      vacio: 'No hay compras con ese filtro',
    })));
  });

  async function nuevaCompra() {
    const [deps, arts] = await Promise.all([API.get('/api/stock/depositos'), App.articulos()]);
    const f = UI.form([
      { nombre: 'deposito_id', etiqueta: 'Entra a', tipo: 'select', requerido: true, opciones: deps.map((d) => ({ valor: d.id, texto: d.nombre })) },
      { nombre: 'notas', etiqueta: 'Notas', tipo: 'textarea', filas: 2 },
    ]);
    const items = UI.itemsArticulos({ articulos: arts });
    UI.modal({
      titulo: 'Solicitud de compra', ancho: 'ancho', contenido: h('div', null, f.el, h('h4', { class: 'form-seccion' }, 'Artículos'), items.el),
      acciones: [{ texto: 'Cancelar' }, { texto: 'Crear', tipo: 'primario', alClick: async (c) => {
        const r = await API.post('/api/compras', { ...f.valores(), items: items.items() }); c(); location.hash = `#/compras/${r.id}`;
      } }],
    });
  }

  App.ruta('/compras/:id', async (el, { id }) => {
    const c = await API.get(`/api/compras/${id}`);
    const aprobar = App.puede('compras', 'aprobar');
    const post = async (accion, datos, msj) => { const r = await API.post(`/api/compras/${c.id}/${accion}`, datos); UI.aviso(msj(r)); App.recargar(); };

    el.appendChild(UI.cabecera(`Compra #${c.numero}`, {
      volver: '#/compras', sub: [c.proveedor ? c.proveedor.nombre : 'Sin proveedor', c.deposito ? `→ ${c.deposito.nombre}` : ''].join(' '),
      acciones: [
        ['solicitada', 'cotizada'].includes(c.estado) && aprobar ? UI.boton('Cotizar / editar', () => cotizar(c)) : null,
        c.estado === 'cotizada' && aprobar ? UI.boton('Aprobar', () => post('aprobar', {}, (r) => (r.requiere_segunda ? 'Aprobada por Compras. Supera el monto: falta la segunda aprobación.' : 'Compra aprobada')), 'primario') : null,
        c.puede_segunda ? UI.boton('Dar segunda aprobación', () => post('segunda-aprobacion', {}, () => 'Compra aprobada'), 'primario') : null,
        ['aprobada', 'recibida_parcial', 'recibida'].includes(c.estado) ? h('a', { class: 'btn', href: `#/compras/${c.id}/orden` }, 'Orden de compra (imprimir)') : null,
        ['aprobada', 'recibida_parcial'].includes(c.estado) && App.puede('compras', 'recibir') ? UI.boton('Recibir mercadería', () => recibir(c), 'primario') : null,
        ['solicitada', 'cotizada', 'pendiente_segunda', 'aprobada'].includes(c.estado) && aprobar ? UI.boton('Cancelar compra', () => {
          const f = UI.form([{ nombre: 'motivo', etiqueta: 'Motivo', tipo: 'textarea', requerido: true }]);
          UI.modal({ titulo: 'Cancelar compra', contenido: f.el, acciones: [{ texto: 'Volver' }, { texto: 'Cancelar compra', tipo: 'peligro', alClick: async (x) => { await post('cancelar', f.valores(), () => 'Compra cancelada'); x(); } }] });
        }, 'peligro') : null,
      ],
    }));
    el.appendChild(h('div', { class: 'datos' },
      UI.dato('Estado', UI.estado(c.estado)),
      UI.dato('Total', c.sin_precio ? 'Faltan precios' : UI.moneda(c.total, c.moneda)),
      c.moneda !== 'ARS' ? UI.dato('En pesos', `${UI.pesos(c.total_ars)} (TC ${UI.num(c.tipo_cambio)})`) : null,
      UI.dato('Solicitó', `${c.solicitante || '—'} · ${UI.fecha(c.creado)}`),
      c.aprobador ? UI.dato('Aprobó', c.aprobador) : null,
      c.segundo_aprobador ? UI.dato('Segunda aprobación', c.segundo_aprobador) : null,
      c.estado === 'pendiente_segunda' ? UI.dato('Falta aprobación de', c.rol_segunda || '—') : null,
      c.trabajo ? UI.dato('Pedido de trabajo', h('a', { href: `#/trabajos/${c.trabajo.id}` }, `#${c.trabajo.numero} ${c.trabajo.titulo}`)) : null));
    if (c.notas) el.appendChild(UI.tarjeta(null, h('p', { class: 'texto-largo' }, c.notas)));
    if (c.motivo_cancelacion) el.appendChild(UI.tarjeta(null, h('p', { class: 'texto-rojo' }, `Cancelada: ${c.motivo_cancelacion}`)));
    el.appendChild(UI.tarjeta('Artículos', UI.tabla({
      columnas: [
        { titulo: 'Código', campo: 'codigo' }, { titulo: 'Artículo', campo: 'descripcion' },
        { titulo: 'Cantidad', valor: (i) => `${UI.num(i.cantidad, 3)} ${i.unidad}`, num: true },
        { titulo: 'Precio unit.', valor: (i) => UI.moneda(i.precio_unitario, c.moneda), num: true },
        { titulo: 'Subtotal', valor: (i) => (i.precio_unitario === null ? '—' : UI.moneda(i.precio_unitario * i.cantidad, c.moneda)), num: true },
        { titulo: 'Recibido', valor: (i) => UI.num(i.recibido, 3), num: true },
      ],
      filas: c.items,
    })));
    el.appendChild(UI.tarjeta('Historial', UI.tabla({
      columnas: [{ titulo: 'Fecha', valor: (x) => UI.fechaHora(x.fecha) }, { titulo: 'Acción', campo: 'accion' }, { titulo: 'Detalle', campo: 'detalle' }, { titulo: 'Usuario', campo: 'usuario' }],
      filas: c.historial,
    })));
  });

  async function cotizar(c) {
    const [provs, arts, deps] = await Promise.all([API.get('/api/proveedores?tipo=proveedor'), App.articulos(), API.get('/api/stock/depositos')]);
    const f = UI.form([
      { nombre: 'proveedor_id', etiqueta: 'Proveedor', tipo: 'select', opciones: provs.map((p) => ({ valor: p.id, texto: p.nombre })) },
      { nombre: 'deposito_id', etiqueta: 'Entra a', tipo: 'select', opciones: deps.map((d) => ({ valor: d.id, texto: d.nombre })) },
      { nombre: 'moneda', etiqueta: 'Moneda', tipo: 'select', vacio: false, opciones: [{ valor: 'ARS', texto: 'Pesos' }, { valor: 'USD', texto: 'Dólares' }], ancho: 'medio',
        alCambiar: (s) => { f.campo('tipo_cambio').closest('.campo').style.display = s.value === 'USD' ? '' : 'none'; } },
      { nombre: 'tipo_cambio', etiqueta: 'Tipo de cambio ($ por USD)', tipo: 'number', ancho: 'medio' },
      { nombre: 'notas', etiqueta: 'Notas', tipo: 'textarea', filas: 2 },
    ], { ...c, proveedor_id: c.proveedor_id, deposito_id: c.deposito_id });
    if (c.moneda !== 'USD') f.campo('tipo_cambio').closest('.campo').style.display = 'none';
    const items = UI.itemsArticulos({ articulos: arts, items: c.items, extra: { campo: 'precio_unitario', etiqueta: 'Precio unit.' } });
    UI.modal({
      titulo: `Cotizar compra #${c.numero}`, ancho: 'ancho',
      contenido: h('div', null, f.el, h('h4', { class: 'form-seccion' }, 'Artículos y precios'), items.el,
        h('p', { class: 'sub' }, 'Con proveedor y todos los precios cargados, la compra queda "cotizada" y lista para aprobar.')),
      acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', tipo: 'primario', alClick: async (x) => {
        await API.put(`/api/compras/${c.id}`, { ...f.valores(), items: items.items() }); x(); UI.aviso('Compra actualizada'); App.recargar();
      } }],
    });
  }

  function recibir(c) {
    const inputs = c.items.filter((i) => i.recibido < i.cantidad).map((i) => {
      const inp = h('input', { type: 'text', inputmode: 'decimal', class: 'corto', value: String(Math.round((i.cantidad - i.recibido) * 1000) / 1000) });
      return { i, inp, el: h('div', { class: 'item' }, h('span', { class: 'crece' }, `${i.codigo} — ${i.descripcion}`), inp, h('span', { class: 'unidad' }, `de ${UI.num(i.cantidad - i.recibido, 3)} ${i.unidad}`)) };
    });
    UI.modal({
      titulo: `Recibir compra #${c.numero}`, ancho: 'ancho',
      contenido: h('div', null, h('p', { class: 'sub' }, `Entra al stock de ${c.deposito ? c.deposito.nombre : '—'}. Poné 0 en lo que no llegó.`), inputs.map((x) => x.el)),
      acciones: [{ texto: 'Cancelar' }, { texto: 'Confirmar recepción', tipo: 'primario', alClick: async (x) => {
        await API.post(`/api/compras/${c.id}/recibir`, { items: inputs.map(({ i, inp }) => ({ item_id: i.id, cantidad: inp.value.replace(',', '.') })) });
        x(); UI.aviso('Mercadería recibida y cargada al stock'); App.recargar();
      } }],
    });
  }

  /** Orden de compra para imprimir o guardar como PDF. */
  App.ruta('/compras/:id/orden', async (el, { id }) => {
    const c = await API.get(`/api/compras/${id}`);
    el.classList.add('documento');
    el.appendChild(h('div', { class: 'no-imprimir acciones-fila' },
      h('a', { class: 'btn', href: `#/compras/${c.id}` }, '← Volver'), UI.boton('Imprimir / guardar PDF', () => window.print(), 'primario')));
    el.appendChild(h('div', { class: 'hoja' },
      h('div', { class: 'hoja-cab' }, h('div', null, h('h1', null, App.sesion.empresa.nombre), h('p', null, 'Orden de compra')),
        h('div', { class: 'derecha' }, h('h2', null, `N° ${String(c.numero).padStart(6, '0')}`), h('p', null, `Fecha: ${UI.fecha(c.aprobado || c.creado)}`))),
      h('div', { class: 'hoja-datos' },
        h('div', null, h('strong', null, 'Proveedor: '), c.proveedor ? c.proveedor.nombre : '—', c.proveedor && c.proveedor.cuit ? ` · CUIT ${c.proveedor.cuit}` : ''),
        h('div', null, h('strong', null, 'Entregar en: '), c.deposito ? c.deposito.nombre : '—'),
        c.proveedor && c.proveedor.contacto ? h('div', null, h('strong', null, 'Contacto: '), c.proveedor.contacto) : null),
      h('table', { class: 'tabla hoja-tabla' },
        h('thead', null, h('tr', null, ['Código', 'Descripción', 'Cantidad', 'Precio unit.', 'Subtotal'].map((x, i) => h('th', { class: i >= 2 ? 'num' : null }, x)))),
        h('tbody', null, c.items.map((i) => h('tr', null, h('td', null, i.codigo), h('td', null, i.descripcion),
          h('td', { class: 'num' }, `${UI.num(i.cantidad, 3)} ${i.unidad}`), h('td', { class: 'num' }, UI.moneda(i.precio_unitario, c.moneda)),
          h('td', { class: 'num' }, UI.moneda((i.precio_unitario || 0) * i.cantidad, c.moneda))))),
        h('tfoot', null, h('tr', null, h('td', { colspan: 4, class: 'num' }, h('strong', null, 'Total')), h('td', { class: 'num' }, h('strong', null, UI.moneda(c.total, c.moneda)))))),
      c.notas ? h('p', null, h('strong', null, 'Observaciones: '), c.notas) : null,
      h('div', { class: 'firmas' }, h('div', null, 'Aprobó: ', c.aprobador || ''), c.segundo_aprobador ? h('div', null, 'Segunda aprobación: ', c.segundo_aprobador) : null)));
  });

  // ── Proveedores y talleres ─────────────────────────────────────────

  App.ruta('/proveedores', async (el) => {
    const lista = await API.get('/api/proveedores?inactivos=1');
    const admin = App.puede('proveedores', 'administrar');
    const editar = (p) => {
      const f = UI.form([
        { nombre: 'nombre', etiqueta: 'Nombre', requerido: true },
        { nombre: 'tipo', etiqueta: 'Tipo', tipo: 'select', vacio: false, ancho: 'medio', opciones: [{ valor: 'proveedor', texto: 'Proveedor' }, { valor: 'taller', texto: 'Taller' }, { valor: 'ambos', texto: 'Proveedor y taller' }] },
        { nombre: 'cuit', etiqueta: 'CUIT', ancho: 'medio' },
        { nombre: 'contacto', etiqueta: 'Contacto', ancho: 'medio' }, { nombre: 'telefono', etiqueta: 'Teléfono', ancho: 'medio' },
        { nombre: 'email', etiqueta: 'Email' }, { nombre: 'notas', etiqueta: 'Notas', tipo: 'textarea', filas: 2 },
        p ? { nombre: 'activo', etiqueta: 'Activo', tipo: 'checkbox' } : null,
      ], p ? { ...p, activo: !!p.activo } : {});
      UI.modal({ titulo: p ? 'Editar' : 'Nuevo proveedor o taller', contenido: f.el, ancho: 'ancho', acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', tipo: 'primario', alClick: async (c) => {
        if (p) await API.put(`/api/proveedores/${p.id}`, f.valores()); else await API.post('/api/proveedores', f.valores());
        c(); App.recargar();
      } }] });
    };
    el.appendChild(UI.cabecera('Proveedores y talleres', { acciones: [admin ? UI.boton('+ Nuevo', () => editar(null), 'primario') : null] }));
    el.appendChild(UI.tarjeta(null, UI.tabla({
      columnas: [
        { titulo: 'Nombre', valor: (p) => [p.nombre, p.activo ? '' : h('span', { class: 'insignia gris' }, ' inactivo')] },
        { titulo: 'Tipo', valor: (p) => ({ proveedor: 'Proveedor', taller: 'Taller', ambos: 'Proveedor y taller' }[p.tipo]) },
        { titulo: 'Contacto', campo: 'contacto' }, { titulo: 'Teléfono', campo: 'telefono' }, { titulo: 'Email', campo: 'email' },
      ],
      filas: lista, buscar: ['nombre', 'contacto'], alClick: admin ? editar : null,
    })));
  });
}());
