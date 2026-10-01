import { zoom, usuario } from './auth.js';

/**
 * Devuelve la hora local (sin "Z") en una zona horaria dada, para "ahora + offset".
 * Se usa como start_time por defecto: al enviarlo junto con `timezone`, Zoom lo
 * interpreta como hora de esa zona (evita el desfase del offset UTC).
 */
function horaLocalISO(tz, offsetMs = 60_000) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
    .formatToParts(new Date(Date.now() + offsetMs))
    .reduce((o, x) => ((o[x.type] = x.value), o), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/* ------------------------------------------------------------------ */
/* Listar                                                              */
/* ------------------------------------------------------------------ */

/**
 * Lista reuniones del usuario.
 * @param {'scheduled'|'live'|'upcoming'|'previous_meetings'} tipo
 *   scheduled          -> todas las programadas (default)
 *   live               -> las que estan EN VIVO ahora
 *   upcoming           -> proximas
 *   previous_meetings  -> finalizadas
 */
export async function listarTransmisiones(tipo = 'scheduled') {
  const uid = usuario();
  const data = await zoom('GET', `/users/${uid}/meetings?type=${tipo}&page_size=300`);
  return data?.meetings ?? [];
}

/** Obtiene una reunion por su ID (incluye su estado: waiting | started). */
export async function obtenerTransmision(id) {
  try {
    return await zoom('GET', `/meetings/${id}`);
  } catch (err) {
    if (err.status === 404) throw new Error(`No existe una reunion con ID ${id}`);
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Crear                                                               */
/* ------------------------------------------------------------------ */

/**
 * Crea una reunion (o webinar) programada.
 *
 * @param {object} opts
 * @param {string}  opts.titulo
 * @param {string} [opts.descripcion]
 * @param {string} [opts.inicio]        ISO 8601. Por defecto: dentro de 1 minuto.
 * @param {number} [opts.duracion]      minutos. Por defecto 60.
 * @param {string} [opts.zonaHoraria]   Por defecto America/Bogota.
 * @param {'reunion'|'webinar'} [opts.tipo]
 * @param {string} [opts.password]      Si no se pasa, Zoom genera una.
 */
export async function crearTransmision({
  titulo,
  descripcion = '',
  inicio,
  duracion = 60,
  zonaHoraria = 'America/Bogota',
  tipo = 'reunion',
  password,
} = {}) {
  if (!titulo) throw new Error('El titulo es obligatorio');

  const uid = usuario();
  const start_time = inicio ?? horaLocalISO(zonaHoraria);

  const cuerpo = {
    topic: titulo,
    type: 2, // 2 = reunion programada / 5 = webinar
    start_time,
    duration: duracion,
    timezone: zonaHoraria,
    agenda: descripcion,
    ...(password ? { password } : {}),
    settings: {
      host_video: true,
      participant_video: true,
      join_before_host: false,
      waiting_room: false,
      approval_type: 2, // sin registro
      auto_recording: 'cloud', // graba en la nube (equivale a recordFromStart)
    },
  };

  const ruta = tipo === 'webinar' ? `/users/${uid}/webinars` : `/users/${uid}/meetings`;
  if (tipo === 'webinar') cuerpo.type = 5;

  return zoom('POST', ruta, cuerpo);
}

/* ------------------------------------------------------------------ */
/* Transiciones: iniciar / finalizar                                   */
/* ------------------------------------------------------------------ */

/**
 * "Iniciar": Zoom no arranca la reunion por API; el host la inicia abriendo
 * su start_url. Devolvemos esa URL (contiene un token ZAK y expira ~2h).
 */
export async function iniciarTransmision(id) {
  const m = await obtenerTransmision(id);
  if (!m.start_url) throw new Error('Esta reunion no tiene start_url (revisa permisos del host).');
  return { id: m.id, topic: m.topic, start_url: m.start_url, join_url: m.join_url };
}

/**
 * FINALIZA la reunion en vivo (action: end).
 * Solo funciona si la reunion esta iniciada (status: started).
 */
export async function finalizarTransmision(id) {
  try {
    await zoom('PUT', `/meetings/${id}/status`, { action: 'end' });
    return { id, status: 'finalizada' };
  } catch (err) {
    const code = err?.zoom?.code;
    // 3002: la reunion no esta en curso -> no hay nada que finalizar
    if (code === 3002) {
      throw new Error('La reunion no esta en curso, no hay nada que finalizar.');
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Extras                                                              */
/* ------------------------------------------------------------------ */

/** Elimina una reunion programada. */
export async function eliminarTransmision(id) {
  await zoom('DELETE', `/meetings/${id}`);
  return true;
}

/**
 * Estado en vivo de la reunion desde el panel (Dashboard).
 * Requiere plan Business+; si no esta disponible devuelve null.
 */
export async function saludDelStream(id) {
  try {
    return await zoom('GET', `/metrics/meetings/${id}`);
  } catch {
    return null;
  }
}

/* ================================================================== */
/* WEBINARS (seminarios web)                                          */
/* ================================================================== */

/**
 * Lista los webinars del usuario (programados Y pasados; el objeto sigue
 * existiendo hasta que se elimina, igual que en la web de Zoom).
 *
 * @param {object} [opts]
 * @param {'todos'|'pasados'|'proximos'} [opts.cuando]  filtro por fecha
 * @param {string} [opts.desde]  YYYY-MM-DD  (limite inferior, opcional)
 * @param {string} [opts.hasta]  YYYY-MM-DD  (limite superior, opcional)
 */
export async function listarWebinars({ cuando = 'todos', desde, hasta } = {}) {
  const uid = usuario();

  // Trae todas las paginas de un tipo dado (sin tipo = todos los existentes).
  const traer = async (tipo) => {
    let out = [];
    let token = '';
    do {
      const q = `page_size=300${tipo ? `&type=${tipo}` : ''}${token ? `&next_page_token=${token}` : ''}`;
      const data = await zoom('GET', `/users/${uid}/webinars?${q}`);
      out.push(...(data?.webinars ?? []));
      token = data?.next_page_token || '';
    } while (token);
    return out;
  };

  let ws;
  if (cuando === 'proximos') {
    // 'upcoming' de Zoom: programados que aun no terminan (incluye en curso).
    ws = await traer('upcoming');
  } else if (cuando === 'pasados') {
    // Todos menos los que Zoom considera 'upcoming'.
    const [todos, prox] = await Promise.all([traer(), traer('upcoming')]);
    const ids = new Set(prox.map((w) => w.id));
    ws = todos.filter((w) => !ids.has(w.id));
  } else {
    ws = await traer();
  }

  if (desde) ws = ws.filter((w) => w.start_time >= desde);
  if (hasta) ws = ws.filter((w) => w.start_time <= `${hasta}T23:59:59Z`);
  ws.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  return ws;
}

/**
 * Crea un webinar (seminario web) programado.
 *
 * @param {object} opts
 * @param {string}  opts.titulo
 * @param {string} [opts.descripcion]
 * @param {string} [opts.inicio]        ISO 8601. Por defecto: dentro de 1 minuto.
 * @param {number} [opts.duracion]      minutos. Por defecto 60.
 * @param {string} [opts.zonaHoraria]   Por defecto America/Bogota.
 * @param {string} [opts.password]
 */
export async function crearWebinar({
  titulo,
  descripcion = '',
  inicio,
  duracion = 60,
  zonaHoraria = 'America/Bogota',
  password,
} = {}) {
  if (!titulo) throw new Error('El titulo es obligatorio');

  const uid = usuario();
  const start_time = inicio ?? horaLocalISO(zonaHoraria);

  const cuerpo = {
    topic: titulo,
    type: 5, // 5 = webinar programado
    start_time,
    duration: duracion,
    timezone: zonaHoraria,
    agenda: descripcion,
    ...(password ? { password } : {}),
    settings: {
      host_video: true,
      panelists_video: true,
      practice_session: false,
      hd_video: true,
      approval_type: 2, // sin registro
      auto_recording: 'cloud',
    },
  };

  return zoom('POST', `/users/${uid}/webinars`, cuerpo);
}

/** Obtiene un webinar por su ID (programado). */
export async function obtenerWebinar(id) {
  try {
    return await zoom('GET', `/webinars/${id}`);
  } catch (err) {
    if (err.status === 404) throw new Error(`No existe un webinar con ID ${id}`);
    throw err;
  }
}

/** Datos de un webinar pasado (participantes, duracion) desde Reportes. */
export async function reporteWebinar(id) {
  try {
    return await zoom('GET', `/report/webinars/${id}`);
  } catch {
    return null;
  }
}

/** FINALIZA un webinar en curso (action: end). */
export async function finalizarWebinar(id) {
  try {
    await zoom('PUT', `/webinars/${id}/status`, { action: 'end' });
    return { id, status: 'finalizado' };
  } catch (err) {
    if (err?.zoom?.code === 3002) {
      throw new Error('El webinar no esta en curso, no hay nada que finalizar.');
    }
    throw err;
  }
}

/** Elimina un webinar programado. */
export async function eliminarWebinar(id) {
  await zoom('DELETE', `/webinars/${id}`);
  return true;
}
