/**
 * ELETEK — Status Badge Component
 */

const StatusBadge = {
  /**
   * Badge de estado online/offline para barcos.
   * @param {boolean} online
   * @returns {string} HTML
   */
  vessel(online) {
    const cls = online ? 'status-online' : 'status-offline';
    const label = online ? 'Online' : 'Offline';
    return `
      <span class="status-badge ${cls}">
        <span class="status-dot"></span>
        ${label}
      </span>
    `;
  },

  /**
   * Badge de estado para comandos (pending, sent, done, error).
   * @param {string} status
   * @returns {string} HTML
   */
  command(status) {
    const labels = {
      pending: 'Pendiente',
      sent: 'Enviado',
      done: 'Completado',
      error: 'Error',
    };
    return `
      <span class="status-badge status-${status}">
        <span class="status-dot"></span>
        ${labels[status] || status}
      </span>
    `;
  },
};
