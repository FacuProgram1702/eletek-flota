/**
 * Logger simple con timestamps.
 * Centraliza el formato de los logs para facilitar diagnóstico.
 */

function timestamp() {
  return new Date().toISOString();
}

const logger = {
  info(msg, ...args) {
    console.log(`[${timestamp()}] [INFO]  ${msg}`, ...args);
  },
  warn(msg, ...args) {
    console.warn(`[${timestamp()}] [WARN]  ${msg}`, ...args);
  },
  error(msg, ...args) {
    console.error(`[${timestamp()}] [ERROR] ${msg}`, ...args);
  },
  poll(vessel, commandCount) {
    console.log(`[${timestamp()}] [POLL]  ${vessel} → ${commandCount} comando(s) pendiente(s)`);
  },
  result(vessel, commandId, status) {
    console.log(`[${timestamp()}] [RESULT] ${vessel} → cmd #${commandId} → ${status}`);
  },
};

module.exports = logger;
