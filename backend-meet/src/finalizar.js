#!/usr/bin/env node
/**
 * FINALIZAR reuniones de Google Meet.
 *
 *   npm run finalizar -- <CODIGO>              busca sola en que cuenta esta
 *   npm run finalizar -- <CODIGO1> <CODIGO2>   varias
 *   npm run finalizar -- --todas               todas las EN VIVO de TODAS las cuentas
 *   npm run finalizar -- --todas --cuenta <nombre>   solo esa cuenta
 *   npm run finalizar -- --todas --si          sin confirmar
 *
 * Solo se pueden finalizar las creadas por este proyecto. Las creadas a mano
 * se intentan igual y se reporta por que fallan.
 */
import readline from 'node:readline/promises';
import {
  listarEnVivo, listarEnVivoEnTodasLasCuentas, finalizarReunion, buscarSalaEnCuentas, esDeLaApp,
} from './meet.js';
import { listarCuentas, resolverCuenta } from './cuentas.js';
import { explicarError, fallar } from './errores.js';

const args = process.argv.slice(2);
const todas = args.includes('--todas');
const sinPreguntar = args.includes('--si') || args.includes('-y');
const iCuenta = args.findIndex((a) => a === '--cuenta' || a === '-c');
const cuentaPedida = iCuenta >= 0 ? args[iCuenta + 1] : null;
const iValor = iCuenta >= 0 ? iCuenta + 1 : -1;
const ids = args.filter((a, i) => !a.startsWith('-') && i !== iValor);

async function confirmar(pregunta) {
  if (sinPreguntar) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const r = await rl.question(`${pregunta} (s/n) `);
  rl.close();
  return /^s(i)?$/i.test(r.trim());
}

async function finalizarUna({ id, titulo, slug, cuenta }) {
  const etiqueta = `${titulo ?? id}${cuenta ? `  [${cuenta}]` : ''}`;
  try {
    await finalizarReunion(id, slug);
    console.log(`  OK  ${etiqueta} -> finalizada`);
    return true;
  } catch (err) {
    const [primera, ...resto] = explicarError(err).split('\n');
    console.error(`  --  ${etiqueta} -> ${primera}`);
    resto.forEach((l) => console.error(`      ${l}`));
    return false;
  }
}

try {
  if (!listarCuentas().length) {
    console.log('\nNo hay cuentas configuradas.');
    console.log('Agrega la primera con:  npm run cuentas -- agregar "Mi cuenta"\n');
    process.exit(0);
  }

  let objetivos = [];

  if (todas) {
    const grupos = cuentaPedida
      ? await (async () => {
          const c = resolverCuenta(cuentaPedida);
          return [{ cuenta: c, items: await listarEnVivo(c.slug), error: null }];
        })()
      : await listarEnVivoEnTodasLasCuentas();

    for (const g of grupos) {
      if (g.error) console.error(`\n  ! [${g.cuenta.email ?? g.cuenta.nombre}] ${explicarError(g.error).split('\n')[0]}`);
    }

    objetivos = grupos.flatMap((g) =>
      g.items.map((r) => ({
        id: r.spaceName,
        titulo: r.titulo ?? r.sala?.meetingCode ?? r.spaceName,
        slug: g.cuenta.slug,
        cuenta: g.cuenta.email ?? g.cuenta.nombre,
        deLaApp: r.deLaApp,
      }))
    );

    if (!objetivos.length) {
      console.log('\nNo hay ninguna reunion en vivo para finalizar.\n');
      process.exit(0);
    }

    console.log(`\nSe van a finalizar ${objetivos.length} reunion(es) EN VIVO:\n`);
    objetivos.forEach((o) => console.log(`  - [${o.cuenta}]  ${o.titulo}${o.deLaApp ? '' : '   (creada a mano: probablemente falle)'}`));
    console.log();
    if (!(await confirmar('Confirmas?'))) {
      console.log('\nCancelado.\n');
      process.exit(0);
    }
  } else if (ids.length) {
    for (const id of ids) {
      const hallado = await buscarSalaEnCuentas(id, cuentaPedida);
      if (!hallado) {
        objetivos.push({ id, noEncontrada: true });
        continue;
      }
      objetivos.push({
        id: hallado.sala.name,
        titulo: hallado.sala.meetingCode ?? id,
        slug: hallado.cuenta.slug,
        cuenta: hallado.cuenta.email ?? hallado.cuenta.nombre,
        deLaApp: esDeLaApp(hallado.sala.name, hallado.cuenta.slug),
      });
    }
    const perdidas = objetivos.filter((o) => o.noEncontrada);
    if (perdidas.length) {
      console.error('\nNo encontre estas reuniones en ninguna de tus cuentas:');
      perdidas.forEach((o) => console.error(`  - ${o.id}`));
      console.error('Revisa el codigo con:  npm run ver\n');
      objetivos = objetivos.filter((o) => !o.noEncontrada);
      if (!objetivos.length) process.exit(1);
    }
  } else {
    console.log(`
Uso:
  npm run finalizar -- <CODIGO>           finaliza esa reunion
  npm run finalizar -- <CODIGO1> <CODIGO2>  varias
  npm run finalizar -- --todas            todas las EN VIVO de todas las cuentas
  npm run finalizar -- --todas --cuenta <nombre>   solo esa cuenta
  npm run finalizar -- --todas --si       sin pedir confirmacion

Para ver los codigos:  npm run ver
`);
    process.exit(0);
  }

  console.log();
  let ok = 0;
  for (const o of objetivos) if (await finalizarUna(o)) ok++;
  console.log(`\n${ok} de ${objetivos.length} finalizada(s).\n`);
  process.exit(ok === objetivos.length ? 0 : 1);
} catch (err) {
  fallar(err);
}
