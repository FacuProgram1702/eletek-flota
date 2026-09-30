/**
 * Datos de ejemplo para probar el sistema: la empresa Pesquera Atlántico Sur con
 * sus tres barcos, un usuario por rol, artículos, equipos con su plan,
 * proveedores y algo de movimiento.
 *
 * Uso:  npm run semilla
 * Solo corre si la empresa todavía no existe. Para empezar de cero, borrar
 * la carpeta data/ (se pierde todo lo cargado).
 *
 * Todos los usuarios de ejemplo tienen la contraseña de SEMILLA_CLAVE en el
 * .env (o "ejemplo2026" si no está).
 */

const bcrypt = require('bcryptjs');
const config = require('../config');
const db = require('./database');
const { crearEsquema } = require('./esquema');
const { crearEmpresa, crearBarco } = require('../servicios/empresa');
const stock = require('../servicios/stock');
const mant = require('../servicios/mantenimiento');

db.abrir();
crearEsquema();

const NOMBRE = 'Pesquera Atlántico Sur';
if (db.uno('SELECT id FROM empresas WHERE nombre = ?', NOMBRE)) {
  console.log(`La empresa "${NOMBRE}" ya existe. No se cargó nada.`);
  process.exit(0);
}

const clave = process.env.SEMILLA_CLAVE || 'ejemplo2026';
const hash = bcrypt.hashSync(clave, 10);
const ahora = new Date().toISOString();
const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString();

db.transaccion(() => {
  const e = crearEmpresa({ nombre: NOMBRE, plan: 'gestion', opciones: { acceso_abordo: true } });
  const barcos = {
    albatros: crearBarco(e, { nombre: 'Albatros', slug_conectividad: 'albatros' }),
    america: crearBarco(e, { nombre: 'Cormorán', slug_conectividad: 'cormoran' }),
    jp: crearBarco(e, { nombre: 'Petrel', slug_conectividad: 'petrel' }),
  };
  const rol = (n) => db.uno('SELECT id FROM roles WHERE empresa_id = ? AND nombre = ?', e, n).id;

  const usuario = (u, nombre, roles, { admin = false, barcosUsuario = null } = {}) => {
    const id = db.ejecutar(
      `INSERT INTO usuarios (empresa_id, nombre, usuario, clave_hash, es_admin, toda_la_flota, creado) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      e, nombre, u, hash, admin ? 1 : 0, barcosUsuario ? 0 : 1, ahora
    ).id;
    for (const r of roles) db.ejecutar('INSERT INTO usuario_roles (usuario_id, rol_id) VALUES (?, ?)', id, rol(r));
    for (const b of barcosUsuario || []) db.ejecutar('INSERT INTO usuario_barcos (usuario_id, barco_id) VALUES (?, ?)', id, b);
    return id;
  };
  const admin = usuario('demo.admin', 'Administrador (ejemplo)', [], { admin: true });
  usuario('demo.dueno', 'Dueño (ejemplo)', ['Dueño']);
  usuario('demo.tecnica', 'Área técnica (ejemplo)', ['Área técnica']);
  usuario('demo.compras', 'Compras (ejemplo)', ['Compras']);
  usuario('demo.stock', 'Pañol / Stock (ejemplo)', ['Stock']);
  usuario('demo.viveres', 'Víveres (ejemplo)', ['Víveres']);
  const capitan = usuario('albatros.capitan', 'Capitán Albatros (ejemplo)', ['Capitán'], { barcosUsuario: [barcos.albatros] });
  const jefe = usuario('albatros.maquinas', 'Jefe de máquinas Albatros (ejemplo)', ['Jefe de máquinas'], { barcosUsuario: [barcos.albatros] });

  // Proveedores y talleres
  const prov = (nombre, tipo) => db.ejecutar('INSERT INTO proveedores (empresa_id, nombre, tipo) VALUES (?, ?, ?)', e, nombre, tipo).id;
  prov('Repuestos Navales (ejemplo)', 'proveedor');
  prov('Lubricantes del Puerto (ejemplo)', 'proveedor');
  prov('Taller de Motores (ejemplo)', 'taller');
  prov('Almacén Naval (ejemplo)', 'ambos');

  // Artículos y existencias
  const tierra = db.uno(`SELECT id FROM depositos WHERE empresa_id = ? AND tipo = 'tierra'`, e).id;
  const depBarco = (b) => stock.depositoDeBarco(b).id;
  const art = (codigo, descripcion, categoria, unidad, costo) => db.ejecutar(
    'INSERT INTO articulos (empresa_id, codigo, descripcion, categoria, unidad, creado) VALUES (?, ?, ?, ?, ?, ?)',
    e, codigo, descripcion, categoria, unidad, ahora
  ).id;
  const A = {
    aceite: art('LUB-15W40', 'Aceite motor 15W40', 'Lubricantes', 'l', 5200),
    filtroAc: art('FIL-ACE-01', 'Filtro de aceite motor principal', 'Filtros', 'u', 38000),
    filtroCb: art('FIL-COM-01', 'Filtro de combustible motor principal', 'Filtros', 'u', 29000),
    sello: art('BOM-SEL-01', 'Sello mecánico bomba de agua salada', 'Repuestos', 'u', 85000),
    correa: art('REP-COR-01', 'Correa alternador', 'Repuestos', 'u', 21000),
    grasa: art('LUB-GRA-01', 'Grasa marina', 'Lubricantes', 'kg', 9800),
    guantes: art('SEG-GUA-01', 'Guantes de trabajo', 'Seguridad', 'u', 3500),
    fideos: art('VIV-FID-01', 'Fideos secos', 'Víveres', 'kg', 1900),
    carne: art('VIV-CAR-01', 'Carne vacuna', 'Víveres', 'kg', 11000),
    yerba: art('VIV-YER-01', 'Yerba mate', 'Víveres', 'kg', 5600),
    aguaBot: art('VIV-AGU-01', 'Agua mineral 6 l', 'Víveres', 'u', 2300),
  };
  const costos = { aceite: 5200, filtroAc: 38000, filtroCb: 29000, sello: 85000, correa: 21000, grasa: 9800, guantes: 3500, fideos: 1900, carne: 11000, yerba: 5600, aguaBot: 2300 };
  const cargas = { aceite: 400, filtroAc: 12, filtroCb: 12, sello: 3, correa: 6, grasa: 20, guantes: 100, fideos: 150, carne: 200, yerba: 40, aguaBot: 300 };
  for (const [k, cant] of Object.entries(cargas)) {
    stock.mover({ empresa_id: e, usuario_id: admin, tipo: 'carga_inicial', articulo_id: A[k], destino: tierra, cantidad: cant, costo_unitario: costos[k], motivo: 'Datos de ejemplo', fecha: hace(30) });
  }
  // Cada barco tiene algo a bordo
  for (const b of Object.values(barcos)) {
    for (const [k, cant] of [['aceite', 60], ['filtroAc', 2], ['filtroCb', 2], ['grasa', 3], ['guantes', 10]]) {
      stock.mover({ empresa_id: e, usuario_id: admin, tipo: 'transferencia', articulo_id: A[k], origen: tierra, destino: depBarco(b), cantidad: cant, motivo: 'Envío a bordo (ejemplo)', fecha: hace(20) });
    }
  }
  const minimo = (a, d, m) => db.ejecutar('INSERT INTO stock_minimos (articulo_id, deposito_id, minimo) VALUES (?, ?, ?)', a, d, m);
  minimo(A.filtroAc, tierra, 6); minimo(A.filtroCb, tierra, 6); minimo(A.sello, tierra, 4); minimo(A.aceite, tierra, 200);
  for (const b of Object.values(barcos)) { minimo(A.filtroAc, depBarco(b), 2); minimo(A.aceite, depBarco(b), 40); }

  // Equipos del Albatros con su plan
  const equipo = (b, nombre, extra = {}) => db.ejecutar(
    `INSERT INTO equipos (empresa_id, barco_id, padre_id, codigo, nombre, marca, modelo, ubicacion, usa_horometro)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, e, b, extra.padre || null, extra.codigo || '', nombre, extra.marca || '',
    extra.modelo || '', extra.ubicacion || '', extra.horometro ? 1 : 0
  ).id;
  const tarea = (eq, nombre, cada, mats = []) => db.ejecutar(
    `INSERT INTO tareas (empresa_id, equipo_id, nombre, cada_horas, cada_dias, cada_mareas, materiales) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    e, eq, nombre, cada.horas || null, cada.dias || null, cada.mareas || null, JSON.stringify(mats)
  ).id;

  const sala = equipo(barcos.albatros, 'Sala de máquinas', { codigo: '600' });
  const mp = equipo(barcos.albatros, 'Motor principal', { padre: sala, codigo: '601', marca: 'Caterpillar', modelo: '3508', ubicacion: 'Sala de máquinas', horometro: true });
  const aux = equipo(barcos.albatros, 'Motor auxiliar 1', { padre: sala, codigo: '611', marca: 'Cummins', modelo: '6BT', ubicacion: 'Sala de máquinas', horometro: true });
  const bomba = equipo(barcos.albatros, 'Bomba de agua salada', { padre: sala, codigo: '721', ubicacion: 'Sala de máquinas' });
  const seg = equipo(barcos.albatros, 'Seguridad', { codigo: '900' });
  const balsas = equipo(barcos.albatros, 'Balsas salvavidas', { padre: seg, codigo: '901', ubicacion: 'Cubierta superior' });

  const tAceite = tarea(mp, 'Cambio de aceite y filtro', { horas: 500 }, [{ articulo_id: A.aceite, cantidad: 40 }, { articulo_id: A.filtroAc, cantidad: 1 }]);
  const tComb = tarea(mp, 'Cambio de filtro de combustible', { horas: 1000 }, [{ articulo_id: A.filtroCb, cantidad: 1 }]);
  tarea(mp, 'Regulación de válvulas', { horas: 3000 });
  const tAux = tarea(aux, 'Cambio de aceite motor auxiliar', { horas: 250 }, [{ articulo_id: A.aceite, cantidad: 16 }]);
  const tSello = tarea(bomba, 'Cambio de sello mecánico', { dias: 365 }, [{ articulo_id: A.sello, cantidad: 1 }]);
  const tBalsas = tarea(balsas, 'Revisión anual de balsas', { dias: 365 });

  const leer = (eq, h, d) => mant.leerHorometro({ equipo: db.uno('SELECT * FROM equipos WHERE id = ?', eq), horas: h, usuario_id: jefe, fecha: hace(d), confirmar: true });
  leer(mp, 11850, 40); leer(aux, 6020, 40);
  const punto = (eq, t, dias, horas) => db.ejecutar(
    'INSERT INTO tareas_estado (equipo_id, tarea_id, ultima_fecha, ultimas_horas, ultima_marea) VALUES (?, ?, ?, ?, 0)', eq, t, hace(dias), horas
  );
  punto(mp, tAceite, 40, 11850); punto(mp, tComb, 90, 11500); punto(aux, tAux, 40, 6020);
  punto(bomba, tSello, 300, null); punto(balsas, tBalsas, 350, null);
  leer(mp, 12310, 2); leer(aux, 6290, 2); // el auxiliar ya pasó sus 250 h

  // El Cormorán es parecido: se copia el plan del Albatros
  mant.copiarBarco(e, barcos.albatros, barcos.america);

  // Un pedido de trabajo pendiente
  db.ejecutar(
    `INSERT INTO trabajos (empresa_id, numero, barco_id, equipo_id, titulo, descripcion, tipo, prioridad, solicitado_por, creado)
     VALUES (?, 1, ?, ?, 'Pérdida en bomba de agua salada', 'Gotea por el sello, revisar antes de zarpar', 'correctivo', 'alta', ?, ?)`,
    e, barcos.albatros, bomba, capitan, hace(1)
  );
});

console.log(`Datos de ejemplo de "${NOMBRE}" cargados.`);
console.log(`Usuarios (contraseña: ${clave}): demo.admin, demo.dueno, demo.tecnica, demo.compras, demo.stock, demo.viveres, albatros.capitan, albatros.maquinas`);
if (!config.superPass) console.log('Recordá definir SUPER_PASS en el .env para el usuario de ELETEK.');
db.cerrar();
