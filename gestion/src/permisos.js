/**
 * Catálogo de módulos, acciones y planes.
 *
 * Los roles de cada empresa guardan, por módulo, la lista de acciones que
 * permiten. Este archivo define cuáles existen y los roles modelo que se
 * crean al dar de alta una empresa (la empresa después los cambia a gusto).
 */

const MODULOS = [
  { clave: 'stock', nombre: 'Stock',
    acciones: { ver: 'Ver existencias y movimientos', cargar: 'Cargar movimientos (entradas, transferencias, consumos)', administrar: 'Artículos, depósitos, ajustes e importación' } },
  { clave: 'mantenimiento', nombre: 'Mantenimiento',
    acciones: { ver: 'Ver equipos, planes y vencimientos', cargar: 'Registrar mantenimientos y horómetro', planificar: 'Armar equipos y planes preventivos' } },
  { clave: 'trabajos', nombre: 'Pedidos de trabajo',
    acciones: { ver: 'Ver pedidos', cargar: 'Pedir trabajos y registrar su realización', aprobar: 'Aprobar, rechazar y asignar' } },
  { clave: 'compras', nombre: 'Compras',
    acciones: { ver: 'Ver compras', cargar: 'Solicitar compras', aprobar: 'Cotizar, aprobar y emitir órdenes', recibir: 'Recibir mercadería' } },
  { clave: 'proveedores', nombre: 'Proveedores y talleres',
    acciones: { ver: 'Ver', administrar: 'Crear y editar' } },
  { clave: 'pesca', nombre: 'Partes de pesca',
    acciones: { ver: 'Ver mareas y lances', cargar: 'Cargar mareas, lances y capturas' } },
  { clave: 'viveres', nombre: 'Víveres',
    acciones: { ver: 'Ver víveres por marea', cargar: 'Cargar y cerrar víveres de la marea' } },
  { clave: 'seguimiento', nombre: 'Seguimiento y actividad',
    acciones: { ver: 'Ver el recorrido, la actividad (pescando, navegando, a la capa…) y los lances detectados', configurar: 'Ajustar velocidades de cada barco y puertos' } },
];

const CLAVES = MODULOS.map((m) => m.clave);

/** Qué módulos de este sistema habilita cada plan. */
const PLANES = {
  conectividad: { nombre: 'Conectividad', modulos: [] },
  // El seguimiento solo necesita el GPS del barco: va también en el plan de
  // ubicación, sin el resto de la gestión.
  ubicacion: { nombre: 'Conectividad + Ubicación', modulos: ['seguimiento'] },
  gestion: { nombre: 'Gestión integral', modulos: CLAVES },
};

const OPCIONES_DEFECTO = {
  acceso_abordo: false,          // capitán / jefe de máquinas entran desde el celular
  aprobacion_monto: false,       // segunda aprobación de compras por monto
  monto_umbral: 0,               // en pesos
  rol_segunda_aprobacion: null,  // id del rol que da la segunda aprobación
  margen_dias: 15,               // "por vencer" en el tablero de mantenimiento
  margen_horas: 50,
};

/** Roles con los que arranca cada empresa nueva. */
const ROLES_MODELO = [
  { nombre: 'Dueño', descripcion: 'Ve todo: informes, costos y estado de la flota', a_bordo: 0,
    permisos: { stock: ['ver'], mantenimiento: ['ver'], trabajos: ['ver'], compras: ['ver'], proveedores: ['ver'], pesca: ['ver'], viveres: ['ver'], seguimiento: ['ver'] } },
  { nombre: 'Área técnica', descripcion: 'Aprueba pedidos de trabajo, asigna talleres y arma los planes de mantenimiento', a_bordo: 0,
    permisos: { stock: ['ver'], mantenimiento: ['ver', 'cargar', 'planificar'], trabajos: ['ver', 'cargar', 'aprobar'], compras: ['ver', 'cargar'], proveedores: ['ver', 'administrar'], pesca: ['ver'], viveres: ['ver'], seguimiento: ['ver'] } },
  { nombre: 'Capitán', descripcion: 'Pide trabajos, carga partes de pesca y ve el stock de su barco', a_bordo: 1,
    permisos: { stock: ['ver'], mantenimiento: ['ver', 'cargar'], trabajos: ['ver', 'cargar'], pesca: ['ver', 'cargar'], viveres: ['ver'], seguimiento: ['ver'] } },
  { nombre: 'Jefe de máquinas', descripcion: 'Horómetro, mantenimientos, fallas y material usado', a_bordo: 1,
    permisos: { stock: ['ver', 'cargar'], mantenimiento: ['ver', 'cargar'], trabajos: ['ver', 'cargar'], compras: ['ver', 'cargar'] } },
  { nombre: 'Stock', descripcion: 'Recibe mercadería, transfiere a los barcos y hace inventarios', a_bordo: 0,
    permisos: { stock: ['ver', 'cargar', 'administrar'], compras: ['ver', 'recibir'], proveedores: ['ver'], viveres: ['ver', 'cargar'] } },
  { nombre: 'Compras', descripcion: 'Gestiona y aprueba las compras', a_bordo: 0,
    permisos: { stock: ['ver'], compras: ['ver', 'cargar', 'aprobar', 'recibir'], proveedores: ['ver', 'administrar'], trabajos: ['ver'] } },
  { nombre: 'Víveres', descripcion: 'Carga víveres al zarpar y controla el consumo por marea', a_bordo: 0,
    permisos: { stock: ['ver', 'cargar'], viveres: ['ver', 'cargar'], compras: ['ver', 'cargar'] } },
];

/** Deja en un objeto de permisos solo módulos y acciones que existen. */
function limpiarPermisos(p) {
  const limpio = {};
  if (!p || typeof p !== 'object') return limpio;
  for (const m of MODULOS) {
    const pedidas = Array.isArray(p[m.clave]) ? p[m.clave] : [];
    const validas = pedidas.filter((a) => Object.prototype.hasOwnProperty.call(m.acciones, a));
    if (validas.length) {
      // "ver" va implícito en cualquier otra acción del módulo
      if (!validas.includes('ver')) validas.unshift('ver');
      limpio[m.clave] = [...new Set(validas)];
    }
  }
  return limpio;
}

module.exports = { MODULOS, CLAVES, PLANES, OPCIONES_DEFECTO, ROLES_MODELO, limpiarPermisos };
