#!/usr/bin/env node
/**
 * VER transmisiones.
 *
 *   npm run ver                          EN VIVO, en TODAS las cuentas
 *   npm run ver -- todas                 todos los estados
 *   npm run ver -- programadas
 *   npm run ver -- finalizadas
 *   npm run ver -- --cuenta <nombre>     solo esa cuenta
 */
import { listarTransmisiones, listarEnTodasLasCuentas, saludDelStream } from './live.js';
import { listarCuentas, resolverCuenta } from './cuentas.js';
import { migrarSiHaceFalta } from './auth.js';
import { explicarError, fallar } from './errores.js';

const ALIAS = {
  vivo: 'active', activas: 'active', active: 'active',
  programadas: 'upcoming', proximas: 'upcoming', upcoming: 'upcoming',
  finalizadas: 'completed', terminadas: 'completed', completed: 'completed',
  todas: 'all', all: 'all',
};

const ESTADOS = {
  created: 'creada', ready: 'lista', testing: 'en prueba',
  live: 'EN VIVO', complete: 'finalizada', revoked: 'revocada',
};

const VACIO = {
  active: 'Ninguna EN VIVO.',
  upcoming: 'Ninguna programada.',
  completed: 'Ninguna finalizada.',
  all: 'Sin transmisiones.',
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

async function pintarTransmision(b, slug) {
  const estado = ESTADOS[b.status?.lifeCycleStatus] ?? b.status?.lifeCycleStatus;
  const enVivo = b.status?.lifeCycleStatus === 'live';

  console.log(`  ${enVivo ? '[ EN VIVO ]' : `[ ${estado} ]`}  ${b.snippet?.title}`);
  console.log(`     ID:         ${b.id}`);
  console.log(`     Privacidad: ${b.status?.privacyStatus}`);
  console.log(`     Programada: ${fecha(b.snippet?.scheduledStartTime)}`);
  if (b.snippet?.actualStartTime) console.log(`     Inicio:     ${fecha(b.snippet.actualStartTime)}`);
  if (b.snippet?.actualEndTime)   console.log(`     Fin:        ${fecha(b.snippet.actualEndTime)}`);
  console.log(`     Ver:        https://www.youtube.com/watch?v=${b.id}`);

  if (enVivo) {
    const s = await saludDelStream(b.id, slug).catch(() => null);
    if (s) console.log(`     Stream:     ${s.status?.streamStatus} / salud ${s.status?.healthStatus?.status}`);
    console.log(`     Finalizar:  npm run finalizar -- ${b.id}`);
  }
  console.log();
}

try {
  await migrarSiHaceFalta();

  const cuentas = listarCuentas();
  if (!cuentas.length) {
    console.log('\nNo hay cuentas configuradas.');
    console.log('Agrega la primera con:  npm run cuentas -- agregar "Mi canal"\n');
    process.exit(0);
  }

  // Una sola cuenta pedida, o todas.
  const grupos = cuentaPedida
    ? await (async () => {
        const c = resolverCuenta(cuentaPedida);
        try {
          return [{ cuenta: c, transmisiones: await listarTransmisiones(filtro, c.slug), error: null }];
        } catch (err) {
          return [{ cuenta: c, transmisiones: [], error: err }];
        }
      })()
    : await listarEnTodasLasCuentas(filtro);

  const total = grupos.reduce((n, g) => n + g.transmisiones.length, 0);
  const varias = grupos.length > 1;

  console.log(`\n${total} transmision(es)${varias ? ` en ${grupos.length} cuentas` : ''}\n`);

  for (const g of grupos) {
    if (varias || g.error) {
      console.log(`--- ${g.cuenta.canal?.titulo ?? g.cuenta.nombre}  (${g.cuenta.slug}) ---`);
    }
    if (g.error) {
      console.log(`  ! ${explicarError(g.error).split('\n')[0]}\n`);
      continue;
    }
    if (!g.transmisiones.length) {
      console.log(`  ${VACIO[filtro]}\n`);
      continue;
    }
    for (const b of g.transmisiones) await pintarTransmision(b, g.cuenta.slug);
  }
} catch (err) {
  fallar(err);
}
