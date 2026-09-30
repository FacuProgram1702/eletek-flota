/**
 * Lee el archivo .env sin depender de la librería dotenv.
 * Formato: CLAVE=valor, una por línea; # para comentarios.
 * Las variables que ya existen en el entorno tienen prioridad.
 */
const fs = require('fs');
const path = require('path');

const archivo = path.join(__dirname, '..', '.env');

if (fs.existsSync(archivo)) {
  const lineas = fs.readFileSync(archivo, 'utf8').split(/\r?\n/);
  for (const linea of lineas) {
    const l = linea.trim();
    if (!l || l.startsWith('#')) continue;
    const i = l.indexOf('=');
    if (i < 1) continue;
    const clave = l.slice(0, i).trim();
    let valor = l.slice(i + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    if (process.env[clave] === undefined) process.env[clave] = valor;
  }
}
