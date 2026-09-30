/**
 * ELETEK — New Command View
 * Formulario dinámico para crear órdenes.
 */

const NewCommandView = {
  _slug: null,
  _vessel: null,
  _selectedType: 'create_user',
  _quotaMode: 'diario',

  async render(slug) {
    this._slug = slug;
    return `
      ${Navbar.render()}
      <div class="page">
        <div class="breadcrumb">
          <a onclick="App.navigate('dashboard')">Flota</a>
          <span class="separator">›</span>
          <a onclick="App.navigate('vessel', '${slug}')" id="nc-vessel-name">Cargando...</a>
          <span class="separator">›</span>
          <span>Nueva orden</span>
        </div>
        <div class="page-header">
          <h1 class="page-title">Nueva orden</h1>
        </div>
        <div id="command-form-container">
          <div class="flex-center" style="padding:48px">
            <div class="loading-spinner"></div>
          </div>
        </div>
      </div>
    `;
  },

  async afterRender() {
    try {
      this._vessel = await API.getVessel(this._slug);
      const nameEl = document.getElementById('nc-vessel-name');
      if (nameEl) nameEl.textContent = this._vessel.name;
      this.renderForm();
      this.checkPending();
      // Mientras haya una orden sin entregar el formulario queda bloqueado;
      // se libera solo en cuanto el barco la recibe.
      this._pendingInterval = setInterval(() => this.checkPending(), 10000);
    } catch (err) {
      document.getElementById('command-form-container').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">Error</div>
          <div class="empty-state-text">${App.utils.escapeHtml(err.message)}</div>
        </div>
      `;
    }
  },

  renderForm() {
    const container = document.getElementById('command-form-container');
    if (!container) return;

    container.innerHTML = `
      <div style="max-width: 700px;" id="pending-warning"></div>
      <div class="card animate-fade-in" style="max-width: 700px;">
        <form onsubmit="NewCommandView.handleSubmit(event)">
          <div class="form-group">
            <label class="form-label">
              Tipo de orden <span class="required">*</span>
            </label>
            <div class="command-type-selector" id="type-selector">
              ${this.renderTypeButtons()}
            </div>
          </div>

          <div id="payload-fields">
            ${this.renderPayloadFields()}
          </div>

          <div id="command-preview" class="preview-box" style="display:none">
            <div class="preview-label">Preview del comando RouterOS</div>
            <div class="preview-code" id="preview-code"></div>
          </div>

          <div id="create-command-error"></div>

          <div class="modal-actions" style="margin-top: var(--space-xl);">
            <button type="button" class="btn btn-secondary" onclick="App.navigate('vessel', '${this._slug}')">
              Cancelar
            </button>
            <button type="submit" class="btn btn-primary btn-lg" id="create-cmd-btn">
              Enviar orden
            </button>
          </div>
        </form>
      </div>
    `;

    this.updatePreview();
  },

  renderTypeButtons() {
    const types = [
      { value: 'create_user', label: 'Crear usuario' },
      { value: 'delete_user', label: 'Eliminar usuario' },
      { value: 'update_user', label: 'Editar usuario' },
      { value: 'reset_quota', label: 'Resetear cuota' },
      { value: 'set_quota_mode', label: 'Plan de datos' },
      // Ejecuta scripts RouterOS arbitrarios: solo para administradores
      { value: 'raw_command', label: 'Comando manual', adminOnly: true },
    ].filter(t => !t.adminOnly || App.isAdmin());

    return types.map(t => `
      <button type="button"
        class="btn ${this._selectedType === t.value ? 'btn-primary' : 'btn-secondary'}"
        onclick="NewCommandView.selectType('${t.value}')"
        style="flex:1; justify-content:center; min-width:120px;">
        ${t.label}
      </button>
    `).join('');
  },

  selectType(type) {
    this._selectedType = type;
    document.getElementById('type-selector').innerHTML = this.renderTypeButtons();
    document.getElementById('payload-fields').innerHTML = this.renderPayloadFields();
    this.updatePreview();
  },

  destroy() {
    if (this._pendingInterval) {
      clearInterval(this._pendingInterval);
      this._pendingInterval = null;
    }
  },

  /**
   * Bloquea el envío mientras el barco tenga una orden sin recibir.
   * Refresca el estado del barco para liberar el formulario en cuanto la tome.
   */
  async checkPending(refresh = true) {
    try {
      if (refresh) this._vessel = await API.getVessel(this._slug);
    } catch { /* si falla el refresco, dejamos el estado como estaba */ }

    const pend = (this._vessel && this._vessel.pendingCommand) || null;

    const btn = document.getElementById('create-cmd-btn');
    const aviso = document.getElementById('pending-warning');
    if (!btn) return;

    btn.disabled = !!pend;
    btn.textContent = pend ? 'Esperando al barco...' : 'Enviar orden';

    if (aviso) {
      if (!pend) { aviso.innerHTML = ''; return; }

      // Cuánto hace que está esperando: si pasaron varios minutos, es probable
      // que el router no esté pidiendo órdenes y conviene cancelarla.
      const desde = new Date(pend.created_at.endsWith('Z') ? pend.created_at : pend.created_at + 'Z');
      const mins = Math.floor((Date.now() - desde.getTime()) / 60000);
      const trabada = mins >= 3;

      aviso.innerHTML = `
        <div class="card" style="border-color: var(--status-pending); background: var(--bg-secondary); padding: var(--space-md); margin-bottom: var(--space-lg);">
          <div style="font-weight:600; margin-bottom:4px; color: var(--status-pending);">
            Hay una orden esperando (#${pend.id})
          </div>
          <div style="font-size: var(--font-size-sm); color: var(--text-secondary);">
            ${trabada
              ? (App.isAdmin()
                  ? `Lleva ${mins} minutos sin que el barco la reciba. Normalmente tarda menos de un minuto,
                     así que puede que el router no esté pidiendo órdenes. Cancelala para poder mandar otra.`
                  : `Lleva ${mins} minutos sin que el barco la reciba. Puede que el router no esté pidiendo
                     órdenes: avisale al administrador para que la cancele.`)
              : 'El barco todavía no la recibió. Se manda una por vez para que no se pisen entre sí. En cuanto la tome, este formulario se habilita solo.'}
          </div>
          ${App.isAdmin() ? `
            <button type="button" class="btn btn-secondary btn-sm" style="margin-top: var(--space-sm);"
                    onclick="NewCommandView.cancelarPendiente(${pend.id})">
              Cancelar orden y desbloquear
            </button>
          ` : ''}
        </div>
      `;
    }
  },

  /** Cancela la orden que está trabando la cola para poder mandar otra. */
  async cancelarPendiente(id) {
    try {
      await API.deleteCommand(id);
      App.toast('Orden cancelada', 'success');
      await this.checkPending();
    } catch (err) {
      App.toast(err.message, 'error');
    }
  },

  selectQuotaMode(mode) {
    // Conservar lo ya tipeado al cambiar de plan
    const nameEl = document.getElementById('cmd-name');
    const prevName = nameEl ? nameEl.value : '';

    this._quotaMode = mode;
    document.getElementById('payload-fields').innerHTML = this.renderPayloadFields();

    const newNameEl = document.getElementById('cmd-name');
    if (newNameEl) newNameEl.value = prevName;
    this.updatePreview();
  },

  renderPayloadFields() {
    switch (this._selectedType) {
      case 'create_user':
        return `
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="cmd-name">Nombre de usuario <span class="required">*</span></label>
              <input class="form-input" type="text" id="cmd-name" placeholder="Ej: juan" required
                     oninput="NewCommandView.updatePreview()" pattern="[a-zA-Z0-9._\\-]+">
              <div class="form-hint">Letras, números, puntos, guiones</div>
            </div>
            <div class="form-group">
              <label class="form-label" for="cmd-password">Contraseña <span class="required">*</span></label>
              <input class="form-input" type="text" id="cmd-password" placeholder="Ej: abc123" required
                     oninput="NewCommandView.updatePreview()">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="cmd-bytes">Límite de datos (bytes)</label>
              <input class="form-input" type="number" id="cmd-bytes" placeholder="Ej: 2147483648 (2 GB)"
                     min="0" oninput="NewCommandView.updatePreview()">
              <div class="form-hint">
                Atajos: 
                <a href="#" onclick="event.preventDefault(); document.getElementById('cmd-bytes').value=1073741824; NewCommandView.updatePreview()">1 GB</a> · 
                <a href="#" onclick="event.preventDefault(); document.getElementById('cmd-bytes').value=2147483648; NewCommandView.updatePreview()">2 GB</a> · 
                <a href="#" onclick="event.preventDefault(); document.getElementById('cmd-bytes').value=5368709120; NewCommandView.updatePreview()">5 GB</a> · 
                <a href="#" onclick="event.preventDefault(); document.getElementById('cmd-bytes').value=10737418240; NewCommandView.updatePreview()">10 GB</a>
              </div>
            </div>
            ${App.isAdmin() ? `
              <div class="form-group">
                <label class="form-label" for="cmd-profile">Perfil (opcional)</label>
                <input class="form-input" type="text" id="cmd-profile" placeholder="Ej: default"
                       oninput="NewCommandView.updatePreview()">
              </div>
            ` : ''}
          </div>
        `;

      case 'delete_user':
        return `
          <div class="form-group">
            <label class="form-label" for="cmd-name">Nombre de usuario <span class="required">*</span></label>
            <input class="form-input" type="text" id="cmd-name" placeholder="Ej: juan" required
                   oninput="NewCommandView.updatePreview()" pattern="[a-zA-Z0-9._\\-]+">
          </div>
        `;

      case 'update_user':
        // Un operador solo puede cambiar el límite de datos, no credenciales
        if (!App.isAdmin()) {
          return `
            <div class="form-group">
              <label class="form-label" for="cmd-name">Nombre de usuario <span class="required">*</span></label>
              <input class="form-input" type="text" id="cmd-name" placeholder="Ej: juan" required
                     oninput="NewCommandView.updatePreview()" pattern="[a-zA-Z0-9._\\-]+">
            </div>
            <div class="form-group">
              <label class="form-label" for="cmd-bytes">Nuevo límite (bytes)</label>
              <input class="form-input" type="number" id="cmd-bytes" placeholder="Ej: 2147483648 (2 GB)"
                     min="0" required oninput="NewCommandView.updatePreview()">
              <div class="form-hint">
                Atajos:
                <a href="#" onclick="event.preventDefault(); document.getElementById('cmd-bytes').value=1073741824; NewCommandView.updatePreview()">1 GB</a> ·
                <a href="#" onclick="event.preventDefault(); document.getElementById('cmd-bytes').value=1610612736; NewCommandView.updatePreview()">1,5 GB</a> ·
                <a href="#" onclick="event.preventDefault(); document.getElementById('cmd-bytes').value=2147483648; NewCommandView.updatePreview()">2 GB</a> ·
                <a href="#" onclick="event.preventDefault(); document.getElementById('cmd-bytes').value=3221225472; NewCommandView.updatePreview()">3 GB</a>
              </div>
            </div>
          `;
        }
        return `
          <div class="form-group">
            <label class="form-label" for="cmd-name">Nombre de usuario <span class="required">*</span></label>
            <input class="form-input" type="text" id="cmd-name" placeholder="Ej: juan" required
                   oninput="NewCommandView.updatePreview()" pattern="[a-zA-Z0-9._\\-]+">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="cmd-password">Nueva contraseña</label>
              <input class="form-input" type="text" id="cmd-password" placeholder="Dejar vacío para no cambiar"
                     oninput="NewCommandView.updatePreview()">
            </div>
            <div class="form-group">
              <label class="form-label" for="cmd-bytes">Nuevo límite (bytes)</label>
              <input class="form-input" type="number" id="cmd-bytes" placeholder="Dejar vacío para no cambiar"
                     min="0" oninput="NewCommandView.updatePreview()">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="cmd-profile">Nuevo perfil</label>
            <input class="form-input" type="text" id="cmd-profile" placeholder="Dejar vacío para no cambiar"
                   oninput="NewCommandView.updatePreview()">
          </div>
        `;

      case 'reset_quota':
        return `
          <div class="form-group">
            <label class="form-label" for="cmd-name">Nombre de usuario <span class="required">*</span></label>
            <input class="form-input" type="text" id="cmd-name" placeholder="Ej: juan" required
                   oninput="NewCommandView.updatePreview()" pattern="[a-zA-Z0-9._\\-]+">
          </div>
        `;

      case 'set_quota_mode': {
        const esMensual = this._quotaMode === 'mensual';
        const atajos = esMensual
          ? [['10 GB', 10737418240], ['16 GB', 17179869184], ['30 GB', 32212254720], ['50 GB', 53687091200]]
          : [['1 GB', 1073741824], ['1,5 GB', 1610612736], ['2 GB', 2147483648], ['3 GB', 3221225472]];

        return `
          <div class="form-group">
            <label class="form-label" for="cmd-name">Nombre de usuario <span class="required">*</span></label>
            <input class="form-input" type="text" id="cmd-name" placeholder="Ej: Usuario1" required
                   oninput="NewCommandView.updatePreview()" pattern="[a-zA-Z0-9._\\-]+">
          </div>

          <div class="form-group">
            <label class="form-label">Plan <span class="required">*</span></label>
            <div class="command-type-selector">
              <button type="button" class="btn ${!esMensual ? 'btn-primary' : 'btn-secondary'}"
                      onclick="NewCommandView.selectQuotaMode('diario')"
                      style="flex:1; justify-content:center;">
                Cuota diaria
              </button>
              <button type="button" class="btn ${esMensual ? 'btn-primary' : 'btn-secondary'}"
                      onclick="NewCommandView.selectQuotaMode('mensual')"
                      style="flex:1; justify-content:center;">
                Cuota mensual
              </button>
            </div>
            <div class="form-hint" style="margin-top:8px">
              ${esMensual
                ? 'Se reinicia el día 1 de cada mes. Si se agota antes, el usuario queda sin datos hasta el mes siguiente.'
                : 'Se reinicia todas las noches a las 00:00.'}
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="cmd-bytes">Límite ${esMensual ? 'mensual' : 'diario'} (bytes) <span class="required">*</span></label>
            <input class="form-input" type="number" id="cmd-bytes" required min="0"
                   placeholder="Ej: ${esMensual ? '17179869184 (16 GB)' : '2147483648 (2 GB)'}"
                   oninput="NewCommandView.updatePreview()">
            <div class="form-hint">
              Atajos:
              ${atajos.map(([lbl, val]) => `
                <a href="#" onclick="event.preventDefault(); document.getElementById('cmd-bytes').value=${val}; NewCommandView.updatePreview()">${lbl}</a>
              `).join(' · ')}
            </div>
          </div>

          <div class="form-hint" style="color: var(--status-pending)">
            Al cambiar de plan, el consumo del usuario vuelve a cero y arranca con la cuota completa.
          </div>
        `;
      }

      case 'raw_command':
        return `
          <div class="form-group">
            <label class="form-label" for="cmd-script">Script RouterOS <span class="required">*</span></label>
            <textarea class="form-textarea" id="cmd-script" placeholder="/ip hotspot user print" required
                      oninput="NewCommandView.updatePreview()" rows="4"></textarea>
            <div class="form-hint">Se ejecutará tal cual en el MikroTik. Usá con precaución.</div>
          </div>
        `;

      default:
        return '';
    }
  },

  updatePreview() {
    const previewBox = document.getElementById('command-preview');
    const previewCode = document.getElementById('preview-code');
    if (!previewBox || !previewCode) return;

    try {
      const payload = this.getPayload();
      const cmd = this.generatePreview(this._selectedType, payload);
      if (cmd) {
        previewCode.textContent = cmd;
        previewBox.style.display = 'block';
      } else {
        previewBox.style.display = 'none';
      }
    } catch {
      previewBox.style.display = 'none';
    }
  },

  generatePreview(type, payload) {
    switch (type) {
      case 'create_user': {
        if (!payload.name) return null;
        let cmd = `/ip hotspot user add name=${payload.name}`;
        if (payload.password) cmd += ` password=${payload.password}`;
        if (payload.limit_bytes_total) cmd += ` limit-bytes-total=${payload.limit_bytes_total}`;
        if (payload.profile) cmd += ` profile=${payload.profile}`;
        return cmd;
      }
      case 'delete_user':
        return payload.name ? `/ip hotspot user remove [find name=${payload.name}]` : null;
      case 'update_user': {
        if (!payload.name) return null;
        const parts = [];
        if (payload.password) parts.push(`password=${payload.password}`);
        if (payload.limit_bytes_total) parts.push(`limit-bytes-total=${payload.limit_bytes_total}`);
        if (payload.profile) parts.push(`profile=${payload.profile}`);
        return parts.length > 0
          ? `/ip hotspot user set [find name=${payload.name}] ${parts.join(' ')}`
          : null;
      }
      case 'reset_quota':
        return payload.name ? `/ip hotspot user reset-counters [find name=${payload.name}]` : null;
      case 'set_quota_mode': {
        if (!payload.name || !payload.limit_bytes_total) return null;
        const profile = payload.mode === 'mensual' ? 'mensual' : 'default';
        return `/ip hotspot user set [find name=${payload.name}] profile=${profile} limit-bytes-total=${payload.limit_bytes_total}\n`
             + `/ip hotspot user reset-counters [find name=${payload.name}]`;
      }
      case 'raw_command':
        return payload.script || null;
      default:
        return null;
    }
  },

  getPayload() {
    const payload = {};
    const name = document.getElementById('cmd-name');
    const password = document.getElementById('cmd-password');
    const bytes = document.getElementById('cmd-bytes');
    const profile = document.getElementById('cmd-profile');
    const script = document.getElementById('cmd-script');

    if (name) payload.name = name.value.trim();
    if (password && password.value.trim()) payload.password = password.value.trim();
    if (bytes && bytes.value) payload.limit_bytes_total = parseInt(bytes.value, 10);
    if (profile && profile.value.trim()) payload.profile = profile.value.trim();
    if (script) payload.script = script.value;

    // El plan se toma del selector, no de un campo del formulario
    if (this._selectedType === 'set_quota_mode') payload.mode = this._quotaMode;

    return payload;
  },

  async handleSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('create-cmd-btn');
    const errorDiv = document.getElementById('create-command-error');

    btn.disabled = true;
    btn.textContent = 'Enviando...';
    errorDiv.innerHTML = '';

    try {
      const payload = this.getPayload();
      await API.createCommand(this._slug, this._selectedType, payload);
      App.toast('Orden creada y en cola para el barco', 'success');
      App.navigate('vessel', this._slug);
    } catch (err) {
      errorDiv.innerHTML = `<div class="form-error" style="margin-top:var(--space-md)">${App.utils.escapeHtml(err.message)}</div>`;
      // Deja el botón como corresponda: si el rechazo fue porque ya hay una
      // orden en cola, tiene que seguir bloqueado.
      await this.checkPending();
    }
  },
};
