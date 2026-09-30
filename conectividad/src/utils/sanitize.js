/**
 * Utilidades de sanitización para prevenir inyección de comandos en RouterOS.
 *
 * RouterOS interpreta ciertos caracteres como metacaracteres:
 *   ;  (separador de comandos)
 *   [  ]  (sub-expresiones)
 *   "  (strings)
 *   \  (escape)
 *   $  (variables)
 *   #  (comentarios)
 *   {  }  (bloques de script)
 *   \n (nueva línea = nuevo comando)
 *
 * La estrategia: validar estrictamente los valores en vez de intentar escapar,
 * porque el escapado de RouterOS es inconsistente y frágil.
 */

// Regex para nombres de usuario de hotspot: alfanuméricos, punto, guión, guión bajo
const USERNAME_REGEX = /^[a-zA-Z0-9._-]{1,64}$/;

// Regex para valores seguros genéricos (sin metacaracteres de RouterOS)
const SAFE_VALUE_REGEX = /^[a-zA-Z0-9._\-@!#%&+=:/ ]{0,256}$/;

// Regex para slug de barco
const SLUG_REGEX = /^[a-z0-9-]{1,32}$/;

/**
 * Valida un nombre de usuario de hotspot.
 * @param {string} name
 * @returns {{ valid: boolean, error?: string }}
 */
function validateUsername(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'El nombre de usuario es requerido' };
  }
  if (!USERNAME_REGEX.test(name)) {
    return {
      valid: false,
      error: 'El nombre solo puede contener letras, números, puntos, guiones y guiones bajos (máx 64 caracteres)',
    };
  }
  return { valid: true };
}

/**
 * Valida una contraseña para hotspot.
 * RouterOS acepta contraseñas con muchos caracteres, pero evitamos metacaracteres.
 * @param {string} password
 * @returns {{ valid: boolean, error?: string }}
 */
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'La contraseña es requerida' };
  }
  if (password.length < 1 || password.length > 128) {
    return { valid: false, error: 'La contraseña debe tener entre 1 y 128 caracteres' };
  }
  // Prohibir metacaracteres peligrosos de RouterOS
  const dangerous = /[;[\]"\\${}()\n\r]/;
  if (dangerous.test(password)) {
    return {
      valid: false,
      error: 'La contraseña no puede contener: ; [ ] " \\ $ { } ( ) ni saltos de línea',
    };
  }
  return { valid: true };
}

/**
 * Valida un valor numérico de bytes (limit-bytes-total).
 * @param {*} bytes
 * @returns {{ valid: boolean, value?: number, error?: string }}
 */
function validateBytes(bytes) {
  const num = Number(bytes);
  if (isNaN(num) || num < 0 || !Number.isFinite(num)) {
    return { valid: false, error: 'El límite de bytes debe ser un número positivo' };
  }
  return { valid: true, value: Math.floor(num) };
}

/**
 * Valida un nombre de perfil de hotspot.
 * @param {string} profile
 * @returns {{ valid: boolean, error?: string }}
 */
function validateProfile(profile) {
  if (!profile) return { valid: true }; // opcional
  if (!SAFE_VALUE_REGEX.test(profile)) {
    return { valid: false, error: 'El nombre del perfil contiene caracteres no permitidos' };
  }
  return { valid: true };
}

/**
 * Valida un slug de barco.
 * @param {string} slug
 * @returns {{ valid: boolean, error?: string }}
 */
function validateSlug(slug) {
  if (!slug || typeof slug !== 'string') {
    return { valid: false, error: 'El slug es requerido' };
  }
  if (!SLUG_REGEX.test(slug)) {
    return {
      valid: false,
      error: 'El slug solo puede contener letras minúsculas, números y guiones (máx 32 caracteres)',
    };
  }
  return { valid: true };
}

module.exports = {
  validateUsername,
  validatePassword,
  validateBytes,
  validateProfile,
  validateSlug,
  USERNAME_REGEX,
  SAFE_VALUE_REGEX,
  SLUG_REGEX,
};
