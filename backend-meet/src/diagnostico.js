#!/usr/bin/env node
/**
 * Revisa que todo este listo: credenciales, cuentas, permisos y APIs habilitadas.
 *   npm run diagnostico
 *   npm run diagnostico -- --cuenta <nombre>
 */
import { google } from 'googleapis';
import { getAuthenticatedClient, permisosFaltantes, consultarEmail } from './auth.js';
import { listarCuentas, resolverCuenta, cuentaActiva } from './cuentas.js';
import { explicarError } from './errores.js';
import 'dotenv/config';

const ok = (t) => console.log(`  [OK]    ${t}`);
const no = (t) => console.log(`  [FALLA] ${t}`);
const info = (t) => console.log(`          ${t}`);

const args = process.argv.slice(2);
const iCuenta = args.findIndex((a) => a === '--cuenta' || a === '-c');
const cuentaPedida = iCuenta >= 0 ? args[iCuenta + 1] : null;

console.log('\nDIAGNOSTICO\n');

// 1. Credenciales de la app
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  ok('Credenciales de la app en .env');
} else {
  no('Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en .env');
  process.exit(1);
}

// 2. Cuentas
const todas = listarCuentas();
if (!todas.length) {
  no('No hay cuentas configuradas.');
  info('Agrega la primera con:  npm run cuentas -- agregar "Mi cuenta"');
  process.exit(1);
}
ok(`${todas.length} cuenta(s) configurada(s)`);
const activa = cuentaActiva();
info(`Cuenta activa: ${activa ? activa.slug : '(ninguna)'}`);

// 3. Revision por cuenta
const aRevisar = cuentaPedida ? [resolverCuenta(cuentaPedida)] : todas;
let fallos = 0;

/** Muestra la primera linea del error y, si es una API sin habilitar, el link. */
function reportar(titulo, e) {
  const lineas = explicarError(e).split('\n');
  no(`${titulo}: ${lineas[0]}`);
  lineas.slice(1).filter(Boolean).forEach(info);
  fallos++;
}

for (const c of aRevisar) {
  console.log(`\n  --- ${c.nombre}  (${c.slug}) ---`);

  if (c.tokens?.refresh_token_expires_in) {
    const dias = (c.tokens.refresh_token_expires_in / 86400).toFixed(1);
    no(`El token caduca en ~${dias} dias (la app esta en modo prueba).`);
    info('Publica la app en Google Auth Platform -> Publico -> Publicar app,');
    info(`y vuelve a autorizar:  npm run cuentas -- agregar "${c.nombre}"`);
    fallos++;
  } else if (c.tokens?.refresh_token) {
    ok('Token sin caducidad');
  } else {
    no('La cuenta no tiene refresh_token. Vuelve a agregarla.');
    fallos++;
    continue;
  }

  const faltan = permisosFaltantes(c.tokens?.scope);
  if (faltan.length) {
    no(`Faltan permisos: ${faltan.map((s) => s.split('/').pop()).join(', ')}`);
    info(`Vuelve a autorizar marcando todas las casillas:  npm run cuentas -- agregar "${c.nombre}"`);
    fallos++;
  } else {
    ok('Todos los permisos concedidos');
  }

  let auth;
  try {
    auth = await getAuthenticatedClient(c.slug);
    await auth.getAccessToken();
    ok('Token valido y renovable');
  } catch (e) {
    no(`No se pudo renovar el token: ${e?.message}`);
    info(`Vuelve a agregar la cuenta:  npm run cuentas -- agregar "${c.nombre}"`);
    fallos++;
    continue;
  }

  try {
    ok(`Cuenta de Google: ${await consultarEmail(auth)}`);
  } catch (e) {
    reportar('No se pudo leer el email', e);
  }

  try {
    const meet = google.meet({ version: 'v2', auth });
    await meet.conferenceRecords.list({ pageSize: 1 });
    ok('Google Meet API habilitada');
  } catch (e) {
    reportar('Google Meet API', e);
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.list({ calendarId: 'primary', maxResults: 1 });
    ok('Google Calendar API habilitada');
  } catch (e) {
    reportar('Google Calendar API', e);
  }
}

console.log(fallos === 0 ? '\n  Todo listo.  Siguiente:  npm run sala\n' : `\n  ${fallos} problema(s) encontrado(s).\n`);
process.exit(fallos === 0 ? 0 : 1);
