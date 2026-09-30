/**
 * ELETEK — App Controller
 * Router hash-based, estado global, utilidades.
 */

const App = {
  // Estado global
  state: {
    authenticated: false,
    user: null,
    role: null,
    scope: null,
  },

  /** @returns {boolean} si el usuario logueado es administrador */
  isAdmin() {
    return this.state.role === 'admin';
  },

  // Vista activa (para cleanup)
  _currentView: null,

  /**
   * Inicializa la app: verifica auth y renderiza la vista correspondiente.
   */
  async init() {
    try {
      const auth = await API.checkAuth();
      this.state.authenticated = auth.authenticated;
      this.state.user = auth.user;
      this.state.role = auth.role;
      this.state.scope = auth.scope;
    } catch {
      this.state.authenticated = false;
    }

    // Listener de cambio de hash
    window.addEventListener('hashchange', () => this.route());

    // Ruta inicial
    this.route();
  },

  /**
   * Router basado en hash.
   */
  async route() {
    // Cleanup de la vista anterior
    if (this._currentView && this._currentView.destroy) {
      this._currentView.destroy();
    }

    const hash = window.location.hash || '#/';
    const parts = hash.slice(2).split('/'); // quita "#/"

    // Si no está autenticado, mostrar login
    if (!this.state.authenticated && parts[0] !== 'login') {
      window.location.hash = '#/login';
      return;
    }

    const app = document.getElementById('app');
    let view = null;
    let slug = null;

    switch (parts[0]) {
      case 'login':
        view = LoginView;
        app.innerHTML = view.render();
        break;

      case '':
      case 'dashboard':
        view = DashboardView;
        app.innerHTML = await view.render();
        break;

      case 'vessel':
        slug = parts[1];
        if (!slug) { this.navigate('dashboard'); return; }
        view = VesselView;
        app.innerHTML = await view.render(slug);
        break;

      case 'new-command':
        slug = parts[1];
        if (!slug) { this.navigate('dashboard'); return; }
        view = NewCommandView;
        app.innerHTML = await view.render(slug);
        break;

      case 'map':
        view = MapView;
        app.innerHTML = await view.render();
        break;

      case 'operators':
        if (!this.isAdmin()) { this.navigate('dashboard'); return; }
        view = OperatorsView;
        app.innerHTML = await view.render();
        break;

      default:
        this.navigate('dashboard');
        return;
    }

    this._currentView = view;

    // Ejecutar afterRender si existe
    if (view && view.afterRender) {
      await view.afterRender();
    }
  },

  /**
   * Navega a una ruta.
   * @param {string} page - login, dashboard, vessel, new-command
   * @param {string} [param] - slug del barco (para vessel/new-command)
   */
  navigate(page, param) {
    let hash = `#/${page}`;
    if (param) hash += `/${param}`;
    window.location.hash = hash;
  },

  /**
   * Cierra sesión.
   */
  async logout() {
    try {
      await API.logout();
    } catch { /* ignore */ }
    this.state.authenticated = false;
    this.state.user = null;
    this.state.role = null;
    this.state.scope = null;
    this.navigate('login');
  },

  /**
   * Muestra un toast de notificación.
   * @param {string} message
   * @param {string} type - success, error, info
   */
  toast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${this.utils.escapeHtml(message)}</span>`;
    container.appendChild(toast);

    // Auto-remove después de 4 segundos
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },

  /**
   * Utilidades compartidas.
   */
  utils: {
    /**
     * Escapa HTML para prevenir XSS.
     */
    escapeHtml(str) {
      if (!str) return '';
      const div = document.createElement('div');
      div.textContent = String(str);
      return div.innerHTML;
    },

    /**
     * Formatea bytes como "1.23 MB", etc.
     */
    formatBytes(bytes) {
      if (!bytes) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    /**
     * Formatea un timestamp como "hace X minutos/horas/días".
     */
    timeAgo(dateStr) {
      if (!dateStr) return 'Nunca';
      // SQLite devuelve timestamps sin 'Z', asumimos UTC
      const date = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
      const now = Date.now();
      const diffMs = now - date.getTime();

      if (diffMs < 0) return 'Ahora';

      const seconds = Math.floor(diffMs / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (seconds < 60) return 'Hace unos segundos';
      if (minutes < 60) return `Hace ${minutes} min`;
      if (hours < 24) return `Hace ${hours}h`;
      if (days < 30) return `Hace ${days}d`;
      return date.toLocaleDateString('es-AR');
    },
  },
};

// ── Bootstrap ─────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
