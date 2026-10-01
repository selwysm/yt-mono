import { getYouTubeClient } from './auth.js';
import { listarCuentas, resolverCuenta } from './cuentas.js';

const PARTES = ['id', 'snippet', 'status', 'contentDetails'];

/* ------------------------------------------------------------------ */
/* Listar                                                              */
/* ------------------------------------------------------------------ */

/**
 * Lista tus transmisiones (las creadas por API y las creadas en YouTube Studio).
 * @param {'all'|'upcoming'|'active'|'completed'} estado
 */
export async function listarTransmisiones(estado = 'all', cuenta) {
  const youtube = await getYouTubeClient(cuenta);
  const { data } = await youtube.liveBroadcasts.list({
    part: PARTES,
    broadcastStatus: estado,
    broadcastType: 'all',
    maxResults: 50,
  });
  return data.items ?? [];
}

/** Obtiene una transmision por su ID. */
export async function obtenerTransmision(id, cuenta) {
  const youtube = await getYouTubeClient(cuenta);
  const { data } = await youtube.liveBroadcasts.list({ part: PARTES, id: [id] });
  const item = data.items?.[0];
  if (!item) throw new Error(`No existe una transmision con ID ${id}`);
  return item;
}

/* ------------------------------------------------------------------ */
/* Crear                                                               */
/* ------------------------------------------------------------------ */

/**
 * Crea una transmision completa: broadcast + stream RTMP + bind.
 *
 * @param {object} opts
 * @param {string}  opts.titulo
 * @param {string} [opts.descripcion]
 * @param {string} [opts.inicio]        ISO 8601. Por defecto: dentro de 1 minuto.
 * @param {'public'|'unlisted'|'private'} [opts.privacidad]
 * @param {boolean} [opts.autoStart]    Pasa a "en vivo" sola al recibir video.
 * @param {boolean} [opts.autoStop]     Finaliza sola al cortar el video.
 * @param {'1080p'|'720p'|'480p'|'360p'|'variable'} [opts.resolucion]
 * @param {'30fps'|'60fps'|'variable'} [opts.fps]
 */
export async function crearTransmision({
  titulo,
  descripcion = '',
  inicio,
  privacidad = 'unlisted',
  autoStart = true,
  autoStop = true,
  resolucion = 'variable',
  fps = 'variable',
  cuenta,
} = {}) {
  if (!titulo) throw new Error('El titulo es obligatorio');

  const youtube = await getYouTubeClient(cuenta);
  const scheduledStartTime = inicio ?? new Date(Date.now() + 60_000).toISOString();

  // 1. El broadcast: es lo que el publico ve (el "evento" con su URL de video).
  const { data: broadcast } = await youtube.liveBroadcasts.insert({
    part: ['snippet', 'status', 'contentDetails'],
    requestBody: {
      snippet: { title: titulo, description: descripcion, scheduledStartTime },
      status: { privacyStatus: privacidad, selfDeclaredMadeForKids: false },
      contentDetails: {
        enableAutoStart: autoStart,
        enableAutoStop: autoStop,
        enableDvr: true,
        recordFromStart: true,
        // Con monitorStream desactivado se puede pasar directo a "live".
        monitorStream: { enableMonitorStream: false },
      },
    },
  });

  // 2. El stream: el "tubo" RTMP por donde entra el video (OBS, ffmpeg, etc.).
  const { data: stream } = await youtube.liveStreams.insert({
    part: ['snippet', 'cdn', 'contentDetails'],
    requestBody: {
      snippet: { title: `${titulo} - stream` },
      cdn: { frameRate: fps, ingestionType: 'rtmp', resolution: resolucion },
      contentDetails: { isReusable: true },
    },
  });

  // 3. Bind: conecta el tubo con el evento.
  const { data: vinculado } = await youtube.liveBroadcasts.bind({
    part: PARTES,
    id: broadcast.id,
    streamId: stream.id,
  });

  const ing = stream.cdn.ingestionInfo;
  return {
    broadcast: vinculado,
    stream,
    watchUrl: `https://www.youtube.com/watch?v=${broadcast.id}`,
    studioUrl: `https://studio.youtube.com/video/${broadcast.id}/livestreaming`,
    rtmp: {
      servidor: ing.ingestionAddress,
      servidorRespaldo: ing.backupIngestionAddress,
      claveDeTransmision: ing.streamName,
      urlCompleta: `${ing.ingestionAddress}/${ing.streamName}`,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Transiciones: iniciar / finalizar                                   */
/* ------------------------------------------------------------------ */

async function transicionar(id, estado, cuenta) {
  const youtube = await getYouTubeClient(cuenta);
  try {
    const { data } = await youtube.liveBroadcasts.transition({
      part: PARTES,
      id,
      broadcastStatus: estado,
    });
    return data;
  } catch (err) {
    const motivo = err?.errors?.[0]?.reason ?? err?.response?.data?.error?.errors?.[0]?.reason;
    if (motivo === 'errorStreamInactive') {
      throw new Error(
        'El stream no esta recibiendo video. Inicia OBS/ffmpeg apuntando al RTMP y vuelve a intentar.'
      );
    }
    if (motivo === 'invalidTransition') {
      throw new Error(
        `No se puede pasar a "${estado}" desde el estado actual. Revisa el estado con: npm run status -- <ID>`
      );
    }
    throw err;
  }
}

/** Pone la transmision EN VIVO. Requiere que ya este entrando video por RTMP. */
export function iniciarTransmision(id, cuenta) {
  return transicionar(id, 'live', cuenta);
}

/** Pasa la transmision a modo prueba (solo si monitorStream esta activo). */
export function probarTransmision(id, cuenta) {
  return transicionar(id, 'testing', cuenta);
}

/** FINALIZA la transmision. Funciona igual para las creadas en YouTube Studio. */
export function finalizarTransmision(id, cuenta) {
  return transicionar(id, 'complete', cuenta);
}

/* ------------------------------------------------------------------ */
/* Extras                                                              */
/* ------------------------------------------------------------------ */

/** Elimina una transmision (solo si no esta completada/en vivo). */
export async function eliminarTransmision(id, cuenta) {
  const youtube = await getYouTubeClient(cuenta);
  await youtube.liveBroadcasts.delete({ id });
  return true;
}

/** Salud del stream vinculado a un broadcast: good | ok | bad | noData. */
export async function saludDelStream(broadcastId, cuenta) {
  const youtube = await getYouTubeClient(cuenta);
  const b = await obtenerTransmision(broadcastId, cuenta);
  const streamId = b.contentDetails?.boundStreamId;
  if (!streamId) return null;
  const { data } = await youtube.liveStreams.list({
    part: ['status', 'cdn', 'snippet'],
    id: [streamId],
  });
  return data.items?.[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Multi-cuenta                                                        */
/* ------------------------------------------------------------------ */

/**
 * Lista las transmisiones de TODAS las cuentas configuradas.
 * Si una cuenta falla, se reporta en el resultado en vez de tumbar todo.
 * @returns {Promise<Array<{cuenta, transmisiones, error}>>}
 */
export async function listarEnTodasLasCuentas(estado = 'all') {
  const cuentas = listarCuentas();
  return Promise.all(cuentas.map(async (c) => {
    try {
      return { cuenta: c, transmisiones: await listarTransmisiones(estado, c.slug), error: null };
    } catch (err) {
      return { cuenta: c, transmisiones: [], error: err };
    }
  }));
}

/**
 * Busca a que cuenta pertenece una transmision, probando una por una.
 * Evita tener que escribir --cuenta al finalizar por ID.
 * @returns {Promise<{cuenta, transmision}|null>}
 */
export async function buscarTransmisionEnCuentas(id, cuentaSugerida) {
  const cuentas = cuentaSugerida ? [resolverCuenta(cuentaSugerida)] : listarCuentas();
  for (const c of cuentas) {
    try {
      const t = await obtenerTransmision(id, c.slug);
      if (t) return { cuenta: c, transmision: t };
    } catch { /* no es de esta cuenta, seguimos */ }
  }
  return null;
}
