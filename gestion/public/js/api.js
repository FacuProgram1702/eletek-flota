/**
 * Cliente de la API. Si la sesión venció, lleva al inicio de sesión.
 */

/* global App */

const API = {
  async pedir(url, { metodo = 'GET', datos } = {}) {
    const op = { method: metodo, credentials: 'same-origin', headers: {} };
    if (datos !== undefined) {
      op.headers['Content-Type'] = 'application/json';
      op.body = JSON.stringify(datos);
    }
    let r;
    try {
      r = await fetch(url, op);
    } catch (e) {
      throw new Error('No hay conexión con el servidor. Revisá internet y probá de nuevo.');
    }
    let cuerpo = null;
    const tipo = r.headers.get('content-type') || '';
    if (tipo.includes('application/json')) cuerpo = await r.json();
    // El 401 del propio login es "contraseña incorrecta", no sesión vencida
    if (r.status === 401 && url !== '/auth/login') {
      App.irALogin();
      throw new Error('Tu sesión venció. Volvé a iniciar sesión.');
    }
    if (!r.ok) {
      const err = new Error((cuerpo && cuerpo.error) || `Error ${r.status}`);
      err.status = r.status;
      err.datos = cuerpo;
      throw err;
    }
    return cuerpo;
  },
  get(url) { return this.pedir(url); },
  post(url, datos = {}) { return this.pedir(url, { metodo: 'POST', datos }); },
  put(url, datos = {}) { return this.pedir(url, { metodo: 'PUT', datos }); },
  del(url) { return this.pedir(url, { metodo: 'DELETE' }); },
};

/** Arma un querystring ignorando valores vacíos. */
API.qs = (obj) => {
  const p = Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return p.length ? '?' + p.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
};
