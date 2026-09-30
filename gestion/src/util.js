/**
 * Utilidades comunes a todas las rutas.
 */

const db = require('./db/database');

/** Fecha y hora actual en ISO UTC. Ver esquema.js: fechas siempre así. */
function ahora() {
  return new Date().toISOString();
}

/**
 * Error pensado para mostrarle al usuario tal cual. Cualquier otro error es
 * un fallo del programa: se registra y se responde un mensaje genérico.
 */
class ErrorUsuario extends Error {
  constructor(mensaje, status = 400) {
    super(mensaje);
    this.status = status;
    this.esUsuario = true;
  }
}

/** Envuelve un manejador para que los errores lleguen al manejador global. */
function ruta(fn) {
  return (req, res, next) => {
    try {
      const r = fn(req, res, next);
      if (r && typeof r.catch === 'function') r.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

// ── Lectura de datos que llegan del formulario ───────────────────────
// Todo lo que viene del navegador se valida acá: el panel también valida,
// pero la API no puede confiar en eso.

function texto(v, { max = 500, requerido = false, campo = 'El campo' } = {}) {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (requerido && !s) throw new ErrorUsuario(`${campo} es obligatorio`);
  if (s.length > max) throw new ErrorUsuario(`${campo} es demasiado largo (máximo ${max} caracteres)`);
  return s;
}

function numero(v, { requerido = false, campo = 'El número', min = null, max = null } = {}) {
  if (v === undefined || v === null || v === '') {
    if (requerido) throw new ErrorUsuario(`${campo} es obligatorio`);
    return null;
  }
  // Acepta coma decimal, como se escribe en Argentina ("12,5")
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) throw new ErrorUsuario(`${campo} no es un número válido`);
  if (min !== null && n < min) throw new ErrorUsuario(`${campo} no puede ser menor que ${min}`);
  if (max !== null && n > max) throw new ErrorUsuario(`${campo} no puede ser mayor que ${max}`);
  return n;
}

function entero(v, opts = {}) {
  const n = numero(v, opts);
  if (n !== null && !Number.isInteger(n)) throw new ErrorUsuario(`${opts.campo || 'El número'} debe ser entero`);
  return n;
}

function opcion(v, validas, { campo = 'El valor', defecto } = {}) {
  if ((v === undefined || v === null || v === '') && defecto !== undefined) return defecto;
  if (!validas.includes(v)) throw new ErrorUsuario(`${campo} no es válido`);
  return v;
}

/** Fecha 'YYYY-MM-DD' o ISO completa → ISO. */
function fecha(v, { requerido = false, campo = 'La fecha' } = {}) {
  if (!v) {
    if (requerido) throw new ErrorUsuario(`${campo} es obligatoria`);
    return null;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ErrorUsuario(`${campo} no es válida`);
  return d.toISOString();
}

function idParam(v, campo = 'id') {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ErrorUsuario(`${campo} inválido`, 400);
  return n;
}

/** Próximo número correlativo de un documento dentro de la empresa. */
function siguienteNumero(tabla, empresaId) {
  const r = db.uno(`SELECT MAX(numero) AS n FROM ${tabla} WHERE empresa_id = ?`, empresaId);
  return (r && r.n ? r.n : 0) + 1;
}

function json(v, defecto) {
  try { return JSON.parse(v); } catch (e) { return defecto; }
}

module.exports = {
  ahora, ErrorUsuario, ruta, texto, numero, entero, opcion, fecha, idParam, siguienteNumero, json,
};
