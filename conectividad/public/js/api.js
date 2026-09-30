/**
 * ELETEK — Cliente API
 * Wrapper fetch con manejo de errores y redirección a login en 401.
 */

const API = {
  /**
   * Realiza una request a la API.
   * @param {string} url
   * @param {object} options - fetch options
   * @returns {Promise<any>}
   */
  async request(url, options = {}) {
    const defaults = {
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
    };

    const config = {
      ...defaults,
      ...options,
      headers: { ...defaults.headers, ...options.headers },
    };

    // Si el body es un objeto, serializarlo
    if (config.body && typeof config.body === 'object') {
      config.body = JSON.stringify(config.body);
    }

    try {
      const response = await fetch(url, config);

      // Si no está autenticado, redirigir al login. El propio login también
      // responde 401 cuando la contraseña es incorrecta: ese caso no es una
      // sesión vencida y tiene que mostrar el error real.
      if (response.status === 401 && url !== '/auth/login') {
        App.state.authenticated = false;
        App.navigate('login');
        throw new Error('Sesión expirada');
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Error ${response.status}`);
      }

      return data;
    } catch (err) {
      if (err.message === 'Sesión expirada') throw err;
      throw err;
    }
  },

  // ── Auth ────────────────────────────────
  login(username, password) {
    return this.request('/auth/login', {
      method: 'POST',
      body: { username, password },
    });
  },

  logout() {
    return this.request('/auth/logout', { method: 'POST' });
  },

  checkAuth() {
    return this.request('/auth/check');
  },

  // ── Vessels ─────────────────────────────
  getVessels() {
    return this.request('/api/vessels');
  },

  getVessel(slug) {
    return this.request(`/api/vessels/${slug}`);
  },

  createVessel(name, slug) {
    return this.request('/api/vessels', {
      method: 'POST',
      body: { name, slug },
    });
  },

  updateVessel(slug, name) {
    return this.request(`/api/vessels/${slug}`, {
      method: 'PUT',
      body: { name },
    });
  },

  deleteVessel(slug) {
    return this.request(`/api/vessels/${slug}`, {
      method: 'DELETE',
    });
  },

  // ── Commands ────────────────────────────
  getCommands(slug, params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/vessels/${slug}/commands${query ? '?' + query : ''}`);
  },

  createCommand(slug, type, payload) {
    return this.request(`/api/vessels/${slug}/commands`, {
      method: 'POST',
      body: { type, payload },
    });
  },

  deleteCommand(id) {
    return this.request(`/api/commands/${id}`, {
      method: 'DELETE',
    });
  },

  getCommandTypes() {
    return this.request('/api/command-types');
  },

  // ── Uso / Consumo ───────────────────────
  getUsageTrend(slug, granularity = 'month', count) {
    const query = count ? `&count=${count}` : '';
    return this.request(`/api/vessels/${slug}/usage/trend?granularity=${granularity}${query}`);
  },

  getUsageByUser(slug, start, end) {
    return this.request(`/api/vessels/${slug}/usage/by-user?start=${start}&end=${end}`);
  },

  // ── Operadores ───────────────────────────
  getOperators() {
    return this.request('/api/operators');
  },

  createOperator(username, password, scope) {
    return this.request('/api/operators', {
      method: 'POST',
      body: { username, password, scope },
    });
  },

  updateOperator(id, data) {
    return this.request(`/api/operators/${id}`, {
      method: 'PUT',
      body: data,
    });
  },

  deleteOperator(id) {
    return this.request(`/api/operators/${id}`, {
      method: 'DELETE',
    });
  },
  // ── Posiciones ─────────────────────
  getPositions() {
    return this.request('/api/positions');
  },
};
