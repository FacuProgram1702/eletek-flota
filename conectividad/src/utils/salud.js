/**
 * Monitor de salud del proceso.
 *
 * Existe porque el servidor se trababa y había que reiniciarlo a mano, sin
 * ninguna pista de por qué. Deja un registro continuo de memoria, retraso del
 * bucle de eventos y tráfico, para que la próxima vez haya evidencia en vez de
 * conjeturas.
 *
 * El retraso del bucle de eventos es la señal clave: si Node está bloqueado en
 * una operación sincrónica, ese número se dispara y el servidor deja de
 * responder aunque el proceso siga vivo. Eso es exactamente "se cuelga".
 */

const fs = require('fs');
const path = require('path');

const RUTA = path.join(__dirname, '..', '..', 'salud.log');
const LIMITE_ARCHIVO = 5 * 1024 * 1024;   // 5 MB y se recicla

// Umbrales a partir de los cuales vale la pena avisar
const LAG_AVISO_MS = 500;
const LAG_ALARMA_MS = 2000;
const MEM_AVISO_MB = 600;

let ultimoTick = Date.now();
let lagMaximo = 0;
let peticiones = 0;
let errores = 0;
let arranque = Date.now();

function escribir(nivel, msg) {
  const linea = new Date().toISOString() + '  [' + nivel + ']  ' + msg + '\n';
  try {
    if (fs.existsSync(RUTA) && fs.statSync(RUTA).size > LIMITE_ARCHIVO) {
      fs.writeFileSync(RUTA, '');
    }
    fs.appendFileSync(RUTA, linea);
  } catch (e) { /* si no se puede registrar, no romper por eso */ }
  if (nivel !== 'INFO') console.error('[SALUD] ' + msg);
}

/** Cuenta una petición atendida. Se engancha como middleware. */
function middleware(req, res, next) {
  peticiones++;
  next();
}

/** Cuenta un error atendido. */
function contarError() {
  errores++;
}

/**
 * Mide cuánto se retrasa el bucle de eventos respecto de lo pedido.
 * Un temporizador de 1 s que vuelve a los 3 s significa que algo bloqueó
 * el proceso 2 s enteros.
 */
function medirLag() {
  const ahora = Date.now();
  const lag = ahora - ultimoTick - 1000;
  ultimoTick = ahora;

  if (lag > lagMaximo) lagMaximo = lag;

  if (lag > LAG_ALARMA_MS) {
    escribir('ALARMA', 'El proceso quedó bloqueado ' + lag + ' ms. ' +
      'Durante ese tiempo no atendió ninguna petición.');
  }
}

/** Resumen periódico: queda el rastro aunque nunca falle nada. */
function resumen() {
  const m = process.memoryUsage();
  const rssMB = Math.round(m.rss / 1048576);
  const heapMB = Math.round(m.heapUsed / 1048576);
  const horas = ((Date.now() - arranque) / 3600000).toFixed(1);

  const txt = 'memoria ' + rssMB + ' MB (heap ' + heapMB + ')' +
              '  lag maximo ' + lagMaximo + ' ms' +
              '  peticiones ' + peticiones +
              '  errores ' + errores +
              '  encendido ' + horas + ' h';

  let nivel = 'INFO';
  if (rssMB > MEM_AVISO_MB) nivel = 'AVISO';
  if (lagMaximo > LAG_AVISO_MS && nivel === 'INFO') nivel = 'AVISO';

  escribir(nivel, txt);

  // El máximo se mide por ventana, si no queda clavado para siempre
  lagMaximo = 0;
  peticiones = 0;
  errores = 0;
}

/**
 * Engancha los manejadores de errores del proceso.
 *
 * Sin esto, una promesa rechazada sin atrapar TERMINA el proceso en Node
 * moderno, y una excepción no atrapada también. En ambos casos el servidor
 * desaparece sin dejar explicación, que es justo lo que pasaba.
 *
 * @param {Function} alSalir - se llama antes de terminar, para guardar datos
 */
function instalar(alSalir) {
  process.on('unhandledRejection', (razon) => {
    const detalle = (razon && razon.stack) ? razon.stack : String(razon);
    escribir('ERROR', 'Promesa rechazada sin atrapar:\n' + detalle);
    // A propósito NO se termina el proceso: un fallo aislado no justifica
    // dejar a toda la flota sin servidor.
  });

  process.on('uncaughtException', (err) => {
    const detalle = (err && err.stack) ? err.stack : String(err);
    escribir('ERROR', 'Excepción no atrapada:\n' + detalle);
    // Tampoco se termina. Si el estado quedó inconsistente lo veremos en el
    // registro, pero es preferible a una caída total sin aviso.
  });

  process.on('warning', (w) => {
    // node:sqlite todavía se marca como experimental en Node; es esperable y
    // no indica ningún problema, así que no se registra como aviso.
    if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
    escribir('AVISO', 'Node avisa: ' + w.name + ' - ' + w.message);
  });

  const salir = (senal) => {
    escribir('INFO', 'Cerrando por ' + senal + '. Guardando datos...');
    try { if (alSalir) alSalir(); } catch (e) { /* nada que hacer */ }
    process.exit(0);
  };
  process.on('SIGINT', () => salir('SIGINT'));
  process.on('SIGTERM', () => salir('SIGTERM'));

  const t1 = setInterval(medirLag, 1000);
  const t2 = setInterval(resumen, 60000);
  if (t1.unref) t1.unref();
  if (t2.unref) t2.unref();

  escribir('INFO', '=== Servidor iniciado (Node ' + process.version + ') ===');
}

module.exports = { instalar, middleware, contarError, escribir, RUTA };
