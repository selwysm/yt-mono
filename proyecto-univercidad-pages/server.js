import express from "express";
import {
  createProxyMiddleware,
  responseInterceptor,
} from "http-proxy-middleware";

const app = express();
const PORT = process.env.PORT || 3000;

// --- Origen del contenido por dominio (multi-dominio) -----------------------
// El proxy elige el origen segun el dominio que entra. Cada origen debe ser
// una direccion DISTINTA al dominio que sirve el proxy (para no crear bucle).
// Se pueden sobreescribir con variables de entorno (utiles en Render).
const ORIGENES = {
  "clase.alexandramarin.co":
    process.env.ORIGIN_CLASE || "https://alexa-marin-sales-page.vercel.app",
  // Pendiente: pon aqui (o en la env ORIGIN_BR) la URL real que sirve
  // alexandramarinbr.com, p.ej. https://xxxx.vercel.app o https://xxxx.pages.dev
  "alexandramarinbr.com": process.env.ORIGIN_BR || "",
  "www.alexandramarinbr.com": process.env.ORIGIN_BR || "",
  "evento.alexandramarinbr.com": process.env.ORIGIN_BR || "",
  "rh.alexandramarinbr.com": process.env.ORIGIN_BR || "",
};

// Origen por defecto si el dominio no esta en el mapa.
const TARGET =
  process.env.TARGET || "https://alexa-marin-sales-page.vercel.app";

// Devuelve el origen segun el Host de la peticion.
const origenParaHost = (host) => {
  const h = String(host || "").toLowerCase().split(":")[0];
  return ORIGENES[h] || TARGET;
};

// --- Reemplazo del enlace de WhatsApp (JS y HTML) ---------------------------
// El enlace original viene horneado en el clon. Si defines WHATSAPP_BR, el
// proxy lo cambia al servir JS o HTML (configurable desde Render).
const WA_ORIGINAL_BR = "https://chat.whatsapp.com/JwSKJ2ZmaDmDm66iBkVtpS";
const WHATSAPP_BR = process.env.WHATSAPP_BR || "";
// GoHighLevel tambien guarda el URL escapado en el payload (\u002F).
const escapeNuxtUrl = (s) => String(s).replaceAll("/", "\\u002F");
const reemplazarWhatsApp = (texto) => {
  if (!WHATSAPP_BR || !texto.includes("JwSKJ2ZmaDmDm66iBkVtpS")) return texto;
  return texto
    .split(WA_ORIGINAL_BR)
    .join(WHATSAPP_BR)
    .split(escapeNuxtUrl(WA_ORIGINAL_BR))
    .join(escapeNuxtUrl(WHATSAPP_BR));
};

// Latencia artificial (ms) en la carga de la pagina (lado servidor).
const SERVER_DELAY_MS = Number(process.env.SERVER_DELAY_MS || 0);

// Duracion del overlay "Cargando..." al enviar el formulario (ms).
const FORM_DELAY_MS = Number(process.env.FORM_DELAY_MS || 30000);

// A donde redirigir despues de la carga lenta (siguiente paso del embudo).
const REDIRECT_TO = process.env.REDIRECT_TO || "/unirse-al-grupo";

// --- Flags y parametros para decidir CUANDO aparece la carga lenta ----------
const bool = (v, def) =>
  v === undefined ? def : /^(1|true|yes|on)$/i.test(String(v));
const parseHM = (s, def) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : def;
};

// Interruptor maestro: apaga TODA la carga lenta.
const SLOW_ENABLED = bool(process.env.SLOW_ENABLED, true);
// Flag del horario y flag del azar (independientes).
const SLOW_SCHEDULE_ENABLED = bool(process.env.SLOW_SCHEDULE_ENABLED, true);
const SLOW_RANDOM_ENABLED = bool(process.env.SLOW_RANDOM_ENABLED, true);
// Franja horaria (hora Colombia por defecto) y probabilidad del azar.
const SLOW_TZ = process.env.SLOW_TZ || "America/Bogota";
const START_MIN = parseHM(process.env.SLOW_START, 20 * 60); // 20:00
const END_MIN = parseHM(process.env.SLOW_END, 7 * 60 + 30); // 07:30
const RANDOM_PROB =
  Math.max(0, Math.min(100, Number(process.env.SLOW_RANDOM_PERCENT || 30))) /
  100;

// ---------------------------------------------------------------------------
// Script inyectado: al enviar el formulario decide si mostrar "Cargando..."
// (segun horario y/o azar). Si aplica, espera FORM_DELAY_MS y redirige.
// ---------------------------------------------------------------------------
const INYECCION = `
<script>
(function () {
  var DELAY = ${FORM_DELAY_MS};
  var DESTINO = ${JSON.stringify(REDIRECT_TO)};
  var MAESTRO = ${SLOW_ENABLED};
  var USAR_HORARIO = ${SLOW_SCHEDULE_ENABLED};
  var USAR_AZAR = ${SLOW_RANDOM_ENABLED};
  var TZ = ${JSON.stringify(SLOW_TZ)};
  var INICIO = ${START_MIN};
  var FIN = ${END_MIN};
  var PROB = ${RANDOM_PROB};

  if (!MAESTRO) return;

  var estilo = document.createElement("style");
  estilo.textContent = "@keyframes __sp{to{transform:rotate(360deg)}}";
  document.head.appendChild(estilo);

  function minutosAhora() {
    try {
      var f = new Intl.DateTimeFormat("en-GB", {
        timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit",
      });
      var h = 0, m = 0;
      f.formatToParts(new Date()).forEach(function (p) {
        if (p.type === "hour") h = parseInt(p.value, 10);
        if (p.type === "minute") m = parseInt(p.value, 10);
      });
      if (h === 24) h = 0;
      return h * 60 + m;
    } catch (e) {
      var d = new Date();
      return d.getHours() * 60 + d.getMinutes();
    }
  }

  function enHorario() {
    var t = minutosAhora();
    // Si la franja cruza medianoche (INICIO > FIN), se usa la logica OR.
    return INICIO <= FIN ? (t >= INICIO && t < FIN) : (t >= INICIO || t < FIN);
  }

  function debeAplicar() {
    var pasaHorario = USAR_HORARIO ? enHorario() : true;
    var pasaAzar = USAR_AZAR ? (Math.random() < PROB) : true;
    return pasaHorario && pasaAzar;
  }

  function mostrarCarga() {
    var o = document.createElement("div");
    o.style.cssText =
      "position:fixed;inset:0;background:rgba(255,255,255,.95);" +
      "display:flex;align-items:center;justify-content:center;" +
      "z-index:2147483647;font-family:sans-serif;color:#333";
    o.innerHTML =
      '<div style="text-align:center">' +
      '<div style="width:52px;height:52px;border:5px solid #ddd;' +
      "border-top-color:#555;border-radius:50%;margin:0 auto 18px;" +
      'animation:__sp 1s linear infinite"></div>' +
      '<p style="font-size:16px">Cargando...</p></div>';
    document.body.appendChild(o);
  }

  document.addEventListener(
    "submit",
    function (e) {
      if (!debeAplicar()) return; // fuera de las condiciones: envio normal
      e.preventDefault();
      e.stopPropagation();
      mostrarCarga();
      setTimeout(function () {
        window.location.href = DESTINO;
      }, DELAY);
    },
    true
  );
})();
</script>
`;

// Latencia artificial en la carga de la pagina.
app.use((req, res, next) => {
  if (SERVER_DELAY_MS > 0) setTimeout(next, SERVER_DELAY_MS);
  else next();
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// Solo inyectamos la carga lenta en la pagina de inicio.
const soloEnInicio = (req) => (req.url || "/").split("?")[0] === "/";

// Proxy inverso hacia el contenido real, inyectando el script en el HTML.
app.use(
  "/",
  createProxyMiddleware({
    target: TARGET,
    changeOrigin: true,
    selfHandleResponse: true,
    // Elige el origen segun el dominio que entra (multi-dominio).
    router: (req) => origenParaHost(req.headers.host),
    on: {
      proxyRes: responseInterceptor(
        async (responseBuffer, proxyRes, req, _res) => {
          const contentType = proxyRes.headers["content-type"] || "";
          const esJs = contentType.includes("javascript");
          const esHtml = contentType.includes("text/html");
          if (!esJs && !esHtml) return responseBuffer;

          let cuerpo = responseBuffer.toString("utf8");
          cuerpo = reemplazarWhatsApp(cuerpo);

          // Carga lenta solo en la home. /registro, /v-a, /v-b y /gracias
          // se sirven tal cual (salvo el cambio de WhatsApp).
          if (esHtml && soloEnInicio(req)) {
            cuerpo = cuerpo.includes("</body>")
              ? cuerpo.replace("</body>", INYECCION + "</body>")
              : cuerpo + INYECCION;
          }
          return cuerpo;
        },
      ),
    },
  }),
);

app.listen(PORT, () => {
  console.log(
    `Proxy en http://localhost:${PORT} -> ${TARGET}\n` +
      `  carga lenta: maestro=${SLOW_ENABLED} ` +
      `horario=${SLOW_SCHEDULE_ENABLED}(${process.env.SLOW_START || "20:00"}-${process.env.SLOW_END || "07:30"} ${SLOW_TZ}) ` +
      `azar=${SLOW_RANDOM_ENABLED}(${Math.round(RANDOM_PROB * 100)}%) ` +
      `delay=${FORM_DELAY_MS}ms -> ${REDIRECT_TO}\n` +
      `  whatsapp: ${WHATSAPP_BR || "(sin cambio)"}`,
  );
});
