/**
 * Esquema de la base. Idempotente: corre en cada arranque.
 *
 * Reglas que se respetan en todas las tablas:
 * - Todo lo que es de un cliente lleva empresa_id. Las consultas SIEMPRE
 *   filtran por la empresa de la sesión (ver middleware/auth.js).
 * - Fechas en texto ISO UTC ('2026-09-22T23:10:00.000Z'), generadas en JS.
 *   Así el SQL no depende de funciones de fecha propias de SQLite y el pase a
 *   PostgreSQL es directo.
 * - El stock NO se guarda como número editable: es la suma de `movimientos`.
 */

const db = require('./database');

function crearEsquema() {
  db.exec(`
    -- ── Empresas, usuarios, roles ─────────────────────────────────────
    CREATE TABLE IF NOT EXISTS empresas (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre      TEXT    NOT NULL,
      plan        TEXT    NOT NULL DEFAULT 'gestion',   -- conectividad | ubicacion | gestion
      opciones    TEXT    NOT NULL DEFAULT '{}',        -- JSON, ver servicios/empresa.js
      activa      INTEGER NOT NULL DEFAULT 1,
      creado      TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id    INTEGER REFERENCES empresas(id) ON DELETE CASCADE,  -- NULL = superadmin ELETEK
      nombre        TEXT    NOT NULL,
      usuario       TEXT    NOT NULL UNIQUE,
      clave_hash    TEXT    NOT NULL,
      es_superadmin INTEGER NOT NULL DEFAULT 0,
      es_admin      INTEGER NOT NULL DEFAULT 0,          -- administrador de SU empresa
      toda_la_flota INTEGER NOT NULL DEFAULT 1,          -- 0 = solo los barcos de usuario_barcos
      activo        INTEGER NOT NULL DEFAULT 1,
      creado        TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id  INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      nombre      TEXT    NOT NULL,
      descripcion TEXT    NOT NULL DEFAULT '',
      permisos    TEXT    NOT NULL DEFAULT '{}',   -- JSON { modulo: ["ver","cargar","aprobar"] }
      a_bordo     INTEGER NOT NULL DEFAULT 0,      -- rol de tripulación (requiere acceso a bordo habilitado)
      UNIQUE (empresa_id, nombre)
    );

    CREATE TABLE IF NOT EXISTS usuario_roles (
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      rol_id     INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (usuario_id, rol_id)
    );

    -- ── Barcos ─────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS barcos (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id         INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      nombre             TEXT    NOT NULL,
      matricula          TEXT    NOT NULL DEFAULT '',
      slug_conectividad  TEXT    NOT NULL DEFAULT '',   -- slug del barco en el panel de internet
      activo             INTEGER NOT NULL DEFAULT 1,
      creado             TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usuario_barcos (
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      barco_id   INTEGER NOT NULL REFERENCES barcos(id) ON DELETE CASCADE,
      PRIMARY KEY (usuario_id, barco_id)
    );

    -- ── Stock ──────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS depositos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id  INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      nombre      TEXT    NOT NULL,
      tipo        TEXT    NOT NULL DEFAULT 'tierra',   -- tierra | barco
      barco_id    INTEGER REFERENCES barcos(id) ON DELETE CASCADE,
      activo      INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS articulos (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id     INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      codigo         TEXT    NOT NULL,
      descripcion    TEXT    NOT NULL,
      categoria      TEXT    NOT NULL DEFAULT 'General',
      unidad         TEXT    NOT NULL DEFAULT 'u',
      costo_promedio REAL,                 -- en pesos; NULL = sin costo cargado todavía
      ultimo_costo   REAL,
      notas          TEXT    NOT NULL DEFAULT '',
      activo         INTEGER NOT NULL DEFAULT 1,
      creado         TEXT    NOT NULL,
      UNIQUE (empresa_id, codigo)
    );

    CREATE TABLE IF NOT EXISTS stock_minimos (
      articulo_id INTEGER NOT NULL REFERENCES articulos(id) ON DELETE CASCADE,
      deposito_id INTEGER NOT NULL REFERENCES depositos(id) ON DELETE CASCADE,
      minimo      REAL    NOT NULL,
      PRIMARY KEY (articulo_id, deposito_id)
    );

    -- Un movimiento mueve una cantidad de un artículo. Entrada: solo destino.
    -- Salida: solo origen. Transferencia: los dos. La existencia de un
    -- depósito = entradas - salidas (ver servicios/stock.js).
    CREATE TABLE IF NOT EXISTS movimientos (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id       INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      fecha            TEXT    NOT NULL,
      tipo             TEXT    NOT NULL,   -- carga_inicial | entrada_manual | entrada_compra | transferencia | consumo | ajuste | devolucion
      articulo_id      INTEGER NOT NULL REFERENCES articulos(id),
      deposito_origen  INTEGER REFERENCES depositos(id),
      deposito_destino INTEGER REFERENCES depositos(id),
      cantidad         REAL    NOT NULL CHECK (cantidad > 0),
      costo_unitario   REAL,
      ref_tipo         TEXT,               -- trabajo | compra | mantenimiento | marea | importacion
      ref_id           INTEGER,
      motivo           TEXT    NOT NULL DEFAULT '',
      usuario_id       INTEGER REFERENCES usuarios(id)
    );

    -- ── Proveedores y talleres ────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS proveedores (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id  INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      nombre      TEXT    NOT NULL,
      tipo        TEXT    NOT NULL DEFAULT 'proveedor',   -- proveedor | taller | ambos
      cuit        TEXT    NOT NULL DEFAULT '',
      contacto    TEXT    NOT NULL DEFAULT '',
      telefono    TEXT    NOT NULL DEFAULT '',
      email       TEXT    NOT NULL DEFAULT '',
      notas       TEXT    NOT NULL DEFAULT '',
      activo      INTEGER NOT NULL DEFAULT 1
    );

    -- ── Mantenimiento ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS planes_modelo (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id  INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      nombre      TEXT    NOT NULL,
      descripcion TEXT    NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS equipos (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id      INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      barco_id        INTEGER NOT NULL REFERENCES barcos(id) ON DELETE CASCADE,
      padre_id        INTEGER REFERENCES equipos(id) ON DELETE CASCADE,
      codigo          TEXT    NOT NULL DEFAULT '',
      nombre          TEXT    NOT NULL,
      marca           TEXT    NOT NULL DEFAULT '',
      modelo          TEXT    NOT NULL DEFAULT '',
      serie           TEXT    NOT NULL DEFAULT '',
      ubicacion       TEXT    NOT NULL DEFAULT '',
      usa_horometro   INTEGER NOT NULL DEFAULT 0,
      horas_actuales  REAL,
      horas_fecha     TEXT,
      plan_modelo_id  INTEGER REFERENCES planes_modelo(id) ON DELETE SET NULL,  -- "igualado" a un modelo
      activo          INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS lecturas_horometro (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      equipo_id   INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
      fecha       TEXT    NOT NULL,
      horas       REAL    NOT NULL,
      nota        TEXT    NOT NULL DEFAULT '',
      usuario_id  INTEGER REFERENCES usuarios(id)
    );

    -- Una tarea es de un equipo (propia) o de un plan modelo (compartida por
    -- todos los equipos igualados a ese modelo). Nunca de los dos.
    CREATE TABLE IF NOT EXISTS tareas (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id      INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      equipo_id       INTEGER REFERENCES equipos(id) ON DELETE CASCADE,
      plan_modelo_id  INTEGER REFERENCES planes_modelo(id) ON DELETE CASCADE,
      nombre          TEXT    NOT NULL,
      descripcion     TEXT    NOT NULL DEFAULT '',
      cada_horas      REAL,
      cada_dias       INTEGER,
      cada_mareas     INTEGER,
      materiales      TEXT    NOT NULL DEFAULT '[]',   -- JSON [{articulo_id, cantidad}]
      activa          INTEGER NOT NULL DEFAULT 1
    );

    -- Cuándo se hizo por última vez cada tarea en cada equipo. Con las tareas
    -- de un modelo, el estado es por equipo aunque la tarea sea compartida.
    CREATE TABLE IF NOT EXISTS tareas_estado (
      equipo_id     INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
      tarea_id      INTEGER NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
      ultima_fecha  TEXT,
      ultimas_horas REAL,
      ultima_marea  INTEGER,     -- cantidad de mareas cerradas del barco en ese momento
      PRIMARY KEY (equipo_id, tarea_id)
    );

    CREATE TABLE IF NOT EXISTS registros_mantenimiento (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id  INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      barco_id    INTEGER NOT NULL REFERENCES barcos(id) ON DELETE CASCADE,
      equipo_id   INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
      tarea_id    INTEGER REFERENCES tareas(id) ON DELETE SET NULL,
      tipo        TEXT    NOT NULL,              -- preventivo | correctivo
      fecha       TEXT    NOT NULL,
      horas       REAL,
      descripcion TEXT    NOT NULL DEFAULT '',
      causa       TEXT    NOT NULL DEFAULT '',
      anticipado  INTEGER NOT NULL DEFAULT 0,    -- correctivo que adelantó una tarea preventiva
      trabajo_id  INTEGER,
      costo_materiales REAL NOT NULL DEFAULT 0,
      usuario_id  INTEGER REFERENCES usuarios(id)
    );

    -- ── Pedidos de trabajo ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS trabajos (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id     INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      numero         INTEGER NOT NULL,
      barco_id       INTEGER NOT NULL REFERENCES barcos(id),
      equipo_id      INTEGER REFERENCES equipos(id) ON DELETE SET NULL,
      tarea_id       INTEGER REFERENCES tareas(id) ON DELETE SET NULL,
      titulo         TEXT    NOT NULL,
      descripcion    TEXT    NOT NULL DEFAULT '',
      tipo           TEXT    NOT NULL DEFAULT 'correctivo',   -- correctivo | preventivo | mejora
      prioridad      TEXT    NOT NULL DEFAULT 'normal',       -- baja | normal | alta | urgente
      estado         TEXT    NOT NULL DEFAULT 'pendiente',    -- pendiente | aprobado | en_curso | realizado | cerrado | rechazado
      ejecutor       TEXT    NOT NULL DEFAULT 'propio',       -- propio | taller
      proveedor_id   INTEGER REFERENCES proveedores(id),
      presupuesto    REAL,
      fecha_comprometida TEXT,
      informe        TEXT    NOT NULL DEFAULT '',
      motivo_rechazo TEXT    NOT NULL DEFAULT '',
      solicitado_por INTEGER REFERENCES usuarios(id),
      aprobado_por   INTEGER REFERENCES usuarios(id),
      realizado_por  INTEGER REFERENCES usuarios(id),
      creado         TEXT    NOT NULL,
      aprobado       TEXT,
      realizado      TEXT,
      cerrado        TEXT,
      UNIQUE (empresa_id, numero)
    );

    -- ── Compras ───────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS compras (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id      INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      numero          INTEGER NOT NULL,
      estado          TEXT    NOT NULL DEFAULT 'solicitada', -- solicitada | cotizada | aprobada | recibida_parcial | recibida | cancelada
      proveedor_id    INTEGER REFERENCES proveedores(id),
      deposito_id     INTEGER REFERENCES depositos(id),       -- dónde entra lo recibido
      trabajo_id      INTEGER REFERENCES trabajos(id) ON DELETE SET NULL,
      moneda          TEXT    NOT NULL DEFAULT 'ARS',
      tipo_cambio     REAL    NOT NULL DEFAULT 1,             -- pesos por unidad de la moneda
      notas           TEXT    NOT NULL DEFAULT '',
      motivo_cancelacion TEXT NOT NULL DEFAULT '',
      requiere_segunda   INTEGER NOT NULL DEFAULT 0,
      solicitado_por  INTEGER REFERENCES usuarios(id),
      aprobado_por    INTEGER REFERENCES usuarios(id),
      segunda_aprobacion_por INTEGER REFERENCES usuarios(id),
      creado          TEXT    NOT NULL,
      aprobado        TEXT,
      UNIQUE (empresa_id, numero)
    );

    CREATE TABLE IF NOT EXISTS compra_items (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      compra_id       INTEGER NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
      articulo_id     INTEGER NOT NULL REFERENCES articulos(id),
      cantidad        REAL    NOT NULL CHECK (cantidad > 0),
      precio_unitario REAL,
      recibido        REAL    NOT NULL DEFAULT 0
    );

    -- ── Partes de pesca ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS mareas (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id       INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      barco_id         INTEGER NOT NULL REFERENCES barcos(id),
      numero           INTEGER NOT NULL,
      estado           TEXT    NOT NULL DEFAULT 'abierta',   -- abierta | cerrada
      puerto_zarpada   TEXT    NOT NULL DEFAULT '',
      fecha_zarpada    TEXT    NOT NULL,
      puerto_arribo    TEXT    NOT NULL DEFAULT '',
      fecha_arribo     TEXT,
      especie_objetivo TEXT    NOT NULL DEFAULT '',
      tripulantes      INTEGER,
      observaciones    TEXT    NOT NULL DEFAULT '',
      capitan_id       INTEGER REFERENCES usuarios(id),
      viveres_cerrados INTEGER NOT NULL DEFAULT 0,   -- ya se contó lo que sobró al arribar
      UNIQUE (barco_id, numero)
    );

    CREATE TABLE IF NOT EXISTS lances (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      marea_id      INTEGER NOT NULL REFERENCES mareas(id) ON DELETE CASCADE,
      numero        INTEGER NOT NULL,
      inicio        TEXT    NOT NULL,
      fin           TEXT,
      lat_inicio    REAL,
      lon_inicio    REAL,
      lat_fin       REAL,
      lon_fin       REAL,
      origen_pos_inicio TEXT NOT NULL DEFAULT 'manual',   -- gps_barco | telefono | manual
      origen_pos_fin    TEXT NOT NULL DEFAULT 'manual',
      profundidad   REAL,
      arte          TEXT    NOT NULL DEFAULT '',
      observaciones TEXT    NOT NULL DEFAULT '',
      UNIQUE (marea_id, numero)
    );

    CREATE TABLE IF NOT EXISTS capturas (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      lance_id  INTEGER NOT NULL REFERENCES lances(id) ON DELETE CASCADE,
      especie   TEXT    NOT NULL,
      cantidad  REAL    NOT NULL,
      unidad    TEXT    NOT NULL DEFAULT 'kg',   -- kg | cajones
      descarte  REAL    NOT NULL DEFAULT 0
    );

    -- Listas que cada empresa maneja (especies, artes, puertos, categorías)
    CREATE TABLE IF NOT EXISTS listas (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id  INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      lista       TEXT    NOT NULL,
      valor       TEXT    NOT NULL,
      UNIQUE (empresa_id, lista, valor)
    );

    -- ── Auditoría: quién cambió qué y cuándo ──────────────────────────
    CREATE TABLE IF NOT EXISTS auditoria (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id  INTEGER,
      usuario_id  INTEGER,
      fecha       TEXT    NOT NULL,
      accion      TEXT    NOT NULL,
      entidad     TEXT    NOT NULL,
      entidad_id  INTEGER,
      detalle     TEXT    NOT NULL DEFAULT ''
    );

    -- ── Seguimiento: umbrales por barco y puertos de la empresa ────────
    -- La actividad no se guarda: se calcula desde el GPS cada vez. Acá solo
    -- van los ajustes. barco_id = 0 es el ajuste general de la empresa.
    CREATE TABLE IF NOT EXISTS seguimiento_parametros (
      empresa_id  INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      barco_id    INTEGER NOT NULL DEFAULT 0,
      parametros  TEXT    NOT NULL DEFAULT '{}',
      PRIMARY KEY (empresa_id, barco_id)
    );

    CREATE TABLE IF NOT EXISTS seguimiento_puertos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id  INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      nombre      TEXT    NOT NULL,
      lat         REAL    NOT NULL,
      lon         REAL    NOT NULL,
      radio_km    REAL    NOT NULL DEFAULT 2.5
    );

    -- Cambios de datos que se aplican una sola vez (no de estructura)
    CREATE TABLE IF NOT EXISTS migraciones (
      clave  TEXT PRIMARY KEY,
      fecha  TEXT NOT NULL
    );

    -- ── Sesiones del panel (sobreviven a los reinicios) ───────────────
    CREATE TABLE IF NOT EXISTS sesiones (
      sid     TEXT PRIMARY KEY,
      datos   TEXT NOT NULL,
      vence   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ix_mov_articulo   ON movimientos(articulo_id);
    CREATE INDEX IF NOT EXISTS ix_mov_origen     ON movimientos(deposito_origen);
    CREATE INDEX IF NOT EXISTS ix_mov_destino    ON movimientos(deposito_destino);
    CREATE INDEX IF NOT EXISTS ix_mov_ref        ON movimientos(ref_tipo, ref_id);
    CREATE INDEX IF NOT EXISTS ix_mov_empresa    ON movimientos(empresa_id, fecha);
    CREATE INDEX IF NOT EXISTS ix_equipos_barco  ON equipos(barco_id);
    CREATE INDEX IF NOT EXISTS ix_tareas_equipo  ON tareas(equipo_id);
    CREATE INDEX IF NOT EXISTS ix_tareas_modelo  ON tareas(plan_modelo_id);
    CREATE INDEX IF NOT EXISTS ix_reg_equipo     ON registros_mantenimiento(equipo_id, fecha);
    CREATE INDEX IF NOT EXISTS ix_trabajos_emp   ON trabajos(empresa_id, estado);
    CREATE INDEX IF NOT EXISTS ix_compras_emp    ON compras(empresa_id, estado);
    CREATE INDEX IF NOT EXISTS ix_lances_marea   ON lances(marea_id);
    CREATE INDEX IF NOT EXISTS ix_auditoria_emp  ON auditoria(empresa_id, fecha);
    CREATE INDEX IF NOT EXISTS ix_sesiones_vence ON sesiones(vence);
  `);
  migrarDatos();
}

/**
 * Migraciones de datos, una sola vez cada una. Van aparte del esquema porque
 * tocan lo que cargó la empresa: si después cambia algo a mano, no se le
 * vuelve a pisar en el próximo arranque.
 */
function migrarDatos() {
  const hecha = (clave) => !!db.uno('SELECT clave FROM migraciones WHERE clave = ?', clave);
  const marcar = (clave) => db.ejecutar('INSERT INTO migraciones (clave, fecha) VALUES (?, ?)', clave, new Date().toISOString());

  // Módulo de seguimiento nuevo: los roles que ya existían con el nombre de
  // un rol modelo reciben lo que ese rol modelo trae para seguimiento.
  if (!hecha('roles_seguimiento')) {
    const { ROLES_MODELO } = require('../permisos');
    db.transaccion(() => {
      for (const modelo of ROLES_MODELO) {
        const acciones = modelo.permisos.seguimiento;
        if (!acciones) continue;
        for (const r of db.todos('SELECT id, permisos FROM roles WHERE nombre = ?', modelo.nombre)) {
          let p = {};
          try { p = JSON.parse(r.permisos || '{}'); } catch (e) { p = {}; }
          if (p.seguimiento) continue;
          p.seguimiento = acciones;
          db.ejecutar('UPDATE roles SET permisos = ? WHERE id = ?', JSON.stringify(p), r.id);
        }
      }
      marcar('roles_seguimiento');
    });
  }
}

module.exports = { crearEsquema };
