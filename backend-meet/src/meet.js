import { getMeetClient, getCalendarClient } from './auth.js';
import { listarCuentas, resolverCuenta, registrarSala, fijarSala } from './cuentas.js';

/*
 * Conceptos de Meet:
 *   - "sala" (space): el link meet.google.com/abc-defg-hij. Es permanente y se
 *     puede usar muchas veces.
 *   - "conferencia" (conferenceRecord): cada vez que alguien entra a la sala y
 *     arranca una llamada. Mientras no tenga endTime, esta EN VIVO.
 *
 * La API solo deja FINALIZAR llamadas de salas creadas por este proyecto
 * (permiso meetings.space.created). Las creadas a mano solo se pueden ver.
 */

const ACCESO = { abierta: 'OPEN', confiable: 'TRUSTED', restringida: 'RESTRICTED' };
const MARCA = 'backendMeet'; // propiedad privada que marca los eventos de Calendar de este proyecto

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

/** "https://meet.google.com/abc-defg-hij", "abc-defg-hij" o "spaces/xyz" -> "spaces/..." */
export function aNombreDeSala(id) {
  const t = String(id).trim();
  if (t.startsWith('spaces/')) return t;
  const m = t.match(/meet\.google\.com\/([a-z0-9-]+)/i);
  return `spaces/${m ? m[1] : t}`;
}

/** Codigo corto de un ID cualquiera, para buscarlo en las salas guardadas. */
function codigoDe(id) {
  return aNombreDeSala(id).slice('spaces/'.length).toLowerCase();
}

/** Busca en las salas guardadas de una cuenta por nombre o por codigo. */
function salaGuardada(registro, id) {
  const codigo = codigoDe(id);
  return (registro.salas ?? []).find(
    (s) => s.name === aNombreDeSala(id) || s.name === `spaces/${codigo}` ||
           s.meetingCode?.toLowerCase() === codigo || s.evento?.id === id
  ) ?? null;
}

/** Recorre todas las paginas de un metodo list de Meet. */
async function todasLasPaginas(llamar, params, campo, limite = Infinity) {
  const out = [];
  let pageToken;
  do {
    const { data } = await llamar({ ...params, pageToken });
    out.push(...(data[campo] ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken && out.length < limite);
  return out.slice(0, limite);
}

/**
 * Suma minutos a una fecha ISO respetando si trae zona o no.
 * "2026-10-01T15:00:00Z" -> ISO UTC; "2026-10-01T15:00" -> hora local sin zona.
 */
function sumarMinutos(iso, minutos) {
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) {
    return new Date(new Date(iso).getTime() + minutos * 60_000).toISOString();
  }
  const [f, h = '00:00:00'] = iso.split('T');
  const [a, m, d] = f.split('-').map(Number);
  const [hh, mm, ss = 0] = h.split(':').map(Number);
  return new Date(Date.UTC(a, m - 1, d, hh, mm + minutos, ss)).toISOString().slice(0, 19);
}

/* ------------------------------------------------------------------ */
/* Crear                                                               */
/* ------------------------------------------------------------------ */

/**
 * Crea una sala de Meet (link inmediato). Queda registrada como "de la app",
 * asi que se podra finalizar por API.
 *
 * @param {object} opts
 * @param {string} [opts.titulo]   solo para identificarla en este proyecto
 * @param {'abierta'|'confiable'|'restringida'} [opts.acceso]  quien entra sin pedir permiso
 * @param {string} [opts.cuenta]
 */
export async function crearSala({ titulo = 'Reunion', acceso, cuenta } = {}) {
  const registro = resolverCuenta(cuenta);
  if (acceso && !ACCESO[acceso]) {
    throw new Error(`Acceso no valido: "${acceso}". Usa: ${Object.keys(ACCESO).join(' | ')}`);
  }
  const meet = await getMeetClient(registro.slug);
  const { data } = await meet.spaces.create({
    requestBody: acceso ? { config: { accessType: ACCESO[acceso] } } : {},
  });
  registrarSala(registro.slug, {
    name: data.name, meetingCode: data.meetingCode, meetingUri: data.meetingUri, titulo,
  });
  return data;
}

/**
 * Programa una reunion con fecha: crea la sala con la API de Meet y luego un
 * evento en Google Calendar con ese link. Asi se puede finalizar por API
 * (si el evento lo creara Calendar con su propio Meet, no se podria).
 *
 * @param {object} opts
 * @param {string}  opts.titulo
 * @param {string}  opts.inicio         ISO 8601. Sin zona = hora de `zonaHoraria`.
 * @param {number} [opts.duracion]      minutos. Por defecto 60.
 * @param {string} [opts.zonaHoraria]   Por defecto America/Bogota.
 * @param {string} [opts.descripcion]
 * @param {string[]} [opts.invitados]   emails; si hay, Google les manda la invitacion.
 * @param {'abierta'|'confiable'|'restringida'} [opts.acceso]
 * @param {string} [opts.cuenta]
 */
export async function programarReunion({
  titulo,
  inicio,
  duracion = 60,
  zonaHoraria = 'America/Bogota',
  descripcion = '',
  invitados = [],
  acceso,
  cuenta,
} = {}) {
  if (!titulo) throw new Error('El titulo es obligatorio');
  if (!inicio) throw new Error('Falta la fecha de inicio (--inicio 2026-10-01T15:00)');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(inicio)) {
    throw new Error(`Fecha no valida: "${inicio}". Usa el formato 2026-10-01T15:00`);
  }
  // Calendar exige segundos: "2026-10-01T15:00" -> "2026-10-01T15:00:00"
  inicio = inicio.replace(/T(\d{2}:\d{2})(?=$|Z|[+-])/, 'T$1:00');

  const registro = resolverCuenta(cuenta);
  const sala = await crearSala({ titulo, acceso, cuenta: registro.slug });

  const calendar = await getCalendarClient(registro.slug);
  const { data: evento } = await calendar.events.insert({
    calendarId: 'primary',
    sendUpdates: invitados.length ? 'all' : 'none',
    requestBody: {
      summary: titulo,
      description: [descripcion, `Unirse a Google Meet: ${sala.meetingUri}`].filter(Boolean).join('\n\n'),
      location: sala.meetingUri,
      start: { dateTime: inicio, timeZone: zonaHoraria },
      end: { dateTime: sumarMinutos(inicio, duracion), timeZone: zonaHoraria },
      attendees: invitados.map((email) => ({ email })),
      extendedProperties: { private: { [MARCA]: '1', space: sala.name } },
    },
  });

  registrarSala(registro.slug, {
    name: sala.name,
    evento: {
      id: evento.id,
      inicio: evento.start?.dateTime,
      fin: evento.end?.dateTime,
      htmlLink: evento.htmlLink,
    },
  });
  return { sala, evento };
}

/**
 * Sala fija de la cuenta: un link permanente para usar siempre (como la sala
 * personal de Zoom). La crea la primera vez; con `nueva` la reemplaza.
 * @returns {Promise<{sala, creada: boolean}>}
 */
export async function salaFija({ cuenta, nueva = false } = {}) {
  const registro = resolverCuenta(cuenta);
  if (registro.salaFija && !nueva) {
    return { sala: await obtenerSala(registro.salaFija, registro.slug), creada: false };
  }
  const sala = await crearSala({ titulo: 'Sala fija', cuenta: registro.slug });
  fijarSala(registro.slug, sala.name);
  return { sala, creada: true };
}

/* ------------------------------------------------------------------ */
/* Consultar                                                           */
/* ------------------------------------------------------------------ */

/** Una sala por codigo, link o nombre (incluye activeConference si hay llamada). */
export async function obtenerSala(id, cuenta) {
  const meet = await getMeetClient(cuenta);
  const { data } = await meet.spaces.get({ name: aNombreDeSala(id) });
  return data;
}

/**
 * Llamadas EN VIVO de una cuenta (de la app y creadas a mano).
 * @returns {Promise<Array<{conferencia, sala, spaceName, titulo, deLaApp}>>}
 */
export async function listarEnVivo(cuenta) {
  const registro = resolverCuenta(cuenta);
  const meet = await getMeetClient(registro.slug);
  const conferencias = await todasLasPaginas(
    (p) => meet.conferenceRecords.list(p),
    { filter: 'end_time IS NULL', pageSize: 100 },
    'conferenceRecords'
  );
  return Promise.all(conferencias.map(async (c) => {
    const sala = await meet.spaces.get({ name: c.space }).then((r) => r.data).catch(() => null);
    const guardada = salaGuardada(registro, c.space);
    return { conferencia: c, sala, spaceName: c.space, titulo: guardada?.titulo ?? null, deLaApp: Boolean(guardada) };
  }));
}

/** Ultimas llamadas finalizadas de una cuenta (Google las guarda 30 dias). */
export async function listarFinalizadas(cuenta, limite = 20) {
  const registro = resolverCuenta(cuenta);
  const meet = await getMeetClient(registro.slug);
  const conferencias = (await todasLasPaginas(
    (p) => meet.conferenceRecords.list(p),
    { pageSize: 100 },
    'conferenceRecords',
    limite * 2
  )).filter((c) => c.endTime).slice(0, limite);

  return Promise.all(conferencias.map(async (c) => {
    const sala = await meet.spaces.get({ name: c.space }).then((r) => r.data).catch(() => null);
    const guardada = salaGuardada(registro, c.space);
    return { conferencia: c, sala, spaceName: c.space, titulo: guardada?.titulo ?? null, deLaApp: Boolean(guardada) };
  }));
}

/** Reuniones programadas por este proyecto en Google Calendar (desde ahora). */
export async function listarProgramadas(cuenta) {
  const calendar = await getCalendarClient(cuenta);
  const { data } = await calendar.events.list({
    calendarId: 'primary',
    privateExtendedProperty: [`${MARCA}=1`],
    timeMin: new Date().toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 100,
  });
  return data.items ?? [];
}

/** Cuantas personas hay AHORA en una llamada. */
export async function participantesActuales(conferenceRecord, cuenta) {
  const meet = await getMeetClient(cuenta);
  const lista = await todasLasPaginas(
    (p) => meet.conferenceRecords.participants.list(p),
    { parent: conferenceRecord, filter: 'latest_end_time IS NULL', pageSize: 100 },
    'participants'
  );
  return lista.length;
}

/* ------------------------------------------------------------------ */
/* Finalizar / eliminar                                                */
/* ------------------------------------------------------------------ */

/**
 * FINALIZA la llamada activa de una sala (saca a todos).
 * Solo funciona con salas creadas por este proyecto.
 * La sala sigue existiendo: el link se puede volver a usar.
 */
export async function finalizarReunion(id, cuenta) {
  const meet = await getMeetClient(cuenta);
  const sala = await obtenerSala(id, cuenta);
  if (!sala.activeConference) {
    throw new Error('La reunion no tiene una llamada activa: no hay nada que finalizar.');
  }
  await meet.spaces.endActiveConference({ name: sala.name, requestBody: {} });
  return sala;
}

/**
 * Elimina una reunion PROGRAMADA: borra su evento de Calendar.
 * La API de Meet no permite borrar salas; el link queda sin evento.
 * @param {string} id  codigo de la reunion o ID del evento de Calendar
 */
export async function eliminarProgramada(id, cuenta) {
  const registro = resolverCuenta(cuenta);
  const guardada = salaGuardada(registro, id);
  const eventoId = guardada?.evento?.id ?? id;

  const calendar = await getCalendarClient(registro.slug);
  await calendar.events.delete({ calendarId: 'primary', eventId: eventoId, sendUpdates: 'all' });
  if (guardada) registrarSala(registro.slug, { name: guardada.name, evento: null });
  return true;
}

/* ------------------------------------------------------------------ */
/* Multi-cuenta                                                        */
/* ------------------------------------------------------------------ */

/**
 * Ejecuta `fn(slug)` en TODAS las cuentas configuradas.
 * Si una cuenta falla, se reporta en el resultado en vez de tumbar todo.
 * @returns {Promise<Array<{cuenta, items, error}>>}
 */
export async function enTodasLasCuentas(fn) {
  return Promise.all(listarCuentas().map(async (c) => {
    try {
      return { cuenta: c, items: await fn(c.slug), error: null };
    } catch (err) {
      return { cuenta: c, items: [], error: err };
    }
  }));
}

/**
 * Llamadas EN VIVO de TODAS las cuentas. Si la misma sala aparece en varias
 * (porque ambas cuentas estan en la llamada), queda en la cuenta que la creo.
 */
export async function listarEnVivoEnTodasLasCuentas() {
  const grupos = await enTodasLasCuentas(listarEnVivo);
  const vistas = new Map(); // spaceName -> slug que se queda con ella

  for (const g of grupos) {
    for (const r of g.items) {
      const previa = vistas.get(r.spaceName);
      if (!previa || (r.deLaApp && !previa.deLaApp)) vistas.set(r.spaceName, { slug: g.cuenta.slug, deLaApp: r.deLaApp });
    }
  }
  for (const g of grupos) {
    g.items = g.items.filter((r) => vistas.get(r.spaceName).slug === g.cuenta.slug);
  }
  return grupos;
}

/**
 * Busca a que cuenta pertenece una reunion. Primero en las salas guardadas
 * (sin llamar a la API); si no, prueba cuenta por cuenta.
 * @returns {Promise<{cuenta, sala}|null>}
 */
export async function buscarSalaEnCuentas(id, cuentaSugerida) {
  const cuentas = cuentaSugerida ? [resolverCuenta(cuentaSugerida)] : listarCuentas();

  const duena = cuentas.find((c) => salaGuardada(c, id));
  if (duena) {
    try { return { cuenta: duena, sala: await obtenerSala(id, duena.slug) }; }
    catch { /* seguimos probando en las demas */ }
  }
  for (const c of cuentas) {
    try { return { cuenta: c, sala: await obtenerSala(id, c.slug) }; }
    catch { /* no es de esta cuenta, seguimos */ }
  }
  return null;
}

/** true si la sala la creo este proyecto en alguna cuenta. */
export function esDeLaApp(id, cuenta) {
  const cuentas = cuenta ? [resolverCuenta(cuenta)] : listarCuentas();
  return cuentas.some((c) => salaGuardada(c, id));
}
