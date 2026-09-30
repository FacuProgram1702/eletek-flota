/**
 * Lógica del stock. TODO cambio de existencia pasa por `mover()`.
 *
 * La existencia de un artículo en un depósito no se guarda: se calcula como
 * (lo que entró a ese depósito) − (lo que salió). Así el número siempre
 * cuadra con el historial y cualquier diferencia tiene un responsable.
 *
 * Costos: se valoriza a costo promedio ponderado, en pesos, a nivel empresa.
 * Cada entrada con costo recalcula el promedio; cada salida toma el promedio
 * del momento, y así cada consumo queda con su costo congelado.
 */

const db = require('../db/database');
const { ahora, ErrorUsuario } = require('../util');

// Tolerancia para comparar cantidades con decimales (0,1 + 0,2 ≠ 0,3)
const EPS = 1e-9;

const TIPOS = {
  carga_inicial: { nombre: 'Carga inicial', entra: true, sale: false },
  entrada_manual: { nombre: 'Entrada manual', entra: true, sale: false },
  entrada_compra: { nombre: 'Entrada por compra', entra: true, sale: false },
  transferencia: { nombre: 'Transferencia', entra: true, sale: true },
  consumo: { nombre: 'Consumo', entra: false, sale: true },
  ajuste: { nombre: 'Ajuste de inventario', entra: null, sale: null }, // uno de los dos
  devolucion: { nombre: 'Devolución', entra: null, sale: null },
};

function existencia(articuloId, depositoId) {
  const r = db.uno(
    `SELECT
       COALESCE((SELECT SUM(cantidad) FROM movimientos WHERE articulo_id = ? AND deposito_destino = ?), 0) -
       COALESCE((SELECT SUM(cantidad) FROM movimientos WHERE articulo_id = ? AND deposito_origen = ?), 0) AS c`,
    articuloId, depositoId, articuloId, depositoId
  );
  return redondear(r.c);
}

/** Existencia total de la empresa (todos los depósitos). */
function existenciaTotal(articuloId) {
  const r = db.uno(
    `SELECT
       COALESCE((SELECT SUM(cantidad) FROM movimientos WHERE articulo_id = ? AND deposito_destino IS NOT NULL), 0) -
       COALESCE((SELECT SUM(cantidad) FROM movimientos WHERE articulo_id = ? AND deposito_origen IS NOT NULL), 0) AS c`,
    articuloId, articuloId
  );
  return redondear(r.c);
}

function redondear(n) {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Registra un movimiento. Valida que el artículo y los depósitos sean de la
 * empresa y que no quede stock negativo. Devuelve el id del movimiento.
 *
 * @param {object} m
 *   empresa_id, usuario_id, tipo, articulo_id, origen, destino, cantidad,
 *   costo_unitario (solo entradas), ref_tipo, ref_id, motivo
 */
function mover(m) {
  if (!TIPOS[m.tipo]) throw new ErrorUsuario('Tipo de movimiento inválido');
  const cantidad = Number(m.cantidad);
  if (!Number.isFinite(cantidad) || cantidad <= 0) throw new ErrorUsuario('La cantidad debe ser mayor que cero');

  const art = db.uno('SELECT * FROM articulos WHERE id = ? AND empresa_id = ?', m.articulo_id, m.empresa_id);
  if (!art) throw new ErrorUsuario('Artículo no encontrado', 404);

  for (const d of [m.origen, m.destino]) {
    if (d && !db.uno('SELECT id FROM depositos WHERE id = ? AND empresa_id = ?', d, m.empresa_id)) {
      throw new ErrorUsuario('Depósito no encontrado', 404);
    }
  }
  if (!m.origen && !m.destino) throw new ErrorUsuario('Falta el depósito');
  if (m.origen && m.destino && m.origen === m.destino) throw new ErrorUsuario('El depósito de origen y el de destino son el mismo');

  return db.transaccion(() => {
    let costo = null;

    if (m.origen) {
      const hay = existencia(art.id, m.origen);
      if (hay + EPS < cantidad) {
        const dep = db.uno('SELECT nombre FROM depositos WHERE id = ?', m.origen);
        throw new ErrorUsuario(
          `No hay stock suficiente de "${art.descripcion}" en ${dep.nombre}: hay ${formato(hay)} ${art.unidad} y se piden ${formato(cantidad)}. ` +
          'Si la existencia real es otra, primero hacé un ajuste de inventario.', 409
        );
      }
      // Las salidas (y transferencias) viajan al costo promedio del momento
      costo = art.costo_promedio;
    }

    if (m.destino && !m.origen) {
      // Entrada desde afuera: si trae costo, recalcula el promedio ponderado
      const cu = m.costo_unitario === null || m.costo_unitario === undefined ? null : Number(m.costo_unitario);
      if (cu !== null) {
        if (!Number.isFinite(cu) || cu < 0) throw new ErrorUsuario('El costo no es válido');
        const total = Math.max(existenciaTotal(art.id), 0);
        const nuevo = art.costo_promedio === null || total <= EPS
          ? cu
          : (total * art.costo_promedio + cantidad * cu) / (total + cantidad);
        db.ejecutar('UPDATE articulos SET costo_promedio = ?, ultimo_costo = ? WHERE id = ?',
          Math.round(nuevo * 10000) / 10000, cu, art.id);
        costo = cu;
      } else {
        costo = art.costo_promedio;
      }
    }

    return db.ejecutar(
      `INSERT INTO movimientos (empresa_id, fecha, tipo, articulo_id, deposito_origen, deposito_destino,
         cantidad, costo_unitario, ref_tipo, ref_id, motivo, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      m.empresa_id, m.fecha || ahora(), m.tipo, art.id, m.origen || null, m.destino || null,
      cantidad, costo, m.ref_tipo || null, m.ref_id || null, (m.motivo || '').slice(0, 500), m.usuario_id || null
    ).id;
  });
}

/**
 * Ajuste de inventario: se indica lo que se contó y el sistema genera el
 * movimiento por la diferencia. Devuelve { id, diferencia } (id null si no
 * había diferencia).
 */
function ajustar({ empresa_id, usuario_id, articulo_id, deposito_id, contado, motivo, ref_tipo, ref_id, tipo = 'ajuste' }) {
  const c = Number(contado);
  if (!Number.isFinite(c) || c < 0) throw new ErrorUsuario('La cantidad contada no es válida');
  if (tipo === 'ajuste' && !String(motivo || '').trim()) throw new ErrorUsuario('Indicá el motivo del ajuste');
  const hay = existencia(articulo_id, deposito_id);
  const dif = redondear(c - hay);
  if (Math.abs(dif) <= EPS) return { id: null, diferencia: 0 };
  const id = mover({
    empresa_id, usuario_id, tipo, articulo_id, cantidad: Math.abs(dif),
    origen: dif < 0 ? deposito_id : null,
    destino: dif > 0 ? deposito_id : null,
    motivo, ref_tipo, ref_id,
  });
  return { id, diferencia: dif };
}

/** Consume varios artículos de un depósito en una sola transacción. */
function consumir({ empresa_id, usuario_id, deposito_id, items, ref_tipo, ref_id, motivo }) {
  return db.transaccion(() => {
    let costoTotal = 0;
    for (const it of items || []) {
      if (!it || !it.articulo_id || !(Number(it.cantidad) > 0)) continue;
      const id = mover({
        empresa_id, usuario_id, tipo: 'consumo', articulo_id: Number(it.articulo_id),
        cantidad: Number(it.cantidad), origen: deposito_id, ref_tipo, ref_id, motivo,
      });
      const mov = db.uno('SELECT cantidad, costo_unitario FROM movimientos WHERE id = ?', id);
      costoTotal += (mov.costo_unitario || 0) * mov.cantidad;
    }
    return Math.round(costoTotal * 100) / 100;
  });
}

function formato(n) {
  return Number(n).toLocaleString('es-AR', { maximumFractionDigits: 3 });
}

/** Depósito a bordo de un barco. */
function depositoDeBarco(barcoId) {
  return db.uno(`SELECT * FROM depositos WHERE barco_id = ? AND tipo = 'barco'`, barcoId);
}

module.exports = { TIPOS, existencia, existenciaTotal, mover, ajustar, consumir, depositoDeBarco, redondear };
