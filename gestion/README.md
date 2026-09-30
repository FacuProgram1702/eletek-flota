# Gestión de flota

ERP por módulos para empresas pesqueras. Ver el [README principal](../README.md).

| Módulo | Qué resuelve |
|---|---|
| Stock | Depósitos en tierra y en cada barco, transferencias, consumos, inventario, costo promedio, importación desde Excel |
| Mantenimiento | Equipos por barco, planes preventivos por horas / días / mareas, horómetros, correctivos, planes modelo |
| Pedidos de trabajo | Del barco al área técnica y de ahí al taller, con material usado que descuenta stock |
| Compras | Solicitud → cotización → aprobación (doble aprobación por monto) → orden → recepción parcial o total |
| Partes de pesca | Mareas, lances con hora y posición GPS, capturas por especie, parte para imprimir |
| Víveres | Carga al zarpar y consumo por marea |
| Seguimiento | Recorrido y actividad de cada barco (pescando, navegando, virada, a la capa…) calculada con el GPS |

Multiempresa, roles configurables por empresa y alcance por barco (el capitán
ve solo su barco). Pensado también para usarse desde el celular a bordo.

```bash
npm install
cp .env.example .env   # completar SESSION_SECRET y SUPER_PASS
npm run semilla        # empresa de ejemplo; usuarios demo.* con clave ejemplo2026
npm start              # http://localhost:3100
```

Requiere Node.js 22.13+ (usa `node:sqlite`).
