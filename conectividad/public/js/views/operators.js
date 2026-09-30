/**
 * ELETEK — Operators View
 * Gestión de operadores: crear, editar barcos asignados y eliminar.
 * Solo visible para administradores.
 */

const OperatorsView = {
  operators: [],
  vessels: [],

  async render() {
    return `
      ${Navbar.render()}
      <div class="page">
        <div class="page-header">
          <div>
            <h1 class="page-title">Operadores</h1>
            <p class="page-description">Gestioná los usuarios con acceso al panel</p>
          </div>
          <button class="btn btn-primary" id="btn-add-operator" onclick="OperatorsView.showAddModal()">
            + Nuevo operador
          </button>
        </div>
        <div id="operators-list">
          <div class="flex-center" style="padding:48px">
            <div class="loading-spinner"></div>
          </div>
        </div>
      </div>
      <div id="modal-container"></div>
    `;
  },

  async afterRender() {
    await this.loadData();
  },

  async loadData() {
    try {
      [this.operators, this.vessels] = await Promise.all([
        API.getOperators(),
        API.getVessels(),
      ]);
      this.renderList();
    } catch (err) {
      document.getElementById('operators-list').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">Error al cargar operadores</div>
          <div class="empty-state-text">${App.utils.escapeHtml(err.message)}</div>
        </div>
      `;
    }
  },

  renderList() {
    const container = document.getElementById('operators-list');
    if (!container) return;

    if (this.operators.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">No hay operadores</div>
          <div class="empty-state-text">Creá el primer operador para darle acceso restringido al panel.</div>
          <button class="btn btn-primary" onclick="OperatorsView.showAddModal()">Nuevo operador</button>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="operators-table-wrap">
        <table class="operators-table">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Barcos asignados</th>
              <th>Creado</th>
              <th style="text-align:right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${this.operators.map((op) => this.renderRow(op)).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  renderRow(op) {
    const vesselBadges = op.scope && op.scope.length > 0
      ? op.scope.map((slug) => {
          const v = this.vessels.find((x) => x.slug === slug);
          const label = v ? App.utils.escapeHtml(v.name) : App.utils.escapeHtml(slug);
          return `<span class="vessel-badge">${label}</span>`;
        }).join('')
      : `<span class="vessel-badge vessel-badge-none">Sin barcos</span>`;

    const created = op.created_at
      ? new Date(op.created_at + 'Z').toLocaleDateString('es-AR')
      : '—';

    return `
      <tr class="operator-row" id="operator-row-${op.id}">
        <td>
          <div class="operator-name">${App.utils.escapeHtml(op.username)}</div>
          <div class="operator-role-badge">operador</div>
        </td>
        <td>
          <div class="vessel-badges">${vesselBadges}</div>
        </td>
        <td class="operator-date">${created}</td>
        <td>
          <div class="operator-actions">
            <button class="btn btn-secondary btn-sm"
              onclick="OperatorsView.showEditModal(${op.id})">
              ✏️ Editar
            </button>
            <button class="btn btn-danger btn-sm"
              onclick="OperatorsView.confirmDelete(${op.id}, '${App.utils.escapeHtml(op.username)}')">
              🗑️ Eliminar
            </button>
          </div>
        </td>
      </tr>
    `;
  },

  // ── Modal Agregar ─────────────────────────────────────────────

  showAddModal() {
    const vesselCheckboxes = this.vessels.map((v) => `
      <label class="vessel-check-label">
        <input type="checkbox" class="vessel-check" value="${v.slug}" id="chk-add-${v.slug}">
        <span class="vessel-check-name">${App.utils.escapeHtml(v.name)}</span>
        <span class="vessel-check-slug">${v.slug}</span>
      </label>
    `).join('');

    const noVessels = this.vessels.length === 0
      ? `<div class="form-hint" style="color:var(--warning)">No hay barcos registrados aún. Primero agregá un barco desde la sección Flota.</div>`
      : '';

    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="OperatorsView.closeModal(event)">
        <div class="modal" onclick="event.stopPropagation()">
          <h2 class="modal-title">Nuevo operador</h2>
          <form onsubmit="OperatorsView.handleAdd(event)">

            <div class="form-group">
              <label class="form-label" for="op-username">
                Usuario <span class="required">*</span>
              </label>
              <input class="form-input" type="text" id="op-username"
                placeholder="Ej: juanmikrotik" autocomplete="off" required>
            </div>

            <div class="form-group">
              <label class="form-label" for="op-password">
                Contraseña <span class="required">*</span>
              </label>
              <input class="form-input" type="password" id="op-password"
                placeholder="Mínimo 6 caracteres" autocomplete="new-password" required minlength="6">
            </div>

            <div class="form-group">
              <label class="form-label">Barcos con acceso</label>
              ${noVessels}
              <div class="vessel-check-list" id="vessel-check-list-add">
                ${vesselCheckboxes || '<div class="form-hint">Sin barcos disponibles</div>'}
              </div>
              <div class="form-hint">Si no seleccionás ninguno, el operador no verá barcos.</div>
            </div>

            <div id="add-op-error"></div>
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" onclick="OperatorsView.closeModal()">Cancelar</button>
              <button type="submit" class="btn btn-primary" id="btn-add-op-submit">Crear operador</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.getElementById('op-username').focus();
  },

  async handleAdd(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-add-op-submit');
    const errorDiv = document.getElementById('add-op-error');
    const username = document.getElementById('op-username').value.trim();
    const password = document.getElementById('op-password').value;
    const scope = Array.from(
      document.querySelectorAll('#vessel-check-list-add .vessel-check:checked')
    ).map((cb) => cb.value);

    btn.disabled = true;
    btn.textContent = 'Creando...';
    errorDiv.innerHTML = '';

    try {
      await API.createOperator(username, password, scope);
      this.closeModal();
      App.toast(`Operador "${username}" creado correctamente`, 'success');
      await this.loadData();
    } catch (err) {
      errorDiv.innerHTML = `<div class="form-error">${App.utils.escapeHtml(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Crear operador';
    }
  },

  // ── Modal Editar ─────────────────────────────────────────────

  showEditModal(id) {
    const op = this.operators.find((o) => o.id === id);
    if (!op) return;

    const vesselCheckboxes = this.vessels.map((v) => {
      const checked = op.scope && op.scope.includes(v.slug) ? 'checked' : '';
      return `
        <label class="vessel-check-label">
          <input type="checkbox" class="vessel-check" value="${v.slug}"
            id="chk-edit-${v.slug}" ${checked}>
          <span class="vessel-check-name">${App.utils.escapeHtml(v.name)}</span>
          <span class="vessel-check-slug">${v.slug}</span>
        </label>
      `;
    }).join('');

    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="OperatorsView.closeModal(event)">
        <div class="modal" onclick="event.stopPropagation()">
          <h2 class="modal-title">Editar operador</h2>
          <form onsubmit="OperatorsView.handleEdit(event, ${op.id})">

            <div class="form-group">
              <label class="form-label" for="edit-op-username">Usuario</label>
              <input class="form-input" type="text" id="edit-op-username"
                value="${App.utils.escapeHtml(op.username)}" autocomplete="off" required>
            </div>

            <div class="form-group">
              <label class="form-label" for="edit-op-password">
                Nueva contraseña
                <span class="form-hint" style="display:inline; margin-left:8px">(dejar vacío para no cambiar)</span>
              </label>
              <input class="form-input" type="password" id="edit-op-password"
                placeholder="Nueva contraseña (opcional)" autocomplete="new-password" minlength="6">
            </div>

            <div class="form-group">
              <label class="form-label">Barcos con acceso</label>
              <div class="vessel-check-list" id="vessel-check-list-edit">
                ${vesselCheckboxes || '<div class="form-hint">Sin barcos disponibles</div>'}
              </div>
              <div class="form-hint">Marcá los barcos que puede ver este operador.</div>
            </div>

            <div id="edit-op-error"></div>
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" onclick="OperatorsView.closeModal()">Cancelar</button>
              <button type="submit" class="btn btn-primary" id="btn-edit-op-submit">Guardar cambios</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.getElementById('edit-op-username').focus();
  },

  async handleEdit(e, id) {
    e.preventDefault();
    const btn = document.getElementById('btn-edit-op-submit');
    const errorDiv = document.getElementById('edit-op-error');
    const username = document.getElementById('edit-op-username').value.trim();
    const password = document.getElementById('edit-op-password').value;
    const scope = Array.from(
      document.querySelectorAll('#vessel-check-list-edit .vessel-check:checked')
    ).map((cb) => cb.value);

    btn.disabled = true;
    btn.textContent = 'Guardando...';
    errorDiv.innerHTML = '';

    const payload = { username, scope };
    if (password) payload.password = password;

    try {
      await API.updateOperator(id, payload);
      this.closeModal();
      App.toast('Operador actualizado correctamente', 'success');
      await this.loadData();
    } catch (err) {
      errorDiv.innerHTML = `<div class="form-error">${App.utils.escapeHtml(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar cambios';
    }
  },

  // ── Confirmar eliminación ─────────────────────────────────────

  confirmDelete(id, username) {
    document.getElementById('modal-container').innerHTML = `
      <div class="modal-overlay" onclick="OperatorsView.closeModal(event)">
        <div class="modal modal-sm" onclick="event.stopPropagation()">
          <h2 class="modal-title">Eliminar operador</h2>
          <p style="color:var(--text-secondary); margin-bottom:var(--space-lg)">
            ¿Estás seguro que querés eliminar al operador
            <strong>${App.utils.escapeHtml(username)}</strong>?
            Esta acción no se puede deshacer.
          </p>
          <div class="modal-actions">
            <button class="btn btn-secondary" onclick="OperatorsView.closeModal()">Cancelar</button>
            <button class="btn btn-danger" id="btn-confirm-delete"
              onclick="OperatorsView.handleDelete(${id})">
              Eliminar
            </button>
          </div>
        </div>
      </div>
    `;
  },

  async handleDelete(id) {
    const btn = document.getElementById('btn-confirm-delete');
    if (btn) { btn.disabled = true; btn.textContent = 'Eliminando...'; }
    try {
      await API.deleteOperator(id);
      this.closeModal();
      App.toast('Operador eliminado', 'success');
      await this.loadData();
    } catch (err) {
      App.toast(err.message, 'error');
      this.closeModal();
    }
  },

  // ── Helpers ───────────────────────────────────────────────────

  closeModal(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('modal-container');
    if (modal) modal.innerHTML = '';
  },
};
