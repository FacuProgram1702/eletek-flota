/**
 * Inicio (tablero) y Mis tareas (vista pensada para el celular a bordo).
 */

/* global App, UI, API, Vistas */

App.ruta('/', async (el) => {
  const { h } = UI;
  const t = await API.get('/api/tablero');
  el.appendChild(UI.cabecera(`Hola, ${App.sesion.usuario.nombre.split(' ')[0]}`, { sub: App.sesion.empresa.nombre }));

  const cifras = h('div', { class: 'cifras' });
  if (t.mantenimiento) {
    cifras.appendChild(UI.cifra(t.mantenimiento.vencidas, 'mantenimientos vencidos', { tono: t.mantenimiento.vencidas ? 'rojo' : '', href: '#/mantenimiento' }));
    cifras.appendChild(UI.cifra(t.mantenimiento.proximas, 'por vencer', { tono: t.mantenimiento.proximas ? 'naranja' : '', href: '#/mantenimiento' }));
  }
  if (t.trabajos) {
    cifras.appendChild(UI.cifra(t.trabajos.pendiente || 0, 'pedidos por aprobar', { tono: t.trabajos.pendiente ? 'amarillo' : '', href: '#/trabajos' }));
    cifras.appendChild(UI.cifra((t.trabajos.aprobado || 0) + (t.trabajos.en_curso || 0), 'trabajos en marcha', { href: '#/trabajos' }));
  }
  if (t.compras) {
    const abiertas = (t.compras.solicitada || 0) + (t.compras.cotizada || 0) + (t.compras.pendiente_segunda || 0);
    cifras.appendChild(UI.cifra(abiertas, 'compras por gestionar', { href: '#/compras' }));
    cifras.appendChild(UI.cifra((t.compras.aprobada || 0) + (t.compras.recibida_parcial || 0), 'compras por recibir', { href: '#/compras' }));
  }
  if (t.stock) cifras.appendChild(UI.cifra(t.stock.bajo_minimo, 'artículos bajo mínimo', { tono: t.stock.bajo_minimo ? 'naranja' : '', href: '#/stock?bajo=1' }));
  el.appendChild(cifras);

  if (t.mantenimiento && t.mantenimiento.lista.length) {
    el.appendChild(UI.tarjeta('Mantenimiento: vencido y por vencer', Vistas.tablaVencimientos(t.mantenimiento.lista)));
  }
  if (t.pesca && t.pesca.abiertas.length) {
    el.appendChild(UI.tarjeta('Mareas en curso', UI.tabla({
      columnas: [
        { titulo: 'Barco', campo: 'barco' }, { titulo: 'Marea', campo: 'numero' },
        { titulo: 'Zarpó', valor: (m) => UI.fechaHora(m.fecha_zarpada) }, { titulo: 'Lances', campo: 'lances', num: true },
      ],
      filas: t.pesca.abiertas, alClick: (m) => { location.hash = `#/pesca/marea/${m.id}`; },
    })));
  }
});

/** Tabla de vencimientos, usada en inicio, mantenimiento y mis tareas. */
window.Vistas = window.Vistas || {};
Vistas.restante = (v) => {
  const partes = [];
  if (v.restan_horas !== null && v.restan_horas !== undefined) partes.push(v.restan_horas <= 0 ? `pasado ${UI.num(-v.restan_horas, 0)} h` : `faltan ${UI.num(v.restan_horas, 0)} h`);
  if (v.restan_dias !== null && v.restan_dias !== undefined) partes.push(v.restan_dias <= 0 ? `vencido hace ${-v.restan_dias} d` : `faltan ${v.restan_dias} d`);
  if (v.restan_mareas !== null && v.restan_mareas !== undefined) partes.push(v.restan_mareas <= 0 ? 'vencido en mareas' : `faltan ${v.restan_mareas} mareas`);
  return partes.join(' · ') || (v.estado === 'sin_registro' ? 'Cargar cuándo se hizo por última vez' : '—');
};
Vistas.frecuencia = (t) => [
  t.cada_horas ? `${UI.num(t.cada_horas, 0)} h` : null, t.cada_dias ? `${t.cada_dias} días` : null,
  t.cada_mareas ? `${t.cada_mareas} mareas` : null].filter(Boolean).join(' / ');
Vistas.tablaVencimientos = (lista, { conBarco = true } = {}) => UI.tabla({
  columnas: [
    { titulo: 'Estado', valor: (v) => UI.estado(v.estado) },
    conBarco ? { titulo: 'Barco', campo: 'barco' } : null,
    { titulo: 'Equipo', campo: 'equipo' },
    { titulo: 'Tarea', campo: 'nombre' },
    { titulo: 'Cada', valor: Vistas.frecuencia },
    { titulo: 'Situación', valor: Vistas.restante },
  ].filter(Boolean),
  filas: lista,
  alClick: (v) => { location.hash = `#/mantenimiento/equipo/${v.equipo_id}`; },
  vacio: 'Nada pendiente',
});

App.ruta('/mis-tareas', async (el) => {
  const { h } = UI;
  const t = await API.get('/api/tablero/mis-tareas');
  const barcos = App.barcos.map((b) => b.nombre).join(', ');
  el.classList.add('a-bordo');
  el.appendChild(UI.cabecera('Mis tareas', { sub: barcos }));

  const accesos = h('div', { class: 'accesos' },
    App.puede('trabajos', 'cargar') ? h('a', { class: 'acceso', href: '#/trabajos/nuevo' }, h('span', null, '⚠'), 'Informar falla o pedir trabajo') : null,
    App.puede('mantenimiento', 'cargar') ? h('a', { class: 'acceso', href: '#/mantenimiento/registrar' }, h('span', null, '✓'), 'Registrar mantenimiento hecho') : null,
    App.puede('mantenimiento', 'cargar') ? h('a', { class: 'acceso', href: '#/mantenimiento/horometros' }, h('span', null, '⏱'), 'Cargar horómetros') : null,
    App.puede('pesca', 'cargar') ? h('a', { class: 'acceso', href: t.marea ? `#/pesca/marea/${t.marea.id}` : '#/pesca/nueva' }, h('span', null, '🐟'),
      t.marea ? `Parte de pesca — marea ${t.marea.numero}` : 'Abrir marea') : null);
  el.appendChild(accesos);

  if (t.horometros.length) {
    el.appendChild(UI.tarjeta('Horómetros para cargar',
      h('p', { class: 'sub' }, 'Sin lectura en la última semana.'),
      h('ul', { class: 'lista-simple' }, t.horometros.map((e) => h('li', null,
        h('a', { href: `#/mantenimiento/equipo/${e.id}` }, `${e.nombre} (${e.barco})`),
        h('small', null, e.horas_actuales !== null ? ` · última: ${UI.num(e.horas_actuales, 0)} h el ${UI.fecha(e.horas_fecha)}` : ' · sin lecturas'))))));
  }
  if (App.puede('mantenimiento')) {
    el.appendChild(UI.tarjeta('Mantenimiento pendiente', Vistas.tablaVencimientos(t.mantenimiento)));
  }
  if (App.puede('trabajos')) {
    el.appendChild(UI.tarjeta('Pedidos de trabajo abiertos', UI.tabla({
      columnas: [
        { titulo: 'N°', campo: 'numero' }, { titulo: 'Estado', valor: (x) => UI.estado(x.estado) },
        { titulo: 'Prioridad', valor: (x) => UI.estado(x.prioridad) }, { titulo: 'Barco', campo: 'barco' }, { titulo: 'Trabajo', campo: 'titulo' },
      ],
      filas: t.trabajos, alClick: (x) => { location.hash = `#/trabajos/${x.id}`; }, vacio: 'No hay pedidos abiertos',
    })));
  }
});
