/**
 * Lógica de mantenimiento: vencimientos, registros, horómetro y planes.
 *
 * Una tarea vence por lo que ocurra primero entre horas de uso, días o
 * mareas. El "último hecho" se guarda por equipo en `tareas_estado`, así una
 * tarea compartida por un plan modelo lleva la cuenta de cada motor aparte.
 */

const db = require('../db/database');
const { ahora, ErrorUsuario, json } = require('../util');
const stock = require('./stock');

const DIA_MS = 24 * 60 * 60 * 1000;

function mareasCerradas(barcoId) {
  const r = db.uno(`SELECT COUNT(*) AS n FROM mareas WHERE barco_id = ? AND estado = 'cerrada'`, barcoId);
  return r ? r.n : 0;
}

/** Tareas activas de un equipo: las propias + las de su plan modelo. */
function tareasDeEquipo(equipo) {
  return db.todos(
    `SELECT t.*, CASE WHEN t.plan_modelo_id IS NOT NULL THEN 1 ELSE 0 END AS de_modelo
     FROM tareas t WHERE t.activa = 1 AND (t.equipo_id = ? OR (t.plan_modelo_id IS NOT NULL AND t.plan_modelo_id = ?))
     ORDER BY t.nombre`, equipo.id, equipo.plan_modelo_id || -1
  ).map((t) => ({ ...t, materiales: json(t.materiales, []) }));
}

/**
 * Estado de una tarea en un equipo.
 * estado: vencida | proxima | ok | sin_registro
 */
function estadoTarea(equipo, tarea, { margenDias = 15, margenHoras = 50, mareas = null } = {}) {
  const st = db.uno('SELECT * FROM tareas_estado WHERE equipo_id = ? AND tarea_id = ?', equipo.id, tarea.id);
  const r = {
    tarea_id: tarea.id, equipo_id: equipo.id, nombre: tarea.nombre,
    cada_horas: tarea.cada_horas, cada_dias: tarea.cada_dias, cada_mareas: tarea.cada_mareas,
    ultima_fecha: st ? st.ultima_fecha : null, ultimas_horas: st ? st.ultimas_horas : null,
    restan_horas: null, restan_dias: null, restan_mareas: null, vence_fecha: null,
    estado: 'ok',
  };
  if (!st) { r.estado = 'sin_registro'; return r; }

  const alertas = [];
  if (tarea.cada_horas && equipo.usa_horometro && equipo.horas_actuales !== null && st.ultimas_horas !== null) {
    r.restan_horas = Math.round((st.ultimas_horas + tarea.cada_horas - equipo.horas_actuales) * 10) / 10;
    alertas.push(r.restan_horas <= 0 ? 'vencida' : r.restan_horas <= margenHoras ? 'proxima' : 'ok');
  }
  if (tarea.cada_dias && st.ultima_fecha) {
    const vence = new Date(new Date(st.ultima_fecha).getTime() + tarea.cada_dias * DIA_MS);
    r.vence_fecha = vence.toISOString();
    r.restan_dias = Math.ceil((vence.getTime() - Date.now()) / DIA_MS);
    alertas.push(r.restan_dias <= 0 ? 'vencida' : r.restan_dias <= margenDias ? 'proxima' : 'ok');
  }
  if (tarea.cada_mareas && st.ultima_marea !== null) {
    const hechas = mareas === null ? mareasCerradas(equipo.barco_id) : mareas;
    r.restan_mareas = st.ultima_marea + tarea.cada_mareas - hechas;
    alertas.push(r.restan_mareas <= 0 ? 'vencida' : r.restan_mareas <= 1 ? 'proxima' : 'ok');
  }
  r.estado = alertas.includes('vencida') ? 'vencida' : alertas.includes('proxima') ? 'proxima' : 'ok';
  return r;
}

/** Todos los vencimientos de los barcos indicados. */
function vencimientos(empresaId, barcoIds, opciones) {
  if (!barcoIds.length) return [];
  const equipos = db.todos(
    `SELECT e.*, b.nombre AS barco FROM equipos e JOIN barcos b ON b.id = e.barco_id
     WHERE e.empresa_id = ? AND e.activo = 1 AND e.barco_id IN (${barcoIds.map(() => '?').join(',')})`,
    empresaId, ...barcoIds
  );
  const mareasPorBarco = new Map();
  const out = [];
  for (const eq of equipos) {
    if (!mareasPorBarco.has(eq.barco_id)) mareasPorBarco.set(eq.barco_id, mareasCerradas(eq.barco_id));
    for (const t of tareasDeEquipo(eq)) {
      const st = estadoTarea(eq, t, {
        margenDias: opciones.margen_dias, margenHoras: opciones.margen_horas, mareas: mareasPorBarco.get(eq.barco_id),
      });
      out.push({ ...st, equipo: eq.nombre, barco: eq.barco, barco_id: eq.barco_id, de_modelo: t.de_modelo, materiales: t.materiales });
    }
  }
  const orden = { vencida: 0, sin_registro: 1, proxima: 2, ok: 3 };
  out.sort((a, b) => orden[a.estado] - orden[b.estado]
    || (a.restan_horas ?? 1e9) - (b.restan_horas ?? 1e9) || (a.restan_dias ?? 1e9) - (b.restan_dias ?? 1e9));
  return out;
}

/**
 * Lectura del horómetro. Si es menor que la anterior pide confirmación: puede
 * ser un error de tipeo o un horómetro cambiado.
 */
function leerHorometro({ equipo, horas, nota, usuario_id, confirmar = false, fecha = null }) {
  const h = Number(horas);
  if (!Number.isFinite(h) || h < 0) throw new ErrorUsuario('La lectura del horómetro no es válida');
  if (!equipo.usa_horometro) throw new ErrorUsuario('Este equipo no lleva horómetro');
  if (equipo.horas_actuales !== null && h < equipo.horas_actuales && !confirmar) {
    const err = new ErrorUsuario(
      `La lectura (${h} h) es menor que la anterior (${equipo.horas_actuales} h). ` +
      '¿Se cambió el horómetro o es un error de tipeo? Confirmá para guardarla igual.', 409
    );
    err.requiereConfirmacion = true;
    throw err;
  }
  const f = fecha || ahora();
  db.transaccion(() => {
    db.ejecutar('INSERT INTO lecturas_horometro (equipo_id, fecha, horas, nota, usuario_id) VALUES (?, ?, ?, ?, ?)',
      equipo.id, f, h, (nota || '').slice(0, 300), usuario_id);
    db.ejecutar('UPDATE equipos SET horas_actuales = ?, horas_fecha = ? WHERE id = ?', h, f, equipo.id);
  });
}

/**
 * Registra un mantenimiento hecho (preventivo o correctivo).
 * - Descuenta los materiales del depósito del barco.
 * - Si corresponde a una tarea, reinicia su conteo (también cuando un
 *   correctivo adelanta el preventivo, ej. sello de bomba roto antes de tiempo).
 * - Si trae horas mayores a las actuales, actualiza el horómetro.
 */
function registrar({ empresa_id, usuario_id, equipo, tarea_id, tipo, fecha, horas, descripcion, causa, materiales, trabajo_id }) {
  if (!['preventivo', 'correctivo'].includes(tipo)) throw new ErrorUsuario('Tipo de mantenimiento inválido');
  let tarea = null;
  if (tarea_id) {
    tarea = tareasDeEquipo(equipo).find((t) => t.id === Number(tarea_id));
    if (!tarea) throw new ErrorUsuario('La tarea no corresponde a este equipo');
  }
  if (tipo === 'preventivo' && !tarea) throw new ErrorUsuario('Un mantenimiento preventivo corresponde a una tarea del plan');
  if (tipo === 'correctivo' && !String(descripcion || '').trim()) throw new ErrorUsuario('Describí qué se hizo');

  const f = fecha || ahora();
  const h = horas === null || horas === undefined || horas === '' ? equipo.horas_actuales : Number(horas);
  const dep = stock.depositoDeBarco(equipo.barco_id);

  return db.transaccion(() => {
    if (h !== null && equipo.usa_horometro && (equipo.horas_actuales === null || h > equipo.horas_actuales)) {
      leerHorometro({ equipo, horas: h, nota: 'Registrada con un mantenimiento', usuario_id, fecha: f });
    }

    // Un correctivo sobre una tarea que todavía no vencía = cambio anticipado
    let anticipado = false;
    if (tipo === 'correctivo' && tarea) {
      const st = estadoTarea({ ...equipo, horas_actuales: h }, tarea);
      anticipado = st.estado === 'ok' || st.estado === 'proxima';
    }

    const id = db.ejecutar(
      `INSERT INTO registros_mantenimiento (empresa_id, barco_id, equipo_id, tarea_id, tipo, fecha, horas,
         descripcion, causa, anticipado, trabajo_id, usuario_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      empresa_id, equipo.barco_id, equipo.id, tarea ? tarea.id : null, tipo, f, h,
      (descripcion || (tarea ? tarea.nombre : '')).slice(0, 2000), (causa || '').slice(0, 1000), anticipado,
      trabajo_id || null, usuario_id
    ).id;

    const costo = stock.consumir({
      empresa_id, usuario_id, deposito_id: dep.id, items: materiales,
      ref_tipo: 'mantenimiento', ref_id: id,
      motivo: `${tipo === 'preventivo' ? 'Preventivo' : 'Correctivo'}: ${equipo.nombre} — ${tarea ? tarea.nombre : (descripcion || '').slice(0, 80)}`,
    });
    db.ejecutar('UPDATE registros_mantenimiento SET costo_materiales = ? WHERE id = ?', costo, id);

    if (tarea) {
      db.ejecutar(
        `INSERT INTO tareas_estado (equipo_id, tarea_id, ultima_fecha, ultimas_horas, ultima_marea) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(equipo_id, tarea_id) DO UPDATE SET ultima_fecha = excluded.ultima_fecha,
           ultimas_horas = excluded.ultimas_horas, ultima_marea = excluded.ultima_marea`,
        equipo.id, tarea.id, f, h, mareasCerradas(equipo.barco_id)
      );
    }
    return { id, anticipado, costo };
  });
}

/** Copia las tareas propias de un equipo a otros (quedan independientes). */
function copiarTareas(empresaId, origenId, destinoIds) {
  const tareas = db.todos('SELECT * FROM tareas WHERE equipo_id = ? AND activa = 1', origenId);
  let n = 0;
  db.transaccion(() => {
    for (const d of destinoIds) {
      for (const t of tareas) {
        db.ejecutar(
          `INSERT INTO tareas (empresa_id, equipo_id, nombre, descripcion, cada_horas, cada_dias, cada_mareas, materiales)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, empresaId, d, t.nombre, t.descripcion, t.cada_horas, t.cada_dias, t.cada_mareas, t.materiales
        );
        n++;
      }
    }
  });
  return n;
}

/**
 * Copia todos los equipos de un barco a otro, con su árbol, sus tareas
 * propias y sus vínculos a planes modelo. Los contadores arrancan de cero.
 */
function copiarBarco(empresaId, origenBarco, destinoBarco) {
  const equipos = db.todos('SELECT * FROM equipos WHERE barco_id = ? AND activo = 1 ORDER BY id', origenBarco);
  const mapa = new Map();
  db.transaccion(() => {
    // Los padres tienen id menor, así que al recorrer por id el padre ya existe
    for (const e of equipos) {
      const nuevo = db.ejecutar(
        `INSERT INTO equipos (empresa_id, barco_id, padre_id, codigo, nombre, marca, modelo, serie, ubicacion, usa_horometro, plan_modelo_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`,
        empresaId, destinoBarco, e.padre_id ? mapa.get(e.padre_id) || null : null, e.codigo, e.nombre, e.marca, e.modelo,
        e.ubicacion, e.usa_horometro, e.plan_modelo_id
      ).id;
      mapa.set(e.id, nuevo);
      copiarTareas(empresaId, e.id, [nuevo]);
    }
  });
  return mapa.size;
}

/**
 * Crea un plan modelo a partir de las tareas propias de un equipo, y deja a
 * ese equipo "igualado" al modelo. El historial de cada tarea se conserva.
 */
function crearModeloDesdeEquipo(empresaId, equipo, nombre) {
  return db.transaccion(() => {
    const modelo = db.ejecutar('INSERT INTO planes_modelo (empresa_id, nombre) VALUES (?, ?)', empresaId, nombre).id;
    const tareas = db.todos('SELECT * FROM tareas WHERE equipo_id = ? AND activa = 1', equipo.id);
    for (const t of tareas) {
      const nueva = db.ejecutar(
        `INSERT INTO tareas (empresa_id, plan_modelo_id, nombre, descripcion, cada_horas, cada_dias, cada_mareas, materiales)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, empresaId, modelo, t.nombre, t.descripcion, t.cada_horas, t.cada_dias, t.cada_mareas, t.materiales
      ).id;
      moverEstado(equipo.id, t.id, nueva);
      db.ejecutar('UPDATE registros_mantenimiento SET tarea_id = ? WHERE tarea_id = ? AND equipo_id = ?', nueva, t.id, equipo.id);
      db.ejecutar('DELETE FROM tareas WHERE id = ?', t.id);
    }
    db.ejecutar('UPDATE equipos SET plan_modelo_id = ? WHERE id = ?', modelo, equipo.id);
    return modelo;
  });
}

function moverEstado(equipoId, deTarea, aTarea) {
  const st = db.uno('SELECT * FROM tareas_estado WHERE equipo_id = ? AND tarea_id = ?', equipoId, deTarea);
  if (!st) return;
  db.ejecutar(
    `INSERT INTO tareas_estado (equipo_id, tarea_id, ultima_fecha, ultimas_horas, ultima_marea) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(equipo_id, tarea_id) DO NOTHING`, equipoId, aTarea, st.ultima_fecha, st.ultimas_horas, st.ultima_marea
  );
}

/**
 * Iguala un equipo a un plan modelo. Si el equipo ya tenía tareas propias con
 * el mismo nombre que las del modelo (típico después de copiar un barco), se
 * reemplazan por las del modelo conservando cuándo se hicieron por última vez.
 */
function igualar(equipo, modeloId) {
  db.transaccion(() => {
    const delModelo = db.todos('SELECT id, nombre FROM tareas WHERE plan_modelo_id = ? AND activa = 1', modeloId);
    const propias = db.todos('SELECT id, nombre FROM tareas WHERE equipo_id = ? AND activa = 1', equipo.id);
    const norm = (s) => s.trim().toLowerCase();
    for (const p of propias) {
      const m = delModelo.find((x) => norm(x.nombre) === norm(p.nombre));
      if (!m) continue;
      moverEstado(equipo.id, p.id, m.id);
      db.ejecutar('UPDATE registros_mantenimiento SET tarea_id = ? WHERE tarea_id = ? AND equipo_id = ?', m.id, p.id, equipo.id);
      db.ejecutar('UPDATE tareas SET activa = 0 WHERE id = ?', p.id);
    }
    db.ejecutar('UPDATE equipos SET plan_modelo_id = ? WHERE id = ?', modeloId, equipo.id);
  });
}

/**
 * Saca a un equipo de su plan modelo. Con `conservar`, las tareas del modelo
 * pasan a ser propias del equipo (con su historial); si no, se quedan sin plan.
 */
function desvincular(empresaId, equipo, conservar) {
  if (!equipo.plan_modelo_id) throw new ErrorUsuario('El equipo no está igualado a ningún plan');
  db.transaccion(() => {
    if (conservar) {
      const tareas = db.todos('SELECT * FROM tareas WHERE plan_modelo_id = ? AND activa = 1', equipo.plan_modelo_id);
      for (const t of tareas) {
        const nueva = db.ejecutar(
          `INSERT INTO tareas (empresa_id, equipo_id, nombre, descripcion, cada_horas, cada_dias, cada_mareas, materiales)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, empresaId, equipo.id, t.nombre, t.descripcion, t.cada_horas, t.cada_dias, t.cada_mareas, t.materiales
        ).id;
        moverEstado(equipo.id, t.id, nueva);
      }
    }
    db.ejecutar('UPDATE equipos SET plan_modelo_id = NULL WHERE id = ?', equipo.id);
  });
}

module.exports = {
  mareasCerradas, tareasDeEquipo, estadoTarea, vencimientos, leerHorometro, registrar,
  copiarTareas, copiarBarco, crearModeloDesdeEquipo, igualar, desvincular,
};
