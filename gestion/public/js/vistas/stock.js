/**
 * Stock: existencias, artículos, movimientos, valorización e importación.
 */

/* global App, UI, API, XLSX */

(function () {
  const { h } = UI;
  const puedeAdmin = () => App.puede('stock', 'administrar');
  const puedeCargar = () => App.puede('stock', 'cargar');

  App.ruta('/stock', async (el) => {
    const q = App.query();
    const p = q.p || 'existencias';
    const ir = (extra) => { location.hash = '#/stock' + API.qs({ ...q, ...extra }); };
    const [depositos, listas] = await Promise.all([API.get('/api/stock/depositos'), App.obtenerListas()]);

    el.appendChild(UI.cabecera('Stock', {
      acciones: [
        puedeAdmin() ? h('a', { class: 'btn', href: '#/stock/importar' }, 'Importar Excel') : null,
        puedeAdmin() ? UI.boton('+ Artículo', () => editarArticulo(null, depositos, listas)) : null,
        puedeCargar() ? UI.boton('Nuevo movimiento', () => nuevoMovimiento(depositos), 'primario') : null,
      ],
    }));
    el.appendChild(h('div', { class: 'filtros' }, UI.pestanas([
      { clave: 'existencias', texto: 'Existencias' }, { clave: 'articulos', texto: 'Artículos' },
      { clave: 'movimientos', texto: 'Movimientos' }, { clave: 'valorizacion', texto: 'Valorización' },
      puedeAdmin() ? { clave: 'depositos', texto: 'Depósitos' } : null,
    ].filter(Boolean), p, (x) => { location.hash = `#/stock?p=${x}`; })));

    const opDep = depositos.map((d) => ({ valor: d.id, texto: d.nombre }));
    const opCat = listas.categoria.map((c) => ({ valor: c.valor, texto: c.valor }));

    if (p === 'existencias') {
      el.appendChild(h('div', { class: 'filtros' },
        UI.select(opDep, q.deposito || '', (v) => ir({ deposito: v }), { vacio: 'Todos los depósitos' }),
        UI.select(opCat, q.categoria || '', (v) => ir({ categoria: v }), { vacio: 'Todas las categorías' }),
        h('label', { class: 'check-inline' }, h('input', { type: 'checkbox', checked: q.bajo === '1', onchange: (e) => ir({ bajo: e.target.checked ? '1' : '' }) }), ' Solo bajo mínimo')));
      const filas = await API.get('/api/stock/existencias' + API.qs({ deposito_id: q.deposito, categoria: q.categoria, bajo_minimo: q.bajo }));
      el.appendChild(UI.tarjeta(null,
        q.bajo === '1' && App.puede('compras', 'cargar') && q.deposito ? h('div', { class: 'acciones-fila' }, UI.boton('Pedir reposición a Compras', async () => {
          const r = await API.post('/api/compras/desde-minimos', { deposito_id: Number(q.deposito) });
          UI.aviso(`Solicitud de compra creada con ${r.articulos} artículo(s)`); location.hash = `#/compras/${r.id}`;
        })) : null,
        UI.tabla({
          columnas: [
            { titulo: 'Código', campo: 'codigo' }, { titulo: 'Artículo', campo: 'descripcion' }, { titulo: 'Categoría', campo: 'categoria' },
            { titulo: 'Depósito', campo: 'deposito' },
            { titulo: 'Existencia', valor: (f) => h('span', { class: f.bajo_minimo ? 'texto-rojo' : '' }, `${UI.num(f.cantidad, 3)} ${f.unidad}`), num: true },
            { titulo: 'Mínimo', valor: (f) => (f.minimo !== null ? UI.num(f.minimo, 3) : ''), num: true },
            { titulo: 'Costo prom.', valor: (f) => UI.pesos(f.costo_promedio), num: true },
            { titulo: 'Valor', valor: (f) => UI.pesos(f.valor), num: true },
          ],
          filas, buscar: ['codigo', 'descripcion', 'deposito'], claseFila: (f) => (f.bajo_minimo ? 'alerta' : ''),
          alClick: (f) => { location.hash = `#/stock/articulo/${f.articulo_id}`; }, vacio: 'Sin existencias con esos filtros',
        })));
    }

    if (p === 'articulos') {
      const arts = await API.get('/api/stock/articulos' + API.qs({ categoria: q.categoria }));
      el.appendChild(h('div', { class: 'filtros' }, UI.select(opCat, q.categoria || '', (v) => ir({ categoria: v }), { vacio: 'Todas las categorías' })));
      el.appendChild(UI.tarjeta(null, UI.tabla({
        columnas: [
          { titulo: 'Código', campo: 'codigo' }, { titulo: 'Descripción', campo: 'descripcion' }, { titulo: 'Categoría', campo: 'categoria' },
          { titulo: 'Unidad', campo: 'unidad' }, { titulo: 'Existencia total', valor: (a) => UI.num(a.existencia, 3), num: true },
          { titulo: 'Costo prom.', valor: (a) => (a.costo_promedio === null ? h('span', { class: 'insignia gris' }, 'sin costo') : UI.pesos(a.costo_promedio)), num: true },
        ],
        filas: arts, buscar: ['codigo', 'descripcion', 'categoria'], alClick: (a) => { location.hash = `#/stock/articulo/${a.id}`; },
      })));
    }

    if (p === 'movimientos') {
      el.appendChild(h('div', { class: 'filtros' },
        UI.select(opDep, q.deposito || '', (v) => ir({ deposito: v }), { vacio: 'Todos los depósitos' }),
        UI.select(Object.entries({ carga_inicial: 'Carga inicial', entrada_manual: 'Entrada manual', entrada_compra: 'Entrada por compra', transferencia: 'Transferencia', consumo: 'Consumo', ajuste: 'Ajuste', devolucion: 'Devolución' })
          .map(([valor, texto]) => ({ valor, texto })), q.tipo || '', (v) => ir({ tipo: v }), { vacio: 'Todos los tipos' })));
      const movs = await API.get('/api/stock/movimientos' + API.qs({ deposito_id: q.deposito, tipo: q.tipo }));
      el.appendChild(UI.tarjeta(null, tablaMovimientos(movs, true)));
    }

    if (p === 'valorizacion') {
      const v = await API.get('/api/stock/valorizacion');
      const total = v.reduce((s, x) => s + x.valor, 0);
      el.appendChild(h('div', { class: 'cifras' }, UI.cifra(UI.pesos(total), 'valor total del stock')));
      el.appendChild(UI.tarjeta(null, UI.tabla({
        columnas: [
          { titulo: 'Depósito', campo: 'deposito' }, { titulo: 'Artículos con stock', campo: 'articulos', num: true },
          { titulo: 'Sin costo cargado', valor: (x) => (x.sin_costo ? h('span', { class: 'insignia naranja' }, x.sin_costo) : '0'), num: true },
          { titulo: 'Valor (costo promedio)', valor: (x) => UI.pesos(x.valor), num: true },
        ],
        filas: v, alClick: (x) => { location.hash = `#/stock?p=existencias&deposito=${x.deposito_id}`; },
      })));
    }

    if (p === 'depositos') {
      el.appendChild(h('div', { class: 'acciones-fila' }, UI.boton('+ Depósito en tierra', () => {
        const f = UI.form([{ nombre: 'nombre', etiqueta: 'Nombre', requerido: true }]);
        UI.modal({ titulo: 'Nuevo depósito en tierra', contenido: f.el, acciones: [{ texto: 'Cancelar' }, { texto: 'Crear', tipo: 'primario', alClick: async (c) => { await API.post('/api/stock/depositos', f.valores()); c(); App.recargar(); } }] });
      })));
      el.appendChild(UI.tarjeta(null, h('p', { class: 'sub' }, 'Cada barco tiene su depósito a bordo, que se crea solo al dar de alta el barco.'), UI.tabla({
        columnas: [{ titulo: 'Depósito', campo: 'nombre' }, { titulo: 'Tipo', valor: (d) => (d.tipo === 'barco' ? `A bordo (${d.barco})` : 'En tierra') }],
        filas: depositos,
        alClick: (d) => {
          if (d.tipo !== 'tierra') return;
          const f = UI.form([{ nombre: 'nombre', etiqueta: 'Nombre', requerido: true }], d);
          UI.modal({ titulo: 'Editar depósito', contenido: f.el, acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', tipo: 'primario', alClick: async (c) => { await API.put(`/api/stock/depositos/${d.id}`, f.valores()); c(); App.recargar(); } }] });
        },
      })));
    }
  });

  function tablaMovimientos(movs, conArticulo) {
    return UI.tabla({
      columnas: [
        { titulo: 'Fecha', valor: (m) => UI.fechaHora(m.fecha) }, { titulo: 'Tipo', valor: (m) => UI.tipoMov(m.tipo) },
        conArticulo ? { titulo: 'Artículo', valor: (m) => `${m.codigo} — ${m.descripcion}` } : null,
        { titulo: 'Sale de', campo: 'origen' }, { titulo: 'Entra a', campo: 'destino' },
        { titulo: 'Cantidad', valor: (m) => UI.num(m.cantidad, 3), num: true },
        { titulo: 'Costo unit.', valor: (m) => UI.pesos(m.costo_unitario), num: true },
        { titulo: 'Motivo / referencia', valor: (m) => [m.motivo, m.ref_tipo === 'trabajo' ? h('a', { href: `#/trabajos/${m.ref_id}` }, ' (pedido)') : null,
          m.ref_tipo === 'compra' ? h('a', { href: `#/compras/${m.ref_id}` }, ' (compra)') : null] },
        { titulo: 'Usuario', campo: 'usuario' },
      ].filter(Boolean),
      filas: movs, buscar: conArticulo ? ['codigo', 'descripcion', 'motivo', 'origen', 'destino'] : null, vacio: 'Sin movimientos',
    });
  }

  function editarArticulo(a, depositos, listas) {
    const f = UI.form([
      { nombre: 'codigo', etiqueta: 'Código', requerido: true, ancho: 'tercio' },
      { nombre: 'descripcion', etiqueta: 'Descripción', requerido: true },
      { nombre: 'categoria', etiqueta: 'Categoría', tipo: 'select', opciones: listas.categoria.map((c) => c.valor), ancho: 'medio', defecto: 'Repuestos' },
      { nombre: 'unidad', etiqueta: 'Unidad', tipo: 'select', opciones: listas.unidad.map((c) => c.valor), ancho: 'medio', defecto: 'u' },
      !a || a.costo_promedio === null ? { nombre: 'costo', etiqueta: 'Costo unitario ($)', tipo: 'number', ancho: 'medio', ayuda: 'Opcional. Después se actualiza solo con cada compra.' } : null,
      a ? null : { seccion: 'Existencia inicial (opcional)' },
      a ? null : { nombre: 'cantidad_inicial', etiqueta: 'Cantidad', tipo: 'number', ancho: 'medio' },
      a ? null : { nombre: 'deposito_id', etiqueta: 'En el depósito', tipo: 'select', ancho: 'medio', opciones: depositos.map((d) => ({ valor: d.id, texto: d.nombre })) },
      { nombre: 'notas', etiqueta: 'Notas', tipo: 'textarea', filas: 2 },
      a ? { nombre: 'activo', etiqueta: 'Activo', tipo: 'checkbox' } : null,
    ], a ? { ...a, activo: !!a.activo } : {});
    UI.modal({
      titulo: a ? 'Editar artículo' : 'Nuevo artículo', contenido: f.el, ancho: 'ancho',
      acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', tipo: 'primario', alClick: async (c) => {
        const v = f.valores();
        if (a) await API.put(`/api/stock/articulos/${a.id}`, v);
        else await API.post('/api/stock/articulos', v);
        c(); UI.aviso('Artículo guardado'); App.recargar();
      } }],
    });
  }

  /** Movimientos manuales: transferencia, consumo, entrada, ajuste. */
  async function nuevoMovimiento(depositos, { tipo: tipoInicial = 'transferencia', origen, articulo } = {}) {
    const arts = await API.get('/api/stock/articulos');
    const tipos = [
      { valor: 'transferencia', texto: 'Transferencia entre depósitos (ej.: de tierra al barco)' },
      { valor: 'consumo', texto: 'Consumo (material usado)' },
      puedeAdmin() ? { valor: 'entrada_manual', texto: 'Entrada manual (sin orden de compra)' } : null,
      puedeAdmin() ? { valor: 'ajuste', texto: 'Ajuste de inventario (conteo físico)' } : null,
    ].filter(Boolean);
    const opDep = depositos.map((d) => ({ valor: d.id, texto: d.nombre }));
    const cont = h('div');
    const selTipo = UI.select(tipos, tipoInicial, () => pintar());
    let f; let items;
    const pintar = () => {
      UI.vaciar(cont);
      const t = selTipo.value;
      f = UI.form([
        t === 'transferencia' || t === 'consumo' ? { nombre: 'origen_id', etiqueta: 'Sale de', tipo: 'select', opciones: opDep, requerido: true, ancho: 'medio', defecto: origen } : null,
        t === 'transferencia' || t === 'entrada_manual' ? { nombre: 'destino_id', etiqueta: 'Entra a', tipo: 'select', opciones: opDep, requerido: true, ancho: 'medio' } : null,
        t === 'ajuste' ? { nombre: 'deposito_id', etiqueta: 'Depósito contado', tipo: 'select', opciones: opDep, requerido: true, defecto: origen } : null,
        { nombre: 'motivo', etiqueta: t === 'consumo' ? 'En qué se usó' : 'Motivo', requerido: t === 'consumo' || t === 'ajuste' },
      ]);
      items = UI.itemsArticulos({
        articulos: arts, items: articulo ? [{ articulo_id: articulo }] : [],
        etiquetaCantidad: t === 'ajuste' ? 'Cantidad contada' : 'Cantidad',
        extra: t === 'entrada_manual' ? { campo: 'costo_unitario', etiqueta: 'Costo unit. $' } : null,
      });
      cont.appendChild(f.el);
      cont.appendChild(h('h4', { class: 'form-seccion' }, t === 'ajuste' ? 'Artículos contados' : 'Artículos'));
      cont.appendChild(items.el);
      if (t === 'ajuste') cont.appendChild(h('p', { class: 'sub' }, 'Poné la cantidad que hay físicamente. El sistema registra la diferencia con lo que figura.'));
    };
    pintar();
    UI.modal({
      titulo: 'Nuevo movimiento de stock', ancho: 'ancho',
      contenido: h('div', null, h('div', { class: 'campo' }, h('label', null, 'Tipo de movimiento'), selTipo), cont),
      acciones: [{ texto: 'Cancelar' }, { texto: 'Registrar', tipo: 'primario', alClick: async (c) => {
        const t = selTipo.value;
        const v = f.valores();
        const its = items.items().map((i) => (t === 'ajuste' ? { articulo_id: i.articulo_id, contado: i.cantidad } : i));
        const r = await API.post('/api/stock/movimientos', { tipo: t, ...v, items: its });
        c(); UI.aviso(`${r.ids.length} movimiento(s) registrado(s)`); App.recargar();
      } }],
    });
  }

  App.ruta('/stock/articulo/:id', async (el, { id }) => {
    const [a, depositos, listas] = await Promise.all([API.get(`/api/stock/articulos/${id}`), API.get('/api/stock/depositos'), App.obtenerListas()]);
    el.appendChild(UI.cabecera(a.descripcion, {
      volver: '#/stock?p=articulos', sub: `${a.codigo} · ${a.categoria} · ${a.unidad}${a.activo ? '' : ' · INACTIVO'}`,
      acciones: [
        puedeCargar() ? UI.boton('Nuevo movimiento', () => nuevoMovimiento(depositos, { articulo: a.id }), 'primario') : null,
        puedeAdmin() ? UI.boton('Editar', () => editarArticulo(a, depositos, listas)) : null,
      ],
    }));
    const total = a.depositos.reduce((s, d) => s + d.existencia, 0);
    el.appendChild(h('div', { class: 'datos' },
      UI.dato('Existencia total', `${UI.num(total, 3)} ${a.unidad}`),
      UI.dato('Costo promedio', UI.pesos(a.costo_promedio)), UI.dato('Último costo', UI.pesos(a.ultimo_costo)),
      UI.dato('Valor total', a.costo_promedio !== null ? UI.pesos(total * a.costo_promedio) : '—')));
    if (a.notas) el.appendChild(UI.tarjeta(null, h('p', null, a.notas)));
    el.appendChild(UI.tarjeta('Por depósito', UI.tabla({
      columnas: [
        { titulo: 'Depósito', campo: 'nombre' },
        { titulo: 'Existencia', valor: (d) => h('span', { class: d.minimo !== null && d.existencia < d.minimo ? 'texto-rojo' : '' }, `${UI.num(d.existencia, 3)} ${a.unidad}`), num: true },
        { titulo: 'Mínimo', valor: (d) => (d.minimo !== null ? UI.num(d.minimo, 3) : '—'), num: true },
        puedeAdmin() ? { titulo: '', valor: (d) => UI.boton('Mínimo', () => {
          const f = UI.form([{ nombre: 'minimo', etiqueta: `Stock mínimo en ${d.nombre}`, tipo: 'number', ayuda: 'Vacío o 0 para quitarlo' }], d);
          UI.modal({ titulo: 'Stock mínimo', contenido: f.el, acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', tipo: 'primario', alClick: async (c) => {
            await API.put(`/api/stock/articulos/${a.id}/minimos`, { deposito_id: d.id, minimo: f.valores().minimo }); c(); App.recargar();
          } }] });
        }, 'chico') } : null,
      ].filter(Boolean),
      filas: a.depositos,
    })));
    el.appendChild(UI.tarjeta('Últimos movimientos', tablaMovimientos(a.movimientos, false)));
  });

  // ── Importación desde Excel ────────────────────────────────────────

  const CAMPOS_IMPORT = [
    { clave: 'codigo', texto: 'Código', req: true, pistas: ['codigo', 'código', 'cod', 'code', 'item', 'nro'] },
    { clave: 'descripcion', texto: 'Descripción', req: true, pistas: ['descripcion', 'descripción', 'detalle', 'articulo', 'artículo', 'nombre', 'producto'] },
    { clave: 'categoria', texto: 'Categoría', pistas: ['categoria', 'categoría', 'rubro', 'familia', 'tipo'] },
    { clave: 'unidad', texto: 'Unidad', pistas: ['unidad', 'um', 'u.m.', 'medida'] },
    { clave: 'cantidad', texto: 'Cantidad / existencia', pistas: ['cantidad', 'cant', 'stock', 'existencia', 'saldo'] },
    { clave: 'costo', texto: 'Costo unitario', pistas: ['costo', 'precio', 'valor', 'p. unit', 'unitario'] },
    { clave: 'minimo', texto: 'Stock mínimo', pistas: ['minimo', 'mínimo', 'min', 'punto de pedido'] },
  ];

  function cargarXLSX() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((ok, mal) => {
      const s = document.createElement('script');
      s.src = '/vendor/xlsx.full.min.js';
      s.onload = ok;
      s.onerror = () => mal(new Error('No se pudo cargar el lector de planillas'));
      document.head.appendChild(s);
    });
  }

  App.ruta('/stock/importar', async (el) => {
    await cargarXLSX();
    const depositos = await API.get('/api/stock/depositos');
    el.appendChild(UI.cabecera('Importar artículos desde Excel', { volver: '#/stock?p=articulos' }));
    const paso = h('div');
    el.appendChild(UI.tarjeta(null, paso));

    const archivo = h('input', { type: 'file', accept: '.xlsx,.xls,.csv,.ods' });
    UI.vaciar(paso).appendChild(h('div', null,
      h('p', null, h('strong', null, '1. Elegí la planilla. '), 'Sirve cualquier Excel o CSV con una fila de títulos (código, descripción, cantidad…). Nada se graba hasta que confirmes.'),
      archivo));

    archivo.addEventListener('change', async () => {
      const file = archivo.files[0];
      if (!file) return;
      try {
        const libro = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        elegirHoja(libro, file.name);
      } catch (e) { UI.error(new Error('No se pudo leer el archivo. ¿Es una planilla válida?')); }
    });

    function elegirHoja(libro, nombre) {
      const hojas = libro.SheetNames;
      const sel = UI.select(hojas.map((x) => ({ valor: x, texto: x })), hojas[0], () => mapear());
      const zona = h('div');
      UI.vaciar(paso).appendChild(h('div', null, h('p', null, h('strong', null, `2. ${nombre}: `), 'elegí la hoja y qué columna es cada dato.'),
        h('div', { class: 'campo' }, h('label', null, 'Hoja'), sel), zona));
      const mapear = () => {
        const filas = XLSX.utils.sheet_to_json(libro.Sheets[sel.value], { defval: '', raw: true });
        UI.vaciar(zona);
        if (!filas.length) { zona.appendChild(h('p', { class: 'texto-rojo' }, 'La hoja está vacía.')); return; }
        const columnas = Object.keys(filas[0]);
        const norm = (s) => String(s).toLowerCase().trim();
        const selects = {};
        const form = h('div', { class: 'form' }, CAMPOS_IMPORT.map((c) => {
          const adivinada = columnas.find((col) => c.pistas.some((p) => norm(col) === p || norm(col).startsWith(p)));
          selects[c.clave] = UI.select(columnas.map((x) => ({ valor: x, texto: x })), adivinada || '', null, { vacio: c.req ? '— Elegir —' : '— No está en la planilla —' });
          return h('div', { class: 'campo medio' }, h('label', null, c.texto, c.req ? h('span', { class: 'req' }, ' *') : null), selects[c.clave]);
        }));
        const dep = UI.select(depositos.map((d) => ({ valor: d.id, texto: d.nombre })), depositos[0] && depositos[0].id, null, { vacio: '— Sin cantidades —' });
        const actualizar = h('input', { type: 'checkbox' });
        zona.appendChild(form);
        zona.appendChild(h('div', { class: 'campo' }, h('label', null, 'Las cantidades entran al depósito'), dep));
        zona.appendChild(h('label', { class: 'campo check' }, actualizar, h('span', null, 'Si un código ya existe, actualizar su descripción, categoría y unidad')));
        zona.appendChild(h('p', { class: 'sub' }, `${filas.length} filas en la hoja.`));
        const armar = () => {
          for (const c of CAMPOS_IMPORT) if (c.req && !selects[c.clave].value) throw new Error(`Elegí la columna de "${c.texto}"`);
          return filas.map((f) => Object.fromEntries(CAMPOS_IMPORT.filter((c) => selects[c.clave].value).map((c) => [c.clave, f[selects[c.clave].value]])))
            .filter((f) => Object.values(f).some((v) => String(v).trim() !== ''));
        };
        zona.appendChild(h('div', { class: 'acciones-fila' }, UI.boton('Revisar antes de importar', async () => {
          const datos = { filas: armar(), deposito_id: dep.value || null, actualizar_existentes: actualizar.checked };
          const r = await API.post('/api/stock/importar', datos);
          previsualizar(r, datos);
        }, 'primario')));
      };
      mapear();
    }

    function previsualizar(r, datos) {
      UI.vaciar(paso).appendChild(h('div', null,
        h('p', null, h('strong', null, '3. Revisión. '), 'Las filas con error no se importan; el resto sí.'),
        h('div', { class: 'cifras' },
          UI.cifra(r.resumen.nuevos, 'artículos nuevos', { tono: 'verde' }),
          UI.cifra(r.resumen.existentes, 'ya existían'),
          UI.cifra(r.resumen.errores, 'con errores', { tono: r.resumen.errores ? 'rojo' : '' })),
        UI.tabla({
          columnas: [
            { titulo: 'Fila', campo: 'fila' }, { titulo: 'Estado', valor: (f) => h('span', { class: `insignia ${f.estado === 'error' ? 'rojo' : f.estado === 'nuevo' ? 'verde' : 'gris'}` }, f.estado) },
            { titulo: 'Código', campo: 'codigo' }, { titulo: 'Descripción', campo: 'descripcion' },
            { titulo: 'Cantidad', valor: (f) => UI.num(f.cantidad, 3), num: true }, { titulo: 'Costo', valor: (f) => UI.pesos(f.costo), num: true },
            { titulo: 'Problema', valor: (f) => f.errores.join(', ') },
          ],
          filas: r.filas,
        }),
        h('div', { class: 'acciones-fila' },
          h('a', { class: 'btn', href: '#/stock/importar', onclick: () => setTimeout(() => App.recargar(), 0) }, 'Empezar de nuevo'),
          UI.boton(`Importar ${r.resumen.nuevos + r.resumen.existentes} filas`, async () => {
            const fin = await API.post('/api/stock/importar', { ...datos, confirmar: true });
            UI.aviso(`Importación lista: ${fin.resumen.nuevos} nuevos, ${fin.resumen.existentes} existentes`);
            location.hash = '#/stock?p=articulos';
          }, 'primario'))));
    }
  });
}());
