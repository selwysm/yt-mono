#!/usr/bin/env node
import {
  listarTransmisiones,
  obtenerTransmision,
  crearTransmision,
  iniciarTransmision,
  finalizarTransmision,
  eliminarTransmision,
  saludDelStream,
} from './live.js';
import { buscarTransmisionEnCuentas } from './live.js';
import { resolverCuenta } from './cuentas.js';
import { migrarSiHaceFalta } from './auth.js';
import { fallar } from './errores.js';

const [, , comando, ...args] = process.argv;

/** Lee banderas tipo --clave valor y --bandera */
function flags(lista) {
  const out = { _: [] };
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i];
    if (a.startsWith('--')) {
      const clave = a.slice(2);
      const sig = lista[i + 1];
      if (sig && !sig.startsWith('--')) { out[clave] = sig; i++; }
      else out[clave] = true;
    } else out._.push(a);
  }
  return out;
}

const f = flags(args);
const id = f._[0] ?? f.id;
const cuentaPedida = f.cuenta ?? f.c;

await migrarSiHaceFalta();

/** Cuenta a usar para operaciones sobre un ID ya existente. */
async function cuentaDe(idTransmision) {
  const hallado = await buscarTransmisionEnCuentas(idTransmision, cuentaPedida);
  if (!hallado) {
    throw new Error(`No encontre la transmision ${idTransmision} en ninguna de tus cuentas.`);
  }
  return hallado.cuenta.slug;
}

const ESTADOS = {
  created: 'creada', ready: 'lista', testing: 'en prueba',
  live: 'EN VIVO', complete: 'finalizada', revoked: 'revocada',
};

function fila(b) {
  const estado = ESTADOS[b.status?.lifeCycleStatus] ?? b.status?.lifeCycleStatus;
  const fecha = b.snippet?.scheduledStartTime ?? b.snippet?.actualStartTime ?? '-';
  return `  ${b.id}  ${String(estado).padEnd(11)} ${String(b.status?.privacyStatus ?? '').padEnd(9)} ${fecha}\n     ${b.snippet?.title}`;
}

function ayuda() {
  console.log(`
Transmisiones en vivo de YouTube

  npm run cuentas                       Gestiona tus cuentas de YouTube
  npm run ver                           Ver transmisiones
  npm run finalizar -- <ID>             Finalizar una transmision

  npm run create -- --titulo "Clase 1" [opciones]
       --cuenta <nombre>                En que canal crearla (por defecto: la activa)
       --descripcion "texto"
       --inicio 2026-08-20T15:00:00Z    (por defecto: en 1 minuto)
       --privacidad public|unlisted|private   (por defecto: unlisted)
       --no-autostart                   No pasar a vivo automaticamente
       --no-autostop                    No finalizar automaticamente

  npm run start -- <ID>                 Pone EN VIVO (necesita video entrando por RTMP)
  npm run status -- <ID>                Estado + salud del stream

  node src/cli.js delete <ID>           Elimina una transmision no iniciada
`);
}

try {
  switch (comando) {
    case 'create': {
      if (!f.titulo) throw new Error('Falta --titulo "Mi transmision"');
      const destino = resolverCuenta(cuentaPedida);
      console.log(`\nCanal destino: ${destino.canal?.titulo ?? destino.nombre}  (${destino.slug})`);
      const r = await crearTransmision({
        cuenta: destino.slug,
        titulo: f.titulo,
        descripcion: f.descripcion ?? '',
        inicio: f.inicio,
        privacidad: f.privacidad ?? 'unlisted',
        autoStart: !f['no-autostart'],
        autoStop: !f['no-autostop'],
      });
      console.log('\nTransmision creada\n');
      console.log(`  ID:        ${r.broadcast.id}`);
      console.log(`  Titulo:    ${r.broadcast.snippet.title}`);
      console.log(`  Estado:    ${ESTADOS[r.broadcast.status.lifeCycleStatus]}`);
      console.log(`  Ver en:    ${r.watchUrl}`);
      console.log(`  Studio:    ${r.studioUrl}`);
      console.log('\n  Configura esto en OBS (Ajustes > Emision > Personalizado):');
      console.log(`  Servidor:  ${r.rtmp.servidor}`);
      console.log(`  Clave:     ${r.rtmp.claveDeTransmision}`);
      console.log(`\n  Para finalizarla:  npm run end -- ${r.broadcast.id}\n`);
      break;
    }

    case 'start': {
      if (!id) throw new Error('Falta el ID. Uso: npm run start -- <ID>');
      const b = await iniciarTransmision(id, await cuentaDe(id));
      console.log(`\nEN VIVO -> https://www.youtube.com/watch?v=${b.id}\n`);
      break;
    }

    case 'status': {
      if (!id) throw new Error('Falta el ID. Uso: npm run status -- <ID>');
      const slug = await cuentaDe(id);
      const b = await obtenerTransmision(id, slug);
      console.log(`\n  Titulo:     ${b.snippet.title}`);
      console.log(`  Estado:     ${ESTADOS[b.status.lifeCycleStatus] ?? b.status.lifeCycleStatus}`);
      console.log(`  Privacidad: ${b.status.privacyStatus}`);
      console.log(`  Programada: ${b.snippet.scheduledStartTime ?? '-'}`);
      console.log(`  Inicio real:${b.snippet.actualStartTime ?? ' -'}`);
      console.log(`  Fin real:   ${b.snippet.actualEndTime ?? '-'}`);
      const s = await saludDelStream(id, slug);
      if (s) {
        console.log(`  Stream:     ${s.status.streamStatus} / salud: ${s.status.healthStatus?.status}`);
      } else {
        console.log('  Stream:     sin stream vinculado');
      }
      console.log();
      break;
    }

    case 'delete': {
      if (!id) throw new Error('Falta el ID. Uso: node src/cli.js delete <ID>');
      await eliminarTransmision(id, await cuentaDe(id));
      console.log(`\nTransmision ${id} eliminada\n`);
      break;
    }

    default:
      ayuda();
  }
} catch (err) {
  fallar(err);
}
