#!/usr/bin/env node
/**
 * Gestion de cuentas de Google (Meet).
 *
 *   npm run cuentas                          lista las cuentas
 *   npm run cuentas -- agregar "Mi cuenta"   agrega una (navegador en ESTA maquina)
 *   npm run cuentas -- agregar-manual "..."  agrega una (navegador en OTRA maquina)
 *   npm run cuentas -- usar <nombre>         fija la cuenta por defecto
 *   npm run cuentas -- borrar <nombre>       quita una cuenta del almacen
 *
 * Volver a "agregar" una cuenta con el mismo email la ACTUALIZA (no la duplica).
 */
import readline from 'node:readline/promises';
import {
  listarCuentas, resolverCuenta, borrarCuenta, activar, cuentaActiva,
} from './cuentas.js';
import { autorizarEnNavegador, registrarCuentaConCodigo, urlDeAutorizacion } from './auth.js';
import { fallar } from './errores.js';

const [, , comando, ...resto] = process.argv;
const nombre = resto.filter((a) => !a.startsWith('-')).join(' ').trim();

function pintarLista() {
  const cuentas = listarCuentas();
  if (!cuentas.length) {
    console.log('\nNo hay cuentas configuradas todavia.');
    console.log('Agrega la primera con:');
    console.log('  npm run cuentas -- agregar "Nombre de la cuenta"\n');
    return;
  }
  const activa = cuentaActiva();
  console.log(`\n${cuentas.length} cuenta(s):\n`);
  for (const c of cuentas) {
    const marca = activa?.slug === c.slug ? '*' : ' ';
    const fija = c.salaFija ? c.salas?.find((s) => s.name === c.salaFija)?.meetingUri : null;
    console.log(` ${marca} ${c.slug}`);
    console.log(`     Nombre:    ${c.nombre}`);
    console.log(`     Email:     ${c.email ?? '(desconocido)'}`);
    console.log(`     Sala fija: ${fija ?? '(ninguna, crea una con: npm run sala)'}`);
    console.log(`     Salas creadas por el proyecto: ${c.salas?.length ?? 0}`);
    if (c.tokens?.refresh_token_expires_in) {
      const dias = (c.tokens.refresh_token_expires_in / 86400).toFixed(1);
      console.log(`     OJO:       el token caduca (~${dias} dias). Publica la app en Google Auth Platform.`);
    }
    console.log();
  }
  console.log(' * = cuenta activa (la que se usa sin --cuenta)');
  console.log(' Cambiala con:  npm run cuentas -- usar <nombre>\n');
}

/** Flujo manual: el navegador esta en otro computador. */
async function agregarManual(nombreCuenta) {
  const url = urlDeAutorizacion();
  console.log(`
================================================================
 AGREGAR CUENTA (navegador en otro computador)
================================================================

PASO 1 - Abre esta URL en el navegador del otro equipo, con la
         cuenta de Google que vas a usar para Meet:

${url}

PASO 2 - Acepta los permisos y MARCA TODAS LAS CASILLAS.
         Si sale "Google no verifico esta app":
         Configuracion avanzada -> Ir a ... (no seguro).

PASO 3 - Google te mandara a una pagina que NO CARGA. Es normal.
         Copia la URL COMPLETA de la barra de direcciones.

PASO 4 - Pegala abajo. El codigo dura ~1 minuto.
================================================================
`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const entrada = (await rl.question('Pega aqui la URL completa (o solo el code): ')).trim();
  rl.close();

  let code = entrada;
  if (entrada.startsWith('http')) {
    const u = new URL(entrada);
    const err = u.searchParams.get('error');
    if (err) throw new Error(`Google devolvio un error: ${err}`);
    code = u.searchParams.get('code');
  }
  if (!code) throw new Error('No encontre el parametro "code" en lo que pegaste.');

  return registrarCuentaConCodigo(decodeURIComponent(code), nombreCuenta);
}

function anunciarAlta({ registro, email, actualizada }) {
  console.log(actualizada ? '\nCuenta actualizada (ya existia con ese email).' : '\nCuenta agregada.');
  console.log(`  Nombre: ${registro.nombre}`);
  console.log(`  Slug:   ${registro.slug}   <- usalo con --cuenta`);
  console.log(`  Email:  ${email}`);
  if (listarCuentas().length === 1) {
    console.log('\nEs tu unica cuenta, asi que quedo como activa.');
  } else if (!actualizada) {
    console.log(`\nPara usarla por defecto:  npm run cuentas -- usar ${registro.slug}`);
  }
  console.log('Siguiente paso:  npm run diagnostico\n');
}

try {
  switch (comando) {
    case undefined:
    case 'listar':
    case 'list':
      pintarLista();
      break;

    case 'agregar':
    case 'add':
      anunciarAlta(await autorizarEnNavegador(nombre || undefined));
      break;

    case 'agregar-manual':
    case 'add-manual':
      anunciarAlta(await agregarManual(nombre || undefined));
      break;

    case 'usar':
    case 'use': {
      if (!nombre) throw new Error('Falta el nombre. Uso: npm run cuentas -- usar <nombre>');
      const c = resolverCuenta(nombre);
      activar(c.slug);
      console.log(`\nCuenta activa: ${c.slug}  (${c.email ?? c.nombre})\n`);
      break;
    }

    case 'borrar':
    case 'quitar':
    case 'remove': {
      if (!nombre) throw new Error('Falta el nombre. Uso: npm run cuentas -- borrar <nombre>');
      const c = resolverCuenta(nombre);
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const r = await rl.question(`Quitar la cuenta "${c.slug}" (${c.email})? (s/n) `);
      rl.close();
      if (!/^s(i)?$/i.test(r.trim())) {
        console.log('\nCancelado.\n');
        break;
      }
      borrarCuenta(c.slug);
      console.log(`\nCuenta "${c.slug}" quitada del almacen.`);
      console.log('OJO: se pierde el registro de sus salas; ya no se podran finalizar por API.');
      console.log('Esto NO revoca el acceso en Google. Para revocarlo:');
      console.log('  https://myaccount.google.com/permissions\n');
      break;
    }

    default:
      console.log(`
Comando desconocido: "${comando}"

  npm run cuentas                          lista las cuentas
  npm run cuentas -- agregar "Mi cuenta"   agrega una (navegador en ESTA maquina)
  npm run cuentas -- agregar-manual "..."  agrega una (navegador en OTRA maquina)
  npm run cuentas -- usar <nombre>         fija la cuenta por defecto
  npm run cuentas -- borrar <nombre>       quita una cuenta del almacen
`);
      process.exit(1);
  }
} catch (err) {
  fallar(err);
}
