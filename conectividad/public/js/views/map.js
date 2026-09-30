/**
 * ELETEK — Vista de mapa
 * Ubica los barcos en un mapa (Leaflet + OpenStreetMap) según la última
 * posición reportada. Cada operador ve solo sus barcos.
 */

const MapView = {
  _map: null,
  _markers: [],
  _refreshInterval: null,

  async render() {
    return `
      ${Navbar.render()}
      <div class="page">
        <div class="page-header">
          <div>
            <h1 class="page-title">Mapa de la flota</h1>
            <p class="page-description">Última ubicación conocida de cada barco</p>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="MapView.refresh()">Actualizar</button>
        </div>
        <div id="map-empty"></div>
        <div id="map" style="height: calc(100vh - 200px); min-height: 420px; border-radius: var(--radius-lg); overflow: hidden; border: 1px solid var(--border);"></div>
      </div>
    `;
  },

  async afterRender() {
    // Centro por defecto: Mar del Plata / Atlántico Sur
    this._map = L.map('map', { zoomControl: true }).setView([-42, -60], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 18,
    }).addTo(this._map);

    await this.refresh();
    // Refresco automático cada 60s
    this._refreshInterval = setInterval(() => this.refresh(true), 60000);
  },

  destroy() {
    if (this._refreshInterval) { clearInterval(this._refreshInterval); this._refreshInterval = null; }
    if (this._map) { this._map.remove(); this._map = null; }
    this._markers = [];
  },

  // Ícono de barco (SVG) en un badge tipo pin, anclado en la base.
  _boatIcon(rumbo) {
    // Si hay rumbo conocido (del GPS de a bordo), el barco apunta hacia allá.
    const giro = (rumbo == null) ? '' : ' style="transform: rotate(' + rumbo + 'deg)"';
    const html =
      '<div class="boat-pin">' +
        '<div class="boat-badge">' +
          '<svg viewBox="0 0 24 24" width="20" height="20" fill="#fff"' + giro + '>' +
            '<path d="M3.2 13.6h17.6l-1.9 4.1a2 2 0 0 1-1.8 1.1H6.9a2 2 0 0 1-1.8-1.1L3.2 13.6z"/>' +
            '<path d="M6 12.4V6.1c0-.5.4-.9.9-.9h3.3l6 5.9v1.3H6z" opacity="0.92"/>' +
            '<rect x="11.2" y="2.6" width="1.4" height="3.2" rx="0.4"/>' +
          '</svg>' +
        '</div>' +
        '<div class="boat-tail"></div>' +
      '</div>';
    return L.divIcon({ html: html, className: 'boat-icon', iconSize: [40, 48], iconAnchor: [20, 44], popupAnchor: [0, -42] });
  },

  async refresh(silent = false) {
    let posiciones;
    try {
      posiciones = await API.getPositions();
    } catch (err) {
      if (!silent) App.toast('Error cargando posiciones: ' + err.message, 'error');
      return;
    }

    // Limpiar marcadores anteriores
    this._markers.forEach((m) => this._map.removeLayer(m));
    this._markers = [];

    const empty = document.getElementById('map-empty');
    if (empty) {
      empty.innerHTML = posiciones.length === 0 ? `
        <div class="card" style="padding: var(--space-lg); margin-bottom: var(--space-md); text-align: center; color: var(--text-secondary);">
          Todavía no hay ninguna ubicación registrada. Aparecerán acá cuando los barcos reporten su posición.
        </div>
      ` : '';
    }

    if (posiciones.length === 0) return;

    const bounds = [];
    posiciones.forEach((p) => {
      const cuando = App.utils.timeAgo(p.reported_at);
      // La proa del girocompás manda; si no hay, sirve el rumbo de avance.
      const rumbo = (p.heading_deg != null) ? p.heading_deg : p.course_deg;
      const marker = L.marker([p.lat, p.lon], { icon: this._boatIcon(rumbo) }).addTo(this._map);
      const nav = [];
      if (p.speed_kn != null) nav.push(p.speed_kn.toFixed(1) + ' nudos');
      if (rumbo != null) nav.push('rumbo ' + Math.round(rumbo) + '°');
      const detalle = (p.source === 'gps')
        ? 'GPS de a bordo'
        : ('±' + (p.accuracy ? Math.round(p.accuracy) + ' m' : '?'));
      marker.bindPopup(
        '<b>' + this._esc(p.name) + '</b><br>' +
        (nav.length ? nav.join(' · ') + '<br>' : '') +
        'Reportado ' + cuando + '<br>' +
        '<span style="color:#666">' + detalle + '</span>'
      );
      this._markers.push(marker);
      bounds.push([p.lat, p.lon]);
    });

    // Encuadrar todos los barcos
    if (bounds.length === 1) {
      this._map.setView(bounds[0], 9);
    } else {
      this._map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 });
    }
  },

  _esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  },
};
