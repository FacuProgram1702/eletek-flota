/**
 * ELETEK — Login View (v2 Dark Premium)
 */

const LoginView = {
  render() {
    return `
      <div class="login-page">
        <div class="login-card">
          <div class="login-header">
            <div class="login-logo-icon">E</div>
            <div class="login-logo">ELETEK</div>
            <p class="login-tagline">Administración remota MikroTik</p>
          </div>
          <div id="login-error"></div>
          <form class="login-form" onsubmit="LoginView.handleSubmit(event)">
            <div class="form-group">
              <label class="form-label" for="login-user">Usuario</label>
              <input
                class="form-input"
                type="text"
                id="login-user"
                name="username"
                placeholder="admin"
                autocomplete="username"
                required
              >
            </div>
            <div class="form-group">
              <label class="form-label" for="login-pass">Contraseña</label>
              <input
                class="form-input"
                type="password"
                id="login-pass"
                name="password"
                placeholder="••••••••"
                autocomplete="current-password"
                required
              >
            </div>
            <button type="submit" class="btn btn-primary btn-lg" id="login-btn"
              style="width:100%;margin-top:8px;border-radius:12px;letter-spacing:0.04em;">
              Iniciar sesión
            </button>
          </form>
          <div style="margin-top:var(--space-xl);text-align:center;font-size:var(--font-size-xs);color:var(--text-muted);">
            Sistema de flota pesquera · ELETEK v2
          </div>
        </div>
      </div>
    `;
  },

  async handleSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    const errorDiv = document.getElementById('login-error');
    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;

    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px"><span class="loading-spinner" style="width:16px;height:16px;border-width:2px"></span> Ingresando...</span>';
    errorDiv.innerHTML = '';

    try {
      const data = await API.login(username, password);
      App.state.authenticated = true;
      App.state.user = data.user;
      App.state.role = data.role;
      App.state.scope = data.scope;
      App.navigate('dashboard');
    } catch (err) {
      errorDiv.innerHTML = `<div class="login-error">${App.utils.escapeHtml(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Iniciar sesión';
    }
  },
};
