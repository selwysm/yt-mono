import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fallar } from './errores.js';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(__dirname, '..', 'token.json');

const BASE = 'https://api.zoom.us/v2';
const OAUTH_URL = 'https://zoom.us/oauth/token';

/**
 * Server-to-Server OAuth: no requiere navegador ni consentimiento de usuario.
 * Se piden credenciales de "cuenta" y Zoom devuelve un access_token que
 * dura 1 hora. Lo cacheamos en token.json y lo renovamos solo al expirar.
 */
function credenciales() {
  const { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = process.env;
  if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
    throw new Error(
      'Faltan ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET en el archivo .env'
    );
  }
  return { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET };
}

function tokenEnCache() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  try {
    const t = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    // margen de 60s para no usar un token a punto de expirar
    if (t.access_token && t.expira_en && Date.now() < t.expira_en - 60_000) return t.access_token;
  } catch {
    /* token.json corrupto: se ignora y se pide uno nuevo */
  }
  return null;
}

/** Pide un access_token nuevo a Zoom y lo guarda en token.json. */
async function pedirToken() {
  const { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = credenciales();
  const basic = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');

  const params = new URLSearchParams({
    grant_type: 'account_credentials',
    account_id: ZOOM_ACCOUNT_ID,
  });

  const res = await fetch(`${OAUTH_URL}?${params}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}` },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.reason || data.error || 'No se pudo obtener el token de Zoom');
    e.zoom = data;
    e.status = res.status;
    throw e;
  }

  const registro = {
    access_token: data.access_token,
    scope: data.scope,
    expira_en: Date.now() + data.expires_in * 1000,
  };
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(registro, null, 2));
  return data.access_token;
}

/** Devuelve un access_token valido (del cache o pidiendo uno nuevo). */
export async function getToken() {
  return tokenEnCache() ?? (await pedirToken());
}

/**
 * Cliente HTTP minimo para la API de Zoom. Agrega el token, arma la URL,
 * parsea el JSON y convierte los errores de Zoom en Error con .zoom/.status.
 *
 * @param {string} metodo  GET | POST | PATCH | DELETE | PUT
 * @param {string} ruta    p.ej. '/users/me/meetings'
 * @param {object} [body]  cuerpo JSON (para POST/PATCH/PUT)
 */
export async function zoom(metodo, ruta, body) {
  const token = await getToken();
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // 204 No Content (p.ej. DELETE o PATCH status) no trae cuerpo.
  if (res.status === 204) return null;

  const texto = await res.text();
  const data = texto ? JSON.parse(texto) : null;

  if (!res.ok) {
    const e = new Error(data?.message || `Error HTTP ${res.status} en ${ruta}`);
    e.zoom = data;
    e.status = res.status;
    throw e;
  }
  return data;
}

/** ID del usuario dueño de las reuniones. Por defecto 'me' (el de las credenciales). */
export function usuario() {
  return process.env.ZOOM_USER_ID || 'me';
}

// Ejecutar directamente: node src/auth.js  -> valida credenciales y muestra la cuenta
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await getToken();
    const yo = await zoom('GET', `/users/${usuario()}`);
    console.log('\nAutenticado correctamente con Zoom.');
    console.log(`Usuario: ${yo.first_name ?? ''} ${yo.last_name ?? ''} <${yo.email}>`);
    console.log(`ID:      ${yo.id}`);
    console.log(`Plan:    ${yo.type === 2 ? 'Licenciado' : yo.type === 1 ? 'Basico' : yo.type}`);
    console.log('\nSiguiente paso:  npm run ver\n');
  } catch (err) {
    fallar(err);
  }
}
