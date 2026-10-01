import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import {
  resolverCuenta, guardarCuenta, actualizarTokens, slugDisponible,
  listarCuentas, activar, cuentaPorEmail,
} from './cuentas.js';
import { fallar } from './errores.js';
import 'dotenv/config';

// userinfo.email          -> saber que cuenta de Google se autorizo
// meetings.space.created  -> crear salas y FINALIZAR las que creo esta app
// meetings.space.readonly -> VER cualquier reunion (tambien las creadas a mano)
// calendar.events         -> programar reuniones con fecha en Google Calendar
export const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/meetings.space.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

export function crearClienteOAuth() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en el archivo .env');
  }
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback'
  );
}

export function urlDeAutorizacion(cliente = crearClienteOAuth()) {
  return cliente.generateAuthUrl({
    access_type: 'offline',   // para recibir refresh_token
    prompt: 'consent',        // fuerza que siempre entregue refresh_token
    scope: SCOPES,
  });
}

/** Permisos que el usuario NO marco en la pantalla de consentimiento. */
export function permisosFaltantes(scopeConcedido = '') {
  const concedidos = scopeConcedido.split(/\s+/);
  return SCOPES.filter((s) => !concedidos.includes(s));
}

/** Email de la cuenta de Google de un cliente ya autenticado. */
export async function consultarEmail(cliente) {
  const oauth2 = google.oauth2({ version: 'v2', auth: cliente });
  const { data } = await oauth2.userinfo.get();
  return data.email ?? null;
}

/**
 * Canjea un codigo de autorizacion y guarda la cuenta.
 * Si ya existe una cuenta con el mismo email, la actualiza en vez de duplicarla.
 * @param {string} code    codigo devuelto por Google
 * @param {string} nombre  nombre con el que quieres identificar la cuenta
 */
export async function registrarCuentaConCodigo(code, nombre) {
  const cliente = crearClienteOAuth();
  const { tokens } = await cliente.getToken(code);
  cliente.setCredentials(tokens);

  // Google deja desmarcar permisos uno por uno en la pantalla de consentimiento.
  const faltan = permisosFaltantes(tokens.scope);
  if (faltan.length) {
    throw new Error(
      'No se concedieron todos los permisos. Repite el proceso y marca TODAS las casillas:\n' +
      faltan.map((s) => `  - ${s.split('/').pop()}`).join('\n')
    );
  }

  const email = await consultarEmail(cliente);
  const existente = cuentaPorEmail(email);
  const slug = existente?.slug ?? slugDisponible(nombre || email?.split('@')[0] || 'cuenta');
  const registro = guardarCuenta({ slug, nombre: nombre || existente?.nombre || email, email, tokens });
  if (listarCuentas().length === 1) activar(slug);
  return { registro, tokens, email, actualizada: Boolean(existente) };
}

/**
 * Flujo con navegador local: abre la URL, espera el callback y guarda la cuenta.
 * Solo sirve si el navegador esta en ESTA maquina.
 */
export function autorizarEnNavegador(nombre) {
  const port = Number(process.env.OAUTH_PORT || 3000);
  const cliente = crearClienteOAuth();
  const authUrl = urlDeAutorizacion(cliente);

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (!req.url.startsWith('/oauth2callback')) return void res.writeHead(404).end();

      const url = new URL(req.url, `http://localhost:${port}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(error
        ? `<h2>Error de autorizacion: ${error}</h2>`
        : '<h2>Listo. Ya puedes cerrar esta pestana y volver a la terminal.</h2>');
      server.close();

      if (error) return reject(new Error(error));
      try { resolve(await registrarCuentaConCodigo(code, nombre)); }
      catch (err) { reject(err); }
    });

    server.listen(port, async () => {
      console.log('\nAbre esta URL en tu navegador si no se abre sola:\n');
      console.log(authUrl + '\n');
      try {
        const { default: open } = await import('open');
        await open(authUrl);
      } catch { /* si falla, el usuario copia la URL a mano */ }
    });

    server.on('error', reject);
  });
}

/* ------------------------------------------------------------------ */
/* Clientes autenticados                                               */
/* ------------------------------------------------------------------ */

/**
 * Cliente OAuth de una cuenta guardada.
 * @param {string} [cuenta] slug o nombre parcial. Si se omite, la cuenta activa.
 */
export async function getAuthenticatedClient(cuenta) {
  const registro = resolverCuenta(cuenta);
  const cliente = crearClienteOAuth();
  cliente.setCredentials(registro.tokens);
  // googleapis renueva el access_token solo; persistimos el nuevo valor.
  cliente.on('tokens', (t) => actualizarTokens(registro.slug, t));
  return cliente;
}

/** Cliente de la Google Meet REST API v2 de una cuenta. */
export async function getMeetClient(cuenta) {
  const auth = await getAuthenticatedClient(cuenta);
  return google.meet({ version: 'v2', auth });
}

/** Cliente de la Google Calendar API v3 de una cuenta. */
export async function getCalendarClient(cuenta) {
  const auth = await getAuthenticatedClient(cuenta);
  return google.calendar({ version: 'v3', auth });
}

/* ------------------------------------------------------------------ */
/* Ejecucion directa: node src/auth.js  (agrega/verifica una cuenta)   */
/* ------------------------------------------------------------------ */

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const nombre = process.argv[2];
    const { registro, email } = await autorizarEnNavegador(nombre);
    console.log('\nCuenta agregada correctamente.');
    console.log(`  Nombre: ${registro.nombre}`);
    console.log(`  Slug:   ${registro.slug}`);
    console.log(`  Email:  ${email}`);
    console.log('\nSiguiente paso:  npm run diagnostico\n');
  } catch (err) {
    fallar(err);
  }
}
