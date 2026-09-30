/**
 * Alta de empresas y barcos, y lectura de las opciones de la empresa.
 */

const db = require('../db/database');
const { ahora, json } = require('../util');
const { ROLES_MODELO, OPCIONES_DEFECTO } = require('../permisos');

const LISTAS_DEFECTO = {
  categoria: ['Repuestos', 'Lubricantes', 'Filtros', 'Consumibles', 'Pesca', 'Seguridad', 'Víveres', 'Limpieza', 'Electricidad'],
  unidad: ['u', 'kg', 'l', 'm', 'caja', 'juego', 'rollo'],
  especie: ['Merluza común (Merluccius hubbsi)', 'Calamar (Illex argentinus)', 'Langostino (Pleoticus muelleri)', 'Abadejo', 'Merluza negra', 'Corvina', 'Pescadilla', 'Raya', 'Otras'],
  arte: ['Red de arrastre de fondo', 'Red de arrastre de media agua', 'Poteras', 'Palangre', 'Tangones'],
  puerto: ['Mar del Plata', 'Puerto Madryn', 'Rawson', 'Puerto Deseado', 'Ushuaia', 'Bahía Blanca', 'Necochea / Quequén'],
};

function opcionesDe(empresaId) {
  const e = db.uno('SELECT opciones FROM empresas WHERE id = ?', empresaId);
  return { ...OPCIONES_DEFECTO, ...(e ? json(e.opciones, {}) : {}) };
}

/** Crea el depósito propio de un barco (cada barco es un depósito). */
function crearDepositoBarco(empresaId, barcoId, nombreBarco) {
  return db.ejecutar(
    `INSERT INTO depositos (empresa_id, nombre, tipo, barco_id) VALUES (?, ?, 'barco', ?)`,
    empresaId, `A bordo — ${nombreBarco}`, barcoId
  ).id;
}

function crearBarco(empresaId, { nombre, matricula = '', slug_conectividad = '' }) {
  return db.transaccion(() => {
    const id = db.ejecutar(
      `INSERT INTO barcos (empresa_id, nombre, matricula, slug_conectividad, creado) VALUES (?, ?, ?, ?, ?)`,
      empresaId, nombre, matricula, slug_conectividad, ahora()
    ).id;
    crearDepositoBarco(empresaId, id, nombre);
    return id;
  });
}

/**
 * Empresa nueva: roles modelo, un depósito en tierra y listas de valores.
 * Los usuarios los crea después el administrador de la empresa.
 */
function crearEmpresa({ nombre, plan = 'gestion', opciones = {} }) {
  return db.transaccion(() => {
    const id = db.ejecutar(
      `INSERT INTO empresas (nombre, plan, opciones, creado) VALUES (?, ?, ?, ?)`,
      nombre, plan, JSON.stringify({ ...OPCIONES_DEFECTO, ...opciones }), ahora()
    ).id;
    for (const r of ROLES_MODELO) {
      db.ejecutar(
        `INSERT INTO roles (empresa_id, nombre, descripcion, permisos, a_bordo) VALUES (?, ?, ?, ?, ?)`,
        id, r.nombre, r.descripcion, JSON.stringify(r.permisos), r.a_bordo
      );
    }
    db.ejecutar(`INSERT INTO depositos (empresa_id, nombre, tipo) VALUES (?, 'Depósito en tierra', 'tierra')`, id);
    for (const [lista, valores] of Object.entries(LISTAS_DEFECTO)) {
      for (const v of valores) {
        db.ejecutar(`INSERT INTO listas (empresa_id, lista, valor) VALUES (?, ?, ?)`, id, lista, v);
      }
    }
    return id;
  });
}

module.exports = { opcionesDe, crearEmpresa, crearBarco, crearDepositoBarco, LISTAS_DEFECTO };
