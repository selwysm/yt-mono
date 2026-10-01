#!/usr/bin/env node
/**
 * APAGADOR: finaliza TODO lo que este en vivo en YouTube y Zoom, una y otra
 * vez, durante un periodo.
 *
 *   npm run apagar                          cada 5 s durante 60 min
 *   npm run apagar -- --minutos 30 --cada 10
 *
 * Revisa en cada vuelta:
 *   - YouTube: transmisiones EN VIVO de TODAS las cuentas de backend/tokens
 *   - Zoom:    reuniones EN VIVO
 *   - Zoom:    webinars en curso
 *   - Meet:    llamadas EN VIVO de TODAS las cuentas de backend-meet/tokens
 *              (solo se pueden cortar las salas creadas por backend-meet;
 *              las creadas a mano se avisan en el log)
 *
 * Reutiliza las funciones de ../backend, ../backend-zoom y ../backend-meet
 * (no las modifica).
 * Ctrl+C lo detiene y muestra el resumen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(__dirname, '..', '..');

// Los dos proyectos usan `import 'dotenv/config'`, que lee el .env de la
// carpeta actual. Desde aqui no lo encontrarian: los cargamos a mano.
process.loadEnvFile(path.join(RAIZ, 'backend', '.env'));
process.loadEnvFile(path.join(RAIZ, 'backend-zoom', '.env'));

const yt = await import('../../backend/src/index.js');
const zm = await import('../../backend-zoom/src/index.js');
const { explicarError: errorYouTube } = await import('../../backend/src/errores.js');
const { explicarError: errorZoom } = await import('../../backend-zoom/src/errores.js');

// Meet es opcional: si el proyecto no esta instalado, el apagador sigue sin el.
// Usa las mismas GOOGLE_* de backend/.env, ya cargadas arriba.
let gm = null;
let errorMeet = (e) => e?.message ?? String(e);
try {
  gm = await import('../../backend-meet/src/index.js');
  ({ explicarError: errorMeet } = await import('../../backend-meet/src/errores.js'));
} catch (err) {
  console.error(`Meet desactivado: no se pudo cargar backend-meet (${err.message}).`);
}

/* ------------------------------------------------------------------ */
/* Opciones                                                            */
/* ------------------------------------------------------------------ */

function opcion(nombre, porDefecto) {
  const args = process.argv.slice(2);
  const i = args.indexOf(`--${nombre}`);
  if (i < 0) return porDefecto;
  const v = Number(args[i + 1]);
  if (!Number.isFinite(v) || v <= 0) {
    console.error(`\n--${nombre} debe ser un numero mayor que 0\n`);
    process.exit(1);
  }
  return v;
}

const MINUTOS = opcion('minutos', 60);
const CADA_MS = opcion('cada', 5) * 1000;
const FIN = Date.now() + MINUTOS * 60_000;

// Tras finalizar una reunion de Zoom la saltamos un rato: la API puede seguir
// mostrandola en vivo unos segundos. No es permanente porque el mismo ID de
// reunion (p.ej. una recurrente o la sala personal) se puede volver a iniciar.
const ESPERA_ZOOM_MS = 30_000;

/* ------------------------------------------------------------------ */
/* Log                                                                 */
/* ------------------------------------------------------------------ */

const DIR_LOGS = path.join(__dirname, '..', 'logs');
fs.mkdirSync(DIR_LOGS, { recursive: true });
const ARCHIVO_LOG = path.join(DIR_LOGS, `apagador-${new Date().toISOString().slice(0, 10)}.log`);

function hora() {
  return new Date().toLocaleTimeString('es-CO', { hour12: false });
}

function log(texto, { error = false } = {}) {
  const linea = `[${hora()}] ${texto}`;
  (error ? console.error : console.log)(linea);
  fs.appendFileSync(ARCHIVO_LOG, `${new Date().toISOString()}  ${texto}\n`);
}

// Un mismo error repetido cada 5 s llenaria la pantalla: se muestra una vez.
const erroresVistos = new Set();
function logErrorUnaVez(clave, texto) {
  if (erroresVistos.has(clave)) return;
  erroresVistos.add(clave);
  log(texto, { error: true });
}

/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */

const finalizadosYouTube = new Set();   // un broadcast completado no vuelve a vivo
const saltarZoomHasta = new Map();      // id -> timestamp
const resumen = { youtube: [], zoom: [], webinars: [], meet: [], vueltas: 0 };

function saltandoZoom(id) {
  const hasta = saltarZoomHasta.get(String(id));
  return hasta && Date.now() < hasta;
}

/* ------------------------------------------------------------------ */
/* YouTube                                                             */
/* ------------------------------------------------------------------ */

async function apagarYouTube() {
  const grupos = await yt.listarEnTodasLasCuentas('active');

  for (const g of grupos) {
    const canal = g.cuenta.canal?.titulo ?? g.cuenta.nombre;
    if (g.error) {
      logErrorUnaVez(`yt-cuenta-${g.cuenta.slug}`,
        `YouTube [${canal}] no se pudo consultar: ${errorYouTube(g.error).split('\n')[0]}`);
      continue;
    }

    for (const b of g.transmisiones) {
      if (finalizadosYouTube.has(b.id)) continue;
      try {
        await yt.finalizarTransmision(b.id, g.cuenta.slug);
        finalizadosYouTube.add(b.id);
        resumen.youtube.push({ id: b.id, titulo: b.snippet?.title, canal, hora: hora() });
        log(`YouTube FINALIZADA  [${canal}]  ${b.snippet?.title}  (${b.id})`);
      } catch (err) {
        logErrorUnaVez(`yt-${b.id}-${err.message}`,
          `YouTube [${canal}] no se pudo finalizar ${b.id}: ${errorYouTube(err).split('\n')[0]}`);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Zoom: reuniones                                                     */
/* ------------------------------------------------------------------ */

async function apagarReunionesZoom() {
  const vivas = await zm.listarTransmisiones('live');

  for (const m of vivas) {
    if (saltandoZoom(m.id)) continue;
    try {
      await zm.finalizarTransmision(m.id);
      saltarZoomHasta.set(String(m.id), Date.now() + ESPERA_ZOOM_MS);
      resumen.zoom.push({ id: m.id, titulo: m.topic, hora: hora() });
      log(`Zoom reunion FINALIZADA  ${m.topic}  (${m.id})`);
    } catch (err) {
      logErrorUnaVez(`zm-${m.id}-${err.message}`,
        `Zoom no se pudo finalizar la reunion ${m.id}: ${errorZoom(err).split('\n')[0]}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Zoom: webinars                                                      */
/* ------------------------------------------------------------------ */

// Zoom no tiene filtro "en vivo" para webinars en /users/{id}/webinars.
// 1. Si la cuenta tiene Dashboard (Business+), /metrics/webinars?type=live
//    los da directo.
// 2. Si no, se intenta finalizar cada webinar proximo cuya hora este cerca de
//    ahora: el host puede iniciarlo antes de la hora o arrancar tarde.
//    Los que no estan en curso responden "no esta en curso" y se ignoran.
let usarDashboard = true;
const VENTANA_ANTES_MS = 12 * 60 * 60_000;  // empezaron hasta hace 12 h
const VENTANA_DESPUES_MS = 2 * 60 * 60_000; // o empiezan dentro de 2 h

async function webinarsCandidatos() {
  if (usarDashboard) {
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      const data = await zm.zoom('GET', `/metrics/webinars?type=live&from=${hoy}&to=${hoy}&page_size=300`);
      return { seguros: true, lista: data?.webinars ?? [] };
    } catch {
      usarDashboard = false;
      log('Zoom: el Dashboard de webinars no esta disponible; se revisaran los webinars programados cerca de esta hora.');
    }
  }

  const ahora = Date.now();
  const proximos = await zm.listarWebinars({ cuando: 'proximos' });
  const lista = proximos.filter((w) => {
    if (!w.start_time) return true; // recurrentes sin hora fija
    const t = new Date(w.start_time).getTime();
    return t >= ahora - VENTANA_ANTES_MS && t <= ahora + VENTANA_DESPUES_MS;
  });
  return { seguros: false, lista };
}

async function apagarWebinarsZoom() {
  const { seguros, lista } = await webinarsCandidatos();

  for (const w of lista) {
    if (saltandoZoom(w.id)) continue;
    try {
      await zm.finalizarWebinar(w.id);
      saltarZoomHasta.set(String(w.id), Date.now() + ESPERA_ZOOM_MS);
      resumen.webinars.push({ id: w.id, titulo: w.topic, hora: hora() });
      log(`Zoom webinar FINALIZADO  ${w.topic}  (${w.id})`);
    } catch (err) {
      const noEstabaEnVivo = /no esta en curso/i.test(err.message);
      if (noEstabaEnVivo && !seguros) continue; // normal al probar candidatos
      logErrorUnaVez(`wb-${w.id}-${err.message}`,
        `Zoom no se pudo finalizar el webinar ${w.id}: ${errorZoom(err).split('\n')[0]}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Google Meet                                                         */
/* ------------------------------------------------------------------ */

// La API solo deja finalizar salas creadas por backend-meet. Las creadas a mano
// se intentan UNA vez; si Google lo rechaza, se avisa y no se reintentan.
// Las de la app se saltan un rato tras cortarlas (la sala fija se reutiliza).
const saltarMeetHasta = new Map();   // spaceName -> timestamp
const meetNoFinalizables = new Set(); // spaceName de salas creadas a mano

async function apagarMeet() {
  if (!gm) return;
  const grupos = await gm.listarEnVivoEnTodasLasCuentas();

  for (const g of grupos) {
    const cuenta = g.cuenta.email ?? g.cuenta.nombre;
    if (g.error) {
      logErrorUnaVez(`gm-cuenta-${g.cuenta.slug}`,
        `Meet [${cuenta}] no se pudo consultar: ${errorMeet(g.error).split('\n')[0]}`);
      continue;
    }

    for (const r of g.items) {
      const codigo = r.sala?.meetingCode ?? r.spaceName;
      if (meetNoFinalizables.has(r.spaceName)) continue;
      const hasta = saltarMeetHasta.get(r.spaceName);
      if (hasta && Date.now() < hasta) continue;

      try {
        await gm.finalizarReunion(r.spaceName, g.cuenta.slug);
        saltarMeetHasta.set(r.spaceName, Date.now() + ESPERA_ZOOM_MS);
        resumen.meet.push({ id: codigo, titulo: r.titulo ?? codigo, cuenta, hora: hora() });
        log(`Meet FINALIZADA  [${cuenta}]  ${r.titulo ?? codigo}  (${codigo})`);
      } catch (err) {
        const denegado = err?.response?.data?.error?.status === 'PERMISSION_DENIED';
        if (!r.deLaApp && denegado) {
          meetNoFinalizables.add(r.spaceName);
          log(`Meet MANUAL EN VIVO  [${cuenta}]  ${codigo}: la API no puede finalizarla. ` +
              'Cortala en Meet con "Finalizar la llamada para todos".', { error: true });
        } else {
          logErrorUnaVez(`gm-${r.spaceName}-${err.message}`,
            `Meet [${cuenta}] no se pudo finalizar ${codigo}: ${errorMeet(err).split('\n')[0]}`);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Ciclo                                                               */
/* ------------------------------------------------------------------ */

async function paso(nombre, fn) {
  try {
    await fn();
  } catch (err) {
    const explicar = nombre === 'YouTube' ? errorYouTube : nombre === 'Meet' ? errorMeet : errorZoom;
    logErrorUnaVez(`${nombre}-${err.message}`, `${nombre}: ${explicar(err).split('\n')[0]}`);
  }
}

async function vuelta() {
  resumen.vueltas++;
  // Cada plataforma por separado: si una falla, la otra sigue.
  await Promise.all([
    paso('YouTube', apagarYouTube),
    paso('Zoom reuniones', apagarReunionesZoom),
    paso('Zoom webinars', apagarWebinarsZoom),
    paso('Meet', apagarMeet),
  ]);
}

function mostrarResumen() {
  const total = resumen.youtube.length + resumen.zoom.length + resumen.webinars.length + resumen.meet.length;
  console.log(`\n=== Resumen: ${resumen.vueltas} vuelta(s), ${total} finalizada(s) ===`);
  for (const t of resumen.youtube) console.log(`  ${t.hora}  YouTube  [${t.canal}]  ${t.titulo}  (${t.id})`);
  for (const t of resumen.zoom) console.log(`  ${t.hora}  Zoom     ${t.titulo}  (${t.id})`);
  for (const t of resumen.webinars) console.log(`  ${t.hora}  Webinar  ${t.titulo}  (${t.id})`);
  for (const t of resumen.meet) console.log(`  ${t.hora}  Meet     [${t.cuenta}]  ${t.titulo}  (${t.id})`);
  console.log(`\nLog: ${ARCHIVO_LOG}\n`);
  fs.appendFileSync(ARCHIVO_LOG,
    `${new Date().toISOString()}  FIN: ${resumen.vueltas} vueltas, ${total} finalizadas\n`);
}

let temporizador = null;

process.on('SIGINT', () => {
  clearTimeout(temporizador);
  log('Detenido con Ctrl+C.');
  mostrarResumen();
  process.exit(0);
});

// setTimeout encadenado (no setInterval): si una vuelta tarda mas que el
// intervalo, la siguiente espera a que termine en vez de encimarse.
async function ciclo() {
  const inicio = Date.now();
  await vuelta();
  if (Date.now() >= FIN) {
    log('Tiempo cumplido.');
    mostrarResumen();
    process.exit(0);
  }
  temporizador = setTimeout(ciclo, Math.max(0, CADA_MS - (Date.now() - inicio)));
}

const cuentas = yt.listarCuentas();
const horaFin = new Date(FIN).toLocaleTimeString('es-CO', { hour12: false });
log(`Apagador iniciado: cada ${CADA_MS / 1000} s durante ${MINUTOS} min (hasta las ${horaFin}).`);
log(`YouTube: ${cuentas.length} cuenta(s): ${cuentas.map((c) => c.canal?.titulo ?? c.nombre).join(', ') || '(ninguna)'}`);
log(`Zoom: usuario ${zm.usuario()} (reuniones y webinars).`);
if (gm) {
  const cuentasMeet = gm.listarCuentas();
  log(`Meet: ${cuentasMeet.length} cuenta(s): ${cuentasMeet.map((c) => c.email ?? c.nombre).join(', ') || '(ninguna, agregalas en backend-meet)'}`);
}
log('Ctrl+C para detener.');

ciclo();
