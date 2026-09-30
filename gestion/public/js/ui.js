/**
 * Piezas comunes del panel: construcción de elementos, tablas, formularios,
 * ventanas, avisos y formatos.
 *
 * Todo el contenido se arma con `h()` (textContent), nunca con innerHTML de
 * datos: un nombre de artículo con "<script>" se muestra como texto.
 */

/* global App */

const UI = {};

/**
 * h('div', { class: 'x', onclick: fn }, 'texto', otroElemento, [lista])
 * Atributos: class, style (texto u objeto), on<evento>, dataset, y el resto
 * como atributo. null/false/undefined en hijos se ignoran.
 */
UI.h = function h(tag, attrs, ...hijos) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'disabled') el.disabled = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  const agregar = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(agregar);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  };
  hijos.forEach(agregar);
  return el;
};
const h = UI.h;

UI.vaciar = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// ── Formatos (Argentina) ─────────────────────────────────────────────

UI.num = (n, dec = 2) => (n === null || n === undefined || n === '' ? '—'
  : Number(n).toLocaleString('es-AR', { maximumFractionDigits: dec }));
UI.pesos = (n) => (n === null || n === undefined ? '—'
  : Number(n).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }));
UI.moneda = (n, m = 'ARS') => (n === null || n === undefined ? '—'
  : Number(n).toLocaleString('es-AR', { style: 'currency', currency: m, maximumFractionDigits: 2 }));
UI.fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-AR') : '—');
UI.fechaHora = (iso) => (iso ? new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
/** ISO → valor para <input type="datetime-local"> en hora local */
UI.aInputFechaHora = (iso) => {
  const d = iso ? new Date(iso) : new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
UI.aInputFecha = (iso) => UI.aInputFechaHora(iso).slice(0, 10);
UI.coord = (lat, lon) => (lat === null || lat === undefined ? '—' : `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`);

// ── Estados con color ────────────────────────────────────────────────

const ESTADOS = {
  // trabajos
  pendiente: ['Pendiente', 'amarillo'], aprobado: ['Aprobado', 'azul'], en_curso: ['En curso', 'azul'],
  realizado: ['Realizado', 'verde'], cerrado: ['Cerrado', 'gris'], rechazado: ['Rechazado', 'rojo'],
  // compras
  solicitada: ['Solicitada', 'amarillo'], cotizada: ['Cotizada', 'azul'], pendiente_segunda: ['Falta 2ª aprobación', 'naranja'],
  aprobada: ['Aprobada · OC emitida', 'azul'], recibida_parcial: ['Recibida parcial', 'naranja'], recibida: ['Recibida', 'verde'],
  cancelada: ['Cancelada', 'gris'],
  // mantenimiento
  vencida: ['Vencida', 'rojo'], proxima: ['Por vencer', 'naranja'], ok: ['Al día', 'verde'], sin_registro: ['Sin punto de partida', 'gris'],
  // pesca
  abierta: ['En curso', 'azul'], cerrada_marea: ['Cerrada', 'gris'],
  // prioridad
  urgente: ['Urgente', 'rojo'], alta: ['Alta', 'naranja'], normal: ['Normal', 'gris'], baja: ['Baja', 'gris'],
};
UI.estado = (e) => {
  const [t, c] = ESTADOS[e] || [String(e || '').replace(/_/g, ' '), 'gris'];
  return h('span', { class: `insignia ${c}` }, t);
};

const TIPOS_MOV = {
  carga_inicial: 'Carga inicial', entrada_manual: 'Entrada manual', entrada_compra: 'Entrada por compra',
  transferencia: 'Transferencia', consumo: 'Consumo', ajuste: 'Ajuste de inventario', devolucion: 'Devolución',
};
UI.tipoMov = (t) => TIPOS_MOV[t] || t;

// ── Avisos ───────────────────────────────────────────────────────────

UI.aviso = (texto, tipo = 'ok') => {
  const caja = document.getElementById('avisos');
  const el = h('div', { class: `aviso ${tipo}`, role: 'status' }, texto);
  caja.appendChild(el);
  setTimeout(() => el.classList.add('saliendo'), tipo === 'error' ? 6000 : 3000);
  setTimeout(() => el.remove(), tipo === 'error' ? 6500 : 3500);
};
UI.error = (err) => UI.aviso(err && err.message ? err.message : String(err), 'error');

// ── Ventana modal ────────────────────────────────────────────────────

/**
 * UI.modal({ titulo, contenido, acciones: [{ texto, tipo, alClick(cerrar) }], ancho })
 * Devuelve { cerrar }. alClick puede ser async: el botón queda deshabilitado
 * mientras corre, y si tira error se muestra y la ventana sigue abierta.
 */
UI.modal = ({ titulo, contenido, acciones = [], ancho = 'normal', alCerrar }) => {
  const fondo = h('div', { class: 'modal-fondo' });
  let cerrado = false;
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    fondo.remove();
    document.removeEventListener('keydown', esc);
    if (alCerrar) alCerrar();
  };
  const esc = (e) => { if (e.key === 'Escape') cerrar(); };
  document.addEventListener('keydown', esc);
  const botones = acciones.map((a) => {
    const b = h('button', { class: `btn ${a.tipo || ''}`, type: 'button' }, a.texto);
    b.addEventListener('click', async () => {
      if (!a.alClick) return cerrar();
      b.disabled = true;
      try { await a.alClick(cerrar); } catch (err) { UI.error(err); } finally { b.disabled = false; }
    });
    return b;
  });
  const caja = h('div', { class: `modal ${ancho}`, role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-cab' }, h('h3', null, titulo),
      h('button', { class: 'btn-icono', type: 'button', 'aria-label': 'Cerrar', onclick: cerrar }, '×')),
    h('div', { class: 'modal-cuerpo' }, contenido),
    botones.length ? h('div', { class: 'modal-pie' }, botones) : null);
  fondo.appendChild(caja);
  fondo.addEventListener('mousedown', (e) => { if (e.target === fondo) cerrar(); });
  document.body.appendChild(fondo);
  const primero = caja.querySelector('input, select, textarea');
  if (primero) setTimeout(() => primero.focus(), 30);
  return { cerrar };
};

UI.confirmar = (titulo, texto, { boton = 'Confirmar', peligro = false } = {}) => new Promise((resolve) => {
  let respuesta = false;
  UI.modal({
    titulo, contenido: h('p', null, texto),
    alCerrar: () => resolve(respuesta),
    acciones: [
      { texto: 'Cancelar' },
      { texto: boton, tipo: peligro ? 'peligro' : 'primario', alClick: (c) => { respuesta = true; c(); } },
    ],
  });
});

// ── Formularios ──────────────────────────────────────────────────────

/**
 * UI.form(campos, valores) → { el, valores(), campo(nombre) }
 * campo: { nombre, etiqueta, tipo: text|number|textarea|select|checkbox|date|datetime|password,
 *          opciones: [{valor, texto}] | [texto], requerido, ayuda, ancho: 'medio'|'tercio', min, paso }
 */
UI.form = (campos, valores = {}) => {
  const controles = {};
  const filas = campos.filter(Boolean).map((c) => {
    if (c.seccion) return h('h4', { class: 'form-seccion' }, c.seccion);
    const id = `f-${c.nombre}-${Math.random().toString(36).slice(2, 7)}`;
    const v = valores[c.nombre] !== undefined ? valores[c.nombre] : c.defecto;
    let ctrl;
    if (c.tipo === 'textarea') {
      ctrl = h('textarea', { id, rows: c.filas || 3, placeholder: c.placeholder || '' });
      ctrl.value = v ?? '';
    } else if (c.tipo === 'select') {
      ctrl = h('select', { id },
        c.vacio !== false ? h('option', { value: '' }, c.vacio || '— Elegir —') : null,
        (c.opciones || []).map((o) => {
          const val = typeof o === 'object' ? o.valor : o;
          const txt = typeof o === 'object' ? o.texto : o;
          return h('option', { value: String(val) }, txt);
        }));
      ctrl.value = v === null || v === undefined ? '' : String(v);
    } else if (c.tipo === 'checkbox') {
      ctrl = h('input', { id, type: 'checkbox', checked: !!v });
    } else {
      const tipos = { number: 'text', date: 'date', datetime: 'datetime-local', password: 'password', text: 'text' };
      ctrl = h('input', {
        id, type: tipos[c.tipo || 'text'] || 'text', placeholder: c.placeholder || '',
        inputmode: c.tipo === 'number' ? 'decimal' : null, autocomplete: c.autocomplete || 'off', list: c.lista || null,
      });
      if (c.tipo === 'datetime') ctrl.value = v ? UI.aInputFechaHora(v) : '';
      else if (c.tipo === 'date') ctrl.value = v ? UI.aInputFecha(v) : '';
      else ctrl.value = v === null || v === undefined ? '' : String(v);
    }
    if (c.alCambiar) ctrl.addEventListener('change', () => c.alCambiar(ctrl));
    controles[c.nombre] = { ctrl, def: c };
    if (c.tipo === 'checkbox') {
      return h('label', { class: `campo check ${c.ancho || ''}`, for: id }, ctrl, h('span', null, c.etiqueta),
        c.ayuda ? h('small', null, c.ayuda) : null);
    }
    return h('div', { class: `campo ${c.ancho || ''}` },
      h('label', { for: id }, c.etiqueta, c.requerido ? h('span', { class: 'req' }, ' *') : null),
      ctrl, c.ayuda ? h('small', null, c.ayuda) : null);
  });
  const el = h('div', { class: 'form' }, filas);
  return {
    el,
    campo: (n) => controles[n] && controles[n].ctrl,
    valores() {
      const out = {};
      for (const [n, { ctrl, def }] of Object.entries(controles)) {
        let v;
        if (def.tipo === 'checkbox') v = ctrl.checked;
        else if (def.tipo === 'datetime' || def.tipo === 'date') v = ctrl.value ? new Date(ctrl.value).toISOString() : null;
        else v = ctrl.value.trim();
        if (def.requerido && (v === '' || v === null)) {
          ctrl.focus();
          throw new Error(`Completá "${def.etiqueta}"`);
        }
        out[n] = v === '' ? null : v;
      }
      return out;
    },
  };
};

// ── Tablas ───────────────────────────────────────────────────────────

/**
 * UI.tabla({ columnas: [{ titulo, campo | valor(fila), clase, num }], filas, alClick(fila), vacio })
 * Con buscador opcional: buscar: ['campo1', 'campo2']
 */
UI.tabla = ({ columnas, filas, alClick, vacio = 'No hay datos para mostrar', buscar, claseFila }) => {
  const cuerpo = h('tbody');
  const pintar = (lista) => {
    UI.vaciar(cuerpo);
    if (!lista.length) {
      cuerpo.appendChild(h('tr', null, h('td', { colspan: columnas.length, class: 'vacio' }, vacio)));
      return;
    }
    for (const f of lista) {
      const tr = h('tr', { class: [alClick ? 'clic' : '', claseFila ? claseFila(f) : ''].join(' ').trim() || null },
        columnas.map((c) => {
          const v = c.valor ? c.valor(f) : f[c.campo];
          return h('td', { class: [c.num ? 'num' : '', c.clase || ''].join(' ').trim() || null, 'data-titulo': c.titulo },
            v === null || v === undefined || v === '' ? '—' : v);
        }));
      if (alClick) {
        tr.tabIndex = 0;
        tr.addEventListener('click', () => alClick(f));
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') alClick(f); });
      }
      cuerpo.appendChild(tr);
    }
  };
  pintar(filas);
  const tabla = h('table', { class: 'tabla' },
    h('thead', null, h('tr', null, columnas.map((c) => h('th', { class: c.num ? 'num' : null }, c.titulo)))), cuerpo);
  if (!buscar) return h('div', { class: 'tabla-caja' }, tabla);
  const input = h('input', { type: 'search', class: 'buscador', placeholder: 'Buscar…' });
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    pintar(!q ? filas : filas.filter((f) => buscar.some((k) => String(f[k] ?? '').toLowerCase().includes(q))));
  });
  return h('div', null, input, h('div', { class: 'tabla-caja' }, tabla));
};

// ── Página ───────────────────────────────────────────────────────────

/** Encabezado de página: título, subtítulo y botones a la derecha. */
UI.cabecera = (titulo, { sub, acciones = [], volver } = {}) => h('div', { class: 'cabecera' },
  h('div', null,
    volver ? h('a', { href: volver, class: 'volver' }, '← Volver') : null,
    h('h1', null, titulo), sub ? h('p', { class: 'sub' }, sub) : null),
  h('div', { class: 'acciones' }, acciones.filter(Boolean)));

UI.boton = (texto, alClick, tipo = '') => {
  const b = h('button', { class: `btn ${tipo}`, type: 'button' }, texto);
  b.addEventListener('click', async () => {
    b.disabled = true;
    try { await alClick(); } catch (err) { UI.error(err); } finally { b.disabled = false; }
  });
  return b;
};

UI.tarjeta = (titulo, ...contenido) => h('section', { class: 'tarjeta' }, titulo ? h('h2', null, titulo) : null, contenido);

UI.dato = (etiqueta, valor) => h('div', { class: 'dato' }, h('span', null, etiqueta), h('strong', null, valor ?? '—'));

UI.cifra = (valor, etiqueta, { tono = '', href } = {}) => h(href ? 'a' : 'div', { class: `cifra ${tono}`, href },
  h('strong', null, valor), h('span', null, etiqueta));

UI.cargando = () => h('div', { class: 'cargando' }, 'Cargando…');

UI.pestanas = (pestanas, activa, alCambiar) => h('div', { class: 'pestanas', role: 'tablist' },
  pestanas.map((p) => h('button', {
    class: `pestana ${p.clave === activa ? 'activa' : ''}`, type: 'button', role: 'tab',
    onclick: () => alCambiar(p.clave),
  }, p.texto)));

// ── Selector de artículos con cantidades ─────────────────────────────

/**
 * Lista editable de { articulo_id, cantidad, [precio_unitario|costo_unitario|contado] }.
 * UI.itemsArticulos({ articulos, items, extra: { campo, etiqueta } | null, etiquetaCantidad })
 * → { el, items() }
 */
UI.itemsArticulos = ({ articulos, items = [], extra = null, etiquetaCantidad = 'Cantidad', mostrarExistencia = null }) => {
  const filas = [];
  const cuerpo = h('div', { class: 'items' });
  const lista = `arts-${Math.random().toString(36).slice(2, 7)}`;
  const datalist = h('datalist', { id: lista }, articulos.map((a) => h('option', { value: `${a.codigo} — ${a.descripcion}` })));
  const porTexto = new Map(articulos.map((a) => [`${a.codigo} — ${a.descripcion}`, a]));
  const porId = new Map(articulos.map((a) => [a.id, a]));

  const agregar = (it = {}) => {
    const a = it.articulo_id ? porId.get(Number(it.articulo_id)) : null;
    const busc = h('input', { type: 'text', list: lista, placeholder: 'Código o descripción', value: a ? `${a.codigo} — ${a.descripcion}` : '' });
    const cant = h('input', { type: 'text', inputmode: 'decimal', class: 'corto', placeholder: etiquetaCantidad, value: it.cantidad ?? it.contado ?? '' });
    const ext = extra ? h('input', { type: 'text', inputmode: 'decimal', class: 'corto', placeholder: extra.etiqueta, value: it[extra.campo] ?? '' }) : null;
    const unidad = h('span', { class: 'unidad' }, a ? a.unidad : '');
    const info = h('small', { class: 'info-exist' }, '');
    const actualizar = () => {
      const art = porTexto.get(busc.value);
      unidad.textContent = art ? art.unidad : '';
      info.textContent = art && mostrarExistencia ? mostrarExistencia(art) : '';
    };
    busc.addEventListener('change', actualizar);
    busc.addEventListener('input', actualizar);
    actualizar();
    const fila = h('div', { class: 'item' }, busc, cant, unidad, ext,
      h('button', { class: 'btn-icono', type: 'button', 'aria-label': 'Quitar', onclick: () => { fila.remove(); filas.splice(filas.indexOf(reg), 1); } }, '×'),
      info);
    const reg = { busc, cant, ext };
    filas.push(reg);
    cuerpo.appendChild(fila);
  };
  items.forEach(agregar);
  if (!items.length) agregar();
  const el = h('div', null, datalist, cuerpo,
    h('button', { class: 'btn chico', type: 'button', onclick: () => agregar() }, '+ Agregar artículo'));
  return {
    el,
    items() {
      const out = [];
      for (const f of filas) {
        if (!f.busc.value.trim() && !f.cant.value.trim()) continue;
        const a = porTexto.get(f.busc.value);
        if (!a) throw new Error(`No se encontró el artículo "${f.busc.value}". Elegilo de la lista.`);
        const n = (s) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
        const cantidad = n(f.cant.value);
        if (cantidad === null || !Number.isFinite(cantidad)) throw new Error(`Falta la cantidad de "${a.descripcion}"`);
        const it = { articulo_id: a.id, cantidad };
        if (extra) it[extra.campo] = n(f.ext.value);
        out.push(it);
      }
      return out;
    },
  };
};

/** Selector simple con opciones { valor, texto }. */
UI.select = (opciones, valor, alCambiar, { vacio } = {}) => {
  const s = h('select', null, vacio ? h('option', { value: '' }, vacio) : null,
    opciones.map((o) => h('option', { value: String(o.valor) }, o.texto)));
  s.value = valor === null || valor === undefined ? '' : String(valor);
  if (alCambiar) s.addEventListener('change', () => alCambiar(s.value));
  return s;
};

/** Pide la posición al teléfono (GPS del navegador). */
UI.posicionTelefono = () => new Promise((resolve) => {
  if (!navigator.geolocation) return resolve(null);
  navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, origen: 'telefono' }),
    () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
});
