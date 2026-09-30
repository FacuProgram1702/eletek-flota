/**
 * Arranque del panel: sesión, menú según permisos y rutas (#/modulo/...).
 *
 * Cada vista se registra con App.ruta('/stock/articulos/:id', fn). La función
 * recibe (contenedor, params) y dibuja la página adentro.
 */

/* global UI, API */

const App = {
  sesion: null,
  rutas: [],
  listas: null,

  ruta(patron, fn) {
    const claves = [];
    const re = new RegExp('^' + patron.replace(/:(\w+)/g, (_, k) => { claves.push(k); return '([^/]+)'; }) + '$');
    this.rutas.push({ re, claves, fn });
  },

  puede(modulo, accion = 'ver') {
    const s = this.sesion;
    return !!s && s.modulos.includes(modulo) && (s.permisos[modulo] || []).includes(accion);
  },

  get esAdmin() { return !!(this.sesion && this.sesion.usuario.es_admin); },
  get barcos() { return this.sesion ? this.sesion.barcos : []; },

  /** Listas de la empresa (categorías, unidades, especies…), con caché. */
  async obtenerListas(forzar = false) {
    if (!this.listas || forzar) this.listas = await API.get('/api/admin/listas');
    return this.listas;
  },

  irALogin() {
    this.sesion = null;
    this.pintarLogin();
  },

  async iniciar() {
    if (!this.escuchando) {
      window.addEventListener('hashchange', () => this.navegar());
      this.escuchando = true;
    }
    try {
      const s = await API.get('/auth/yo');
      if (!s.autenticado) return this.pintarLogin();
      this.sesion = s;
      this.pintarMarco();
      this.navegar();
    } catch (e) {
      document.getElementById('app').textContent = e.message;
    }
  },

  pintarLogin() {
    const { h } = UI;
    const raiz = UI.vaciar(document.getElementById('app'));
    document.body.classList.add('en-login');
    const f = UI.form([
      { nombre: 'usuario', etiqueta: 'Usuario', requerido: true, autocomplete: 'username' },
      { nombre: 'clave', etiqueta: 'Contraseña', tipo: 'password', requerido: true, autocomplete: 'current-password' },
    ]);
    const error = h('p', { class: 'error-login', role: 'alert' });
    const entrar = async (ev) => {
      ev.preventDefault();
      error.textContent = '';
      try {
        await API.post('/auth/login', f.valores());
        document.body.classList.remove('en-login');
        this.listas = null;
        await this.iniciar();
      } catch (e) { error.textContent = e.message; }
    };
    raiz.appendChild(h('div', { class: 'login' },
      h('form', { class: 'login-caja', onsubmit: entrar },
        h('div', { class: 'marca' }, h('span', { class: 'logo' }, 'E'), h('div', null, h('strong', null, 'ELETEK'), h('span', null, 'Gestión de flota'))),
        f.el, error, h('button', { class: 'btn primario ancho', type: 'submit' }, 'Ingresar'))));
  },

  /** Menú lateral: solo lo que el usuario puede ver. */
  menu() {
    const s = this.sesion;
    const items = [];
    if (!s.empresa && s.usuario.es_superadmin) {
      items.push({ texto: 'Empresas', href: '#/super/empresas', icono: '🏢' });
      return items;
    }
    const aBordo = s.usuario.solo_a_bordo;
    items.push(aBordo
      ? { texto: 'Mis tareas', href: '#/mis-tareas', icono: '✓' }
      : { texto: 'Inicio', href: '#/', icono: '⌂' });
    if (!aBordo) items.push({ texto: 'Mis tareas', href: '#/mis-tareas', icono: '✓' });
    if (this.puede('mantenimiento')) items.push({ texto: 'Mantenimiento', href: '#/mantenimiento', icono: '⚙' });
    if (this.puede('trabajos')) items.push({ texto: 'Pedidos de trabajo', href: '#/trabajos', icono: '🔧' });
    if (this.puede('stock')) items.push({ texto: 'Stock', href: '#/stock', icono: '▦' });
    if (this.puede('compras')) items.push({ texto: 'Compras', href: '#/compras', icono: '🛒' });
    if (this.puede('proveedores')) items.push({ texto: 'Proveedores y talleres', href: '#/proveedores', icono: '☎' });
    if (this.puede('pesca')) items.push({ texto: 'Partes de pesca', href: '#/pesca', icono: '🐟' });
    if (this.puede('viveres')) items.push({ texto: 'Víveres', href: '#/viveres', icono: '🍞' });
    if (this.puede('seguimiento')) items.push({ texto: 'Seguimiento', href: '#/seguimiento', icono: '🧭' });
    if (s.conectividad_url) items.push({ texto: 'Internet de a bordo', href: s.conectividad_url, icono: '📶', externo: true });
    if (this.esAdmin) items.push({ texto: 'Administración', href: '#/admin', icono: '☰' });
    if (s.usuario.es_superadmin) items.push({ texto: 'Empresas (ELETEK)', href: '#/super/empresas', icono: '🏢' });
    return items;
  },

  pintarMarco() {
    const { h } = UI;
    const s = this.sesion;
    const raiz = UI.vaciar(document.getElementById('app'));
    document.body.classList.remove('en-login');
    const nav = h('nav', { class: 'menu', id: 'menu' },
      this.menu().map((i) => h('a', { href: i.href, target: i.externo ? '_blank' : null, rel: i.externo ? 'noopener' : null },
        h('span', { class: 'icono', 'aria-hidden': 'true' }, i.icono), i.texto)));
    const alternar = () => document.body.classList.toggle('menu-abierto');
    nav.addEventListener('click', (e) => { if (e.target.closest('a')) document.body.classList.remove('menu-abierto'); });
    const usuario = h('details', { class: 'usuario' },
      h('summary', null, s.usuario.nombre),
      h('div', { class: 'usuario-menu' },
        h('small', null, s.usuario.roles.map((r) => r.nombre).join(', ') || (s.usuario.es_admin ? 'Administrador' : '')),
        h('button', { class: 'btn chico', type: 'button', onclick: () => this.cambiarClave() }, 'Cambiar contraseña'),
        h('button', { class: 'btn chico', type: 'button', onclick: async () => { await API.post('/auth/logout'); this.irALogin(); } }, 'Salir')));
    raiz.appendChild(h('header', { class: 'barra' },
      h('button', { class: 'btn-icono hamburguesa', type: 'button', 'aria-label': 'Menú', onclick: alternar }, '☰'),
      h('a', { class: 'marca', href: '#/' }, h('span', { class: 'logo' }, 'E'), h('strong', null, 'ELETEK')),
      h('span', { class: 'empresa' }, s.empresa ? s.empresa.nombre : 'ELETEK — soporte'),
      s.usuario.es_superadmin && s.empresa
        ? h('button', { class: 'btn chico', type: 'button', onclick: async () => { await API.post('/auth/empresa-activa', { empresa_id: null }); location.hash = '#/super/empresas'; location.reload(); } }, 'Salir de la empresa')
        : null,
      usuario));
    raiz.appendChild(h('div', { class: 'cuerpo' }, nav, h('main', { id: 'contenido', tabindex: '-1' })));
  },

  cambiarClave() {
    const f = UI.form([
      { nombre: 'actual', etiqueta: 'Contraseña actual', tipo: 'password', requerido: true },
      { nombre: 'nueva', etiqueta: 'Contraseña nueva', tipo: 'password', requerido: true, ayuda: 'Mínimo 8 caracteres' },
    ]);
    UI.modal({
      titulo: 'Cambiar contraseña', contenido: f.el,
      acciones: [{ texto: 'Cancelar' }, {
        texto: 'Guardar', tipo: 'primario',
        alClick: async (cerrar) => { await API.post('/auth/cambiar-clave', f.valores()); cerrar(); UI.aviso('Contraseña actualizada'); },
      }],
    });
  },

  async navegar() {
    if (!this.sesion) return;
    const cont = document.getElementById('contenido');
    if (!cont) return;
    let camino = (location.hash || '#/').slice(1) || '/';
    camino = camino.split('?')[0];
    if (camino === '/') {
      if (!this.sesion.empresa && this.sesion.usuario.es_superadmin) camino = '/super/empresas';
      else if (this.sesion.usuario.solo_a_bordo) camino = '/mis-tareas';
    }
    // Marca en el menú la sección actual
    document.querySelectorAll('#menu a').forEach((a) => {
      const href = a.getAttribute('href').slice(1);
      a.classList.toggle('activo', href === camino || (href !== '/' && camino.startsWith(href + '/')) || href === camino);
    });
    for (const r of this.rutas) {
      const m = camino.match(r.re);
      if (!m) continue;
      const params = {};
      r.claves.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      UI.vaciar(cont).appendChild(UI.cargando());
      try {
        const pagina = UI.h('div', { class: 'pagina' });
        await r.fn(pagina, params);
        UI.vaciar(cont).appendChild(pagina);
        cont.focus({ preventScroll: true });
        window.scrollTo(0, 0);
      } catch (e) {
        UI.vaciar(cont).appendChild(UI.h('div', { class: 'pagina' }, UI.h('div', { class: 'tarjeta error' }, e.message)));
      }
      return;
    }
    UI.vaciar(cont).appendChild(UI.h('div', { class: 'pagina' }, UI.h('p', null, 'Página no encontrada.')));
  },

  /** Parámetros después de "?" en el hash: #/stock?bajo=1 → { bajo: '1' } */
  query() {
    const q = (location.hash.split('?')[1] || '');
    return Object.fromEntries(new URLSearchParams(q));
  },

  /** Artículos para los selectores (si el usuario puede ver stock). */
  async articulos() {
    if (!this.puede('stock')) return [];
    return API.get('/api/stock/articulos');
  },

  /** Vuelve a dibujar la página actual (después de guardar algo). */
  recargar() { this.navegar(); },
};

document.addEventListener('DOMContentLoaded', () => App.iniciar());
