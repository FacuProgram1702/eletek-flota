# Agente GPS de a bordo

Programa para las PC de navegación de la flota. Lee la posición del puerto serie
(GPS, plotter o girocompás) en formato NMEA y la reporta al panel de ELETEK.

| | |
|---|---|
| **Archivo** | `EletekGPS.exe` — 26 KB, un solo ejecutable |
| **Requisitos** | Windows 7 SP1 o posterior, con .NET Framework 4.0 (viene con Windows) |
| **Instalación** | No tiene: se copia y se ejecuta |
| **Reporta** | Posición, velocidad, rumbo de avance y proa del girocompás |

---

## Instalar en una PC del barco

**1. Copiar el ejecutable.** Puede ir a `C:\ELETEK\EletekGPS.exe` o al escritorio.
No hay instalador ni hace falta ser administrador.

**2. Conseguir el código del barco.** Es el token que figura en el panel, en la
ficha del barco, bajo *API Token*. Se copia con el botón Copiar.

**3. Abrir el programa y configurarlo.**

- Pegar el código en **Código del barco** y tocar **Verificar**.
  Tiene que aparecer el nombre del barco en verde. Si dice que el código no es
  válido, está mal copiado.
- Elegir el **puerto COM**. El botón *Buscar puertos* lista los que hay.
- Elegir la **velocidad**: casi siempre `4800` para un GPS, `38400` para un
  girocompás. Si no llega nada, probar la otra.
- Dejar tildado **Arrancar automáticamente con Windows**.
- **Guardar y aplicar**.

**4. Confirmar que funciona.** En el recuadro *Estado* tiene que verse:

```
Puerto: Conectado a COM3   ·   142 líneas leídas
-38.04928, -57.55894   5.4 nudos   rumbo 82°
Envío: Enviado 14:32:05
```

Si el puerto conecta pero no aparece posición, mirar el recuadro de abajo: ahí se
ve crudo lo que llega. Si no llega nada, la velocidad está mal o el puerto es otro.

**5. Cerrar la ventana.** El programa **no se cierra**: queda en el área de
notificación, al lado del reloj. Doble clic para volver a abrirlo.

---

## Si la PC usa GpsGate

El puerto serie lo puede abrir **un solo programa a la vez**. Si los programas de
navegación ya lo están usando a través de GpsGate, este agente no puede tomarlo.

La solución es pedirle a GpsGate **una salida más**: un COM virtual dedicado para
el agente. En la configuración de GpsGate se agrega una salida de tipo *Virtual
COM port*, y ese número de puerto es el que se elige acá.

No hay que sacar a GpsGate del medio ni tocar los programas de navegación.

---

## Que la PC pueda llegar al panel

Las PC de a bordo están detrás del hotspot del MikroTik, así que sin loguearse no
tienen internet. Hay dos formas de resolverlo, y conviene la segunda:

**Loguear un usuario del hotspot en esa PC.** Funciona, pero cuando esa cuota se
agote la PC deja de reportar justo cuando más falta hace.

**Permitir solo el panel (recomendado).** Se manda esta orden al barco desde el
panel, en *Comando manual*:

```routeros
/ip hotspot walled-garden ip add dst-host=panel.tu-dominio.com action=accept comment=eletek-agente
```

Con eso la PC puede llegar **únicamente** al servidor de ELETEK sin loguearse: no
puede navegar ni consume cuota de nadie. El resto de la tripulación sigue teniendo
que loguearse igual que siempre.

---

## Diagnóstico

**Ver qué está pasando:** clic derecho en el ícono del área de notificación →
*Ver registro*. El archivo está en:

```
%APPDATA%\ELETEK\agente-gps.log
```

**Probar un puerto sin abrir la interfaz**, desde una consola:

```
EletekGPS.exe /probar COM3 4800
```

Muestra cada línea que llega y, cuando logra armar una posición, la imprime
debajo. Sirve para encontrar el puerto y la velocidad correctos.

**Problemas frecuentes**

| Síntoma | Causa habitual |
|---|---|
| "Access denied" al abrir el puerto | Otro programa lo tiene tomado — pedirle un COM virtual a GpsGate |
| Llegan líneas pero salen raras | Velocidad equivocada; probar 4800, 9600, 38400 |
| Llegan líneas pero no hay posición | El equipo manda solo sentencias de profundidad o viento, no de posición |
| "Sin conexión con el panel" | Falta el walled-garden, o la PC no tiene internet |
| "El código del barco no es válido" | El token está mal copiado o es de otro barco |

---

## Qué sentencias entiende

| Sentencia | De dónde sale | Qué aporta |
|---|---|---|
| `RMC` | GPS | posición, velocidad, rumbo |
| `GGA` | GPS | posición (ignora las que no tienen fix) |
| `GLL` | GPS | posición |
| `VTG` | GPS | velocidad y rumbo de avance |
| `HDT` `HDG` `HDM` | girocompás | proa |

Acepta cualquier *talker*: `GP` (GPS), `GN` (GPS+GLONASS), `HE` (girocompás), etc.
Valida el checksum de cada línea, así que una sentencia cortada —cosa común en un
puerto compartido— se descarta en vez de dar una posición equivocada.

---

## Cómo se comporta

- **Reporta cada 1 minuto** por defecto (configurable hasta 15).
- **Espera 45 segundos** antes del primer envío, para darle tiempo al GPS a fijar
  posición.
- **No manda posiciones viejas**: si hace más de 5 minutos que el GPS no da un
  fix, no envía nada en vez de mandar una posición desactualizada.
- **Reintenta el puerto para siempre**: si la PC arranca antes que GpsGate cree el
  COM virtual, lo toma cuando aparece.
- **Una sola instancia**: si alguien lo abre estando ya corriendo, avisa y no
  abre un segundo proceso que pelee por el puerto.

---

## Compilar

```
compilar.bat
```

Usa el compilador que ya viene con Windows (`.NET Framework 4.0`), así que no hay
que instalar nada. Se apunta a esa versión a propósito: es lo que garantiza que
el mismo `.exe` corra en las PC viejas con Windows 7 y en las nuevas con 11.

**Correr las pruebas:**

```
csc /target:exe /out:Pruebas.exe /main:Eletek.Gps.Pruebas ^
    /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll ^
    EletekGPS.cs Pruebas.cs
Pruebas.exe
```

Son 37 pruebas del parser NMEA (checksum, hemisferio sur y oeste, sentencias
cortadas, basura). Con `ELETEK_URL` y `ELETEK_TOKEN` en el entorno agrega 4 más
que prueban la conexión real con el panel.
