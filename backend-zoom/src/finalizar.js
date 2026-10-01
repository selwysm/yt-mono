#!/usr/bin/env node
/**
 * FINALIZAR reuniones.
 *
 *   npm run finalizar -- <ID>          finaliza esa reunion
 *   npm run finalizar -- <ID1> <ID2>   finaliza varias
 *   npm run finalizar -- --todas       finaliza TODAS las que estan en vivo (pide confirmacion)
 *   npm run finalizar -- --todas --si  finaliza todas sin preguntar
 */
import readline from 'node:readline/promises';
import { listarTransmisiones, finalizarTransmision, obtenerTransmision } from './zoom.js';
import { explicarError, fallar } from './errores.js';

const args = process.argv.slice(2);
const todas = args.includes('--todas');
const sinPreguntar = args.includes('--si') || args.includes('-y');
const ids = args.filter((a) => !a.startsWith('-'));

async function confirmar(pregunta) {
  if (sinPreguntar) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const r = await rl.question(`${pregunta} (s/n) `);
  rl.close();
  return /^s(i)?$/i.test(r.trim());
}

async function finalizarUna(id, titulo) {
  try {
    await finalizarTransmision(id);
    console.log(`  OK  ${titulo ?? id} -> finalizada`);
    return true;
  } catch (err) {
    console.error(`  --  ${titulo ?? id} -> ${explicarError(err).split('\n')[0]}`);
    return false;
  }
}

try {
  let objetivos = [];

  if (todas) {
    const activas = await listarTransmisiones('live');
    if (!activas.length) {
      console.log('\nNo hay ninguna reunion en vivo para finalizar.\n');
      process.exit(0);
    }
    console.log(`\nSe van a finalizar ${activas.length} reunion(es) en vivo:\n`);
    activas.forEach((m) => console.log(`  - ${m.topic}  (${m.id})`));
    console.log();
    if (!(await confirmar('Confirmas?'))) {
      console.log('\nCancelado.\n');
      process.exit(0);
    }
    objetivos = activas.map((m) => ({ id: m.id, titulo: m.topic }));
  } else if (ids.length) {
    objetivos = [];
    for (const id of ids) {
      const m = await obtenerTransmision(id).catch(() => null);
      objetivos.push({ id, titulo: m?.topic });
    }
  } else {
    console.log(`
Uso:
  npm run finalizar -- <ID>           finaliza esa reunion
  npm run finalizar -- <ID1> <ID2>    finaliza varias
  npm run finalizar -- --todas        finaliza todas las que estan EN VIVO
  npm run finalizar -- --todas --si   sin pedir confirmacion

Para ver los IDs:  npm run ver
`);
    process.exit(0);
  }

  console.log();
  let ok = 0;
  for (const o of objetivos) if (await finalizarUna(o.id, o.titulo)) ok++;
  console.log(`\n${ok} de ${objetivos.length} finalizada(s).\n`);
  process.exit(ok === objetivos.length ? 0 : 1);
} catch (err) {
  fallar(err);
}
