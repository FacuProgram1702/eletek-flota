# Panel de conectividad

Administración remota de los routers MikroTik de la flota. Ver el
[README principal](../README.md) para la arquitectura.

- **Flota:** estado de cada barco (en línea / sin conexión) según su último reporte.
- **Barco:** usuarios del hotspot con cuota y consumo, salud del router
  (CPU, memoria, voltaje, temperatura, reinicios), consumo por día y por usuario.
- **Órdenes remotas:** crear, editar, habilitar o reiniciar cuotas de usuarios.
  Se traducen a RouterOS en [`src/services/commandTranslator.js`](src/services/commandTranslator.js)
  con validación de cada campo ([`src/utils/sanitize.js`](src/utils/sanitize.js)).
- **Operadores:** usuarios del panel con acceso limitado a ciertos barcos.
- **Mapa:** última posición de cada barco (agente GPS o portal cautivo).
- **Portal cautivo:** página de ingreso al wifi de a bordo que además toma la
  posición del celular ([`src/routes/location.js`](src/routes/location.js)).

Scripts de RouterOS del lado del barco: [`MIKROTIK_GUIDE.md`](MIKROTIK_GUIDE.md).

```bash
npm install
cp .env.example .env   # completar SESSION_SECRET y ADMIN_PASS
npm run demo           # datos inventados: 5 barcos, consumos y recorridos
npm start              # http://localhost:3000
```
