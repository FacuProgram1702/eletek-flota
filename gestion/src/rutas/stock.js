/**
 * Stock: depósitos, artículos, existencias, movimientos e importación.
 */

const express = require('express');
const db = require('../db/database');
const { ruta, texto, numero, idParam, ErrorUsuario, opcion, fecha } = require('../util');
const { requiere, puede, verificarDeposito, barcosVisibles } = require('../middleware/auth');
const { auditar } = require('../servicios/auditoria');
const stock = require('../servicios/stock');

const router = express.Router();

/** Depósitos que el usuario puede ver: los de tierra y los de sus barcos. */
function depositosVisibles(req) {
  const barcos = barcosVisibles(req);
  return db.todos(
    `SELECT d.*, b.nombre AS barco FROM depositos d LEFT JOIN barcos b ON b.id = d.barco_id
     WHERE d.empresa_id = ? AND d.activo = 1 ORDER BY d.tipo DESC, d.nombre`, req.usuario.empresa_id
  ).filter((d) => d.tipo === 'tierra' || barcos.includes(d.barco_id));
}

/** Existencias agrupadas por artículo y depósito (solo lo distinto de cero). */
function tablaExistencias(empresaId) {
  return db.todos(
    `SELECT articulo_id, deposito_id, SUM(q) AS cantidad FROM (
       SELECT articulo_id, deposito_destino AS deposito_id, cantidad AS q
         FROM movimientos WHERE empresa_id = ? AND deposito_destino IS NOT NULL
       UNION ALL
       SELECT articulo_id, deposito_origen AS deposito_id, -cantidad AS q
         FROM movimientos WHERE empresa_id = ? AND deposito_origen IS NOT NULL
     ) t GROUP BY articulo_id, deposito_id`, empresaId, empresaId
  ).map((r) => ({ ...r, cantidad: stock.redondear(r.cantidad) }));
}

// ── Depósitos ────────────────────────────────────────────────────────

router.get('/depositos', requiere('stock', 'ver'), ruta((req, res) => {
  res.json(depositosVisibles(req));
}));

router.post('/depositos', requiere('stock', 'administrar'), ruta((req, res) => {
  const nombre = texto(req.body.nombre, { requerido: true, campo: 'El nombre', max: 80 });
  // Los depósitos de barco se crean solos con cada barco; acá solo los de tierra
  const id = db.ejecutar(`INSERT INTO depositos (empresa_id, nombre, tipo) VALUES (?, ?, 'tierra')`,
    req.usuario.empresa_id, nombre).id;
  auditar(req, 'crear', 'deposito', id, nombre);
  res.status(201).json({ id });
}));

router.put('/depositos/:id', requiere('stock', 'administrar'), ruta((req, res) => {
  const d = verificarDeposito(req, idParam(req.params.id));
  if (d.tipo !== 'tierra') throw new ErrorUsuario('El depósito de un barco toma el nombre del barco');
  db.ejecutar('UPDATE depositos SET nombre = ? WHERE id = ?',
    texto(req.body.nombre, { requerido: true, campo: 'El nombre', max: 80 }), d.id);
  auditar(req, 'editar', 'deposito', d.id);
  res.json({ ok: true });
}));

// ── Artículos ────────────────────────────────────────────────────────

router.get('/articulos', requiere('stock', 'ver'), ruta((req, res) => {
  const e = req.usuario.empresa_id;
  const visibles = new Set(depositosVisibles(req).map((d) => d.id));
  const exist = tablaExistencias(e).filter((x) => visibles.has(x.deposito_id));
  const porArt = new Map();
  for (const x of exist) porArt.set(x.articulo_id, (porArt.get(x.articulo_id) || 0) + x.cantidad);

  let sql = 'SELECT * FROM articulos WHERE empresa_id = ?';
  const params = [e];
  if (req.query.q) {
    sql += ' AND (lower(codigo) LIKE ? OR lower(descripcion) LIKE ?)';
    const q = `%${String(req.query.q).toLowerCase()}%`;
    params.push(q, q);
  }
  if (req.query.categoria) { sql += ' AND categoria = ?'; params.push(String(req.query.categoria)); }
  if (req.query.inactivos !== '1') sql += ' AND activo = 1';
  sql += ' ORDER BY descripcion';

  res.json(db.todos(sql, ...params).map((a) => ({
    ...a,
    existencia: stock.redondear(porArt.get(a.id) || 0),
  })));
}));

function leerArticulo(req) {
  return {
    codigo: texto(req.body.codigo, { requerido: true, campo: 'El código', max: 40 }),
    descripcion: texto(req.body.descripcion, { requerido: true, campo: 'La descripción', max: 200 }),
    categoria: texto(req.body.categoria, { max: 60 }) || 'General',
    unidad: texto(req.body.unidad, { max: 20 }) || 'u',
    notas: texto(req.body.notas, { max: 1000 }),
  };
}

router.post('/articulos', requiere('stock', 'administrar'), ruta((req, res) => {
  const a = leerArticulo(req);
  const e = req.usuario.empresa_id;
  if (db.uno('SELECT id FROM articulos WHERE empresa_id = ? AND codigo = ?', e, a.codigo)) {
    throw new ErrorUsuario(`Ya existe un artículo con el código ${a.codigo}`, 409);
  }
  const costo = numero(req.body.costo, { min: 0, campo: 'El costo' });
  const id = db.transaccion(() => {
    const nuevo = db.ejecutar(
      `INSERT INTO articulos (empresa_id, codigo, descripcion, categoria, unidad, notas, creado)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, e, a.codigo, a.descripcion, a.categoria, a.unidad, a.notas, new Date().toISOString()
    ).id;
    // Carga manual con existencia inicial en un depósito
    const cant = numero(req.body.cantidad_inicial, { min: 0, campo: 'La cantidad inicial' });
    if (cant && cant > 0) {
      const dep = verificarDeposito(req, idParam(req.body.deposito_id, 'Depósito'));
      stock.mover({
        empresa_id: e, usuario_id: req.usuario.id, tipo: 'carga_inicial', articulo_id: nuevo,
        destino: dep.id, cantidad: cant, costo_unitario: costo, motivo: 'Alta del artículo',
      });
    } else if (costo !== null) {
      db.ejecutar('UPDATE articulos SET costo_promedio = ?, ultimo_costo = ? WHERE id = ?', costo, costo, nuevo);
    }
    return nuevo;
  });
  auditar(req, 'crear', 'articulo', id, a.codigo);
  res.status(201).json({ id });
}));

router.put('/articulos/:id', requiere('stock', 'administrar'), ruta((req, res) => {
  const id = idParam(req.params.id);
  const e = req.usuario.empresa_id;
  const actual = db.uno('SELECT * FROM articulos WHERE id = ? AND empresa_id = ?', id, e);
  if (!actual) throw new ErrorUsuario('Artículo no encontrado', 404);
  const a = leerArticulo(req);
  if (db.uno('SELECT id FROM articulos WHERE empresa_id = ? AND codigo = ? AND id <> ?', e, a.codigo, id)) {
    throw new ErrorUsuario(`Ya existe un artículo con el código ${a.codigo}`, 409);
  }
  db.ejecutar(
    'UPDATE articulos SET codigo = ?, descripcion = ?, categoria = ?, unidad = ?, notas = ?, activo = ? WHERE id = ?',
    a.codigo, a.descripcion, a.categoria, a.unidad, a.notas,
    req.body.activo === undefined ? actual.activo : !!req.body.activo, id
  );
  // El costo se corrige a mano solo si todavía no tenía (ej. carga inicial sin precio)
  const costo = numero(req.body.costo, { min: 0, campo: 'El costo' });
  if (costo !== null && actual.costo_promedio === null) {
    db.ejecutar('UPDATE articulos SET costo_promedio = ?, ultimo_costo = ? WHERE id = ?', costo, costo, id);
  }
  auditar(req, 'editar', 'articulo', id, a.codigo);
  res.json({ ok: true });
}));

router.get('/articulos/:id', requiere('stock', 'ver'), ruta((req, res) => {
  const id = idParam(req.params.id);
  const a = db.uno('SELECT * FROM articulos WHERE id = ? AND empresa_id = ?', id, req.usuario.empresa_id);
  if (!a) throw new ErrorUsuario('Artículo no encontrado', 404);
  const deps = depositosVisibles(req);
  const minimos = new Map(db.todos('SELECT deposito_id, minimo FROM stock_minimos WHERE articulo_id = ?', id)
    .map((m) => [m.deposito_id, m.minimo]));
  a.depositos = deps.map((d) => ({
    id: d.id, nombre: d.nombre, tipo: d.tipo,
    existencia: stock.existencia(id, d.id), minimo: minimos.has(d.id) ? minimos.get(d.id) : null,
  }));
  const ids = deps.map((d) => d.id);
  a.movimientos = ids.length ? db.todos(
    `SELECT m.*, o.nombre AS origen, d.nombre AS destino, u.nombre AS usuario
     FROM movimientos m LEFT JOIN depositos o ON o.id = m.deposito_origen
     LEFT JOIN depositos d ON d.id = m.deposito_destino LEFT JOIN usuarios u ON u.id = m.usuario_id
     WHERE m.articulo_id = ? AND (m.deposito_origen IN (${ids.map(() => '?').join(',')})
                               OR m.deposito_destino IN (${ids.map(() => '?').join(',')}))
     ORDER BY m.fecha DESC, m.id DESC LIMIT 100`, id, ...ids, ...ids
  ) : [];
  res.json(a);
}));

router.put('/articulos/:id/minimos', requiere('stock', 'administrar'), ruta((req, res) => {
  const id = idParam(req.params.id);
  if (!db.uno('SELECT id FROM articulos WHERE id = ? AND empresa_id = ?', id, req.usuario.empresa_id)) {
    throw new ErrorUsuario('Artículo no encontrado', 404);
  }
  const dep = verificarDeposito(req, idParam(req.body.deposito_id, 'Depósito'));
  const minimo = numero(req.body.minimo, { min: 0, campo: 'El mínimo' });
  if (minimo === null || minimo === 0) {
    db.ejecutar('DELETE FROM stock_minimos WHERE articulo_id = ? AND deposito_id = ?', id, dep.id);
  } else {
    db.ejecutar(`INSERT INTO stock_minimos (articulo_id, deposito_id, minimo) VALUES (?, ?, ?)
      ON CONFLICT(articulo_id, deposito_id) DO UPDATE SET minimo = excluded.minimo`, id, dep.id, minimo);
  }
  res.json({ ok: true });
}));

// ── Existencias y alertas ────────────────────────────────────────────

router.get('/existencias', requiere('stock', 'ver'), ruta((req, res) => {
  const e = req.usuario.empresa_id;
  const deps = depositosVisibles(req);
  const depId = req.query.deposito_id ? Number(req.query.deposito_id) : null;
  const usar = depId ? deps.filter((d) => d.id === depId) : deps;
  if (depId && usar.length === 0) throw new ErrorUsuario('Depósito no encontrado', 404);
  const setDeps = new Set(usar.map((d) => d.id));
  const arts = new Map(db.todos('SELECT * FROM articulos WHERE empresa_id = ?', e).map((a) => [a.id, a]));
  const mins = new Map(db.todos(
    `SELECT sm.* FROM stock_minimos sm JOIN articulos a ON a.id = sm.articulo_id WHERE a.empresa_id = ?`, e
  ).map((m) => [`${m.articulo_id}-${m.deposito_id}`, m.minimo]));
  const nombreDep = new Map(deps.map((d) => [d.id, d.nombre]));

  const filas = [];
  const vistos = new Set();
  for (const x of tablaExistencias(e)) {
    if (!setDeps.has(x.deposito_id)) continue;
    const a = arts.get(x.articulo_id);
    if (!a) continue;
    vistos.add(`${x.articulo_id}-${x.deposito_id}`);
    if (Math.abs(x.cantidad) < 1e-9 && !mins.has(`${x.articulo_id}-${x.deposito_id}`)) continue;
    filas.push(fila(a, x.deposito_id, x.cantidad));
  }
  // Artículos con mínimo definido pero sin ningún movimiento en ese depósito
  for (const [k, minimo] of mins) {
    if (vistos.has(k)) continue;
    const [artId, dep] = k.split('-').map(Number);
    if (setDeps.has(dep) && arts.get(artId)) filas.push(fila(arts.get(artId), dep, 0));
  }
  function fila(a, dep, cantidad) {
    const minimo = mins.has(`${a.id}-${dep}`) ? mins.get(`${a.id}-${dep}`) : null;
    return {
      articulo_id: a.id, codigo: a.codigo, descripcion: a.descripcion, categoria: a.categoria, unidad: a.unidad,
      deposito_id: dep, deposito: nombreDep.get(dep), cantidad, minimo,
      bajo_minimo: minimo !== null && cantidad < minimo,
      costo_promedio: a.costo_promedio,
      valor: a.costo_promedio === null ? null : Math.round(cantidad * a.costo_promedio * 100) / 100,
    };
  }
  let out = filas;
  if (req.query.q) {
    const q = String(req.query.q).toLowerCase();
    out = out.filter((f) => f.codigo.toLowerCase().includes(q) || f.descripcion.toLowerCase().includes(q));
  }
  if (req.query.categoria) out = out.filter((f) => f.categoria === req.query.categoria);
  if (req.query.bajo_minimo === '1') out = out.filter((f) => f.bajo_minimo);
  out.sort((a, b) => a.descripcion.localeCompare(b.descripcion) || a.deposito.localeCompare(b.deposito));
  res.json(out);
}));

/** Valor del stock por depósito (a costo promedio). */
router.get('/valorizacion', requiere('stock', 'ver'), ruta((req, res) => {
  const deps = depositosVisibles(req);
  const arts = new Map(db.todos('SELECT id, costo_promedio FROM articulos WHERE empresa_id = ?', req.usuario.empresa_id)
    .map((a) => [a.id, a.costo_promedio]));
  const porDep = new Map(deps.map((d) => [d.id, { deposito_id: d.id, deposito: d.nombre, valor: 0, sin_costo: 0, articulos: 0 }]));
  for (const x of tablaExistencias(req.usuario.empresa_id)) {
    const r = porDep.get(x.deposito_id);
    if (!r || x.cantidad <= 1e-9) continue;
    r.articulos++;
    const c = arts.get(x.articulo_id);
    if (c === null || c === undefined) r.sin_costo++;
    else r.valor += x.cantidad * c;
  }
  res.json([...porDep.values()].map((r) => ({ ...r, valor: Math.round(r.valor * 100) / 100 })));
}));

// ── Movimientos ──────────────────────────────────────────────────────

router.get('/movimientos', requiere('stock', 'ver'), ruta((req, res) => {
  const ids = depositosVisibles(req).map((d) => d.id);
  if (!ids.length) return res.json([]);
  const ph = ids.map(() => '?').join(',');
  let sql = `SELECT m.*, a.codigo, a.descripcion, a.unidad, o.nombre AS origen, d.nombre AS destino, u.nombre AS usuario
     FROM movimientos m JOIN articulos a ON a.id = m.articulo_id
     LEFT JOIN depositos o ON o.id = m.deposito_origen LEFT JOIN depositos d ON d.id = m.deposito_destino
     LEFT JOIN usuarios u ON u.id = m.usuario_id
     WHERE m.empresa_id = ? AND (m.deposito_origen IN (${ph}) OR m.deposito_destino IN (${ph}))`;
  const params = [req.usuario.empresa_id, ...ids, ...ids];
  if (req.query.deposito_id) {
    sql += ' AND (m.deposito_origen = ? OR m.deposito_destino = ?)';
    params.push(Number(req.query.deposito_id), Number(req.query.deposito_id));
  }
  if (req.query.articulo_id) { sql += ' AND m.articulo_id = ?'; params.push(Number(req.query.articulo_id)); }
  if (req.query.tipo) { sql += ' AND m.tipo = ?'; params.push(String(req.query.tipo)); }
  if (req.query.desde) { sql += ' AND m.fecha >= ?'; params.push(fecha(req.query.desde)); }
  if (req.query.hasta) {
    const h = new Date(req.query.hasta); h.setDate(h.getDate() + 1);
    sql += ' AND m.fecha < ?'; params.push(h.toISOString());
  }
  sql += ' ORDER BY m.fecha DESC, m.id DESC LIMIT ?';
  params.push(Math.min(Number(req.query.limite) || 300, 2000));
  res.json(db.todos(sql, ...params));
}));

/**
 * Movimientos manuales. Varios artículos por vez, todos o ninguno.
 * body: { tipo, origen_id?, destino_id?, motivo, items: [{articulo_id, cantidad, costo_unitario?}] }
 * Para "ajuste": items: [{articulo_id, contado}] y deposito_id.
 */
router.post('/movimientos', requiere('stock', 'cargar'), ruta((req, res) => {
  const tipo = opcion(req.body.tipo, ['entrada_manual', 'transferencia', 'consumo', 'ajuste', 'devolucion'], { campo: 'El tipo' });
  const motivo = texto(req.body.motivo, { max: 500 });
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw new ErrorUsuario('Agregá al menos un artículo');
  if ((tipo === 'ajuste' || tipo === 'entrada_manual') && !puede(req, 'stock', 'administrar')) {
    throw new ErrorUsuario('Los ajustes y las entradas manuales los hace quien administra el stock', 403);
  }
  const base = { empresa_id: req.usuario.empresa_id, usuario_id: req.usuario.id, motivo };

  const ids = db.transaccion(() => {
    const creados = [];
    if (tipo === 'ajuste') {
      const dep = verificarDeposito(req, idParam(req.body.deposito_id, 'Depósito'));
      if (!motivo) throw new ErrorUsuario('Indicá el motivo del ajuste');
      for (const it of items) {
        const r = stock.ajustar({ ...base, articulo_id: Number(it.articulo_id), deposito_id: dep.id, contado: numero(it.contado, { requerido: true, min: 0, campo: 'La cantidad contada' }) });
        if (r.id) creados.push(r.id);
      }
      return creados;
    }
    const origen = req.body.origen_id ? verificarDeposito(req, Number(req.body.origen_id)).id : null;
    const destino = req.body.destino_id ? verificarDeposito(req, Number(req.body.destino_id)).id : null;
    if (tipo === 'transferencia' && (!origen || !destino)) throw new ErrorUsuario('Elegí el depósito de origen y el de destino');
    if (tipo === 'consumo' && !origen) throw new ErrorUsuario('Elegí de qué depósito sale');
    if (tipo === 'entrada_manual' && !destino) throw new ErrorUsuario('Elegí a qué depósito entra');
    if (tipo === 'devolucion' && !origen === !destino) throw new ErrorUsuario('Una devolución entra a un depósito o sale de uno');
    if (tipo === 'consumo' && !motivo) throw new ErrorUsuario('Indicá en qué se usó el material');
    for (const it of items) {
      creados.push(stock.mover({
        ...base, tipo, articulo_id: Number(it.articulo_id),
        cantidad: numero(it.cantidad, { requerido: true, min: 0, campo: 'La cantidad' }),
        origen: tipo === 'entrada_manual' ? null : origen,
        destino: tipo === 'consumo' ? null : destino,
        costo_unitario: numero(it.costo_unitario, { min: 0, campo: 'El costo' }),
      }));
    }
    return creados;
  });
  auditar(req, 'movimiento', 'stock', null, `${tipo}: ${ids.length} movimiento(s)`);
  res.status(201).json({ ids });
}));

// ── Importación desde Excel ──────────────────────────────────────────
// El navegador lee la planilla (SheetJS) y manda las filas ya mapeadas a
// columnas. Primero se previsualiza; nada se graba hasta confirmar.

router.post('/importar', requiere('stock', 'administrar'), ruta((req, res) => {
  const e = req.usuario.empresa_id;
  const confirmar = req.body.confirmar === true;
  const actualizar = req.body.actualizar_existentes === true;
  const dep = req.body.deposito_id ? verificarDeposito(req, Number(req.body.deposito_id)) : null;
  const filas = Array.isArray(req.body.filas) ? req.body.filas.slice(0, 20000) : [];
  if (!filas.length) throw new ErrorUsuario('La planilla no tiene filas para importar');

  const vistos = new Set();
  const resultado = filas.map((f, i) => {
    const r = { fila: i + 2, errores: [] };
    r.codigo = String(f.codigo ?? '').trim();
    r.descripcion = String(f.descripcion ?? '').trim();
    r.categoria = String(f.categoria ?? '').trim() || 'General';
    r.unidad = String(f.unidad ?? '').trim() || 'u';
    // Números como vienen de una planilla argentina: "1.250,50" o "1250.5"
    const n = (v) => {
      if (v === undefined || v === null || String(v).trim() === '') return null;
      if (typeof v === 'number') return v;
      let t = String(v).replace(/[\s$]/g, '');
      if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
      const x = Number(t);
      return Number.isFinite(x) ? x : NaN;
    };
    r.cantidad = n(f.cantidad);
    r.costo = n(f.costo);
    r.minimo = n(f.minimo);
    if (!r.codigo) r.errores.push('sin código');
    if (!r.descripcion) r.errores.push('sin descripción');
    if (Number.isNaN(r.cantidad) || (r.cantidad !== null && r.cantidad < 0)) r.errores.push('cantidad inválida');
    if (Number.isNaN(r.costo) || (r.costo !== null && r.costo < 0)) r.errores.push('costo inválido');
    if (Number.isNaN(r.minimo)) r.errores.push('mínimo inválido');
    if (r.cantidad && !dep) r.errores.push('trae cantidad pero no se eligió depósito');
    if (r.codigo && vistos.has(r.codigo.toLowerCase())) r.errores.push('código repetido en la planilla');
    vistos.add(r.codigo.toLowerCase());
    const existente = r.codigo ? db.uno('SELECT id FROM articulos WHERE empresa_id = ? AND codigo = ?', e, r.codigo) : null;
    r.estado = r.errores.length ? 'error' : existente ? 'existente' : 'nuevo';
    r.articulo_id = existente ? existente.id : null;
    return r;
  });

  const resumen = {
    nuevos: resultado.filter((r) => r.estado === 'nuevo').length,
    existentes: resultado.filter((r) => r.estado === 'existente').length,
    errores: resultado.filter((r) => r.estado === 'error').length,
  };

  if (!confirmar) return res.json({ resumen, filas: resultado.slice(0, 1000) });

  const ahora = new Date().toISOString();
  db.transaccion(() => {
    for (const r of resultado) {
      if (r.estado === 'error') continue;
      let id = r.articulo_id;
      if (!id) {
        id = db.ejecutar(
          `INSERT INTO articulos (empresa_id, codigo, descripcion, categoria, unidad, creado) VALUES (?, ?, ?, ?, ?, ?)`,
          e, r.codigo, r.descripcion.slice(0, 200), r.categoria.slice(0, 60), r.unidad.slice(0, 20), ahora
        ).id;
      } else if (actualizar) {
        db.ejecutar('UPDATE articulos SET descripcion = ?, categoria = ?, unidad = ? WHERE id = ?',
          r.descripcion.slice(0, 200), r.categoria.slice(0, 60), r.unidad.slice(0, 20), id);
      }
      if (r.cantidad && r.cantidad > 0 && dep) {
        stock.mover({
          empresa_id: e, usuario_id: req.usuario.id, tipo: 'carga_inicial', articulo_id: id,
          destino: dep.id, cantidad: r.cantidad, costo_unitario: r.costo, ref_tipo: 'importacion',
          motivo: 'Importación desde planilla',
        });
      } else if (r.costo !== null) {
        const a = db.uno('SELECT costo_promedio FROM articulos WHERE id = ?', id);
        if (a.costo_promedio === null) db.ejecutar('UPDATE articulos SET costo_promedio = ?, ultimo_costo = ? WHERE id = ?', r.costo, r.costo, id);
      }
      if (r.minimo && dep) {
        db.ejecutar(`INSERT INTO stock_minimos (articulo_id, deposito_id, minimo) VALUES (?, ?, ?)
          ON CONFLICT(articulo_id, deposito_id) DO UPDATE SET minimo = excluded.minimo`, id, dep.id, r.minimo);
      }
      // Categoría y unidad nuevas se suman a las listas de la empresa
      db.ejecutar(`INSERT INTO listas (empresa_id, lista, valor) VALUES (?, 'categoria', ?) ON CONFLICT DO NOTHING`, e, r.categoria.slice(0, 60));
      db.ejecutar(`INSERT INTO listas (empresa_id, lista, valor) VALUES (?, 'unidad', ?) ON CONFLICT DO NOTHING`, e, r.unidad.slice(0, 20));
    }
  });
  auditar(req, 'importar', 'stock', null, JSON.stringify(resumen));
  res.json({ resumen, importado: true });
}));

module.exports = router;
