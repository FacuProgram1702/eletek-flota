/**
 * Administración de la empresa y panel de ELETEK (empresas).
 */

/* global App, UI, API */

(function () {
  const { h } = UI;

  App.ruta('/admin', async (el) => {
    const q = App.query();
    const p = q.p || 'usuarios';
    el.appendChild(UI.cabecera('Administración', { sub: App.sesion.empresa.nombre }));
    el.appendChild(h('div', { class: 'filtros' }, UI.pestanas([
      { clave: 'usuarios', texto: 'Usuarios' }, { clave: 'roles', texto: 'Roles y permisos' }, { clave: 'barcos', texto: 'Barcos' },
      { clave: 'opciones', texto: 'Opciones' }, { clave: 'listas', texto: 'Listas' }, { clave: 'auditoria', texto: 'Auditoría' },
    ], p, (x) => { location.hash = `#/admin?p=${x}`; })));
    await ({ usuarios, roles, barcos, opciones, listas, auditoria }[p] || usuarios)(el);
  });

  // ── Usuarios ───────────────────────────────────────────────────────

  async function usuarios(el) {
    const [lista, roles, barcosEmp] = await Promise.all([API.get('/api/admin/usuarios'), API.get('/api/admin/roles'), API.get('/api/admin/barcos')]);
    const nombreRol = new Map(roles.map((r) => [r.id, r.nombre]));
    const nombreBarco = new Map(barcosEmp.map((b) => [b.id, b.nombre]));
    el.appendChild(h('div', { class: 'acciones-fila' }, UI.boton('+ Usuario', () => editarUsuario(null, roles, barcosEmp), 'primario')));
    el.appendChild(UI.tarjeta(null, UI.tabla({
      columnas: [
        { titulo: 'Nombre', valor: (u) => [u.nombre, u.activo ? '' : h('span', { class: 'insignia gris' }, ' inactivo')] },
        { titulo: 'Usuario', campo: 'usuario' },
        { titulo: 'Roles', valor: (u) => (u.es_admin ? 'Administrador' : u.roles.map((r) => nombreRol.get(r)).join(', ')) },
        { titulo: 'Barcos', valor: (u) => (u.es_admin || u.toda_la_flota ? 'Toda la flota' : u.barcos.map((b) => nombreBarco.get(b)).join(', ')) },
      ],
      filas: lista, buscar: ['nombre', 'usuario'], alClick: (u) => editarUsuario(u, roles, barcosEmp),
    })));
  }

  function editarUsuario(u, roles, barcosEmp) {
    const f = UI.form([
      { nombre: 'nombre', etiqueta: 'Nombre y apellido', requerido: true },
      u ? null : { nombre: 'usuario', etiqueta: 'Usuario para entrar', requerido: true, ayuda: 'Minúsculas, sin espacios. Ej.: jperez o albatros.capitan', ancho: 'medio' },
      { nombre: 'clave', etiqueta: u ? 'Nueva contraseña (dejar vacío para no cambiarla)' : 'Contraseña', tipo: 'password', requerido: !u, ancho: 'medio', ayuda: 'Mínimo 8 caracteres' },
      { nombre: 'es_admin', etiqueta: 'Administrador de la empresa (acceso total, maneja usuarios y opciones)', tipo: 'checkbox' },
      u ? { nombre: 'activo', etiqueta: 'Activo', tipo: 'checkbox' } : null,
    ], u ? { ...u, es_admin: !!u.es_admin, activo: !!u.activo } : {});
    const checksRoles = roles.map((r) => {
      const c = h('input', { type: 'checkbox', checked: u ? u.roles.includes(r.id) : false });
      return { r, c, el: h('label', { class: 'campo check' }, c, h('span', null, r.nombre, r.a_bordo ? h('small', null, ' (a bordo)') : null), h('small', null, r.descripcion)) };
    });
    const todaFlota = h('input', { type: 'checkbox', checked: u ? !!u.toda_la_flota : true });
    const checksBarcos = barcosEmp.filter((b) => b.activo).map((b) => {
      const c = h('input', { type: 'checkbox', checked: u ? u.barcos.includes(b.id) : false });
      return { b, c, el: h('label', { class: 'campo check tercio' }, c, h('span', null, b.nombre)) };
    });
    const zonaBarcos = h('div', { class: 'form' }, checksBarcos.map((x) => x.el));
    const sync = () => { zonaBarcos.style.display = todaFlota.checked ? 'none' : ''; };
    todaFlota.addEventListener('change', sync);
    sync();
    UI.modal({
      titulo: u ? `Editar ${u.nombre}` : 'Nuevo usuario', ancho: 'ancho',
      contenido: h('div', null, f.el,
        h('h4', { class: 'form-seccion' }, 'Roles'), h('div', null, checksRoles.map((x) => x.el)),
        h('h4', { class: 'form-seccion' }, 'Barcos que ve'),
        h('label', { class: 'campo check' }, todaFlota, h('span', null, 'Toda la flota')), zonaBarcos),
      acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', tipo: 'primario', alClick: async (c) => {
        const v = {
          ...f.valores(), toda_la_flota: todaFlota.checked,
          roles: checksRoles.filter((x) => x.c.checked).map((x) => x.r.id),
          barcos: checksBarcos.filter((x) => x.c.checked).map((x) => x.b.id),
        };
        if (u) await API.put(`/api/admin/usuarios/${u.id}`, v); else await API.post('/api/admin/usuarios', v);
        c(); UI.aviso('Usuario guardado'); App.recargar();
      } }],
    });
  }

  // ── Roles: matriz de permisos ──────────────────────────────────────

  async function roles(el) {
    const lista = await API.get('/api/admin/roles');
    el.appendChild(h('div', { class: 'ayuda-caja' }, 'Cada rol define qué puede hacer en cada módulo. Los roles "a bordo" (tripulación) solo pueden entrar si el acceso a bordo está habilitado en Opciones.'));
    el.appendChild(h('div', { class: 'acciones-fila' }, UI.boton('+ Rol', () => editarRol(null), 'primario')));
    el.appendChild(UI.tarjeta(null, UI.tabla({
      columnas: [
        { titulo: 'Rol', valor: (r) => [r.nombre, r.a_bordo ? h('span', { class: 'insignia azul' }, ' a bordo') : null] },
        { titulo: 'Descripción', campo: 'descripcion' },
        { titulo: 'Módulos', valor: (r) => Object.keys(r.permisos).map((m) => (App.sesion.catalogo.modulos.find((x) => x.clave === m) || {}).nombre).join(', ') },
        { titulo: 'Usuarios', campo: 'usuarios', num: true },
      ],
      filas: lista, alClick: (r) => editarRol(r),
    })));
  }

  function editarRol(r) {
    const f = UI.form([
      { nombre: 'nombre', etiqueta: 'Nombre', requerido: true, ancho: 'medio' },
      { nombre: 'descripcion', etiqueta: 'Descripción', ancho: 'medio' },
      { nombre: 'a_bordo', etiqueta: 'Rol de tripulación (a bordo)', tipo: 'checkbox' },
    ], r ? { ...r, a_bordo: !!r.a_bordo } : {});
    const checks = [];
    const matriz = h('table', { class: 'tabla matriz' },
      h('thead', null, h('tr', null, h('th', null, 'Módulo'), h('th', null, 'Permisos'))),
      h('tbody', null, App.sesion.catalogo.modulos.map((m) => h('tr', null, h('td', null, m.nombre),
        h('td', null, Object.entries(m.acciones).map(([acc, desc]) => {
          const c = h('input', { type: 'checkbox', checked: r ? (r.permisos[m.clave] || []).includes(acc) : false });
          checks.push({ modulo: m.clave, acc, c });
          return h('label', { class: 'permiso', title: desc }, c, ` ${acc}`, h('small', null, ` — ${desc}`));
        }))))));
    UI.modal({
      titulo: r ? `Rol: ${r.nombre}` : 'Nuevo rol', ancho: 'ancho',
      contenido: h('div', null, f.el, h('h4', { class: 'form-seccion' }, 'Permisos'), matriz),
      acciones: [
        r && !r.usuarios ? { texto: 'Borrar rol', tipo: 'peligro', alClick: async (c) => {
          if (!await UI.confirmar('Borrar rol', `¿Borrar "${r.nombre}"?`, { peligro: true, boton: 'Borrar' })) return;
          await API.del(`/api/admin/roles/${r.id}`); c(); App.recargar();
        } } : null,
        { texto: 'Cancelar' },
        { texto: 'Guardar', tipo: 'primario', alClick: async (c) => {
          const permisos = {};
          for (const x of checks) if (x.c.checked) (permisos[x.modulo] = permisos[x.modulo] || []).push(x.acc);
          const v = { ...f.valores(), permisos };
          if (r) await API.put(`/api/admin/roles/${r.id}`, v); else await API.post('/api/admin/roles', v);
          c(); UI.aviso('Rol guardado'); App.recargar();
        } },
      ].filter(Boolean),
    });
  }

  // ── Barcos ─────────────────────────────────────────────────────────

  async function barcos(el) {
    const lista = await API.get('/api/admin/barcos');
    const editar = (b) => {
      const f = UI.form([
        { nombre: 'nombre', etiqueta: 'Nombre', requerido: true },
        { nombre: 'matricula', etiqueta: 'Matrícula', ancho: 'medio' },
        { nombre: 'slug_conectividad', etiqueta: 'Identificador en el panel de internet', ancho: 'medio', ayuda: 'El "slug" del barco en el panel de conectividad (ej.: albatros). Sirve para tomar la posición GPS en los partes.' },
        b ? { nombre: 'activo', etiqueta: 'Activo', tipo: 'checkbox' } : null,
      ], b ? { ...b, activo: !!b.activo } : {});
      UI.modal({ titulo: b ? `Editar ${b.nombre}` : 'Nuevo barco', contenido: f.el, acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', tipo: 'primario', alClick: async (c) => {
        if (b) await API.put(`/api/admin/barcos/${b.id}`, f.valores()); else await API.post('/api/admin/barcos', f.valores());
        c(); UI.aviso('Barco guardado. Actualizá la página para verlo en los menús.'); App.recargar();
      } }] });
    };
    el.appendChild(h('div', { class: 'acciones-fila' }, UI.boton('+ Barco', () => editar(null), 'primario')));
    el.appendChild(UI.tarjeta(null, UI.tabla({
      columnas: [{ titulo: 'Barco', valor: (b) => [b.nombre, b.activo ? '' : h('span', { class: 'insignia gris' }, ' inactivo')] },
        { titulo: 'Matrícula', campo: 'matricula' }, { titulo: 'Panel de internet', campo: 'slug_conectividad' }],
      filas: lista, alClick: editar,
    })));
  }

  // ── Opciones ───────────────────────────────────────────────────────

  async function opciones(el) {
    const [op, rolesLista] = await Promise.all([API.get('/api/admin/opciones'), API.get('/api/admin/roles')]);
    const f = UI.form([
      { seccion: 'Acceso a bordo' },
      { nombre: 'acceso_abordo', etiqueta: 'Permitir que la tripulación (capitán, jefe de máquinas) entre desde el celular', tipo: 'checkbox',
        ayuda: 'Lo que puede hacer cada uno se define en su rol.' },
      { seccion: 'Compras' },
      { nombre: 'aprobacion_monto', etiqueta: 'Pedir una segunda aprobación para compras grandes', tipo: 'checkbox' },
      { nombre: 'monto_umbral', etiqueta: 'A partir de este monto ($, en pesos)', tipo: 'number', ancho: 'medio' },
      { nombre: 'rol_segunda_aprobacion', etiqueta: 'La da el rol', tipo: 'select', ancho: 'medio', opciones: rolesLista.map((r) => ({ valor: r.id, texto: r.nombre })) },
      { seccion: 'Mantenimiento: cuándo avisar "por vencer"' },
      { nombre: 'margen_dias', etiqueta: 'Días antes', tipo: 'number', ancho: 'medio' },
      { nombre: 'margen_horas', etiqueta: 'Horas antes', tipo: 'number', ancho: 'medio' },
    ], op);
    el.appendChild(UI.tarjeta(null, f.el, h('div', { class: 'acciones-fila' }, UI.boton('Guardar opciones', async () => {
      const v = f.valores();
      await API.put('/api/admin/opciones', { ...v, rol_segunda_aprobacion: v.rol_segunda_aprobacion ? Number(v.rol_segunda_aprobacion) : null });
      UI.aviso('Opciones guardadas');
    }, 'primario'))));
  }

  // ── Listas ─────────────────────────────────────────────────────────

  async function listas(el) {
    const ls = await App.obtenerListas(true);
    const nombres = { categoria: 'Categorías de artículos', unidad: 'Unidades', especie: 'Especies', arte: 'Artes de pesca', puerto: 'Puertos' };
    for (const [clave, titulo] of Object.entries(nombres)) {
      const input = h('input', { type: 'text', placeholder: 'Nuevo valor' });
      el.appendChild(UI.tarjeta(titulo,
        h('div', { class: 'chips' }, (ls[clave] || []).map((v) => h('span', { class: 'chip' }, v.valor,
          h('button', { class: 'btn-icono', type: 'button', 'aria-label': `Quitar ${v.valor}`, onclick: async () => { await API.del(`/api/admin/listas/${v.id}`); App.listas = null; App.recargar(); } }, '×')))),
        h('div', { class: 'item' }, input, UI.boton('Agregar', async () => {
          if (!input.value.trim()) return;
          await API.post('/api/admin/listas', { lista: clave, valor: input.value }); App.listas = null; App.recargar();
        }))));
    }
  }

  async function auditoria(el) {
    const lista = await API.get('/api/admin/auditoria');
    el.appendChild(UI.tarjeta(null, UI.tabla({
      columnas: [{ titulo: 'Fecha', valor: (a) => UI.fechaHora(a.fecha) }, { titulo: 'Usuario', campo: 'usuario' },
        { titulo: 'Acción', campo: 'accion' }, { titulo: 'Sobre', valor: (a) => `${a.entidad}${a.entidad_id ? ` #${a.entidad_id}` : ''}` }, { titulo: 'Detalle', campo: 'detalle' }],
      filas: lista, buscar: ['usuario', 'accion', 'entidad', 'detalle'],
    })));
  }

  // ── ELETEK: empresas ───────────────────────────────────────────────

  App.ruta('/super/empresas', async (el) => {
    if (!App.sesion.usuario.es_superadmin) throw new Error('Solo para ELETEK');
    const lista = await API.get('/api/super/empresas');
    const planes = Object.entries(App.sesion.catalogo.planes).map(([valor, p]) => ({ valor, texto: p.nombre }));
    el.appendChild(UI.cabecera('Empresas', { acciones: [UI.boton('+ Empresa', () => {
      const f = UI.form([
        { nombre: 'nombre', etiqueta: 'Empresa', requerido: true },
        { nombre: 'plan', etiqueta: 'Plan', tipo: 'select', vacio: false, opciones: planes, defecto: 'gestion' },
        { seccion: 'Primer administrador de la empresa' },
        { nombre: 'admin_nombre', etiqueta: 'Nombre', requerido: true, ancho: 'medio' },
        { nombre: 'admin_usuario', etiqueta: 'Usuario', requerido: true, ancho: 'medio' },
        { nombre: 'admin_clave', etiqueta: 'Contraseña', tipo: 'password', requerido: true, ayuda: 'Mínimo 8 caracteres. Que la cambie al entrar.' },
      ]);
      UI.modal({ titulo: 'Nueva empresa', contenido: f.el, ancho: 'ancho', acciones: [{ texto: 'Cancelar' }, { texto: 'Crear', tipo: 'primario', alClick: async (c) => {
        await API.post('/api/super/empresas', f.valores()); c(); App.recargar();
      } }] });
    }, 'primario')] }));
    el.appendChild(UI.tarjeta(null, UI.tabla({
      columnas: [
        { titulo: 'Empresa', valor: (e) => [e.nombre, e.activa ? '' : h('span', { class: 'insignia gris' }, ' inactiva')] },
        { titulo: 'Plan', valor: (e) => App.sesion.catalogo.planes[e.plan].nombre }, { titulo: 'Barcos', campo: 'barcos', num: true },
        { titulo: 'Usuarios', campo: 'usuarios', num: true },
        { titulo: '', valor: (e) => h('div', { class: 'botones-fila' },
          UI.boton('Entrar', async () => { await API.post('/auth/empresa-activa', { empresa_id: e.id }); location.hash = '#/'; location.reload(); }, 'chico'),
          UI.boton('Editar', () => {
            const f = UI.form([{ nombre: 'nombre', etiqueta: 'Empresa', requerido: true }, { nombre: 'plan', etiqueta: 'Plan', tipo: 'select', vacio: false, opciones: planes },
              { nombre: 'activa', etiqueta: 'Activa', tipo: 'checkbox' }], { ...e, activa: !!e.activa });
            UI.modal({ titulo: e.nombre, contenido: f.el, acciones: [{ texto: 'Cancelar' }, { texto: 'Guardar', tipo: 'primario', alClick: async (c) => { await API.put(`/api/super/empresas/${e.id}`, f.valores()); c(); App.recargar(); } }] });
          }, 'chico')) },
      ],
      filas: lista,
    })));
  });
}());
