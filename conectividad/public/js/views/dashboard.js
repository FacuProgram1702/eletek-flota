/**
 * ELETEK — Dashboard View (v2 Dark Premium)
 * Lista de barcos con estado online/offline y stats animadas.
 */

const DashboardView = {
  vessels: [],

  async render() {
    return `
      ${Navbar.render()}
      <div class="page">
        <div class="page-header animate-slide-up">
          <div>
            <h1 class="page-title">Flota</h1>
            <p class="page-description">Administrá tus barcos y routers MikroTik</p>
          </div>
          ${App.isAdmin() ? `
            <button class="btn btn-primary" id="btn-add-vessel" onclick="DashboardView.showAddModal()">
              + Agregar barco
            </button>
          ` : ''}
        </div>

        <!-- Stats rápidas -->
        <div id="dashboard-stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:var(--space-md);margin-bottom:var(--space-xl);">
          ${this._renderStatSkeleton()}
        </div>

        <div id="vessel-list">
          <div class="flex-center" style="padding:64px">
            <div class="loading-spinner"></div>
          </div>
        </div>
      </div>
      <div id="modal-container"></div>
    `;
  },

  _renderStatSkeleton() {
    return ['', '', ''].map(() => `
      <div class="card" style="padding:var(--space-md);min-height:88px;background:var(--bg-card);">
        <div style="height:10px;width:60%;background:rgba(255,255,255,0.06);border-radius:4px;margin-bottom:12px;"></div>
        <div style="height:24px;width:40%;background:rgba(255,255,255,0.04);border-radius:4px;"></div>
      </div>
    `).join('');
  },

  _renderStats(vessels) {
    const online = vessels.filter(v => v.online).length;
    const offline = vessels.length - online;
    const pct = vessels.length ? Math.round((online / vessels.length) * 100) : 0;

    const stats = [
      { label: 'Total de barcos', value: vessels.length, color: '#60a5fa', icon: '🚢' },
      { label: 'En línea',        value: online,          color: '#4ade80', icon: '🟢' },
      { label: 'Sin conexión',    value: offline,         color: '#f87171', icon: '🔴' },
    ];

    const statsHtml = stats.map((s, i) => `
      <div class="card animate-slide-up" style="
        padding: var(--space-md) var(--space-lg);
        animation-delay: ${i * 80}ms;
        border-color: rgba(255,255,255,0.06);
        position: relative;
        overflow: hidden;
      ">
        <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${s.color};opacity:0.7;"></div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:10px;">
          ${s.label}
        </div>
        <div style="font-size:2rem;font-weight:800;color:${s.color};line-height:1;animation:countUp 500ms ease ${i * 80}ms both;">
          ${s.value}
        </div>
      </div>
    `).join('');

    // Barra de salud de flota
    const healthBar = vessels.length > 0 ? `
      <div class="card animate-slide-up" style="
        padding: var(--space-md) var(--space-lg);
        animation-delay: 240ms;
        border-color: rgba(255,255,255,0.06);
      ">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-bottom:10px;">
          Salud de flota
        </div>
        <div style="font-size:2rem;font-weight:800;color:${pct >= 75 ? '#4ade80' : pct >= 40 ? '#fbbf24' : '#f87171'};line-height:1;margin-bottom:10px;">
          ${pct}%
        </div>
        <div style="height:4px;background:rgba(255,255,255,0.06);border-radius:999px;overflow:hidden;">
          <div style="
            height:100%;
            width:${pct}%;
            background:${pct >= 75 ? 'linear-gradient(90deg,#22c55e,#4ade80)' : pct >= 40 ? 'linear-gradient(90deg,#f59e0b,#fbbf24)' : 'linear-gradient(90deg,#ef4444,#f87171)'};
            border-radius:999px;
            transition:width 1s cubic-bezier(0.4,0,0.2,1);
          "></div>
        </div>
      </div>
    ` : '';

    return statsHtml + healthBar;
  },

  async afterRender() {
    await this.loadVessels();
    this._refreshInterval = setInterval(() => this.loadVessels(), 30000);
  },

  destroy() {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = null;
    }
  },

  async loadVessels() {
    try {
      this.vessels = await API.getVessels();
      this.renderVesselList();
    } catch (err) {
      const list = document.getElementById('vessel-list');
      if (list) list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠️</div>
          <div class="empty-state-title">Error al cargar barcos</div>
          <div class="empty-state-text">${App.utils.escapeHtml(err.message)}</div>
        </div>
      `;
    }
  },

  renderVesselList() {
    const container = document.getElementById('vessel-list');
    const statsContainer = document.getElementById('dashboard-stats');
    if (!container) return;

    // Actualizar stats
    if (statsContainer) {
      statsContainer.innerHTML = this._renderStats(this.vessels);
    }

    if (this.vessels.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🚢</div>
          <div class="empty-state-title">No hay barcos registrados</div>
          <div class="empty-state-text">
            ${App.isAdmin()
              ? 'Agregá tu primer barco para comenzar a administrar sus routers MikroTik.'
              : 'No tenés ningún barco asignado. Pedile al administrador que te habilite uno.'}
          </div>
          ${App.isAdmin() ? `
            <button class="btn btn-primary" onclick="DashboardView.showAddModal()" style="margin-top:var(--space-md)">
              + Agregar barco
            </button>
          ` : ''}
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="vessel-grid animate-stagger">
        ${this.vessels.map((v) => this.renderVesselCard(v)).join('')}
      </div>
    `;
  },

  renderVesselCard(vessel) {
    const lastSeen = vessel.last_seen ? App.utils.timeAgo(vessel.last_seen) : 'Nunca';

    return `
      <div class="card card-clickable vessel-card"
           onclick="App.navigate('vessel', '${vessel.slug}')">
        <!-- Accent line top -->
        <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${vessel.online ? 'linear-gradient(90deg,#22c55e,#06b6d4)' : 'linear-gradient(90deg,rgba(239,68,68,0.5),rgba(239,68,68,0.2))'};border-radius:var(--radius-xl) var(--radius-xl) 0 0;"></div>

        <div class="vessel-card-header">
          <div>
            <div class="vessel-name">${App.utils.escapeHtml(vessel.name)}</div>
            <span class="vessel-slug">${vessel.slug}</span>
          </div>
          ${StatusBadge.vessel(vessel.online)}
        </div>

        <div class="vessel-meta">
          <div class="vessel-meta-item">
            <span style="color:var(--text-muted);font-size:var(--font-size-xs);">Último contacto:</span>
            <span style="font-weight:500;">${lastSeen}</span>
          </div>
        </div>

        ${App.isAdmin() ? `
          <div style="margin-top:var(--space-md);padding-top:var(--space-md);border-top:1px solid var(--border);display:flex;align-items:center;justify-content:flex-end;">
            <span style="font-size:var(--font-size-xs);color:var(--text-muted);">Ver detalles →</span>
          </div>
        ` : ''}
      </div>
    `;
  },

  // ── Modal Agregar Barco ───────────────────────────────────────

  showAddModal() {
    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="DashboardView.closeModal(event)">
        <div class="modal" onclick="event.stopPropagation()">
          <h2 class="modal-title">🚢 Agregar barco</h2>
          <form onsubmit="DashboardView.handleAddVessel(event)">
            <div class="form-group">
              <label class="form-label" for="vessel-name">
                Nombre del barco <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="text"
                id="vessel-name"
                placeholder="Ej: Gaviota"
                required
              >
            </div>
            <div class="form-group">
              <label class="form-label" for="vessel-slug">
                Slug (ID interno) <span class="required">*</span>
              </label>
              <input
                class="form-input"
                type="text"
                id="vessel-slug"
                placeholder="Ej: gaviota"
                pattern="[a-z0-9\\-]{1,32}"
                required
              >
              <div class="form-hint">Solo minúsculas, números y guiones. Se usa en la URL y en el script MikroTik.</div>
            </div>
            <div id="add-vessel-error"></div>
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" onclick="DashboardView.closeModal()">Cancelar</button>
              <button type="submit" class="btn btn-primary" id="add-vessel-btn">Crear barco</button>
            </div>
          </form>
        </div>
      </div>
    `;

    const nameInput = document.getElementById('vessel-name');
    const slugInput = document.getElementById('vessel-slug');
    nameInput.addEventListener('input', () => {
      slugInput.value = nameInput.value
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .substring(0, 32);
    });
    nameInput.focus();
  },

  closeModal(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('modal-container');
    if (modal) modal.innerHTML = '';
  },

  async handleAddVessel(e) {
    e.preventDefault();
    const btn = document.getElementById('add-vessel-btn');
    const errorDiv = document.getElementById('add-vessel-error');
    const name = document.getElementById('vessel-name').value.trim();
    const slug = document.getElementById('vessel-slug').value.trim();

    btn.disabled = true;
    btn.textContent = 'Creando...';
    errorDiv.innerHTML = '';

    try {
      const vessel = await API.createVessel(name, slug);
      this.closeModal();
      App.toast(`Barco "${vessel.name}" creado exitosamente`, 'success');
      this.showTokenModal(vessel);
      await this.loadVessels();
    } catch (err) {
      errorDiv.innerHTML = `<div class="form-error">${App.utils.escapeHtml(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Crear barco';
    }
  },

  showTokenModal(vessel) {
    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="DashboardView.closeModal(event)">
        <div class="modal" onclick="event.stopPropagation()">
          <h2 class="modal-title">🔑 Token generado</h2>
          <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-lg);line-height:1.6;">
            Guardá este token — es necesario para el script MikroTik de <strong style="color:var(--text-primary)">${App.utils.escapeHtml(vessel.name)}</strong>.
          </p>
          <div class="token-display">
            <span class="token-value" id="token-val">${vessel.api_token}</span>
            <button class="btn btn-secondary btn-sm" onclick="DashboardView.copyToken()">Copiar</button>
          </div>
          <div class="form-hint mt-md">Este token se puede ver después desde el detalle del barco.</div>
          <div class="modal-actions">
            <button class="btn btn-primary" onclick="DashboardView.closeModal()">Entendido</button>
          </div>
        </div>
      </div>
    `;
  },

  copyToken() {
    const tokenEl = document.getElementById('token-val');
    if (tokenEl) {
      navigator.clipboard.writeText(tokenEl.textContent).then(() => {
        App.toast('Token copiado al portapapeles', 'success');
      });
    }
  },
};
