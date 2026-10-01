#!/usr/bin/env node
/**
 * Revisa que todo este listo: credenciales, cuentas, canales y permiso de "en vivo".
 *   npm run diagnostico
 *   npm run diagnostico -- --cuenta <nombre>
 */
import { google } from 'googleapis';
import { getAuthenticatedClient, migrarSiHaceFalta } from './auth.js';
import { listarCuentas, resolverCuenta, cuentaActiva } from './cuentas.js';
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
const migrado = await migrarSiHaceFalta();
if (migrado) info(`Se migro el token.json anterior a la cuenta "${migrado.slug}".`);

const todas = listarCuentas();
if (!todas.length) {
  no('No hay cuentas configuradas.');
  info('Agrega la primera con:  npm run cuentas -- agregar "Mi canal"');
  process.exit(1);
}
ok(`${todas.length} cuenta(s) configurada(s)`);
const activa = cuentaActiva();
info(`Cuenta activa: ${activa ? activa.slug : '(ninguna)'}`);

// 3. Revision por cuenta
const aRevisar = cuentaPedida ? [resolverCuenta(cuentaPedida)] : todas;
let fallos = 0;

for (const c of aRevisar) {
  console.log(`\n  --- ${c.nombre}  (${c.slug}) ---`);

  if (c.tokens?.refresh_token_expires_in) {
    const dias = (c.tokens.refresh_token_expires_in / 86400).toFixed(1);
    no(`El token caduca en ~${dias} dias (la app esta en modo prueba).`);
    info('Publica la app en Google Auth Platform -> Publico -> Publicar app,');
    info(`y vuelve a autorizar:  npm run cuentas -- agregar-manual "${c.nombre}"`);
    fallos++;
  } else if (c.tokens?.refresh_token) {
    ok('Token sin caducidad');
  } else {
    no('La cuenta no tiene refresh_token. Vuelve a agregarla.');
    fallos++;
    continue;
  }

  let auth;
  try {
    auth = await getAuthenticatedClient(c.slug);
    await auth.getAccessToken();
    ok('Token valido y renovable');
  } catch (e) {
    no(`No se pudo renovar el token: ${e?.message}`);
    info(`Vuelve a agregar la cuenta:  npm run cuentas -- agregar-manual "${c.nombre}"`);
    fallos++;
    continue;
  }

  const youtube = google.youtube({ version: 'v3', auth });

  try {
    const { data } = await youtube.channels.list({ part: ['snippet'], mine: true });
    const canal = data.items?.[0];
    if (canal) ok(`Canal: "${canal.snippet.title}"  (${canal.id})`);
    else { no('La cuenta no tiene canal de YouTube asociado.'); fallos++; }
  } catch (e) {
    no(`No se pudo consultar el canal: ${e?.response?.data?.error?.message ?? e.message}`);
    fallos++;
  }

  try {
    await youtube.liveBroadcasts.list({ part: ['id'], broadcastStatus: 'all', maxResults: 1 });
    ok('Transmisiones en vivo HABILITADAS');
  } catch (e) {
    const motivo = e?.response?.data?.error?.errors?.[0]?.reason;
    if (motivo === 'liveStreamingNotEnabled') {
      no('El canal no tiene habilitadas las transmisiones en vivo.');
      info('  1. https://www.youtube.com/verify   (verificar canal)');
      info('  2. https://www.youtube.com/livestreaming   (activar)');
      info('  3. La PRIMERA activacion tarda hasta 24 horas.');
    } else {
      no(`liveBroadcasts fallo: ${e?.response?.data?.error?.message ?? e.message}`);
    }
    fallos++;
  }
}

console.log(fallos === 0 ? '\n  Todo listo.  Siguiente:  npm run ver\n' : `\n  ${fallos} problema(s) encontrado(s).\n`);
process.exit(fallos === 0 ? 0 : 1);
