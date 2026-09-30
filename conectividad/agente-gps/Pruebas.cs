// Pruebas del parser NMEA y del envío al panel.
// Se compila junto con EletekGPS.cs eligiendo este Main con /main.

using System;
using System.Globalization;

namespace Eletek.Gps
{
    static class Pruebas
    {
        static int ok = 0, fallos = 0;

        static void Afirmar(string que, bool condicion, string detalle)
        {
            if (condicion) { ok++; Console.WriteLine("  OK    " + que); }
            else { fallos++; Console.WriteLine("  FALLA " + que + "   " + detalle); }
        }

        static void Cerca(string que, double? valor, double esperado, double tolerancia)
        {
            if (!valor.HasValue) { fallos++; Console.WriteLine("  FALLA " + que + "   (sin valor)"); return; }
            double d = Math.Abs(valor.Value - esperado);
            Afirmar(que, d <= tolerancia,
                "esperaba " + esperado.ToString(CultureInfo.InvariantCulture) +
                " y dio " + valor.Value.ToString(CultureInfo.InvariantCulture));
        }

        /// Arma una sentencia con el checksum correcto.
        static string Con(string cuerpo)
        {
            int c = 0;
            foreach (char ch in cuerpo) c ^= ch;
            return "$" + cuerpo + "*" + c.ToString("X2");
        }

        static void Main()
        {
            Console.WriteLine("== Checksum ==");
            Afirmar("acepta uno correcto", Nmea.ChecksumOk(Con("GPRMC,123519,A,3802.9568,S,05733.5366,W,5.4,82.3,140926,,,A")), "");
            Afirmar("rechaza uno alterado", !Nmea.ChecksumOk("$GPRMC,123519,A,3802.9568,S,05733.5366,W,5.4,82.3,140926,,,A*00"), "");
            Afirmar("rechaza basura", !Nmea.ChecksumOk("cualquier cosa"), "");
            Afirmar("rechaza vacio", !Nmea.ChecksumOk(""), "");

            Console.WriteLine();
            Console.WriteLine("== Coordenadas (hemisferio sur y oeste) ==");
            Cerca("latitud sur es negativa", Nmea.Coord("3802.9568", "S"), -38.049280, 0.00001);
            Cerca("longitud oeste es negativa", Nmea.Coord("05733.5366", "W"), -57.558943, 0.00001);
            Cerca("latitud norte es positiva", Nmea.Coord("4450.3998", "N"), 44.839997, 0.00001);
            Cerca("longitud este es positiva", Nmea.Coord("02024.3520", "E"), 20.405867, 0.00001);
            Afirmar("rechaza vacio", !Nmea.Coord("", "S").HasValue, "");
            Afirmar("rechaza sin hemisferio", !Nmea.Coord("3802.9568", "").HasValue, "");

            Console.WriteLine();
            Console.WriteLine("== RMC ==");
            Fix f = new Fix();
            bool r = Nmea.Procesar(Con("GPRMC,123519,A,3802.9568,S,05733.5366,W,5.4,82.3,140926,,,A"), f);
            Afirmar("acepta un RMC valido", r, "");
            Cerca("latitud", f.Lat, -38.049280, 0.00001);
            Cerca("longitud", f.Lon, -57.558943, 0.00001);
            Cerca("velocidad en nudos", f.VelocidadNudos, 5.4, 0.001);
            Cerca("rumbo", f.RumboGrados, 82.3, 0.001);

            Fix f2 = new Fix();
            bool r2 = Nmea.Procesar(Con("GPRMC,123519,V,3802.9568,S,05733.5366,W,5.4,82.3,140926,,,N"), f2);
            Afirmar("ignora RMC marcado invalido (V)", !r2 && !f2.TienePos, "");

            Fix f3 = new Fix();
            Nmea.Procesar("$GPRMC,123519,A,3802.9568,S,05733.5366,W,5.4,82.3,140926,,,A*11", f3);
            Afirmar("ignora RMC con checksum malo", !f3.TienePos, "");

            Console.WriteLine();
            Console.WriteLine("== GGA ==");
            Fix g = new Fix();
            bool rg = Nmea.Procesar(Con("GPGGA,123519,3802.9568,S,05733.5366,W,1,08,0.9,10.4,M,33.9,M,,"), g);
            Afirmar("acepta GGA con fix", rg && g.TienePos, "");
            Cerca("latitud", g.Lat, -38.049280, 0.00001);

            Fix g0 = new Fix();
            Nmea.Procesar(Con("GPGGA,123519,3802.9568,S,05733.5366,W,0,00,99.9,,M,,M,,"), g0);
            Afirmar("ignora GGA sin fix (calidad 0)", !g0.TienePos, "");

            Console.WriteLine();
            Console.WriteLine("== Otras sentencias ==");
            Fix h = new Fix();
            Nmea.Procesar(Con("HEHDT,187.4,T"), h);
            Cerca("proa del girocompas (HDT)", h.ProaGrados, 187.4, 0.001);

            Fix hg = new Fix();
            Nmea.Procesar(Con("HEHDG,205.1,,,10.2,E"), hg);
            Cerca("proa (HDG)", hg.ProaGrados, 205.1, 0.001);

            Fix v = new Fix();
            Nmea.Procesar(Con("GPVTG,82.3,T,84.1,M,5.4,N,10.0,K,A"), v);
            Cerca("rumbo de VTG", v.RumboGrados, 82.3, 0.001);
            Cerca("velocidad de VTG", v.VelocidadNudos, 5.4, 0.001);

            Fix gl = new Fix();
            Nmea.Procesar(Con("GPGLL,3802.9568,S,05733.5366,W,123519,A"), gl);
            Afirmar("acepta GLL", gl.TienePos, "");
            Cerca("latitud de GLL", gl.Lat, -38.049280, 0.00001);

            Console.WriteLine();
            Console.WriteLine("== Talkers distintos (GN de GPS+GLONASS) ==");
            Fix gn = new Fix();
            Nmea.Procesar(Con("GNRMC,123519,A,3802.9568,S,05733.5366,W,5.4,82.3,140926,,,A"), gn);
            Afirmar("acepta GNRMC igual que GPRMC", gn.TienePos, "");

            Console.WriteLine();
            Console.WriteLine("== Basura y bordes ==");
            Fix b = new Fix();
            Afirmar("no explota con vacio", !Nmea.Procesar("", b), "");
            Afirmar("no explota con nulo", !Nmea.Procesar(null, b), "");
            Afirmar("no explota con texto suelto", !Nmea.Procesar("hola mundo", b), "");
            Afirmar("no explota con sentencia cortada", !Nmea.Procesar("$GPRMC,1235", b), "");
            Afirmar("no explota con solo simbolo", !Nmea.Procesar("$", b), "");
            Afirmar("ignora sentencia desconocida", !Nmea.Procesar(Con("GPZZZ,1,2,3"), b), "");
            Afirmar("tras la basura el fix sigue limpio", !b.TienePos, "");

            Console.WriteLine();
            Console.WriteLine("== Acumulacion entre sentencias ==");
            Fix acc = new Fix();
            Nmea.Procesar(Con("GPGGA,123519,3802.9568,S,05733.5366,W,1,08,0.9,10.4,M,33.9,M,,"), acc);
            Nmea.Procesar(Con("HEHDT,187.4,T"), acc);
            Nmea.Procesar(Con("GPVTG,82.3,T,84.1,M,5.4,N,10.0,K,A"), acc);
            Afirmar("junta posicion, proa y velocidad de tres sentencias",
                acc.TienePos && acc.ProaGrados.HasValue && acc.VelocidadNudos.HasValue, "");

            Console.WriteLine();
            Console.WriteLine("== Frescura ==");
            Fix fr = new Fix();
            Nmea.Procesar(Con("GPRMC,123519,A,3802.9568,S,05733.5366,W,5.4,82.3,140926,,,A"), fr);
            Afirmar("recien parseado es fresco", fr.EsFresco(300), "");
            fr.Momento = DateTime.UtcNow.AddMinutes(-10);
            Afirmar("de hace 10 min ya no es fresco", !fr.EsFresco(300), "");

            // Las pruebas de red solo corren si se apunta a un servidor.
            string url = Environment.GetEnvironmentVariable("ELETEK_URL");
            string tok = Environment.GetEnvironmentVariable("ELETEK_TOKEN");
            if (!string.IsNullOrEmpty(url) && !string.IsNullOrEmpty(tok))
            {
                Console.WriteLine();
                Console.WriteLine("== Conexion con el panel (" + url + ") ==");

                string nombre, slug, err;
                bool id = Panel.Identificar(tok, out nombre, out slug, out err);
                Afirmar("identifica el barco con el token", id, err == null ? "" : err);
                if (id) Console.WriteLine("        -> " + nombre + " (" + slug + ")");

                string n2, s2, e2;
                Afirmar("rechaza un token invalido",
                    !Panel.Identificar("token-que-no-existe", out n2, out s2, out e2), "");

                Fix env = new Fix();
                Nmea.Procesar(Con("GPRMC,123519,A,3802.9568,S,05733.5366,W,5.4,82.3,140926,,,A"), env);
                Nmea.Procesar(Con("HEHDT,187.4,T"), env);
                string e3;
                Afirmar("envia la posicion", Panel.EnviarPosicion(tok, env, out e3), e3 == null ? "" : e3);

                string e4;
                Afirmar("rechaza enviar con token malo",
                    !Panel.EnviarPosicion("token-que-no-existe", env, out e4), "");
            }

            Console.WriteLine();
            Console.WriteLine("=====================================");
            Console.WriteLine("  " + ok + " correctas, " + fallos + " fallas");
            Console.WriteLine("=====================================");
            Environment.Exit(fallos == 0 ? 0 : 1);
        }
    }
}
