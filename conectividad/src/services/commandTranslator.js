/**
 * Traductor de órdenes de alto nivel a comandos RouterOS (raw_script).
 *
 * Recibe un tipo de orden y su payload (datos humanos) y genera
 * el/los comando(s) RouterOS listos para ejecutar en el MikroTik.
 */

const {
  validateUsername,
  validatePassword,
  validateBytes,
  validateProfile,
} = require('../utils/sanitize');

/**
 * Traduce una orden a raw_script de RouterOS.
 * @param {string} type - Tipo de orden (create_user, delete_user, etc.)
 * @param {object} payload - Parámetros de la orden
 * @returns {{ raw_script: string }} | throws Error
 */
function translate(type, payload) {
  switch (type) {
    case 'create_user':
      return translateCreateUser(payload);
    case 'delete_user':
      return translateDeleteUser(payload);
    case 'update_user':
      return translateUpdateUser(payload);
    case 'reset_quota':
      return translateResetQuota(payload);
    case 'set_quota_mode':
      return translateSetQuotaMode(payload);
    case 'raw_command':
      return translateRawCommand(payload);
    default:
      throw new Error(`Tipo de orden desconocido: "${type}"`);
  }
}

function translateCreateUser(payload) {
  const { name, password, limit_bytes_total, profile } = payload;

  // Validar campos requeridos
  const nameCheck = validateUsername(name);
  if (!nameCheck.valid) throw new Error(`name: ${nameCheck.error}`);

  const passCheck = validatePassword(password);
  if (!passCheck.valid) throw new Error(`password: ${passCheck.error}`);

  // Construir comando
  let cmd = `/ip hotspot user add name=${name} password=${password}`;

  if (limit_bytes_total !== undefined && limit_bytes_total !== null && limit_bytes_total !== '') {
    const bytesCheck = validateBytes(limit_bytes_total);
    if (!bytesCheck.valid) throw new Error(`limit_bytes_total: ${bytesCheck.error}`);
    cmd += ` limit-bytes-total=${bytesCheck.value}`;
  }

  if (profile) {
    const profileCheck = validateProfile(profile);
    if (!profileCheck.valid) throw new Error(`profile: ${profileCheck.error}`);
    cmd += ` profile=${profile}`;
  }

  return { raw_script: cmd };
}

function translateDeleteUser(payload) {
  const { name } = payload;

  const nameCheck = validateUsername(name);
  if (!nameCheck.valid) throw new Error(`name: ${nameCheck.error}`);

  return { raw_script: `/ip hotspot user remove [find name=${name}]` };
}

function translateUpdateUser(payload) {
  const { name, ...fields } = payload;

  const nameCheck = validateUsername(name);
  if (!nameCheck.valid) throw new Error(`name: ${nameCheck.error}`);

  const setParts = [];

  if (fields.password !== undefined) {
    const passCheck = validatePassword(fields.password);
    if (!passCheck.valid) throw new Error(`password: ${passCheck.error}`);
    setParts.push(`password=${fields.password}`);
  }

  if (fields.limit_bytes_total !== undefined) {
    const bytesCheck = validateBytes(fields.limit_bytes_total);
    if (!bytesCheck.valid) throw new Error(`limit_bytes_total: ${bytesCheck.error}`);
    setParts.push(`limit-bytes-total=${bytesCheck.value}`);
  }

  if (fields.profile !== undefined) {
    const profileCheck = validateProfile(fields.profile);
    if (!profileCheck.valid) throw new Error(`profile: ${profileCheck.error}`);
    setParts.push(`profile=${fields.profile}`);
  }

  if (setParts.length === 0) {
    throw new Error('No se especificaron campos para actualizar');
  }

  return {
    raw_script: `/ip hotspot user set [find name=${name}] ${setParts.join(' ')}`,
  };
}

function translateResetQuota(payload) {
  const { name } = payload;

  const nameCheck = validateUsername(name);
  if (!nameCheck.valid) throw new Error(`name: ${nameCheck.error}`);

  return { raw_script: `/ip hotspot user reset-counters [find name=${name}]` };
}

/**
 * Planes de datos disponibles.
 * El perfil de RouterOS es la etiqueta que usan los schedulers para saber
 * a quién resetear: 'default' todas las noches, 'mensual' el día 1.
 */
const QUOTA_MODES = {
  diario: { profile: 'default', label: 'Cuota diaria' },
  mensual: { profile: 'mensual', label: 'Cuota mensual' },
};

/**
 * Cambia el plan de datos de un usuario (diario <-> mensual) y su límite.
 * Resetea el contador para que arranque limpio con la cuota nueva.
 */
function translateSetQuotaMode(payload) {
  const { name, mode, limit_bytes_total } = payload;

  const nameCheck = validateUsername(name);
  if (!nameCheck.valid) throw new Error(`name: ${nameCheck.error}`);

  // El perfil sale de esta tabla, nunca del cliente
  const plan = QUOTA_MODES[mode];
  if (!plan) {
    throw new Error(`mode: debe ser "diario" o "mensual" (recibido: "${mode}")`);
  }

  const bytesCheck = validateBytes(limit_bytes_total);
  if (!bytesCheck.valid) throw new Error(`limit_bytes_total: ${bytesCheck.error}`);

  return {
    raw_script:
      `/ip hotspot user set [find name=${name}] profile=${plan.profile} limit-bytes-total=${bytesCheck.value}\n` +
      `/ip hotspot user reset-counters [find name=${name}]`,
  };
}

function translateRawCommand(payload) {
  const { script } = payload;

  if (!script || typeof script !== 'string' || script.trim().length === 0) {
    throw new Error('El script es requerido para comandos raw');
  }

  if (script.length > 4096) {
    throw new Error('El script es demasiado largo (máximo 4096 caracteres)');
  }

  return { raw_script: script.trim() };
}

// Lista de tipos soportados (para validación y UI)
const COMMAND_TYPES = [
  { value: 'create_user', label: 'Crear usuario', description: 'Agrega un usuario al hotspot' },
  { value: 'delete_user', label: 'Eliminar usuario', description: 'Elimina un usuario del hotspot' },
  { value: 'update_user', label: 'Editar usuario', description: 'Modifica campos de un usuario existente' },
  { value: 'reset_quota', label: 'Resetear cuota', description: 'Reinicia los contadores de un usuario' },
  { value: 'set_quota_mode', label: 'Cambiar plan de datos', description: 'Pasa un usuario a cuota diaria o mensual y define su límite' },
  { value: 'raw_command', label: 'Comando manual', description: 'Ejecuta un script RouterOS personalizado' },
];

module.exports = { translate, COMMAND_TYPES, QUOTA_MODES };
