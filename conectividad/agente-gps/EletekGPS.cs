// ELETEK — Agente GPS de a bordo
//
// Lee sentencias NMEA de un puerto serie (GPS, plotter o girocompás) y reporta
// la posición del barco al panel de ELETEK.
//
// Diseñado para las PC de navegación de la flota:
//   - Un solo .exe, sin instalador ni dependencias.
//   - .NET Framework 4.0, que corre desde Windows 7 SP1 hasta Windows 11.
//   - Vive en el área de notificación y arranca solo con Windows.
//   - No abre el puerto en exclusiva más de lo necesario: si GpsGate ya está
//     multiplexando, se le pide un COM virtual propio para este agente.
//
// Compilar:  compilar.bat
//
// Limitaciones deliberadas de lenguaje: el compilador que viene con .NET 4.0
// es C# 4.0, así que acá no hay async/await, ni interpolación de cadenas, ni
// operador ?. — es a propósito, para no depender de instalar nada en el barco.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.IO.Ports;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Eletek.Gps
{
    // ─────────────────────────────────────────────────────────────────────
    //  Configuración persistida
    // ─────────────────────────────────────────────────────────────────────

    class Config
    {
        public string Token = "";
        public string Barco = "";          // nombre, solo para mostrar
        public string Slug = "";
        public string Puerto = "";
        public int Baudios = 4800;
        public int IntervaloMin = 1;
        public bool ArrancarConWindows = true;
        public bool SinCifrar = false;   // ultimo recurso: PC sin TLS 1.2

        public static string Carpeta
        {
            get
            {
                string b = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                return Path.Combine(b, "ELETEK");
            }
        }

        public static string Ruta { get { return Path.Combine(Carpeta, "agente-gps.cfg"); } }

        public static Config Cargar()
        {
            Config c = new Config();
            try
            {
                if (!File.Exists(Ruta)) return c;
                foreach (string linea in File.ReadAllLines(Ruta))
                {
                    int i = linea.IndexOf('=');
                    if (i <= 0) continue;
                    string k = linea.Substring(0, i).Trim();
                    string v = linea.Substring(i + 1).Trim();
                    switch (k)
                    {
                        case "token": c.Token = v; break;
                        case "barco": c.Barco = v; break;
                        case "slug": c.Slug = v; break;
                        case "puerto": c.Puerto = v; break;
                        case "baudios": int.TryParse(v, out c.Baudios); break;
                        case "intervalo": int.TryParse(v, out c.IntervaloMin); break;
                        case "autostart": c.ArrancarConWindows = (v == "1"); break;
                        case "sincifrar": c.SinCifrar = (v == "1"); break;
                    }
                }
                if (c.Baudios <= 0) c.Baudios = 4800;
                if (c.IntervaloMin <= 0) c.IntervaloMin = 1;
            }
            catch (Exception e) { Log.Escribir("Error leyendo configuración: " + e.Message); }
            return c;
        }

        public void Guardar()
        {
            try
            {
                Directory.CreateDirectory(Carpeta);
                StringBuilder sb = new StringBuilder();
                sb.AppendLine("token=" + Token);
                sb.AppendLine("barco=" + Barco);
                sb.AppendLine("slug=" + Slug);
                sb.AppendLine("puerto=" + Puerto);
                sb.AppendLine("baudios=" + Baudios);
                sb.AppendLine("intervalo=" + IntervaloMin);
                sb.AppendLine("autostart=" + (ArrancarConWindows ? "1" : "0"));
                sb.AppendLine("sincifrar=" + (SinCifrar ? "1" : "0"));
                File.WriteAllText(Ruta, sb.ToString());
            }
            catch (Exception e) { Log.Escribir("Error guardando configuración: " + e.Message); }
        }

        // El arranque automático va por la clave Run del usuario: no necesita
        // permisos de administrador, que en las PC de a bordo rara vez están.
        public void AplicarAutoarranque()
        {
            try
            {
                RegistryKey k = Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\Run", true);
                if (k == null) return;
                if (ArrancarConWindows)
                    k.SetValue("EletekGPS", "\"" + Application.ExecutablePath + "\" /oculto");
                else
                    k.DeleteValue("EletekGPS", false);
                k.Close();
            }
            catch (Exception e) { Log.Escribir("Error con el arranque automático: " + e.Message); }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Log a archivo (para diagnosticar a distancia)
    // ─────────────────────────────────────────────────────────────────────

    static class Log
    {
        static readonly object candado = new object();
        public static string Ruta { get { return Path.Combine(Config.Carpeta, "agente-gps.log"); } }

        public static void Escribir(string msg)
        {
            lock (candado)
            {
                try
                {
                    Directory.CreateDirectory(Config.Carpeta);
                    // Rotación simple: si pasa 1 MB, se empieza de nuevo. En un
                    // barco nadie va a ir a borrar logs.
                    if (File.Exists(Ruta) && new FileInfo(Ruta).Length > 1024 * 1024)
                        File.WriteAllText(Ruta, "");
                    File.AppendAllText(Ruta,
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + msg + Environment.NewLine);
                }
                catch { /* si no se puede loguear, no vale la pena romper por eso */ }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Posición
    // ─────────────────────────────────────────────────────────────────────

    class Fix
    {
        public double Lat, Lon;
        public bool TienePos;
        public double? VelocidadNudos;
        public double? RumboGrados;    // course over ground (movimiento)
        public double? ProaGrados;     // heading del girocompás (hacia dónde apunta)
        public DateTime Momento = DateTime.MinValue;

        public bool EsFresco(int segundos)
        {
            return TienePos && (DateTime.UtcNow - Momento).TotalSeconds < segundos;
        }

        public Fix Copia()
        {
            Fix f = new Fix();
            f.Lat = Lat; f.Lon = Lon; f.TienePos = TienePos;
            f.VelocidadNudos = VelocidadNudos; f.RumboGrados = RumboGrados;
            f.ProaGrados = ProaGrados; f.Momento = Momento;
            return f;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Parser NMEA 0183
    // ─────────────────────────────────────────────────────────────────────

    static class Nmea
    {
        // El checksum es el XOR de todo lo que hay entre '$' y '*'. Validarlo
        // evita tomar por buena una línea cortada, que en un puerto compartido
        // pasa seguido.
        public static bool ChecksumOk(string linea)
        {
            if (string.IsNullOrEmpty(linea)) return false;
            int ini = linea.IndexOf('$');
            if (ini < 0) ini = linea.IndexOf('!');
            if (ini < 0) return false;
            int ast = linea.LastIndexOf('*');
            if (ast < 0 || ast <= ini) return false;            // sin checksum
            if (ast + 3 > linea.Length) return false;

            int calc = 0;
            for (int i = ini + 1; i < ast; i++) calc ^= linea[i];

            int leido;
            if (!int.TryParse(linea.Substring(ast + 1, 2),
                    NumberStyles.HexNumber, CultureInfo.InvariantCulture, out leido))
                return false;
            return calc == leido;
        }

        /// Convierte ddmm.mmmm + hemisferio a grados decimales.
        public static double? Coord(string valor, string hemi)
        {
            if (string.IsNullOrEmpty(valor) || string.IsNullOrEmpty(hemi)) return null;
            int punto = valor.IndexOf('.');
            // Los grados son todo menos los 2 dígitos de minutos antes del punto.
            int corte = (punto >= 0 ? punto : valor.Length) - 2;
            if (corte < 1) return null;

            double grados, minutos;
            if (!double.TryParse(valor.Substring(0, corte),
                    NumberStyles.Float, CultureInfo.InvariantCulture, out grados)) return null;
            if (!double.TryParse(valor.Substring(corte),
                    NumberStyles.Float, CultureInfo.InvariantCulture, out minutos)) return null;

            double d = grados + minutos / 60.0;
            string h = hemi.Trim().ToUpperInvariant();
            if (h == "S" || h == "W") d = -d;
            if (d < -180 || d > 180) return null;
            return d;
        }

        static double? Num(string s)
        {
            if (string.IsNullOrEmpty(s)) return null;
            double d;
            if (!double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out d)) return null;
            return d;
        }

        /// Procesa una línea y actualiza el fix acumulado.
        /// Devuelve true si la línea aportó algún dato útil.
        public static bool Procesar(string linea, Fix fix)
        {
            if (string.IsNullOrEmpty(linea)) return false;
            linea = linea.Trim();
            if (linea.Length < 6) return false;
            if (linea[0] != '$' && linea[0] != '!') return false;

            // Si trae checksum, tiene que estar bien. Si no lo trae, se acepta:
            // algunos equipos viejos mandan sentencias sin él.
            if (linea.LastIndexOf('*') > 0 && !ChecksumOk(linea)) return false;

            int ast = linea.LastIndexOf('*');
            string cuerpo = (ast > 0) ? linea.Substring(1, ast - 1) : linea.Substring(1);
            string[] c = cuerpo.Split(',');
            if (c.Length < 2) return false;

            // El "talker" son los 2 primeros caracteres (GP, GN, HE...). Lo que
            // importa es el tipo de sentencia, que son los 3 siguientes.
            string tipo = c[0].Length >= 5 ? c[0].Substring(2, 3).ToUpperInvariant() : c[0].ToUpperInvariant();
            bool sirvio = false;

            if (tipo == "RMC" && c.Length >= 8)
            {
                // $--RMC,hhmmss,A,llll.ll,N,yyyyy.yy,E,vel,rumbo,ddmmyy
                bool valido = (c[2].Trim().ToUpperInvariant() == "A");
                double? lat = Coord(c[3], c[4]);
                double? lon = Coord(c[5], c[6]);
                if (valido && lat.HasValue && lon.HasValue)
                {
                    fix.Lat = lat.Value; fix.Lon = lon.Value;
                    fix.TienePos = true; fix.Momento = DateTime.UtcNow;
                    sirvio = true;
                }
                double? vel = Num(c[7]);
                if (vel.HasValue && vel.Value >= 0 && vel.Value < 200) fix.VelocidadNudos = vel;
                if (c.Length >= 9)
                {
                    double? rum = Num(c[8]);
                    if (rum.HasValue && rum.Value >= 0 && rum.Value <= 360) fix.RumboGrados = rum;
                }
            }
            else if (tipo == "GGA" && c.Length >= 7)
            {
                // $--GGA,hhmmss,llll.ll,N,yyyyy.yy,E,calidad,sats,...
                // calidad 0 = sin fix
                double? cal = Num(c[6]);
                double? lat = Coord(c[2], c[3]);
                double? lon = Coord(c[4], c[5]);
                if (cal.HasValue && cal.Value > 0 && lat.HasValue && lon.HasValue)
                {
                    fix.Lat = lat.Value; fix.Lon = lon.Value;
                    fix.TienePos = true; fix.Momento = DateTime.UtcNow;
                    sirvio = true;
                }
            }
            else if (tipo == "GLL" && c.Length >= 6)
            {
                // $--GLL,llll.ll,N,yyyyy.yy,E,hhmmss,A
                bool valido = c.Length < 7 || c[6].Trim().ToUpperInvariant() != "V";
                double? lat = Coord(c[1], c[2]);
                double? lon = Coord(c[3], c[4]);
                if (valido && lat.HasValue && lon.HasValue)
                {
                    fix.Lat = lat.Value; fix.Lon = lon.Value;
                    fix.TienePos = true; fix.Momento = DateTime.UtcNow;
                    sirvio = true;
                }
            }
            else if (tipo == "VTG" && c.Length >= 8)
            {
                // $--VTG,rumboT,T,rumboM,M,nudos,N,kmh,K
                double? rum = Num(c[1]);
                if (rum.HasValue && rum.Value >= 0 && rum.Value <= 360) { fix.RumboGrados = rum; sirvio = true; }
                double? vel = Num(c[5]);
                if (vel.HasValue && vel.Value >= 0 && vel.Value < 200) { fix.VelocidadNudos = vel; sirvio = true; }
            }
            else if (tipo == "HDT" || tipo == "HDG" || tipo == "HDM")
            {
                // Girocompás: $HEHDT,123.4,T  /  $HEHDG,123.4,,,,
                double? proa = Num(c.Length > 1 ? c[1] : null);
                if (proa.HasValue && proa.Value >= 0 && proa.Value <= 360)
                {
                    fix.ProaGrados = proa; sirvio = true;
                }
            }

            return sirvio;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Cliente HTTP del panel
    // ─────────────────────────────────────────────────────────────────────

    static class Panel
    {
        // Normalmente el panel de producción. La variable de entorno permite
        // apuntarlo a otro servidor para probar, sin recompilar.
        public const string Host = "panel.tu-dominio.com";

        // Normalmente HTTPS. Se baja a HTTP solo si el operador activa la
        // opcion, para las PC donde Windows no puede negociar TLS 1.2.
        public static string Dominio =
            Environment.GetEnvironmentVariable("ELETEK_URL") ?? ("https://" + Host);

        public static void UsarSinCifrar(bool si)
        {
            if (Environment.GetEnvironmentVariable("ELETEK_URL") != null) return;
            Dominio = (si ? "http://" : "https://") + Host;
            Log.Escribir("Conexion al panel: " + Dominio);
        }

        static Panel()
        {
            // El servidor solo acepta TLS 1.2 y 1.3, y .NET 4.0 arranca pidiendo
            // TLS 1.0. Hay que exigir 1.2 explícitamente: el valor 3072 es Tls12,
            // que en el enum de este framework todavía no tiene nombre.
            //
            // Se prueban varias combinaciones porque asignar un protocolo que el
            // sistema no soporta lanza excepción, y en ese caso queda el valor
            // viejo (TLS 1.0) y toda conexión falla sin explicación.
            int[] intentos = new int[] { 3072 | 768 | 192, 3072 | 768, 3072 };
            foreach (int v in intentos)
            {
                try { ServicePointManager.SecurityProtocol = (SecurityProtocolType)v; break; }
                catch { /* ese sistema no soporta esa combinación: probar la siguiente */ }
            }

            ServicePointManager.Expect100Continue = false;
            Log.Escribir("TLS en uso: " + ServicePointManager.SecurityProtocol);
        }

        /// Hace la petición. Si el cifrado falla —hay PC de a bordo donde
        /// Windows no puede negociar TLS 1.2 y no se arregla desde acá— baja
        /// sola a HTTP y reintenta, para que el barco no deje de reportar.
        static string Pedir(string url, string metodo, string cuerpo)
        {
            try
            {
                return PedirDirecto(url, metodo, cuerpo);
            }
            catch (WebException we)
            {
                bool fallaDeCifrado =
                    we.Status == WebExceptionStatus.TrustFailure ||
                    we.Status == WebExceptionStatus.SecureChannelFailure;

                if (fallaDeCifrado && Dominio.StartsWith("https://"))
                {
                    Dominio = "http://" + Host;
                    BajoACifradoSimple = true;
                    Log.Escribir("El cifrado fallo (" + we.Status + "). Esta PC no puede " +
                                 "negociar TLS con el servidor: se reintenta sin cifrar.");
                    return PedirDirecto(url.Replace("https://", "http://"), metodo, cuerpo);
                }
                throw;
            }
        }

        /// Queda en true si hubo que bajar a HTTP, para avisarlo en pantalla.
        public static bool BajoACifradoSimple = false;

        static string PedirDirecto(string url, string metodo, string cuerpo)
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = metodo;
            req.Timeout = 30000;
            req.ReadWriteTimeout = 30000;
            req.UserAgent = "EletekGPS/1.0";
            req.KeepAlive = false;

            if (cuerpo != null)
            {
                byte[] datos = Encoding.UTF8.GetBytes(cuerpo);
                req.ContentType = "application/json; charset=utf-8";
                req.ContentLength = datos.Length;
                using (Stream s = req.GetRequestStream()) s.Write(datos, 0, datos.Length);
            }

            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
            using (StreamReader sr = new StreamReader(resp.GetResponseStream()))
                return sr.ReadToEnd();
        }

        /// Confirma el token y devuelve el nombre del barco, o null si falla.
        /// 'error' queda con el motivo, para mostrárselo a quien configura.
        public static bool Identificar(string token, out string nombre, out string slug, out string error)
        {
            nombre = null; slug = null; error = null;
            try
            {
                string r = Pedir(Dominio + "/api/v1/identificar?token=" + Uri.EscapeDataString(token), "GET", null);
                nombre = ExtraerJson(r, "name");
                slug = ExtraerJson(r, "slug");
                if (string.IsNullOrEmpty(nombre)) { error = "El servidor respondió algo inesperado."; return false; }
                return true;
            }
            catch (WebException we)
            {
                error = DescribirError(we);
                return false;
            }
            catch (Exception e) { error = e.Message; return false; }
        }

        public static bool EnviarPosicion(string token, Fix f, out string error)
        {
            error = null;
            try
            {
                StringBuilder j = new StringBuilder();
                j.Append("{");
                j.Append("\"lat\":").Append(f.Lat.ToString("F6", CultureInfo.InvariantCulture));
                j.Append(",\"lon\":").Append(f.Lon.ToString("F6", CultureInfo.InvariantCulture));
                if (f.VelocidadNudos.HasValue)
                    j.Append(",\"speed_kn\":").Append(f.VelocidadNudos.Value.ToString("F2", CultureInfo.InvariantCulture));
                if (f.RumboGrados.HasValue)
                    j.Append(",\"course_deg\":").Append(f.RumboGrados.Value.ToString("F1", CultureInfo.InvariantCulture));
                if (f.ProaGrados.HasValue)
                    j.Append(",\"heading_deg\":").Append(f.ProaGrados.Value.ToString("F1", CultureInfo.InvariantCulture));
                j.Append("}");

                Pedir(Dominio + "/api/v1/posicion?token=" + Uri.EscapeDataString(token), "POST", j.ToString());
                return true;
            }
            catch (WebException we) { error = DescribirError(we); return false; }
            catch (Exception e) { error = e.Message; return false; }
        }

        static string DescribirError(WebException we)
        {
            HttpWebResponse r = we.Response as HttpWebResponse;
            if (r != null)
            {
                if ((int)r.StatusCode == 403) return "El código del barco no es válido.";
                if ((int)r.StatusCode == 401) return "Falta el código del barco.";
                return "El servidor respondió " + (int)r.StatusCode + ".";
            }

            // Sin respuesta HTTP: el problema es de red o de TLS. Conviene decir
            // exactamente qué pasó, porque a bordo no hay forma de averiguarlo.
            string detalle = we.Message;
            Exception inner = we.InnerException;
            while (inner != null)
            {
                detalle = inner.Message;
                inner = inner.InnerException;
            }
            string s = "Sin conexión con el panel [" + we.Status + "]: " + detalle;
            Log.Escribir("FALLO DE RED: " + we.Status + " | " + we.Message + " | " + detalle);
            return s;
        }

        // Extractor mínimo: las respuestas son objetos planos y chicos, no hace
        // falta arrastrar una librería de JSON al barco.
        static string ExtraerJson(string json, string clave)
        {
            if (json == null) return null;
            string busca = "\"" + clave + "\"";
            int i = json.IndexOf(busca, StringComparison.Ordinal);
            if (i < 0) return null;
            i = json.IndexOf(':', i + busca.Length);
            if (i < 0) return null;
            int ini = json.IndexOf('"', i);
            if (ini < 0) return null;
            int fin = json.IndexOf('"', ini + 1);
            if (fin < 0) return null;
            return json.Substring(ini + 1, fin - ini - 1);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Agente: lee el puerto y reporta
    // ─────────────────────────────────────────────────────────────────────

    class Agente
    {
        Config cfg;
        SerialPort puerto;
        Thread hiloSerie, hiloEnvio;
        volatile bool corriendo;
        readonly Fix fix = new Fix();
        readonly object candadoFix = new object();

        public string EstadoPuerto = "Detenido";
        public string EstadoEnvio = "—";
        public DateTime UltimoEnvioOk = DateTime.MinValue;
        public long LineasLeidas = 0;

        /// Se dispara con cada línea NMEA cruda (para la ventana de diagnóstico).
        public event Action<string> LineaRecibida;

        public Agente(Config c) { cfg = c; }

        public Fix FixActual { get { lock (candadoFix) { return fix.Copia(); } } }

        public void Arrancar()
        {
            if (corriendo) return;
            corriendo = true;
            hiloSerie = new Thread(BucleSerie); hiloSerie.IsBackground = true; hiloSerie.Start();
            hiloEnvio = new Thread(BucleEnvio); hiloEnvio.IsBackground = true; hiloEnvio.Start();
            Log.Escribir("Agente iniciado. Puerto " + cfg.Puerto + " a " + cfg.Baudios + " baudios.");
        }

        public void Detener()
        {
            corriendo = false;
            try { if (puerto != null && puerto.IsOpen) puerto.Close(); }
            catch { }
            EstadoPuerto = "Detenido";
        }

        // Reintenta abrir el puerto para siempre: si la PC arranca antes que
        // GpsGate cree el COM virtual, el agente lo toma cuando aparece.
        void BucleSerie()
        {
            while (corriendo)
            {
                try
                {
                    if (string.IsNullOrEmpty(cfg.Puerto))
                    {
                        EstadoPuerto = "Sin puerto configurado";
                        Thread.Sleep(3000);
                        continue;
                    }

                    puerto = new SerialPort(cfg.Puerto, cfg.Baudios, Parity.None, 8, StopBits.One);
                    puerto.ReadTimeout = 5000;
                    puerto.NewLine = "\n";
                    puerto.Open();
                    EstadoPuerto = "Conectado a " + cfg.Puerto;
                    Log.Escribir("Puerto " + cfg.Puerto + " abierto.");

                    while (corriendo && puerto.IsOpen)
                    {
                        string linea;
                        try { linea = puerto.ReadLine(); }
                        catch (TimeoutException) { continue; }

                        if (linea == null) continue;
                        linea = linea.Trim();
                        if (linea.Length == 0) continue;

                        LineasLeidas++;
                        Action<string> h = LineaRecibida;
                        if (h != null) { try { h(linea); } catch { } }

                        lock (candadoFix) { Nmea.Procesar(linea, fix); }
                    }
                }
                catch (Exception e)
                {
                    EstadoPuerto = "Error: " + e.Message;
                    Log.Escribir("Puerto serie: " + e.Message);
                }
                finally
                {
                    try { if (puerto != null && puerto.IsOpen) puerto.Close(); } catch { }
                }

                if (corriendo) Thread.Sleep(5000);   // esperar y reintentar
            }
        }

        void BucleEnvio()
        {
            // Primer envío al minuto de arrancar, para no disparar antes de que
            // el GPS tenga fix.
            DateTime proximo = DateTime.UtcNow.AddSeconds(45);
            while (corriendo)
            {
                Thread.Sleep(1000);
                if (DateTime.UtcNow < proximo) continue;
                proximo = DateTime.UtcNow.AddMinutes(cfg.IntervaloMin);

                Fix f = FixActual;
                if (!f.EsFresco(300))
                {
                    EstadoEnvio = f.TienePos ? "Posición vieja, esperando GPS" : "Esperando señal del GPS";
                    continue;
                }
                if (string.IsNullOrEmpty(cfg.Token)) { EstadoEnvio = "Falta el código del barco"; continue; }

                string err;
                if (Panel.EnviarPosicion(cfg.Token, f, out err))
                {
                    UltimoEnvioOk = DateTime.Now;
                    EstadoEnvio = "Enviado " + UltimoEnvioOk.ToString("HH:mm:ss");
                }
                else
                {
                    EstadoEnvio = "No se pudo enviar: " + err;
                    Log.Escribir("Envío fallido: " + err);
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Ventana de configuración
    // ─────────────────────────────────────────────────────────────────────

    class VentanaConfig : Form
    {
        Config cfg;
        Agente agente;

        TextBox txtToken, txtCrudo;
        ComboBox cmbPuerto, cmbBaudios, cmbIntervalo;
        CheckBox chkAuto, chkSinCifrar;
        Label lblBarco, lblEstadoPuerto, lblEstadoEnvio, lblPos;
        Button btnVerificar, btnGuardar;
        System.Windows.Forms.Timer refresco;

        public VentanaConfig(Config c, Agente a)
        {
            cfg = c; agente = a;
            ConstruirUI();
            agente.LineaRecibida += OnLinea;

            refresco = new System.Windows.Forms.Timer();
            refresco.Interval = 1000;
            refresco.Tick += delegate { Refrescar(); };
            refresco.Start();
        }

        void ConstruirUI()
        {
            Text = "ELETEK — Agente GPS";
            Size = new Size(560, 700);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 9f);
            BackColor = Color.White;

            int y = 16;

            Label t = new Label();
            t.Text = "Agente GPS de a bordo";
            t.Font = new Font("Segoe UI", 14f, FontStyle.Bold);
            t.SetBounds(20, y, 400, 30); Controls.Add(t); y += 38;

            Label sub = new Label();
            sub.Text = "Lee la posición del puerto serie y la envía al panel de ELETEK.";
            sub.ForeColor = Color.Gray;
            sub.SetBounds(20, y, 500, 20); Controls.Add(sub); y += 34;

            // ── Barco ──
            Controls.Add(Etiqueta("Código del barco", 20, y)); y += 22;
            txtToken = new TextBox();
            txtToken.SetBounds(20, y, 380, 26);
            txtToken.Text = cfg.Token;
            Controls.Add(txtToken);
            btnVerificar = new Button();
            btnVerificar.Text = "Verificar";
            btnVerificar.SetBounds(410, y - 1, 110, 28);
            btnVerificar.Click += OnVerificar;
            Controls.Add(btnVerificar);
            y += 32;

            Button btnDiag = new Button();
            btnDiag.Text = "Diagnosticar conexión";
            btnDiag.SetBounds(20, y, 170, 26);
            btnDiag.Click += delegate { Program.Diagnostico(); };
            Controls.Add(btnDiag);
            y += 32;

            lblBarco = new Label();
            lblBarco.SetBounds(20, y, 500, 20);
            lblBarco.ForeColor = Color.Gray;
            lblBarco.Text = string.IsNullOrEmpty(cfg.Barco)
                ? "Pegá el código que te pasaron y tocá Verificar."
                : "Barco: " + cfg.Barco;
            Controls.Add(lblBarco); y += 34;

            // ── Puerto ──
            Controls.Add(Etiqueta("Puerto COM del GPS o girocompás", 20, y)); y += 22;
            cmbPuerto = new ComboBox();
            cmbPuerto.DropDownStyle = ComboBoxStyle.DropDown;
            cmbPuerto.SetBounds(20, y, 160, 26);
            Controls.Add(cmbPuerto);

            Button btnBuscar = new Button();
            btnBuscar.Text = "Buscar puertos";
            btnBuscar.SetBounds(190, y - 1, 120, 28);
            btnBuscar.Click += delegate { CargarPuertos(); };
            Controls.Add(btnBuscar);

            Controls.Add(Etiqueta("Velocidad", 325, y - 22));
            cmbBaudios = new ComboBox();
            cmbBaudios.DropDownStyle = ComboBoxStyle.DropDownList;
            cmbBaudios.SetBounds(325, y, 100, 26);
            cmbBaudios.Items.AddRange(new object[] { 4800, 9600, 19200, 38400, 57600, 115200 });
            cmbBaudios.SelectedItem = cfg.Baudios;
            if (cmbBaudios.SelectedIndex < 0) cmbBaudios.SelectedItem = 4800;
            Controls.Add(cmbBaudios);

            Controls.Add(Etiqueta("Cada", 440, y - 22));
            cmbIntervalo = new ComboBox();
            cmbIntervalo.DropDownStyle = ComboBoxStyle.DropDownList;
            cmbIntervalo.SetBounds(440, y, 80, 26);
            cmbIntervalo.Items.AddRange(new object[] { "1 min", "2 min", "5 min", "10 min", "15 min" });
            cmbIntervalo.SelectedItem = cfg.IntervaloMin + " min";
            if (cmbIntervalo.SelectedIndex < 0) cmbIntervalo.SelectedIndex = 0;
            Controls.Add(cmbIntervalo);
            y += 38;

            CargarPuertos();

            // ── Estado ──
            GroupBox g = new GroupBox();
            g.Text = "Estado";
            g.SetBounds(20, y, 500, 108);
            Controls.Add(g);

            lblEstadoPuerto = new Label();
            lblEstadoPuerto.SetBounds(14, 24, 470, 20);
            g.Controls.Add(lblEstadoPuerto);

            lblPos = new Label();
            lblPos.SetBounds(14, 48, 470, 20);
            lblPos.Font = new Font("Consolas", 9f);
            g.Controls.Add(lblPos);

            lblEstadoEnvio = new Label();
            lblEstadoEnvio.SetBounds(14, 74, 470, 20);
            g.Controls.Add(lblEstadoEnvio);
            y += 118;

            // ── NMEA crudo ──
            Controls.Add(Etiqueta("Lo que llega por el puerto (para diagnosticar)", 20, y)); y += 22;
            txtCrudo = new TextBox();
            txtCrudo.Multiline = true;
            txtCrudo.ScrollBars = ScrollBars.Vertical;
            txtCrudo.ReadOnly = true;
            txtCrudo.Font = new Font("Consolas", 8.5f);
            txtCrudo.BackColor = Color.FromArgb(250, 250, 250);
            txtCrudo.SetBounds(20, y, 500, 150);
            Controls.Add(txtCrudo);
            y += 160;

            chkAuto = new CheckBox();
            chkAuto.Text = "Arrancar automáticamente con Windows";
            chkAuto.Checked = cfg.ArrancarConWindows;
            chkAuto.SetBounds(20, y, 320, 24);
            Controls.Add(chkAuto);

            chkSinCifrar = new CheckBox();
            chkSinCifrar.Text = "Conectar sin cifrado (solo si falla el diagnóstico de TLS)";
            chkSinCifrar.Checked = cfg.SinCifrar;
            chkSinCifrar.ForeColor = Color.Firebrick;
            chkSinCifrar.SetBounds(20, y + 26, 420, 24);
            Controls.Add(chkSinCifrar);

            btnGuardar = new Button();
            btnGuardar.Text = "Guardar y aplicar";
            btnGuardar.SetBounds(360, y + 16, 160, 32);
            btnGuardar.Click += OnGuardar;
            Controls.Add(btnGuardar);

            // Cerrar la ventana no cierra el agente: sigue en la bandeja.
            FormClosing += delegate(object s, FormClosingEventArgs e)
            {
                if (e.CloseReason == CloseReason.UserClosing)
                {
                    e.Cancel = true;
                    Hide();
                }
            };
        }

        static Label Etiqueta(string texto, int x, int y)
        {
            Label l = new Label();
            l.Text = texto;
            l.SetBounds(x, y, 300, 18);
            l.ForeColor = Color.FromArgb(60, 60, 60);
            return l;
        }

        void CargarPuertos()
        {
            string actual = cmbPuerto.Text;
            cmbPuerto.Items.Clear();
            try
            {
                string[] p = SerialPort.GetPortNames();
                Array.Sort(p);
                cmbPuerto.Items.AddRange(p);
            }
            catch { }
            if (!string.IsNullOrEmpty(cfg.Puerto)) cmbPuerto.Text = cfg.Puerto;
            else if (!string.IsNullOrEmpty(actual)) cmbPuerto.Text = actual;
            else if (cmbPuerto.Items.Count > 0) cmbPuerto.SelectedIndex = 0;
        }

        void OnVerificar(object s, EventArgs e)
        {
            string token = txtToken.Text.Trim();
            if (token.Length == 0)
            {
                lblBarco.ForeColor = Color.Firebrick;
                lblBarco.Text = "Pegá el código del barco.";
                return;
            }
            btnVerificar.Enabled = false;
            lblBarco.ForeColor = Color.Gray;
            lblBarco.Text = "Verificando...";
            Application.DoEvents();

            string nombre, slug, err;
            if (Panel.Identificar(token, out nombre, out slug, out err))
            {
                cfg.Barco = nombre; cfg.Slug = slug;
                lblBarco.ForeColor = Color.SeaGreen;
                lblBarco.Text = "Barco: " + nombre;
            }
            else
            {
                lblBarco.ForeColor = Color.Firebrick;
                lblBarco.Text = err;
            }
            btnVerificar.Enabled = true;
        }

        void OnGuardar(object s, EventArgs e)
        {
            cfg.Token = txtToken.Text.Trim();
            cfg.Puerto = cmbPuerto.Text.Trim();
            cfg.Baudios = (int)cmbBaudios.SelectedItem;
            string iv = (string)cmbIntervalo.SelectedItem;
            cfg.IntervaloMin = int.Parse(iv.Split(' ')[0]);
            cfg.ArrancarConWindows = chkAuto.Checked;
            cfg.SinCifrar = chkSinCifrar.Checked;
            Panel.UsarSinCifrar(cfg.SinCifrar);

            cfg.Guardar();
            cfg.AplicarAutoarranque();

            // Reiniciar el agente para tomar puerto y velocidad nuevos.
            agente.Detener();
            Thread.Sleep(300);
            agente.Arrancar();

            MessageBox.Show(this,
                "Configuración guardada.\n\nEl agente ya está reportando en segundo plano. " +
                "Podés cerrar esta ventana: queda funcionando en el área de notificación, " +
                "al lado del reloj.",
                "ELETEK", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        void OnLinea(string linea)
        {
            if (IsDisposed || !Visible) return;
            try
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    if (txtCrudo.Lines.Length > 200) txtCrudo.Clear();
                    txtCrudo.AppendText(linea + Environment.NewLine);
                });
            }
            catch { }
        }

        void Refrescar()
        {
            if (!Visible) return;
            lblEstadoPuerto.Text = "Puerto: " + agente.EstadoPuerto + "   ·   " +
                                   agente.LineasLeidas + " líneas leídas";

            Fix f = agente.FixActual;
            if (f.TienePos)
            {
                string txt = f.Lat.ToString("F5", CultureInfo.InvariantCulture) + ", " +
                             f.Lon.ToString("F5", CultureInfo.InvariantCulture);
                if (f.VelocidadNudos.HasValue) txt += "   " + f.VelocidadNudos.Value.ToString("F1") + " nudos";
                if (f.RumboGrados.HasValue) txt += "   rumbo " + f.RumboGrados.Value.ToString("F0") + "°";
                if (f.ProaGrados.HasValue) txt += "   proa " + f.ProaGrados.Value.ToString("F0") + "°";
                lblPos.ForeColor = Color.SeaGreen;
                lblPos.Text = txt;
            }
            else
            {
                lblPos.ForeColor = Color.Gray;
                lblPos.Text = "Sin posición todavía";
            }

            lblEstadoEnvio.Text = "Envío: " + agente.EstadoEnvio;
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    //  Programa
    // ─────────────────────────────────────────────────────────────────────

    static class Program
    {
        // El programa se compila como aplicación de ventanas, así que no trae
        // consola. Para los modos /diag y /probar hay que engancharse a la de
        // quien lo llamó, o crear una propia si se abrió con doble clic.
        [System.Runtime.InteropServices.DllImport("kernel32.dll")]
        static extern bool AttachConsole(int dwProcessId);
        [System.Runtime.InteropServices.DllImport("kernel32.dll")]
        static extern bool AllocConsole();

        static void AbrirConsola()
        {
            try { if (!AttachConsole(-1)) AllocConsole(); } catch { }
        }

        static NotifyIcon bandeja;
        static VentanaConfig ventana;
        static Agente agente;
        static Config cfg;

        [STAThread]
        static void Main(string[] args)
        {
            // Los modos de diagnóstico van antes del control de instancia única:
            // tienen que poder correr con el agente ya funcionando, que es
            // justamente cuando hacen falta.
            if (args.Length > 0 && args[0] == "/diag")
            {
                cfg = Config.Cargar();
                Panel.UsarSinCifrar(cfg.SinCifrar);
                Diagnostico();
                return;
            }
            if (args.Length > 0 && args[0] == "/probar")
            {
                cfg = Config.Cargar();
                AbrirConsola();
                Probar(args);
                return;
            }

            // Una sola instancia: si arranca con Windows y alguien lo abre a
            // mano, no queremos dos procesos peleando por el puerto serie.
            bool nuevo;
            Mutex mutex = new Mutex(true, "Global\\EletekGPS_Agente", out nuevo);
            if (!nuevo)
            {
                MessageBox.Show("El agente GPS ya está corriendo.\n\nMiralo en el área de notificación, al lado del reloj.",
                    "ELETEK", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            cfg = Config.Cargar();
            Panel.UsarSinCifrar(cfg.SinCifrar);
            agente = new Agente(cfg);

            // Modo consola para probar sin interfaz: EletekGPS.exe /probar COM3 4800


            bool oculto = false;
            foreach (string a in args) if (a == "/oculto") oculto = true;

            ventana = new VentanaConfig(cfg, agente);
            ArmarBandeja();

            agente.Arrancar();

            // Si nunca se configuró, mostrar la ventana aunque haya arrancado
            // oculto: sin token y sin puerto no puede hacer nada.
            bool sinConfigurar = string.IsNullOrEmpty(cfg.Token) || string.IsNullOrEmpty(cfg.Puerto);
            if (!oculto || sinConfigurar) ventana.Show();

            Application.Run();

            agente.Detener();
            if (bandeja != null) bandeja.Visible = false;
            GC.KeepAlive(mutex);
        }

        static void ArmarBandeja()
        {
            ContextMenu menu = new ContextMenu();
            menu.MenuItems.Add("Abrir configuración", delegate { ventana.Show(); ventana.BringToFront(); });
            menu.MenuItems.Add("Ver registro", delegate
            {
                try { System.Diagnostics.Process.Start("notepad.exe", Log.Ruta); }
                catch { MessageBox.Show("Todavía no hay registro."); }
            });
            menu.MenuItems.Add("-");
            menu.MenuItems.Add("Salir", delegate
            {
                if (MessageBox.Show("Si salís, el barco deja de reportar su posición.\n\n¿Salir igual?",
                        "ELETEK", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                    Application.Exit();
            });

            bandeja = new NotifyIcon();
            bandeja.Icon = SystemIcons.Application;
            bandeja.Text = "ELETEK — Agente GPS";
            bandeja.ContextMenu = menu;
            bandeja.Visible = true;
            bandeja.DoubleClick += delegate { ventana.Show(); ventana.BringToFront(); };
        }

        /// Prueba la conexión paso a paso y deja el resultado en un archivo,
        /// que se abre solo en el Bloc de notas. No depende de tener consola.
        public static void Diagnostico()
        {
            StringBuilder o = new StringBuilder();
            Action<string> D = delegate(string t) { o.AppendLine(t); };

            D("=== DIAGNOSTICO DE CONEXION - ELETEK ===");
            D(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
            D("Servidor: " + Panel.Dominio);
            D("Windows : " + Environment.OSVersion.VersionString);
            D(".NET    : " + Environment.Version);
            D("");

            string host = "panel.tu-dominio.com";
            bool corto = false;

            D("1) Resolver el nombre del servidor (DNS)");
            System.Net.IPAddress[] ips = null;
            try
            {
                ips = Dns.GetHostAddresses(host);
                foreach (System.Net.IPAddress ip in ips) D("   OK  -> " + ip);
            }
            catch (Exception e)
            {
                D("   FALLA: " + e.Message);
                D("");
                D("   >> La PC no puede resolver nombres.");
                D("      Revisar que este conectada al WiFi del barco.");
                corto = true;
            }

            if (!corto)
            {
                D("");
                D("2) Abrir el puerto 443 (TCP)");
                try
                {
                    using (System.Net.Sockets.TcpClient t = new System.Net.Sockets.TcpClient())
                    {
                        IAsyncResult ar = t.BeginConnect(ips[0], 443, null, null);
                        if (!ar.AsyncWaitHandle.WaitOne(10000)) throw new Exception("tiempo agotado");
                        t.EndConnect(ar);
                        D("   OK  -> conectado a " + ips[0] + ":443");
                    }
                }
                catch (Exception e)
                {
                    D("   FALLA: " + e.Message);
                    D("");
                    D("   >> Resuelve el nombre pero no llega al puerto.");
                    D("      Falta el walled-garden en el MikroTik.");
                    corto = true;
                }
            }

            if (!corto)
            {
                D("");
                D("3) Negociar TLS");
                D("   ServicePointManager.SecurityProtocol = " + ServicePointManager.SecurityProtocol);
                D("   (Tls12 tiene que figurar en esa lista)");
                D("");

                bool alguna = false;
                int[] vals = new int[] { 3072, 768, 192 };
                string[] nombres = new string[] { "TLS 1.2", "TLS 1.1", "TLS 1.0" };

                for (int i = 0; i < vals.Length; i++)
                {
                    try
                    {
                        using (System.Net.Sockets.TcpClient t = new System.Net.Sockets.TcpClient(host, 443))
                        using (System.Net.Security.SslStream ssl = new System.Net.Security.SslStream(t.GetStream(), false))
                        {
                            ssl.AuthenticateAsClient(host, null,
                                (System.Security.Authentication.SslProtocols)vals[i], false);
                            D("   " + nombres[i] + ": OK  (negociado " + ssl.SslProtocol + ")");
                            if (vals[i] == 3072)
                            {
                                alguna = true;
                                System.Security.Cryptography.X509Certificates.X509Certificate2 c =
                                    new System.Security.Cryptography.X509Certificates.X509Certificate2(ssl.RemoteCertificate);
                                D("        certificado emitido por: " + c.Issuer);
                                D("        vence: " + c.NotAfter);
                            }
                        }
                    }
                    catch (Exception e)
                    {
                        string causa = e.Message;
                        Exception inner = e.InnerException;
                        while (inner != null) { causa = inner.Message; inner = inner.InnerException; }
                        D("   " + nombres[i] + ": FALLA - " + causa);
                    }
                }

                D("");
                if (!alguna)
                {
                    D("   >> La PC NO puede negociar TLS 1.2 con el servidor.");
                    D("      El servidor solo acepta TLS 1.2 y 1.3.");
                    D("      MANDAR ESTE ARCHIVO ENTERO.");
                    corto = true;
                }
                else
                {
                    D("   >> TLS 1.2 funciona. El certificado se valida bien.");
                }
            }

            if (!corto)
            {
                D("");
                D("4) Hablar con el panel (HTTPS)");
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(Panel.Dominio + "/api/v1/identificar");
                    req.Timeout = 20000;
                    req.UserAgent = "EletekGPS/diag";
                    try { using (req.GetResponse()) { D("   OK  -> respondio"); } }
                    catch (WebException we2)
                    {
                        HttpWebResponse hr = we2.Response as HttpWebResponse;
                        if (hr != null) D("   OK  -> el servidor respondio " + (int)hr.StatusCode + " (401 es lo esperado sin codigo)");
                        else throw;
                    }
                    D("");
                    D("=== TODO OK: la PC PUEDE hablar con el panel ===");
                    D("Si el programa igual falla, el problema es el codigo del barco.");
                }
                catch (Exception e)
                {
                    D("   FALLA: " + e.Message);
                    Exception inner = e.InnerException;
                    while (inner != null) { D("          causa: " + inner.Message); inner = inner.InnerException; }
                    D("");
                    D("   MANDAR ESTE ARCHIVO ENTERO.");
                }
            }

            string ruta = Path.Combine(Config.Carpeta, "diagnostico.txt");
            try
            {
                Directory.CreateDirectory(Config.Carpeta);
                File.WriteAllText(ruta, o.ToString());
                System.Diagnostics.Process.Start("notepad.exe", ruta);
            }
            catch
            {
                MessageBox.Show(o.ToString(), "Diagnostico ELETEK");
            }
        }

        // Modo consola: sirve para verificar el puerto sin tocar la interfaz.
        static void Probar(string[] args)
        {
            string puerto = args.Length > 1 ? args[1] : cfg.Puerto;
            int baud = cfg.Baudios;
            if (args.Length > 2) int.TryParse(args[2], out baud);

            Console.WriteLine("Escuchando " + puerto + " a " + baud + " baudios. Ctrl+C para cortar.");
            Fix f = new Fix();
            try
            {
                using (SerialPort sp = new SerialPort(puerto, baud, Parity.None, 8, StopBits.One))
                {
                    sp.ReadTimeout = 5000;
                    sp.Open();
                    while (true)
                    {
                        string l;
                        try { l = sp.ReadLine(); }
                        catch (TimeoutException) { Console.WriteLine("(sin datos)"); continue; }
                        l = l.Trim();
                        if (l.Length == 0) continue;
                        bool util = Nmea.Procesar(l, f);
                        Console.WriteLine((util ? "[ok] " : "     ") + l);
                        if (f.TienePos)
                            Console.WriteLine("      -> " + f.Lat.ToString("F5", CultureInfo.InvariantCulture)
                                + ", " + f.Lon.ToString("F5", CultureInfo.InvariantCulture));
                    }
                }
            }
            catch (Exception e) { Console.WriteLine("Error: " + e.Message); }
        }
    }
}
