import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import {
  resolverCuenta, guardarCuenta, actualizarTokens, slugDisponible,
  listarCuentas, activar,
} from './cuentas.js';
import { fallar } from './errores.js';
import 'dotenv/config';

// youtube  -> crear/gestionar transmisiones
// youtube.force-ssl -> requerido para liveBroadcasts/liveStreams
export const SCOPES = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl',
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

/** Consulta el canal asociado a un cliente ya autenticado. */
export async function consultarCanal(cliente) {
  const youtube = google.youtube({ version: 'v3', auth: cliente });
  const { data } = await youtube.channels.list({ part: ['snippet'], mine: true });
  const c = data.items?.[0];
  return c ? { id: c.id, titulo: c.snippet.title } : null;
}

/**
 * Canjea un codigo de autorizacion y guarda la cuenta.
 * @param {string} code    codigo devuelto por Google
 * @param {string} nombre  nombre con el que quieres identificar la cuenta
 */
export async function registrarCuentaConCodigo(code, nombre) {
  const cliente = crearClienteOAuth();
  const { tokens } = await cliente.getToken(code);
  cliente.setCredentials(tokens);

  const canal = await consultarCanal(cliente);
  if (!canal) {
    throw new Error(
      'Esa cuenta de Google no tiene un canal de YouTube asociado. ' +
      'Repite el proceso eligiendo la cuenta o el canal correcto.'
    );
  }

  const slug = slugDisponible(nombre || canal.titulo);
  const registro = guardarCuenta({ slug, nombre: nombre || canal.titulo, canal, tokens });
  if (listarCuentas().length === 1) activar(slug);
  return { registro, tokens, canal };
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

/**
 * Convierte el token.json de la version de una sola cuenta en la primera
 * cuenta del almacen. No hace nada si ya hay cuentas o no existe el archivo.
 * @returns {Promise<object|null>} el registro migrado, o null.
 */
export async function migrarSiHaceFalta() {
  const rutaVieja = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'token.json');
  if (!fs.existsSync(rutaVieja) || listarCuentas().length > 0) return null;

  const tokens = JSON.parse(fs.readFileSync(rutaVieja, 'utf8'));
  const cliente = crearClienteOAuth();
  cliente.setCredentials(tokens);

  let canal = null;
  try { canal = await consultarCanal(cliente); } catch { /* seguimos sin canal */ }

  const nombre = canal?.titulo ?? 'principal';
  const slug = slugDisponible(nombre);
  const registro = guardarCuenta({ slug, nombre, canal, tokens });
  activar(slug);
  fs.renameSync(rutaVieja, `${rutaVieja}.respaldo`);
  return registro;
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

/**
 * Cliente de la YouTube Data API v3 de una cuenta.
 * @param {string} [cuenta] slug o nombre parcial.
 */
export async function getYouTubeClient(cuenta) {
  const auth = await getAuthenticatedClient(cuenta);
  return google.youtube({ version: 'v3', auth });
}

/* ------------------------------------------------------------------ */
/* Ejecucion directa: node src/auth.js  (agrega/verifica una cuenta)   */
/* ------------------------------------------------------------------ */

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    // Convierte el token.json de la version anterior en la primera cuenta.
    const migrado = await migrarSiHaceFalta();
    if (migrado) console.log(`\nSe migro tu token anterior a la cuenta "${migrado.slug}".`);

    const nombre = process.argv[2];
    const { registro, canal } = await autorizarEnNavegador(nombre);
    console.log('\nCuenta agregada correctamente.');
    console.log(`  Nombre: ${registro.nombre}`);
    console.log(`  Slug:   ${registro.slug}`);
    console.log(`  Canal:  ${canal.titulo}`);
    console.log('\nSiguiente paso:  npm run cuentas\n');
  } catch (err) {
    fallar(err);
  }
}
