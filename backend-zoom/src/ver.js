#!/usr/bin/env node
/**
 * VER reuniones.
 *
 *   npm run ver              -> las que estan EN VIVO ahora mismo
 *   npm run ver -- todas     -> todas las programadas
 *   npm run ver -- programadas
 *   npm run ver -- finalizadas
 */
import { listarTransmisiones } from './zoom.js';
import { fallar } from './errores.js';

const ALIAS = {
  vivo: 'live', activas: 'live', live: 'live',
  programadas: 'scheduled', todas: 'scheduled', scheduled: 'scheduled',
  proximas: 'upcoming', upcoming: 'upcoming',
  finalizadas: 'previous_meetings', terminadas: 'previous_meetings', previous_meetings: 'previous_meetings',
};

const arg = (process.argv[2] ?? 'vivo').toLowerCase();
const filtro = ALIAS[arg];

if (!filtro) {
  console.error(`\nFiltro no valido: "${arg}"`);
  console.error('Usa: vivo | programadas | proximas | finalizadas | todas\n');
  process.exit(1);
}

function fecha(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

try {
  const items = await listarTransmisiones(filtro);

  if (!items.length) {
    const texto = {
      live: 'No hay ninguna reunion EN VIVO en este momento.',
      scheduled: 'No tienes reuniones programadas.',
      upcoming: 'No tienes reuniones proximas.',
      previous_meetings: 'No tienes reuniones finalizadas.',
    };
    console.log(`\n${texto[filtro]}\n`);
    process.exit(0);
  }

  console.log(`\n${items.length} reunion(es)\n`);

  for (const m of items) {
    const enVivo = filtro === 'live';
    console.log(`${enVivo ? '[ EN VIVO ]' : '[ programada ]'}  ${m.topic}`);
    console.log(`   ID:      ${m.id}`);
    console.log(`   Inicio:  ${fecha(m.start_time)}`);
    console.log(`   Unirse:  ${m.join_url}`);
    if (enVivo) console.log(`   Finalizar:  npm run finalizar -- ${m.id}`);
    console.log();
  }
} catch (err) {
  fallar(err);
}
