/**
 * ELETEK — Navbar Component
 */

const Navbar = {
  render() {
    const adminLinks = App.isAdmin() ? `
      <button class="btn btn-ghost btn-sm navbar-link" onclick="App.navigate('operators')">
        Operadores
      </button>
    ` : '';

    return `
      <nav class="navbar">
        <a class="navbar-brand" onclick="App.navigate('dashboard')">
          <div class="navbar-logo-icon">E</div>
          <div>
            <div class="navbar-logo">ELETEK</div>
            <div class="navbar-subtitle">Admin MikroTik Remoto</div>
          </div>
        </a>
        <div class="navbar-actions">
          <button class="btn btn-ghost btn-sm navbar-link" onclick="App.navigate('map')">
            Mapa
          </button>
          ${adminLinks}
          <span class="navbar-user">
            ${App.state.user || 'admin'}${App.isAdmin() ? '' : ' <span style="opacity:.6; font-size:var(--font-size-xs)">· operador</span>'}
          </span>
          <button class="btn btn-ghost btn-sm" onclick="App.logout()">
            Cerrar sesión
          </button>
        </div>
      </nav>
    `;
  },
};
