/**
 * Compras: solicitud → cotización → aprobación → orden de compra → recepción.
 *
 * Estados:
 *   solicitada          alguien pidió material (a mano, desde un trabajo o por stock mínimo)
 *   cotizada            Compras cargó proveedor y precios
 *   pendiente_segunda   aprobada por Compras, falta la aprobación extra por monto
 *   aprobada            orden de compra emitida al proveedor
 *   recibida_parcial    llegó una parte (ya entró al stock)
 *   recibida            llegó todo
 *   cancelada
 *
 * La aprobación extra por monto es opcional: la habilita el administrador de
 * la empresa y define el monto y el rol que aprueba (ver opciones).
 */

const express = require('express');
const db = require('../db/database');
const { ruta, texto, numero, idParam, ErrorUsuario, opcion, ahora, siguienteNumero } = require('../util');
const { requiere, puede, verificarDeposito } = require('../middleware/auth');
const { auditar } = require('../servicios/auditoria');
const stock = require('../servicios/stock');

const router = express.Router();

function compraDe(req, id) {
  const c = db.uno('SELECT * FROM compras WHERE id = ? AND empresa_id = ?', id, req.usuario.empresa_id);
  if (!c) throw new ErrorUsuario('Compra no encontrada', 404);
  if (c.deposito_id) verificarDeposito(req, c.deposito_id);
  return c;
}

function items(compraId) {
  return db.todos(
    `SELECT i.*, a.codigo, a.descripcion, a.unidad FROM compra_items i JOIN articulos a ON a.id = i.articulo_id
     WHERE i.compra_id = ? ORDER BY i.id`, compraId
  );
}

/** Total en la moneda de la compra y en pesos. */
function totales(c, its) {
  const total = its.reduce((s, i) => s + (i.precio_unitario || 0) * i.cantidad, 0);
  return {
    total: Math.round(total * 100) / 100,
    total_ars: Math.round(total * (c.tipo_cambio || 1) * 100) / 100,
    sin_precio: its.filter((i) => i.precio_unitario === null).length,
  };
}

function exigirEstado(c, estados, accion) {
  if (!estados.includes(c.estado)) {
    throw new ErrorUsuario(`No se puede ${accion} una compra en estado "${c.estado.replace('_', ' ')}"`, 409);
  }
}

router.get('/', requiere('compras', 'ver'), ruta((req, res) => {
  let sql = `SELECT c.*, p.nombre AS proveedor, d.nombre AS deposito, u.nombre AS solicitante, t.numero AS trabajo_numero
     FROM compras c LEFT JOIN proveedores p ON p.id = c.proveedor_id LEFT JOIN depositos d ON d.id = c.deposito_id
     LEFT JOIN usuarios u ON u.id = c.solicitado_por LEFT JOIN trabajos t ON t.id = c.trabajo_id
     WHERE c.empresa_id = ?`;
  const params = [req.usuario.empresa_id];
  if (req.query.estado) {
    const est = String(req.query.estado).split(',');
    sql += ` AND c.estado IN (${est.map(() => '?').join(',')})`;
    params.push(...est);
  }
  sql += ' ORDER BY c.numero DESC LIMIT 500';
  const lista = db.todos(sql, ...params).filter((c) => {
    try { if (c.deposito_id) verificarDeposito(req, c.deposito_id); return true; } catch (e) { return false; }
  });
  for (const c of lista) Object.assign(c, totales(c, items(c.id)));
  res.json(lista);
}));

router.get('/:id', requiere('compras', 'ver'), ruta((req, res) => {
  const c = compraDe(req, idParam(req.params.id));
  c.items = items(c.id);
  Object.assign(c, totales(c, c.items));
  c.proveedor = c.proveedor_id ? db.uno('SELECT * FROM proveedores WHERE id = ?', c.proveedor_id) : null;
  c.deposito = c.deposito_id ? db.uno('SELECT id, nombre FROM depositos WHERE id = ?', c.deposito_id) : null;
  c.trabajo = c.trabajo_id ? db.uno('SELECT id, numero, titulo FROM trabajos WHERE id = ?', c.trabajo_id) : null;
  for (const [campo, col] of [['solicitante', 'solicitado_por'], ['aprobador', 'aprobado_por'], ['segundo_aprobador', 'segunda_aprobacion_por']]) {
    c[campo] = c[col] ? db.uno('SELECT nombre FROM usuarios WHERE id = ?', c[col]).nombre : null;
  }
  const op = req.usuario.opciones;
  c.puede_segunda = c.estado === 'pendiente_segunda' && puedeSegunda(req);
  c.rol_segunda = op.rol_segunda_aprobacion ? (db.uno('SELECT nombre FROM roles WHERE id = ?', op.rol_segunda_aprobacion) || {}).nombre : null;
  c.historial = db.todos(
    `SELECT a.fecha, a.accion, a.detalle, u.nombre AS usuario FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
     WHERE a.entidad = 'compra' AND a.entidad_id = ? AND a.empresa_id = ? ORDER BY a.id`, c.id, req.usuario.empresa_id
  );
  res.json(c);
}));

function leerItems(req) {
  const lista = Array.isArray(req.body.items) ? req.body.items : [];
  const out = lista.filter((i) => i && i.articulo_id).map((i) => {
    const a = db.uno('SELECT id FROM articulos WHERE id = ? AND empresa_id = ?', Number(i.articulo_id), req.usuario.empresa_id);
    if (!a) throw new ErrorUsuario('Artículo inválido');
    return {
      articulo_id: a.id,
      cantidad: numero(i.cantidad, { requerido: true, min: 0.0001, campo: 'La cantidad' }),
      precio_unitario: numero(i.precio_unitario, { min: 0, campo: 'El precio' }),
    };
  });
  if (!out.length) throw new ErrorUsuario('Agregá al menos un artículo');
  return out;
}

router.post('/', requiere('compras', 'cargar'), ruta((req, res) => {
  const dep = verificarDeposito(req, idParam(req.body.deposito_id, 'Depósito de destino'));
  const its = leerItems(req);
  const e = req.usuario.empresa_id;
  const id = db.transaccion(() => {
    const c = db.ejecutar(
      `INSERT INTO compras (empresa_id, numero, deposito_id, notas, solicitado_por, creado) VALUES (?, ?, ?, ?, ?, ?)`,
      e, siguienteNumero('compras', e), dep.id, texto(req.body.notas, { max: 2000 }), req.usuario.id, ahora()
    ).id;
    for (const i of its) {
      db.ejecutar('INSERT INTO compra_items (compra_id, articulo_id, cantidad, precio_unitario) VALUES (?, ?, ?, ?)',
        c, i.articulo_id, i.cantidad, i.precio_unitario);
    }
    return c;
  });
  auditar(req, 'crear', 'compra', id);
  res.status(201).json({ id });
}));

/** Cotización: proveedor, moneda y precios. Solo antes de aprobar. */
router.put('/:id', requiere('compras', 'aprobar'), ruta((req, res) => {
  const c = compraDe(req, idParam(req.params.id));
  exigirEstado(c, ['solicitada', 'cotizada'], 'modificar');
  const its = leerItems(req);
  let proveedorId = null;
  if (req.body.proveedor_id) {
    const p = db.uno(`SELECT id FROM proveedores WHERE id = ? AND empresa_id = ?`, Number(req.body.proveedor_id), req.usuario.empresa_id);
    if (!p) throw new ErrorUsuario('Proveedor inválido');
    proveedorId = p.id;
  }
  const moneda = opcion(req.body.moneda, ['ARS', 'USD'], { campo: 'La moneda', defecto: 'ARS' });
  const tc = moneda === 'ARS' ? 1 : numero(req.body.tipo_cambio, { requerido: true, min: 0.0001, campo: 'El tipo de cambio' });
  const dep = req.body.deposito_id ? verificarDeposito(req, Number(req.body.deposito_id)).id : c.deposito_id;
  db.transaccion(() => {
    const cotizada = proveedorId && its.every((i) => i.precio_unitario !== null);
    db.ejecutar(`UPDATE compras SET proveedor_id = ?, moneda = ?, tipo_cambio = ?, deposito_id = ?, notas = ?, estado = ? WHERE id = ?`,
      proveedorId, moneda, tc, dep, texto(req.body.notas, { max: 2000 }), cotizada ? 'cotizada' : 'solicitada', c.id);
    db.ejecutar('DELETE FROM compra_items WHERE compra_id = ?', c.id);
    for (const i of its) {
      db.ejecutar('INSERT INTO compra_items (compra_id, articulo_id, cantidad, precio_unitario) VALUES (?, ?, ?, ?)',
        c.id, i.articulo_id, i.cantidad, i.precio_unitario);
    }
  });
  auditar(req, 'cotizar', 'compra', c.id, `${moneda}${moneda !== 'ARS' ? ' TC ' + tc : ''}`);
  res.json({ ok: true });
}));

function puedeSegunda(req) {
  const op = req.usuario.opciones;
  if (req.usuario.es_admin) return true;
  return !!op.rol_segunda_aprobacion && req.usuario.roles.some((r) => r.id === op.rol_segunda_aprobacion);
}

router.post('/:id/aprobar', requiere('compras', 'aprobar'), ruta((req, res) => {
  const c = compraDe(req, idParam(req.params.id));
  exigirEstado(c, ['cotizada'], 'aprobar');
  const its = items(c.id);
  const t = totales(c, its);
  if (!c.proveedor_id) throw new ErrorUsuario('Falta elegir el proveedor');
  if (t.sin_precio) throw new ErrorUsuario('Hay artículos sin precio');
  const op = req.usuario.opciones;
  const requiere2 = !!op.aprobacion_monto && t.total_ars > (op.monto_umbral || 0);
  db.ejecutar(`UPDATE compras SET estado = ?, aprobado_por = ?, aprobado = ?, requiere_segunda = ? WHERE id = ?`,
    requiere2 ? 'pendiente_segunda' : 'aprobada', req.usuario.id, requiere2 ? null : ahora(), requiere2, c.id);
  auditar(req, 'aprobar', 'compra', c.id, requiere2 ? `Supera el monto (${t.total_ars} ARS): falta segunda aprobación` : `Total ${t.total_ars} ARS`);
  res.json({ ok: true, requiere_segunda: requiere2 });
}));

router.post('/:id/segunda-aprobacion', requiere('compras', 'ver'), ruta((req, res) => {
  const c = compraDe(req, idParam(req.params.id));
  exigirEstado(c, ['pendiente_segunda'], 'dar la segunda aprobación a');
  if (!puedeSegunda(req)) throw new ErrorUsuario('Tu rol no da la segunda aprobación de compras', 403);
  if (c.aprobado_por === req.usuario.id && !req.usuario.es_admin) {
    throw new ErrorUsuario('La segunda aprobación la tiene que dar otra persona', 403);
  }
  db.ejecutar(`UPDATE compras SET estado = 'aprobada', segunda_aprobacion_por = ?, aprobado = ? WHERE id = ?`,
    req.usuario.id, ahora(), c.id);
  auditar(req, 'segunda_aprobacion', 'compra', c.id);
  res.json({ ok: true });
}));

/**
 * Recepción: lo recibido entra al stock del depósito de destino, al precio
 * de la orden convertido a pesos (actualiza el costo promedio).
 * body: { items: [{ item_id, cantidad }] }
 */
router.post('/:id/recibir', requiere('compras', 'recibir'), ruta((req, res) => {
  const c = compraDe(req, idParam(req.params.id));
  exigirEstado(c, ['aprobada', 'recibida_parcial'], 'recibir');
  if (!c.deposito_id) throw new ErrorUsuario('La compra no tiene depósito de destino');
  const pedidos = Array.isArray(req.body.items) ? req.body.items : [];
  const its = items(c.id);
  let recibidos = 0;
  db.transaccion(() => {
    for (const p of pedidos) {
      const it = its.find((i) => i.id === Number(p.item_id));
      if (!it) throw new ErrorUsuario('Ítem inválido');
      const cant = numero(p.cantidad, { min: 0, campo: 'La cantidad recibida' });
      if (!cant) continue;
      const pendiente = it.cantidad - it.recibido;
      if (cant > pendiente + 1e-9) {
        throw new ErrorUsuario(`De "${it.descripcion}" quedan ${pendiente} por recibir y se cargaron ${cant}`);
      }
      stock.mover({
        empresa_id: req.usuario.empresa_id, usuario_id: req.usuario.id, tipo: 'entrada_compra',
        articulo_id: it.articulo_id, destino: c.deposito_id, cantidad: cant,
        costo_unitario: it.precio_unitario === null ? null : it.precio_unitario * (c.tipo_cambio || 1),
        ref_tipo: 'compra', ref_id: c.id, motivo: `Orden de compra #${c.numero}`,
      });
      db.ejecutar('UPDATE compra_items SET recibido = recibido + ? WHERE id = ?', cant, it.id);
      recibidos++;
    }
    if (!recibidos) throw new ErrorUsuario('Indicá cuánto llegó de al menos un artículo');
    const faltan = db.uno('SELECT COUNT(*) AS n FROM compra_items WHERE compra_id = ? AND recibido < cantidad - 0.000001', c.id).n;
    db.ejecutar('UPDATE compras SET estado = ? WHERE id = ?', faltan ? 'recibida_parcial' : 'recibida', c.id);
  });
  auditar(req, 'recibir', 'compra', c.id, `${recibidos} ítem(s)`);
  res.json({ ok: true });
}));

router.post('/:id/cancelar', requiere('compras', 'aprobar'), ruta((req, res) => {
  const c = compraDe(req, idParam(req.params.id));
  exigirEstado(c, ['solicitada', 'cotizada', 'pendiente_segunda', 'aprobada'], 'cancelar');
  const motivo = texto(req.body.motivo, { requerido: true, campo: 'El motivo', max: 1000 });
  db.ejecutar(`UPDATE compras SET estado = 'cancelada', motivo_cancelacion = ? WHERE id = ?`, motivo, c.id);
  auditar(req, 'cancelar', 'compra', c.id, motivo);
  res.json({ ok: true });
}));

/** Solicitud automática con todo lo que está bajo el mínimo en un depósito. */
router.post('/desde-minimos', requiere('compras', 'cargar'), ruta((req, res) => {
  const dep = verificarDeposito(req, idParam(req.body.deposito_id, 'Depósito'));
  const mins = db.todos('SELECT articulo_id, minimo FROM stock_minimos WHERE deposito_id = ?', dep.id);
  const faltan = mins.map((m) => ({ ...m, hay: stock.existencia(m.articulo_id, dep.id) }))
    .filter((m) => m.hay < m.minimo);
  if (!faltan.length) throw new ErrorUsuario('No hay artículos bajo el mínimo en ese depósito');
  const e = req.usuario.empresa_id;
  const id = db.transaccion(() => {
    const c = db.ejecutar(
      `INSERT INTO compras (empresa_id, numero, deposito_id, notas, solicitado_por, creado) VALUES (?, ?, ?, ?, ?, ?)`,
      e, siguienteNumero('compras', e), dep.id, 'Reposición de stock mínimo', req.usuario.id, ahora()
    ).id;
    for (const f of faltan) {
      db.ejecutar('INSERT INTO compra_items (compra_id, articulo_id, cantidad) VALUES (?, ?, ?)', c, f.articulo_id,
        Math.round((f.minimo - f.hay) * 1000) / 1000);
    }
    return c;
  });
  auditar(req, 'crear', 'compra', id, 'Reposición de stock mínimo');
  res.status(201).json({ id, articulos: faltan.length });
}));

module.exports = router;
