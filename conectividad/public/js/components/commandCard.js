/**
 * ELETEK — Command Card Component
 */

const CommandCard = {
  /**
   * Íconos por tipo de comando.
   */
  icons: {
    create_user: '+',
    delete_user: '×',
    update_user: '~',
    reset_quota: '↺',
    raw_command: '>_',
  },

  /**
   * Labels legibles por tipo de comando.
   */
  labels: {
    create_user: 'Crear usuario',
    delete_user: 'Eliminar usuario',
    update_user: 'Editar usuario',
    reset_quota: 'Resetear cuota',
    raw_command: 'Comando manual',
  },

  /**
   * Renderiza una tarjeta de comando.
   * @param {object} command
   * @returns {string} HTML
   */
  render(command) {
    const icon = this.icons[command.type] || '•';
    const label = this.labels[command.type] || command.type;
    const created = App.utils.timeAgo(command.created_at);
    const executed = command.executed_at ? App.utils.timeAgo(command.executed_at) : null;

    let resultHtml = '';
    if (command.result && (command.status === 'done' || command.status === 'error')) {
      resultHtml = `
        <div class="command-result command-result-${command.status}">
          ${App.utils.escapeHtml(command.result)}
        </div>
      `;
    }

    let cancelBtn = '';
    if (command.status === 'pending') {
      cancelBtn = `
        <button class="btn btn-danger btn-sm" onclick="VesselView.cancelCommand(${command.id})">
          Cancelar
        </button>
      `;
    }

    return `
      <div class="card command-card command-type-${command.type}">
        <div class="command-card-header">
          <div class="command-card-left">
            <div class="command-type-icon">${icon}</div>
            <div>
              <span class="command-type">${label}</span>
              <span class="command-id">#${command.id}</span>
            </div>
          </div>
          <div class="flex gap-sm" style="align-items:center">
            ${StatusBadge.command(command.status)}
            ${cancelBtn}
          </div>
        </div>
        <div class="command-script">${App.utils.escapeHtml(command.raw_script)}</div>
        ${resultHtml}
        <div class="command-meta">
          <span>Creado ${created}</span>
          ${executed ? `<span>Ejecutado ${executed}</span>` : ''}
        </div>
      </div>
    `;
  },
};
