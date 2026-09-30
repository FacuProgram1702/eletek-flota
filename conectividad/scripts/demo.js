/**
 * Carga datos de DEMOSTRACIÓN en el panel de conectividad.
 *
 *   npm run demo
 *
 * Todo es inventado: barcos, tripulantes, consumos y recorridos. Los
 * recorridos se generan simulando una marea de arrastre (salida de puerto,
 * navegación, lances a ~4 nudos con viradas entre medio, a la capa), así el
 * módulo de Seguimiento de ELETEK Gestión tiene algo real para clasificar.
 *
 * Borra y vuelve a crear data/eletek.db.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../src/config');

async function main() {
  for (const suf of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(config.dbPath + suf); } catch (e) { /* no existía */ }
  }
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

  const db = require('../src/db/database');
  await db.initDatabase();
  require('../src/db/migrations').runMigrations();

  const ahora = Date.now();
  const sqlFecha = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  const MIN = 60000, HORA = 3600000, DIA = 86400000;

  // Números al azar pero repetibles: la demo sale igual cada vez
  let semilla = 42;
  const azar = () => { semilla = (semilla * 16807) % 2147483647; return (semilla - 1) / 2147483646; };
  const ruido = (amp) => (azar() * 2 - 1) * amp;

  const BARCOS = [
    { nombre: 'Albatros', slug: 'albatros', online: true, gps: true },
    { nombre: 'Cormorán', slug: 'cormoran', online: true, gps: false },
    { nombre: 'Petrel', slug: 'petrel', online: true, gps: true },
    { nombre: 'Gaviota', slug: 'gaviota', online: true, gps: false },
    { nombre: 'Pingüino', slug: 'pinguino', online: false, gps: false },
  ];

  const ins = db.prepare('INSERT INTO vessels (name, slug, api_token, last_seen, sync_data) VALUES (?, ?, ?, ?, ?)');
  const insDia = db.prepare('INSERT INTO usage_daily (vessel_id, username, day, bytes) VALUES (?, ?, ?, ?)');
  const insPos = db.prepare(`INSERT INTO vessel_positions (vessel_id, lat, lon, source, reported_at, speed_kn, course_deg, heading_deg)
                             VALUES (?, ?, ?, 'gps', ?, ?, ?, ?)`);
  const GB = 1024 ** 3;

  db.batch(() => {
    BARCOS.forEach((b, n) => {
      // Tripulación: usuarios del hotspot con su cupo y consumo
      const usuarios = [];
      const cant = 8 + Math.floor(azar() * 6);
      for (let i = 1; i <= cant; i++) {
        const limite = (i <= 2 ? 10 : 3) * GB;
        usuarios.push({
          name: `tripulante${String(i).padStart(2, '0')}`,
          bytes: Math.floor(limite * (0.1 + azar() * 0.85)),
          limit: limite,
          active: b.online && azar() > 0.55,
          profile: i <= 2 ? 'oficiales' : 'default',
          password: null,
        });
      }
      const router = {
        uptime: `${2 + n}d${Math.floor(azar() * 23)}h`, uptime_s: (2 + n) * 86400,
        cpu_load: Math.round(3 + azar() * 20), free_memory: 180e6, total_memory: 256e6,
        version: '7.16.2', model: 'hEX S', voltage: 24.1, temperature: 41,
      };
      const visto = b.online ? ahora - Math.floor(azar() * 50) * 1000 : ahora - 3 * DIA;
      const id = ins.run(b.nombre, b.slug, crypto.randomUUID(), sqlFecha(visto), JSON.stringify({ users: usuarios, router })).lastInsertRowid;

      // Consumo diario de los últimos 14 días
      for (let d = 13; d >= 0; d--) {
        if (!b.online && d < 3) continue;
        const dia = new Date(ahora - d * DIA).toISOString().slice(0, 10);
        for (const u of usuarios) insDia.run(id, u.name, dia, Math.floor((0.05 + azar() * 0.6) * GB));
      }

      if (b.gps) marea(id, n);
    });
  });

  /**
   * Simula una marea de arrastre de los últimos 3 días, un punto por minuto.
   * Cada tramo: [estado, minutos, velocidad (kn), rumbo inicial].
   */
  function marea(vesselId, n) {
    const tramos = [
      ['puerto', 90, 0, 0], ['navegando', 9 * 60, 9.5, 140],
      ['lance', 270, 4, 60], ['virada', 40, 1.2, null], ['lance', 300, 4.1, 240],
      ['virada', 45, 1.4, null], ['lance', 250, 3.9, 55], ['virada', 35, 1.1, null],
      ['navegando', 150, 8.5, 200], ['lance', 290, 4, 70], ['virada', 40, 1.3, null],
      ['lance', 280, 4.2, 250], ['capa', 7 * 60, 0.9, 300], ['lance', 300, 4, 60],
      ['virada', 40, 1.2, null], ['lance', 260, 4.1, 240], ['virada', 38, 1.3, null],
      ['lance', 240, 3.8, 65],
    ];
    const total = tramos.reduce((s, t) => s + t[1], 0);
    let t = ahora - total * MIN;
    // Puerto de salida genérico y desplazamiento por barco para que no se pisen
    let lat = -38.045 + n * 0.02, lon = -57.535;
    let rumbo = 0;
    for (const [estado, minutos, vel, rumboIni] of tramos) {
      if (rumboIni !== null) rumbo = rumboIni + n * 15;
      for (let m = 0; m < minutos; m++, t += MIN) {
        let v = estado === 'puerto' ? 0 : Math.max(0, vel + ruido(estado === 'lance' ? 0.6 : 0.4));
        // Virada y capa: el rumbo cambia mucho, el barco casi no avanza
        if (estado === 'virada' || estado === 'capa') rumbo = (rumbo + ruido(40) + 360) % 360;
        else rumbo = (rumbo + ruido(3) + 360) % 360;
        const mn = v / 60; // millas en un minuto
        lat += (mn / 60) * Math.cos(rumbo * Math.PI / 180);
        lon += (mn / 60) * Math.sin(rumbo * Math.PI / 180) / Math.cos(lat * Math.PI / 180);
        insPos.run(vesselId, lat, lon, sqlFecha(t), Math.round(v * 100) / 100, Math.round(rumbo * 10) / 10,
          Math.round(((rumbo + ruido(8)) + 360) % 360));
      }
    }
  }

  db.cerrar();
  console.log(`Demo cargada en ${config.dbPath}`);
  console.log(`Barcos: ${BARCOS.map((b) => b.nombre).join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
