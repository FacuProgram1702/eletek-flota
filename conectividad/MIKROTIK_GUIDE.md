# Guía de Configuración y Mantenimiento - ELETEK MikroTik

Este documento guarda todo el proceso de configuración y resolución de problemas del entorno de desarrollo y los barcos, para tenerlo a mano en la próxima sesión.

> **La configuración de cada barco está en [`docs/`](docs/README.md)** — una ficha por
> barco con sus comandos listos para copiar, más las lecciones aprendidas (FastTrack,
> WiFi en `mode=station`, DHCP del bridge, etc.) y la
> [plantilla para barcos nuevos](docs/plantilla-barco-nuevo.md).
> Este archivo cubre el entorno de desarrollo y los scripts base.

## 1. Problemas de Conexión (Barcos Offline)

### El problema de la IP dinámica en el puerto
Si llevás la notebook a otro lado y volvés, el router de tu casa te puede asignar una IP distinta (por ejemplo, pasás de la `.102` a la `.100`). 
* **Síntoma:** El servidor Node y Caddy arrancan bien, pero los barcos aparecen "offline".
* **Solución:**
  1. Entrar al router de tu casa (`http://192.168.50.1`).
  2. Ir a **NAT Forwarding / Port Forwarding**.
  3. Asegurarse de que los puertos **80** y **443** apunten a la IP actual de tu notebook.
* **Solución Definitiva:** Configurar una IP estática o "Address Reservation" en la sección DHCP del router para la MAC de tu notebook.

### Hairpin NAT (No carga la web en el teléfono por WiFi)
Si estás conectado a la misma red WiFi que el servidor (en tu casa) y entrás a `https://panel.tu-dominio.com`, te va a dar **Timeout** y no va a cargar.
* Esto pasa porque los routers de hogar no permiten salir hacia internet y volver a entrar hacia el mismo router (Hairpin NAT).
* **Cómo testear:**
  * En la PC donde corre el server: entrá a `http://localhost:3000`.
  * En el teléfono: **Apagá el WiFi** y usá datos móviles 4G/5G.

## 2. Ejecución Correcta del Servidor
Nunca arrancar los procesos en "segundo plano" desde PowerShell, porque al cerrarse la terminal se mata `caddy.exe` y te quedás sin HTTPS.
* **Forma correcta:** Usar siempre el archivo **`start.bat`**. Esto abre las ventanas negras correspondientes que mantienen los procesos vivos.

## 3. Scripts Correctos para el MikroTik

### Script de Telemetría (`eletek_sync`)
Este script asegura que si un usuario aún no consumió bytes, el reporte no se rompa (envía `0`).

```routeros
# ELETEK - Agente de Telemetria (REAL-TIME FIX)
:local vesselSlug "gaviota"
:local apiToken "TOKEN-DEL-BARCO"
:local domain "https://panel.tu-dominio.com"
:local syncUrl "$domain/api/v1/sync/$vesselSlug\?token=$apiToken"
:local report ""

:do {
  :foreach userId in=[/ip hotspot user find] do={
    :local uName [/ip hotspot user get $userId name]
    :local bIn [/ip hotspot user get $userId bytes-in]
    :local bOut [/ip hotspot user get $userId bytes-out]
    :local limit [/ip hotspot user get $userId limit-bytes-total]
    
    :if ([:len $bIn] = 0) do={:set bIn 0} else={:set bIn [:tonum $bIn]}
    :if ([:len $bOut] = 0) do={:set bOut 0} else={:set bOut [:tonum $bOut]}
    :if ([:len $limit] = 0) do={:set limit 0} else={:set limit [:tonum $limit]}
    
    :local active "false"
    :local activeIds [/ip hotspot active find user=$uName]
    :if ([:len $activeIds] > 0) do={
      :set active "true"
      # Sumamos el trafico EN VIVO de la sesion actual
      :local aIn [/ip hotspot active get ($activeIds->0) bytes-in]
      :local aOut [/ip hotspot active get ($activeIds->0) bytes-out]
      :if ([:len $aIn] > 0) do={:set bIn ($bIn + [:tonum $aIn])}
      :if ([:len $aOut] > 0) do={:set bOut ($bOut + [:tonum $aOut])}
    }
    
    :set report ($report . $uName . ":" . $bIn . ":" . $bOut . ":" . $limit . ":" . $active . "|")
  }
  
  :if ([:len $report] > 0) do={
    /tool fetch url=$syncUrl mode=https http-method=post http-data=("payload=" . $report) output=none
  }
} on-error={ :log warning "ELETEK: Falla al enviar telemetria." }
```

### Script de Polling (`eletek_poll`)
Revisa y ejecuta comandos enviados desde el panel.

```routeros
# ELETEK - Agente de Ordenes
:local vesselSlug "gaviota"
:local apiToken "TOKEN-DEL-BARCO"
:local domain "https://panel.tu-dominio.com"
:local syncUrl "$domain/api/v1/poll/$vesselSlug\?token=$apiToken&format=text"
:local resultUrlBase "$domain/api/v1/result/$vesselSlug\?token=$apiToken"

:do {
  :local response [/tool fetch url=$syncUrl mode=https output=user as-value]
  :local data ($response->"data")
  :if ([:len $data] > 0) do={
    :local pipePos [:find $data "|" -1]
    :if ([:typeof $pipePos] = "num") do={
      :local cmdId [:pick $data 0 $pipePos]
      :local cmdScript [:pick $data ($pipePos + 1) [:len $data]]
      :log info ("ELETEK: Ejecutando orden #" . $cmdId)
      :do {
        :local runCmd [:parse $cmdScript]
        $runCmd
        /tool fetch url="$resultUrlBase&id=$cmdId&status=done&result=ok" mode=https output=none
      } on-error={
        /tool fetch url="$resultUrlBase&id=$cmdId&status=error&result=fallo_ejecucion" mode=https output=none
      }
    }
  }
} on-error={ :log warning "ELETEK: Falla al buscar ordenes." }
```

### Generación Rápida de Usuarios
Comando para crear bloques de usuarios rápidamente desde la terminal Winbox (2GB de límite):
```routeros
/ip hotspot user
add name=Usuario10 password=Caramelo17 limit-bytes-total=2147483648
add name=Usuario11 password=Delfin23 limit-bytes-total=2147483648
```
