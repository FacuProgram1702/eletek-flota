/**
 * Mantiene actualizada la IP del subdominio de DuckDNS de este sistema.
 *
 * El panel se publica en internet a través de la IP de la conexión donde
 * corre (Caddy + DuckDNS). Si el proveedor de internet cambia la IP, DuckDNS
 * tiene que enterarse: cada 5 minutos se le avisa. DuckDNS toma la IP desde
 * la que llega el pedido, así que no hace falta averiguarla.
 *
 * Solo corre si DUCKDNS_TOKEN y DUCKDNS_DOMINIOS están en el .env.
 */

const https = require('https');

const CADA_MS = 5 * 60 * 1000;

function actualizar(dominios, token) {
  const url = `https://www.duckdns.org/update?domains=${encodeURIComponent(dominios)}&token=${encodeURIComponent(token)}&ip=`;
  https.get(url, { timeout: 15000 }, (res) => {
    let cuerpo = '';
    res.on('data', (d) => { cuerpo += d; });
    res.on('end', () => {
      // Si DuckDNS devuelve una página entera (caída o mantenimiento), no
      // llenar la consola con el HTML: alcanza con el principio.
      const r = cuerpo.trim().replace(/\s+/g, ' ');
      if (r !== 'OK') console.error(`[duckdns] respuesta inesperada (HTTP ${res.statusCode}): "${r.slice(0, 120)}${r.length > 120 ? '…' : ''}"`);
    });
  }).on('error', (e) => console.error('[duckdns] no se pudo actualizar:', e.message))
    .on('timeout', function () { this.destroy(); });
}

function iniciar() {
  const token = process.env.DUCKDNS_TOKEN;
  const dominios = process.env.DUCKDNS_DOMINIOS;
  if (!token || !dominios) return;
  actualizar(dominios, token);
  setInterval(() => actualizar(dominios, token), CADA_MS).unref();
  console.log(`[duckdns] actualizando ${dominios} cada 5 minutos`);
}

module.exports = { iniciar };
