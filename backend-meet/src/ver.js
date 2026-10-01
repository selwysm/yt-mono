#!/usr/bin/env node
/**
 * VER reuniones de Google Meet.
 *
 *   npm run ver                          EN VIVO, en TODAS las cuentas
 *   npm run ver -- programadas           las programadas por este proyecto
 *   npm run ver -- finalizadas           historial (ultimos 30 dias)
 *   npm run ver -- todas                 en vivo + programadas
 *   npm run ver -- --cuenta <nombre>     solo esa cuenta
 */
import {
  listarEnVivo, listarEnVivoEnTodasLasCuentas, listarProgramadas, listarFinalizadas,
  enTodasLasCuentas, participantesActuales,
} from './meet.js';
import { listarCuentas, resolverCuenta } from './cuentas.js';
import { explicarError, fallar } from './errores.js';

const ALIAS = {
  vivo: 'vivo', activas: 'vivo', active: 'vivo', live: 'vivo',
  programadas: 'programadas', proximas: 'programadas', upcoming: 'programadas',
  finalizadas: 'finalizadas', terminadas: 'finalizadas', completed: 'finalizadas',
  todas: 'todas', all: 'todas',
};

const VACIO = {
  vivo: 'Ninguna EN VIVO.',
  programadas: 'Ninguna programada.',
  finalizadas: 'Ninguna finalizada en los ultimos 30 dias.',
};

// --cuenta <nombre> puede ir en cualquier posicion
const args = process.argv.slice(2);
const iCuenta = args.findIndex((a) => a === '--cuenta' || a === '-c');
const cuentaPedida = iCuenta >= 0 ? args[iCuenta + 1] : null;
const iValor = iCuenta >= 0 ? iCuenta + 1 : -1;
const posicionales = args.filter((a, i) => !a.startsWith('-') && i !== iValor);
const arg = (posicionales[0] ?? 'vivo').toLowerCase();
const filtro = ALIAS[arg];

if (!filtro) {
  console.error(`\nFiltro no valido: "${arg}"`);
  console.error('Usa: vivo | programadas | finalizadas | todas\n');
  process.exit(1);
}

function fecha(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

function minutos(desde, hasta = new Date().toISOString()) {
  return Math.round((new Date(hasta) - new Date(desde)) / 60_000);
}

async function pintarEnVivo(r, slug) {
  const codigo = r.sala?.meetingCode ?? r.spaceName;
  const n = await participantesActuales(r.conferencia.name, slug).catch(() => null);
  console.log(`  [ EN VIVO ]  ${r.titulo ?? codigo}`);
  console.log(`     Codigo:    ${codigo}`);
  if (r.sala?.meetingUri) console.log(`     Link:      ${r.sala.meetingUri}`);
  console.log(`     Inicio:    ${fecha(r.conferencia.startTime)}  (hace ${minutos(r.conferencia.startTime)} min)`);
  if (n !== null) console.log(`     Personas:  ${n}`);
  if (r.deLaApp) {
    console.log(`     Finalizar: npm run finalizar -- ${codigo}`);
  } else {
    console.log('     Origen:    creada a mano -> la API no puede finalizarla');
    console.log('                (en Meet: "Finalizar la llamada para todos")');
  }
  console.log();
}

function pintarProgramada(e) {
  const codigo = e.location?.match(/meet\.google\.com\/([a-z0-9-]+)/i)?.[1] ?? '-';
  console.log(`  [ programada ]  ${e.summary}`);
  console.log(`     Codigo:    ${codigo}`);
  console.log(`     Inicio:    ${fecha(e.start?.dateTime ?? e.start?.date)}`);
  console.log(`     Fin:       ${fecha(e.end?.dateTime ?? e.end?.date)}`);
  console.log(`     Link:      ${e.location ?? '-'}`);
  if (e.attendees?.length) console.log(`     Invitados: ${e.attendees.map((a) => a.email).join(', ')}`);
  console.log(`     Borrar:    node src/cli.js delete ${codigo}`);
  console.log();
}

function pintarFinalizada(r) {
  const codigo = r.sala?.meetingCode ?? r.spaceName;
  console.log(`  [ finalizada ]  ${r.titulo ?? codigo}`);
  console.log(`     Codigo:    ${codigo}`);
  console.log(`     Inicio:    ${fecha(r.conferencia.startTime)}`);
  console.log(`     Fin:       ${fecha(r.conferencia.endTime)}  (${minutos(r.conferencia.startTime, r.conferencia.endTime)} min)`);
  console.log();
}

/** Trae y pinta una seccion (vivo | programadas | finalizadas). */
async function seccion(tipo) {
  const unaCuenta = async (fn) => {
    const c = resolverCuenta(cuentaPedida);
    try { return [{ cuenta: c, items: await fn(c.slug), error: null }]; }
    catch (err) { return [{ cuenta: c, items: [], error: err }]; }
  };

  const fuente = { vivo: listarEnVivo, programadas: listarProgramadas, finalizadas: listarFinalizadas }[tipo];
  const grupos = cuentaPedida
    ? await unaCuenta(fuente)
    : tipo === 'vivo' ? await listarEnVivoEnTodasLasCuentas() : await enTodasLasCuentas(fuente);

  const total = grupos.reduce((n, g) => n + g.items.length, 0);
  const varias = grupos.length > 1;
  const titulo = { vivo: 'EN VIVO', programadas: 'programada(s)', finalizadas: 'finalizada(s)' }[tipo];
  console.log(`\n${total} reunion(es) ${titulo}${varias ? ` en ${grupos.length} cuentas` : ''}\n`);

  for (const g of grupos) {
    if (varias || g.error) console.log(`--- ${g.cuenta.email ?? g.cuenta.nombre}  (${g.cuenta.slug}) ---`);
    if (g.error) {
      console.log(`  ! ${explicarError(g.error).split('\n')[0]}\n`);
      continue;
    }
    if (!g.items.length) {
      console.log(`  ${VACIO[tipo]}\n`);
      continue;
    }
    for (const r of g.items) {
      if (tipo === 'vivo') await pintarEnVivo(r, g.cuenta.slug);
      else if (tipo === 'programadas') pintarProgramada(r);
      else pintarFinalizada(r);
    }
  }
}

try {
  if (!listarCuentas().length) {
    console.log('\nNo hay cuentas configuradas.');
    console.log('Agrega la primera con:  npm run cuentas -- agregar "Mi cuenta"\n');
    process.exit(0);
  }

  if (filtro === 'todas') {
    await seccion('vivo');
    await seccion('programadas');
  } else {
    await seccion(filtro);
  }
} catch (err) {
  fallar(err);
}
