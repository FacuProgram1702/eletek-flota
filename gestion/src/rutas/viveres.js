/**
 * Víveres por marea.
 *
 * Los víveres son artículos del stock con categoría "Víveres". Por marea:
 *   1. Al zarpar se cargan al barco (desde el depósito en tierra o compra directa).
 *   2. Al arribar se cuenta lo que sobró. La diferencia es el consumo de la marea.
 *   3. Lo que sobra queda en el barco para la marea siguiente.
 */

const express = require('express');
const db = require('../db/database');
const { ruta, texto, numero, idParam, ErrorUsuario } = require('../util');
const { requiere, verificarBarco, verificarDeposito, filtroBarcos } = require('../middleware/auth');
const { auditar } = require('../servicios/auditoria');
const stock = require('../servicios/stock');

const router = express.Router();
const CATEGORIA = 'Víveres';

function mareaDe(req, id) {
  const m = db.uno('SELECT * FROM mareas WHERE id = ? AND empresa_id = ?', id, req.usuario.empresa_id);
  if (!m) throw new ErrorUsuario('Marea no encontrada', 404);
  verificarBarco(req, m.barco_id);
  return m;
}

function articuloViveres(req, id) {
  const a = db.uno('SELECT * FROM articulos WHERE id = ? AND empresa_id = ? AND categoria = ?', Number(id), req.usuario.empresa_id, CATEGORIA);
  if (!a) throw new ErrorUsuario(`El artículo no es de la categoría ${CATEGORIA}`);
  return a;
}

function diasDe(m) {
  const fin = m.fecha_arribo ? new Date(m.fecha_arribo) : new Date();
  return Math.max(1, Math.ceil((fin - new Date(m.fecha_zarpada)) / 86400000));
}

router.get('/mareas', requiere('viveres', 'ver'), ruta((req, res) => {
  const f = filtroBarcos(req, 'm.barco_id');
  const mareas = db.todos(
    `SELECT m.*, b.nombre AS barco FROM mareas m JOIN barcos b ON b.id = m.barco_id
     WHERE m.empresa_id = ?${f.sql} ORDER BY m.fecha_zarpada DESC LIMIT 200`, req.usuario.empresa_id, ...f.params
  );
  for (const m of mareas) {
    const c = db.uno(
      `SELECT SUM(cantidad * COALESCE(costo_unitario, 0)) AS costo FROM movimientos
       WHERE ref_tipo = 'marea' AND ref_id = ? AND tipo = 'consumo'`, m.id
    );
    m.costo_consumo = Math.round((c.costo || 0) * 100) / 100;
    m.dias = diasDe(m);
    m.costo_dia = Math.round((m.costo_consumo / m.dias) * 100) / 100;
    m.costo_tripulante_dia = m.tripulantes ? Math.round((m.costo_consumo / m.dias / m.tripulantes) * 100) / 100 : null;
  }
  res.json(mareas);
}));

/** Detalle de víveres de una marea: cargado, existencia a bordo y consumo. */
router.get('/mareas/:id', requiere('viveres', 'ver'), ruta((req, res) => {
  const m = mareaDe(req, idParam(req.params.id));
  const dep = stock.depositoDeBarco(m.barco_id);
  m.barco = db.uno('SELECT nombre FROM barcos WHERE id = ?', m.barco_id).nombre;
  m.deposito_id = dep.id;
  const arts = db.todos('SELECT * FROM articulos WHERE empresa_id = ? AND categoria = ? AND activo = 1 ORDER BY descripcion',
    req.usuario.empresa_id, CATEGORIA);
  const movs = db.todos(`SELECT * FROM movimientos WHERE ref_tipo = 'marea' AND ref_id = ?`, m.id);
  m.items = arts.map((a) => {
    const propios = movs.filter((x) => x.articulo_id === a.id);
    const cargado = propios.filter((x) => x.deposito_destino === dep.id).reduce((s, x) => s + x.cantidad, 0);
    const consumido = propios.filter((x) => x.tipo === 'consumo').reduce((s, x) => s + x.cantidad, 0);
    const costo = propios.filter((x) => x.tipo === 'consumo').reduce((s, x) => s + x.cantidad * (x.costo_unitario || 0), 0);
    return {
      articulo_id: a.id, codigo: a.codigo, descripcion: a.descripcion, unidad: a.unidad,
      cargado: stock.redondear(cargado), a_bordo: stock.existencia(a.id, dep.id),
      consumido: stock.redondear(consumido), costo: Math.round(costo * 100) / 100,
    };
  }).filter((i) => i.cargado || i.a_bordo || i.consumido);
  m.dias = diasDe(m);
  m.costo_consumo = Math.round(m.items.reduce((s, i) => s + i.costo, 0) * 100) / 100;
  res.json(m);
}));

/**
 * Carga de víveres al barco para la marea.
 * body: { origen_id?, items: [{articulo_id, cantidad, costo_unitario?}] }
 * Con origen: transferencia desde tierra. Sin origen: compra directa (entrada).
 */
router.post('/mareas/:id/cargar', requiere('viveres', 'cargar'), ruta((req, res) => {
  const m = mareaDe(req, idParam(req.params.id));
  if (m.viveres_cerrados) throw new ErrorUsuario('Los víveres de esta marea ya se cerraron', 409);
  const dep = stock.depositoDeBarco(m.barco_id);
  const origen = req.body.origen_id ? verificarDeposito(req, Number(req.body.origen_id)) : null;
  if (origen && origen.id === dep.id) throw new ErrorUsuario('El origen es el mismo barco');
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw new ErrorUsuario('Agregá al menos un artículo');
  db.transaccion(() => {
    for (const it of items) {
      const a = articuloViveres(req, it.articulo_id);
      stock.mover({
        empresa_id: req.usuario.empresa_id, usuario_id: req.usuario.id,
        tipo: origen ? 'transferencia' : 'entrada_manual', articulo_id: a.id,
        origen: origen ? origen.id : null, destino: dep.id,
        cantidad: numero(it.cantidad, { requerido: true, min: 0.0001, campo: 'La cantidad' }),
        costo_unitario: origen ? null : numero(it.costo_unitario, { min: 0, campo: 'El costo' }),
        ref_tipo: 'marea', ref_id: m.id, motivo: `Víveres marea ${m.numero}`,
      });
    }
  });
  auditar(req, 'cargar_viveres', 'marea', m.id, `${items.length} artículo(s)`);
  res.json({ ok: true });
}));

/**
 * Cierre: lo que se contó al arribar. La diferencia con lo que figura a
 * bordo se registra como consumo de la marea.
 * body: { items: [{articulo_id, contado}] }
 */
router.post('/mareas/:id/cerrar', requiere('viveres', 'cargar'), ruta((req, res) => {
  const m = mareaDe(req, idParam(req.params.id));
  if (m.viveres_cerrados) throw new ErrorUsuario('Los víveres de esta marea ya se cerraron', 409);
  const dep = stock.depositoDeBarco(m.barco_id);
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  let costo = 0;
  db.transaccion(() => {
    for (const it of items) {
      const a = articuloViveres(req, it.articulo_id);
      const contado = numero(it.contado, { requerido: true, min: 0, campo: `Lo contado de ${a.descripcion}` });
      const hay = stock.existencia(a.id, dep.id);
      if (contado > hay + 1e-9) {
        throw new ErrorUsuario(`De "${a.descripcion}" se contó más (${contado}) de lo que figura a bordo (${hay}). Revisá la carga o hacé un ajuste de inventario.`);
      }
      const consumo = stock.redondear(hay - contado);
      if (consumo > 0) {
        const id = stock.mover({
          empresa_id: req.usuario.empresa_id, usuario_id: req.usuario.id, tipo: 'consumo', articulo_id: a.id,
          origen: dep.id, cantidad: consumo, ref_tipo: 'marea', ref_id: m.id, motivo: `Consumo de víveres marea ${m.numero}`,
        });
        const mv = db.uno('SELECT costo_unitario FROM movimientos WHERE id = ?', id);
        costo += consumo * (mv.costo_unitario || 0);
      }
    }
    db.ejecutar('UPDATE mareas SET viveres_cerrados = 1 WHERE id = ?', m.id);
  });
  auditar(req, 'cerrar_viveres', 'marea', m.id, `Consumo ${Math.round(costo)} ARS`);
  res.json({ ok: true, costo: Math.round(costo * 100) / 100 });
}));

module.exports = router;
