/**
 * ELETEK — Vessel Detail View
 * Detalle de un barco: info, token, consumo y historial de órdenes,
 * organizado en secciones (Resumen / Consumo / Órdenes).
 */

const VesselView = {
  vessel: null,
  commands: [],
  currentFilter: null,
  currentSection: 'resumen',
  _consumoLoaded: false,
  _consumoGranularity: 'month',
  _consumoBuckets: [],
  _consumoValues: [],
  _consumoPeriodIndex: -1,

  async render(slug) {
    this._slug = slug;
    return `
      ${Navbar.render()}
      <div class="page">
        <div class="breadcrumb">
          <a onclick="App.navigate('dashboard')">Flota</a>
          <span class="separator">›</span>
          <span id="breadcrumb-name">Cargando...</span>
        </div>
        <div id="vessel-detail">
          <div class="flex-center" style="padding:48px">
            <div class="loading-spinner"></div>
          </div>
        </div>
      </div>
      <div id="modal-container"></div>
    `;
  },

  async afterRender() {
    await this.loadVessel();
    // El historial de órdenes es solo para administradores
    if (App.isAdmin()) await this.loadCommands();
    this._refreshInterval = setInterval(() => {
      this.loadVessel(true);
      if (App.isAdmin()) this.loadCommands(true);
    }, 15000);
  },

  destroy() {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = null;
    }
    Charts._destroy('chart-trend');
    Charts._destroy('chart-by-user');
  },

  async loadVessel(silent = false) {
    try {
      this.vessel = await API.getVessel(this._slug);
      if (!silent) this.renderDetail();
      // Update breadcrumb and header always
      const bc = document.getElementById('breadcrumb-name');
      if (bc) bc.textContent = this.vessel.name;
      this.updateHeader();
    } catch (err) {
      if (!silent) {
        document.getElementById('vessel-detail').innerHTML = `
          <div class="empty-state">
            <div class="empty-state-title">Barco no encontrado</div>
            <div class="empty-state-text">${App.utils.escapeHtml(err.message)}</div>
            <button class="btn btn-secondary" onclick="App.navigate('dashboard')">Volver</button>
          </div>
        `;
      }
    }
  },

  updateHeader() {
    const headerStatus = document.getElementById('vessel-status-badge');
    if (headerStatus && this.vessel) {
      headerStatus.innerHTML = StatusBadge.vessel(this.vessel.online);
    }
    const lastSeenEl = document.getElementById('vessel-last-seen');
    if (lastSeenEl && this.vessel) {
      lastSeenEl.textContent = this.vessel.last_seen ? App.utils.timeAgo(this.vessel.last_seen) : 'Nunca';
    }
  },

  renderDetail() {
    const v = this.vessel;
    const container = document.getElementById('vessel-detail');
    if (!container) return;

    const stats = v.commandStats || {};
    // El historial de órdenes es solo para administradores
    const sections = App.isAdmin() ? ['resumen', 'consumo', 'ordenes'] : ['resumen', 'consumo'];
    const sectionLabels = { resumen: 'Resumen', consumo: 'Consumo', ordenes: 'Órdenes' };

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${App.utils.escapeHtml(v.name)}</h1>
          <p class="page-description">
            <span class="vessel-slug" style="margin-right: 8px">${v.slug}</span>
            <span id="vessel-status-badge">${StatusBadge.vessel(v.online)}</span>
          </p>
        </div>
        <div class="flex gap-sm">
          <button class="btn btn-primary" onclick="App.navigate('new-command', '${v.slug}')">
            Nueva orden
          </button>
          ${App.isAdmin() ? `
            <button class="btn btn-secondary btn-sm" onclick="VesselView.showEditModal()">
              Editar
            </button>
            <button class="btn btn-danger btn-sm" onclick="VesselView.confirmDelete()">
              Eliminar
            </button>
          ` : ''}
        </div>
      </div>

      <div class="info-grid animate-fade-in">
        <div class="info-item">
          <div class="info-label">Último contacto</div>
          <div class="info-value" id="vessel-last-seen">${v.last_seen ? App.utils.timeAgo(v.last_seen) : 'Nunca'}</div>
        </div>
        ${App.isAdmin() ? `
          <div class="info-item">
            <div class="info-label">Pendientes</div>
            <div class="info-value" style="color: var(--status-pending)">${(stats.pending || 0) + (stats.sent || 0)}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Completados</div>
            <div class="info-value" style="color: var(--status-done)">${stats.done || 0}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Errores</div>
            <div class="info-value" style="color: var(--status-error)">${stats.error || 0}</div>
          </div>
        ` : `
          <div class="info-item">
            <div class="info-label">Usuarios</div>
            <div class="info-value">${v.sync_data && v.sync_data.users ? v.sync_data.users.length : 0}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Conectados ahora</div>
            <div class="info-value" style="color: var(--status-done)">${v.sync_data && v.sync_data.users ? v.sync_data.users.filter(u => u.active).length : 0}</div>
          </div>
        `}
      </div>

      ${App.isAdmin() ? `
        <div class="card mb-lg" style="padding: var(--space-md) var(--space-lg);">
          <div class="info-label" style="margin-bottom: var(--space-sm)">API Token</div>
          <div class="token-display">
            <span class="token-value" id="detail-token">${this._tokenVisible ? v.api_token : '••••••••-••••-••••-••••-••••••••••••'}</span>
            <button class="btn btn-secondary btn-sm token-toggle" onclick="VesselView.toggleToken()">
              ${this._tokenVisible ? 'Ocultar' : 'Mostrar'}
            </button>
            <button class="btn btn-secondary btn-sm" onclick="VesselView.copyToken()">
              Copiar
            </button>
          </div>
        </div>
      ` : ''}

      <div class="tabs" id="vessel-section-tabs" style="margin-top: var(--space-xl)">
        ${sections.map((s) => `
          <button class="tab ${this.currentSection === s ? 'active' : ''}" onclick="VesselView.switchSection('${s}')">
            ${sectionLabels[s]}
          </button>
        `).join('')}
      </div>

      <div id="section-resumen" style="display:${this.currentSection === 'resumen' ? 'block' : 'none'}">
        ${this.renderRouterHealth(v)}
        <div class="page-header" style="margin-bottom: var(--space-md); margin-top: var(--space-lg)">
          <h2 style="font-size: var(--font-size-xl); font-weight: 600;">Usuarios del Router</h2>
          <span style="font-size: var(--font-size-sm); color: var(--text-secondary);">Sincronizado: ${v.sync_data && v.sync_data.users ? 'Sí' : 'No'}</span>
        </div>
        <div id="users-list">
          ${this.renderUsers(v.sync_data)}
        </div>
      </div>

      <div id="section-consumo" style="display:${this.currentSection === 'consumo' ? 'block' : 'none'}">
        <div class="tabs" id="consumo-granularity-tabs" style="margin-top: var(--space-lg)">
          <button class="tab ${this._consumoGranularity === 'day' ? 'active' : ''}" onclick="VesselView.switchGranularity('day')">Día</button>
          <button class="tab ${this._consumoGranularity === 'week' ? 'active' : ''}" onclick="VesselView.switchGranularity('week')">Semana</button>
          <button class="tab ${this._consumoGranularity === 'month' ? 'active' : ''}" onclick="VesselView.switchGranularity('month')">Mes</button>
          <button class="tab ${this._consumoGranularity === 'year' ? 'active' : ''}" onclick="VesselView.switchGranularity('year')">Año</button>
        </div>

        <div class="info-grid">
          <div class="info-item">
            <div class="info-label">Promedio por período</div>
            <div class="info-value" id="consumo-stat-avg">—</div>
          </div>
          <div class="info-item">
            <div class="info-label">Período de mayor consumo</div>
            <div class="info-value" id="consumo-stat-peak">—</div>
          </div>
          <div class="info-item">
            <div class="info-label">Mayor consumo del período elegido</div>
            <div class="info-value" id="consumo-stat-top">—</div>
          </div>
        </div>

        <div class="page-header" style="margin-bottom: var(--space-md)">
          <div>
            <h2 style="font-size: var(--font-size-xl); font-weight: 600;">Consumo total</h2>
            <p style="font-size: var(--font-size-sm); color: var(--text-secondary); margin-top: 2px;">Suma de todos los usuarios · clickeá un punto para ver el detalle abajo</p>
          </div>
        </div>
        <div class="card" style="margin-bottom: var(--space-xl);">
          <div style="height: 260px; position: relative;">
            <canvas id="chart-trend"></canvas>
          </div>
        </div>

        <div class="page-header" style="margin-bottom: var(--space-md); align-items:center;">
          <div>
            <h2 style="font-size: var(--font-size-xl); font-weight: 600;">Consumo por usuario</h2>
            <p style="font-size: var(--font-size-sm); color: var(--text-secondary); margin-top: 2px;">Ranking de consumo real del período elegido</p>
          </div>
          <div class="flex" style="align-items:center; gap: var(--space-sm);">
            <button class="btn btn-secondary btn-sm" id="consumo-period-prev" onclick="VesselView.navigatePeriod(-1)">‹</button>
            <span id="consumo-period-label" style="min-width: 150px; text-align:center; font-weight:600; font-size: var(--font-size-sm);">—</span>
            <button class="btn btn-secondary btn-sm" id="consumo-period-next" onclick="VesselView.navigatePeriod(1)">›</button>
          </div>
        </div>
        <div class="card">
          <div style="position: relative;">
            <canvas id="chart-by-user"></canvas>
          </div>
        </div>
      </div>

      ${App.isAdmin() ? `
        <div id="section-ordenes" style="display:${this.currentSection === 'ordenes' ? 'block' : 'none'}">
          <div class="page-header" style="margin-bottom: var(--space-md); margin-top: var(--space-lg)">
            <h2 style="font-size: var(--font-size-xl); font-weight: 600;">Historial de órdenes</h2>
          </div>

          <div class="tabs" id="command-tabs">
            <button class="tab ${!this.currentFilter ? 'active' : ''}" onclick="VesselView.filterCommands(null)">Todas</button>
            <button class="tab ${this.currentFilter === 'pending' ? 'active' : ''}" onclick="VesselView.filterCommands('pending')">Pendientes</button>
            <button class="tab ${this.currentFilter === 'sent' ? 'active' : ''}" onclick="VesselView.filterCommands('sent')">Enviadas</button>
            <button class="tab ${this.currentFilter === 'done' ? 'active' : ''}" onclick="VesselView.filterCommands('done')">Completadas</button>
            <button class="tab ${this.currentFilter === 'error' ? 'active' : ''}" onclick="VesselView.filterCommands('error')">Errores</button>
          </div>

          <div id="command-list">
            <div class="flex-center" style="padding:24px">
              <div class="loading-spinner"></div>
            </div>
          </div>
        </div>
      ` : ''}
    `;

    if (this.currentSection === 'consumo') {
      this.loadConsumoData();
    }
  },

  switchSection(section) {
    this.currentSection = section;

    const tabs = document.querySelectorAll('#vessel-section-tabs .tab');
    const sections = ['resumen', 'consumo', 'ordenes'];
    tabs.forEach((t, i) => t.classList.toggle('active', sections[i] === section));

    sections.forEach((s) => {
      const el = document.getElementById(`section-${s}`);
      if (el) el.style.display = s === section ? 'block' : 'none';
    });

    if (section === 'consumo' && !this._consumoLoaded) {
      this.loadConsumoData();
    }
  },

  async loadConsumoData() {
    this._consumoLoaded = true;
    try {
      const trend = await API.getUsageTrend(this._slug, this._consumoGranularity);
      this._consumoBuckets = trend.buckets;
      this._consumoValues = trend.values;
      this._consumoPeriodIndex = this._consumoBuckets.length - 1;

      this.renderTrendChart();
      this.renderConsumoStats();
      this.updatePeriodNav();
      await this.loadByUserChart();
    } catch (err) {
      this._consumoLoaded = false;
      App.toast(`Error cargando consumo: ${err.message}`, 'error');
    }
  },

  switchGranularity(granularity) {
    if (this._consumoGranularity === granularity) return;
    this._consumoGranularity = granularity;

    const order = ['day', 'week', 'month', 'year'];
    const tabs = document.querySelectorAll('#consumo-granularity-tabs .tab');
    tabs.forEach((t, i) => t.classList.toggle('active', order[i] === granularity));

    this.loadConsumoData();
  },

  renderTrendChart() {
    Charts.renderTrendChart(
      'chart-trend',
      this._consumoBuckets,
      this._consumoValues,
      this._consumoPeriodIndex,
      (index) => this.selectPeriodIndex(index)
    );
  },

  selectPeriodIndex(index) {
    if (index < 0 || index >= this._consumoBuckets.length || index === this._consumoPeriodIndex) return;
    this._consumoPeriodIndex = index;
    this.renderTrendChart();
    this.updatePeriodNav();
    this.loadByUserChart();
  },

  navigatePeriod(delta) {
    this.selectPeriodIndex(this._consumoPeriodIndex + delta);
  },

  updatePeriodNav() {
    const bucket = this._consumoBuckets[this._consumoPeriodIndex];
    const label = document.getElementById('consumo-period-label');
    if (label && bucket) label.textContent = bucket.label;

    const prevBtn = document.getElementById('consumo-period-prev');
    const nextBtn = document.getElementById('consumo-period-next');
    if (prevBtn) prevBtn.disabled = this._consumoPeriodIndex <= 0;
    if (nextBtn) nextBtn.disabled = this._consumoPeriodIndex >= this._consumoBuckets.length - 1;
  },

  renderConsumoStats() {
    const values = this._consumoValues;
    const nonZero = values.filter((v) => v > 0);

    const avgEl = document.getElementById('consumo-stat-avg');
    if (avgEl) {
      const avg = nonZero.length ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0;
      avgEl.textContent = App.utils.formatBytes(avg);
    }

    const peakEl = document.getElementById('consumo-stat-peak');
    if (peakEl) {
      const maxVal = Math.max(0, ...values);
      if (maxVal > 0) {
        const idx = values.indexOf(maxVal);
        peakEl.textContent = `${this._consumoBuckets[idx].label} · ${App.utils.formatBytes(maxVal)}`;
      } else {
        peakEl.textContent = 'Sin datos';
      }
    }
  },

  renderTopUserStat(users) {
    const topEl = document.getElementById('consumo-stat-top');
    if (!topEl) return;
    const top = users.find((u) => u.bytes > 0);
    topEl.textContent = top ? `${top.name} · ${App.utils.formatBytes(top.bytes)}` : 'Sin consumo';
  },

  async loadByUserChart() {
    const bucket = this._consumoBuckets[this._consumoPeriodIndex];
    if (!bucket) return;
    try {
      const data = await API.getUsageByUser(this._slug, bucket.start, bucket.end);
      Charts.renderByUserChart('chart-by-user', data.users);
      this.renderTopUserStat(data.users);
    } catch (err) {
      App.toast(`Error cargando consumo por usuario: ${err.message}`, 'error');
    }
  },

  _tokenVisible: false,

  toggleToken() {
    this._tokenVisible = !this._tokenVisible;
    this.renderDetail();
    this.renderCommandList();
  },

  copyToken() {
    if (this.vessel) {
      navigator.clipboard.writeText(this.vessel.api_token).then(() => {
        App.toast('Token copiado al portapapeles', 'success');
      });
    }
  },

  async filterCommands(status) {
    this.currentFilter = status;
    // Update tab styles
    const tabs = document.querySelectorAll('#command-tabs .tab');
    tabs.forEach(t => t.classList.remove('active'));
    const idx = [null, 'pending', 'sent', 'done', 'error'].indexOf(status);
    if (tabs[idx]) tabs[idx].classList.add('active');

    await this.loadCommands();
  },

  async loadCommands(silent = false) {
    try {
      const params = {};
      if (this.currentFilter) params.status = this.currentFilter;
      const data = await API.getCommands(this._slug, params);
      this.commands = data.commands;
      this.renderCommandList();
    } catch (err) {
      if (!silent) {
        const cl = document.getElementById('command-list');
        if (cl) cl.innerHTML = `<div class="form-error">Error: ${App.utils.escapeHtml(err.message)}</div>`;
      }
    }
  },

  renderCommandList() {
    const container = document.getElementById('command-list');
    if (!container) return;

    if (this.commands.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: var(--space-xl)">
          <div class="empty-state-title">Sin órdenes</div>
          <div class="empty-state-text">
            ${this.currentFilter ? 'No hay órdenes con este filtro.' : 'Creá una orden para enviarla al router de este barco.'}
          </div>
          ${!this.currentFilter ? `
            <button class="btn btn-primary" onclick="App.navigate('new-command', '${this._slug}')">
              Nueva orden
            </button>
          ` : ''}
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="command-list">
        ${this.commands.map(c => CommandCard.render(c)).join('')}
      </div>
    `;
  },

  /**
   * Estado de salud del router: uptime, reinicios, CPU, memoria.
   * Solo aparece si el barco tiene el script de telemetría actualizado.
   */
  renderRouterHealth(v) {
    const r = v.sync_data && v.sync_data.router;
    const rb = v.reboots || { last24h: 0, last7d: 0, recent: [] };
    if (!r) return '';

    const fmtUptime = (s) => {
      if (s == null) return '—';
      const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
      if (d > 0) return d + 'd ' + h + 'h';
      if (h > 0) return h + 'h ' + m + 'min';
      return m + ' min';
    };

    // Un router sano se reinicia solo cuando alguien lo reinicia. Varios
    // reinicios en un día casi siempre son alimentación (fuente o contacto).
    const alerta = rb.last24h >= 3;
    const aviso  = rb.last24h > 0 && rb.last24h < 3;
    const colorRe = alerta ? 'var(--status-error)' : (aviso ? 'var(--status-pending)' : 'var(--status-done)');

    const memPct = (r.free_memory != null && r.total_memory) 
      ? Math.round((1 - r.free_memory / r.total_memory) * 100) : null;

    const item = (label, valor, color) => `
      <div class="info-item">
        <div class="info-label">${label}</div>
        <div class="info-value"${color ? ` style="color:${color}"` : ''}>${valor}</div>
      </div>`;

    return `
      <div class="page-header" style="margin-bottom: var(--space-md); margin-top: var(--space-lg)">
        <h2 style="font-size: var(--font-size-xl); font-weight: 600;">Estado del router</h2>
        <span style="font-size: var(--font-size-sm); color: var(--text-secondary);">
          ${App.utils.escapeHtml(r.model || '')} ${r.version ? '· RouterOS ' + App.utils.escapeHtml(r.version) : ''}
        </span>
      </div>
      <div class="info-grid mb-lg">
        ${item('Encendido hace', fmtUptime(r.uptime_s))}
        ${item('Reinicios 24h', rb.last24h, colorRe)}
        ${item('Reinicios 7 días', rb.last7d)}
        ${r.cpu_load != null ? item('CPU', r.cpu_load + '%') : ''}
        ${memPct != null ? item('Memoria usada', memPct + '%') : ''}
        ${r.voltage != null ? item('Voltaje', r.voltage + ' V') : ''}
        ${r.temperature != null ? item('Temperatura', r.temperature + ' °C') : ''}
      </div>
      ${alerta ? `
        <div class="card mb-lg" style="padding: var(--space-md) var(--space-lg); border-left: 3px solid var(--status-error);">
          <strong>El router se reinició ${rb.last24h} veces en las últimas 24 horas.</strong>
          <div style="font-size: var(--font-size-sm); color: var(--text-secondary); margin-top: 4px;">
            Cada reinicio corta el WiFi entre 1 y 3 minutos y desloguea a todos. En un barco
            esto casi siempre es la alimentación: fuente floja, voltaje inestable o un falso
            contacto en el conector. Necesita revisión a bordo.
          </div>
        </div>` : ''}
      ${rb.recent && rb.recent.length ? `
        <details class="mb-lg" style="font-size: var(--font-size-sm); color: var(--text-secondary);">
          <summary style="cursor:pointer">Ver últimos reinicios (${rb.recent.length})</summary>
          <div style="margin-top: var(--space-sm); font-family: var(--font-mono); line-height: 1.7;">
            ${rb.recent.map((x) => App.utils.timeAgo(x.detected_at) + ' · había estado encendido ' + fmtUptime(x.prev_uptime_s)).join('<br>')}
          </div>
        </details>` : ''}
    `;
  },

  renderUsers(syncData) {
    if (!syncData || !syncData.users || syncData.users.length === 0) {
      return `
        <div class="empty-state" style="padding: var(--space-lg)">
          <div class="empty-state-title">No hay datos de usuarios</div>
          <div class="empty-state-text">El router todavía no ha enviado su reporte de consumos.</div>
        </div>
      `;
    }

    // Agrupados por plan: el reset de cada grupo ocurre en momentos distintos,
    // así que mezclarlos hace difícil leer cuánto le queda a cada uno.
    const mensuales = syncData.users.filter(u => u.profile === 'mensual');
    const diarios = syncData.users.filter(u => u.profile !== 'mensual');

    const grupo = (titulo, subtitulo, lista, color) => {
      if (lista.length === 0) return '';
      const conectados = lista.filter(u => u.active).length;
      return `
        <div style="margin-bottom: var(--space-xl);">
          <div class="flex" style="align-items: baseline; gap: var(--space-sm); margin-bottom: var(--space-sm);
                                   padding-bottom: var(--space-xs); border-bottom: 2px solid ${color};">
            <h3 style="font-size: var(--font-size-base); font-weight: 600; margin: 0;">${titulo}</h3>
            <span style="font-size: var(--font-size-xs); color: var(--text-muted);">
              ${lista.length} ${lista.length === 1 ? 'usuario' : 'usuarios'}${conectados ? ` · ${conectados} conectado${conectados === 1 ? '' : 's'}` : ''}
            </span>
            <span style="font-size: var(--font-size-xs); color: var(--text-muted); margin-left: auto;">${subtitulo}</span>
          </div>
          ${lista.map(u => this.renderUserRow(u)).join('')}
        </div>
      `;
    };

    return `
      <div>
        ${grupo('Cuota mensual', 'se reinicia el día 1', mensuales, 'var(--accent)')}
        ${grupo('Cuota diaria', 'se reinicia a la medianoche', diarios, 'var(--border-hover)')}
      </div>
    `;
  },

  /** Una fila de usuario con su barra de consumo. */
  renderUserRow(u) {
    const sinLimite = !u.limit || u.limit === 0;
    const percentage = sinLimite ? 0 : (Math.min(100, Math.round((u.bytes / u.limit) * 100)) || 0);
    const isNearLimit = percentage > 85;

    return `
      <div class="card" style="margin-bottom: var(--space-sm); padding: var(--space-md);">
        <div class="flex" style="justify-content: space-between; margin-bottom: var(--space-xs);">
          <div style="font-weight: 600;">
            ${App.utils.escapeHtml(u.name)}
            ${u.password ? `<span style="font-family: var(--font-mono); font-size: var(--font-size-sm);
                                        color: var(--text-secondary); background: var(--bg-tertiary);
                                        padding: 1px 7px; border-radius: var(--radius-sm); margin-left: 8px;"
                                  title="Contraseña">${App.utils.escapeHtml(u.password)}</span>` : ''}
            ${u.active ? '<span style="color: var(--status-done); font-size: 12px; margin-left: 8px;">● Online</span>' : ''}
          </div>
          <div style="font-size: var(--font-size-sm); color: var(--text-secondary);">
            ${sinLimite
              ? `${App.utils.formatBytes(u.bytes)} · <span style="color: var(--text-muted)">sin límite</span>`
              : `${App.utils.formatBytes(u.bytes)} / ${App.utils.formatBytes(u.limit)}`}
          </div>
        </div>
        ${sinLimite ? '' : `
          <div style="width: 100%; height: 8px; background: var(--bg-tertiary); border-radius: 4px; overflow: hidden;">
            <div style="height: 100%; width: ${percentage}%; background: ${isNearLimit ? 'var(--status-error)' : 'var(--status-done)'}; border-radius: 4px; transition: width 0.3s ease;"></div>
          </div>
        `}
      </div>
    `;
  },

  async cancelCommand(id) {
    if (!confirm('¿Cancelar esta orden pendiente?')) return;
    try {
      await API.deleteCommand(id);
      App.toast('Orden cancelada', 'success');
      await this.loadCommands();
      await this.loadVessel(true);
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  confirmDelete() {
    if (!this.vessel) return;
    const modal = document.getElementById('modal-container');
    modal.innerHTML = `
      <div class="modal-overlay" onclick="VesselView.closeModal(event)">
        <div class="modal" onclick="event.stopPropagation()">
          <h2 class="modal-title">Eliminar barco</h2>
          <p style="color: var(--text-secondary); font-size: var(--font-size-sm); margin-bottom: var(--space-md);">
            ¿Estás seguro de que querés eliminar <strong>${App.utils.escapeHtml(this.vessel.name)}</strong>?
            Se perderán todas las órdenes asociadas. Esta acción no se puede deshacer.
          </p>
          <div class="modal-actions">
            <button class="btn btn-secondary" onclick="VesselView.closeModal()">Cancelar</button>
            <button class="btn btn-danger" onclick="VesselView.deleteVessel()">Eliminar</button>
          </div>
        </div>
      </div>
    `;
  },

  closeModal(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('modal-container');
    if (modal) modal.innerHTML = '';
  },

  async deleteVessel() {
    try {
      await API.deleteVessel(this._slug);
      App.toast(`Barco eliminado`, 'success');
      App.navigate('dashboard');
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  showEditModal() {
    if (!this.vessel) return;
    const modal = document.getElementById('modal-container');
    modal.innerHTML = `
      <div class="modal-overlay" onclick="VesselView.closeModal(event)">
        <div class="modal" onclick="event.stopPropagation()">
          <h2 class="modal-title">Editar barco</h2>
          <form onsubmit="VesselView.handleEditVessel(event)">
            <div class="form-group">
              <label class="form-label" for="edit-vessel-name">
                Nuevo nombre
              </label>
              <input
                class="form-input"
                type="text"
                id="edit-vessel-name"
                value="${App.utils.escapeHtml(this.vessel.name)}"
                required
              >
              <div class="form-hint" style="margin-top: 8px">El identificador (slug) <strong>${this.vessel.slug}</strong> no cambiará para no romper la conexión con el router.</div>
            </div>
            <div id="edit-vessel-error"></div>
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" onclick="VesselView.closeModal()">Cancelar</button>
              <button type="submit" class="btn btn-primary" id="edit-vessel-btn">Guardar</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.getElementById('edit-vessel-name').focus();
  },

  async handleEditVessel(e) {
    e.preventDefault();
    const btn = document.getElementById('edit-vessel-btn');
    const errorDiv = document.getElementById('edit-vessel-error');
    const name = document.getElementById('edit-vessel-name').value.trim();

    btn.disabled = true;
    btn.textContent = 'Guardando...';
    errorDiv.innerHTML = '';

    try {
      await API.updateVessel(this._slug, name);
      this.closeModal();
      App.toast('Nombre actualizado', 'success');
      await this.loadVessel(false);
    } catch (err) {
      errorDiv.innerHTML = `<div class="form-error">${App.utils.escapeHtml(err.message)}</div>`;
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  },
};
