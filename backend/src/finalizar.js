#!/usr/bin/env node
/**
 * FINALIZAR transmisiones.
 *
 *   npm run finalizar -- <ID>              busca sola en que cuenta esta
 *   npm run finalizar -- <ID1> <ID2>       varias
 *   npm run finalizar -- --todas           todas las EN VIVO de TODAS las cuentas
 *   npm run finalizar -- --todas --cuenta <nombre>   solo esa cuenta
 *   npm run finalizar -- --todas --si      sin confirmar
 */
import readline from 'node:readline/promises';
import {
  listarTransmisiones, listarEnTodasLasCuentas,
  finalizarTransmision, buscarTransmisionEnCuentas,
} from './live.js';
import { listarCuentas, resolverCuenta } from './cuentas.js';
import { migrarSiHaceFalta } from './auth.js';
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

async function finalizarUna({ id, titulo, slug, canal }) {
  const etiqueta = `${titulo ?? id}${canal ? `  [${canal}]` : ''}`;
  try {
    const b = await finalizarTransmision(id, slug);
    console.log(`  OK  ${etiqueta} -> finalizada`);
    console.log(`      Grabacion: https://www.youtube.com/watch?v=${b.id}`);
    return true;
  } catch (err) {
    console.error(`  --  ${etiqueta} -> ${explicarError(err).split('\n')[0]}`);
    return false;
  }
}

try {
  await migrarSiHaceFalta();

  if (!listarCuentas().length) {
    console.log('\nNo hay cuentas configuradas.');
    console.log('Agrega la primera con:  npm run cuentas -- agregar "Mi canal"\n');
    process.exit(0);
  }

  let objetivos = [];

  if (todas) {
    const grupos = cuentaPedida
      ? await (async () => {
          const c = resolverCuenta(cuentaPedida);
          return [{ cuenta: c, transmisiones: await listarTransmisiones('active', c.slug), error: null }];
        })()
      : await listarEnTodasLasCuentas('active');

    objetivos = grupos.flatMap((g) =>
      g.transmisiones.map((b) => ({
        id: b.id, titulo: b.snippet.title, slug: g.cuenta.slug,
        canal: g.cuenta.canal?.titulo ?? g.cuenta.nombre,
      }))
    );

    if (!objetivos.length) {
      console.log('\nNo hay ninguna transmision en vivo para finalizar.\n');
      process.exit(0);
    }

    console.log(`\nSe van a finalizar ${objetivos.length} transmision(es) EN VIVO:\n`);
    objetivos.forEach((o) => console.log(`  - [${o.canal}]  ${o.titulo}  (${o.id})`));
    console.log();
    if (!(await confirmar('Confirmas?'))) {
      console.log('\nCancelado.\n');
      process.exit(0);
    }
  } else if (ids.length) {
    for (const id of ids) {
      const hallado = await buscarTransmisionEnCuentas(id, cuentaPedida);
      if (!hallado) {
        objetivos.push({ id, titulo: null, slug: cuentaPedida, canal: null, noEncontrada: true });
        continue;
      }
      objetivos.push({
        id,
        titulo: hallado.transmision.snippet?.title,
        slug: hallado.cuenta.slug,
        canal: hallado.cuenta.canal?.titulo ?? hallado.cuenta.nombre,
      });
    }
    const perdidas = objetivos.filter((o) => o.noEncontrada);
    if (perdidas.length) {
      console.error(`\nNo encontre estas transmisiones en ninguna de tus cuentas:`);
      perdidas.forEach((o) => console.error(`  - ${o.id}`));
      console.error('Revisa el ID con:  npm run ver -- todas\n');
      objetivos = objetivos.filter((o) => !o.noEncontrada);
      if (!objetivos.length) process.exit(1);
    }
  } else {
    console.log(`
Uso:
  npm run finalizar -- <ID>             finaliza esa transmision
  npm run finalizar -- <ID1> <ID2>      varias
  npm run finalizar -- --todas          todas las EN VIVO de todas las cuentas
  npm run finalizar -- --todas --cuenta <nombre>   solo esa cuenta
  npm run finalizar -- --todas --si     sin pedir confirmacion

Para ver los IDs:  npm run ver -- todas
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
