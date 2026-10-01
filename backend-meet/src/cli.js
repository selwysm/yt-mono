#!/usr/bin/env node
import {
  crearSala,
  programarReunion,
  salaFija,
  finalizarReunion,
  eliminarProgramada,
  participantesActuales,
  buscarSalaEnCuentas,
  esDeLaApp,
} from './meet.js';
import { resolverCuenta } from './cuentas.js';
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

function fecha(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

/** Cuenta a usar para operaciones sobre un ID ya existente. */
async function cuentaDe(idReunion) {
  const hallado = await buscarSalaEnCuentas(idReunion, cuentaPedida);
  if (!hallado) {
    throw new Error(`No encontre la reunion ${idReunion} en ninguna de tus cuentas.`);
  }
  return hallado;
}

function ayuda() {
  console.log(`
Reuniones de Google Meet

  npm run cuentas                       Gestiona tus cuentas de Google
  npm run ver                           Ver reuniones
  npm run finalizar -- <CODIGO>         Finalizar una reunion

  npm run create -- --titulo "Clase 1" [opciones]
       --cuenta <nombre>                En que cuenta crearla (por defecto: la activa)
       --inicio 2026-10-01T15:00        Programarla en Calendar (sin esto: link inmediato)
       --duracion 90                    minutos (por defecto 60)
       --zona America/Bogota
       --descripcion "texto"
       --invitados "a@x.com,b@y.com"    Google les manda la invitacion
       --acceso abierta|confiable|restringida

  npm run sala                          Muestra (o crea) la sala FIJA de la cuenta
  npm run sala -- --nueva               Reemplaza la sala fija por una nueva

  npm run status -- <CODIGO>            Estado de la reunion y participantes

  node src/cli.js delete <CODIGO>       Borra una reunion programada (su evento de Calendar)

  <CODIGO> acepta: abc-defg-hij, https://meet.google.com/abc-defg-hij o spaces/xxxx
`);
}

try {
  switch (comando) {
    case 'create': {
      if (!f.titulo) throw new Error('Falta --titulo "Mi reunion"');
      const destino = resolverCuenta(cuentaPedida);
      console.log(`\nCuenta destino: ${destino.email ?? destino.nombre}  (${destino.slug})`);

      if (f.inicio) {
        const { sala, evento } = await programarReunion({
          cuenta: destino.slug,
          titulo: f.titulo,
          inicio: f.inicio,
          duracion: f.duracion ? Number(f.duracion) : undefined,
          zonaHoraria: f.zona,
          descripcion: f.descripcion ?? '',
          invitados: f.invitados ? String(f.invitados).split(',').map((e) => e.trim()).filter(Boolean) : [],
          acceso: f.acceso,
        });
        console.log('\nReunion programada\n');
        console.log(`  Titulo:    ${evento.summary}`);
        console.log(`  Inicio:    ${fecha(evento.start?.dateTime)}`);
        console.log(`  Fin:       ${fecha(evento.end?.dateTime)}`);
        console.log(`  Codigo:    ${sala.meetingCode}`);
        console.log(`  Unirse:    ${sala.meetingUri}`);
        console.log(`  Calendar:  ${evento.htmlLink}`);
        console.log(`\n  Para finalizarla:  npm run finalizar -- ${sala.meetingCode}\n`);
      } else {
        const sala = await crearSala({ cuenta: destino.slug, titulo: f.titulo, acceso: f.acceso });
        console.log('\nReunion creada\n');
        console.log(`  Titulo:    ${f.titulo}`);
        console.log(`  Codigo:    ${sala.meetingCode}`);
        console.log(`  Unirse:    ${sala.meetingUri}`);
        console.log('\n  La llamada arranca cuando entre la primera persona.');
        console.log(`  Para finalizarla:  npm run finalizar -- ${sala.meetingCode}\n`);
      }
      break;
    }

    case 'sala': {
      const destino = resolverCuenta(cuentaPedida);
      const { sala, creada } = await salaFija({ cuenta: destino.slug, nueva: Boolean(f.nueva) });
      console.log(`\n${creada ? 'Sala fija creada' : 'Sala fija'}  (${destino.email ?? destino.nombre})\n`);
      console.log(`  Codigo:  ${sala.meetingCode}`);
      console.log(`  Link:    ${sala.meetingUri}`);
      console.log(`  Estado:  ${sala.activeConference ? 'EN VIVO' : 'sin llamada'}`);
      console.log('\n  Usa SIEMPRE este link en vez de crear reuniones a mano:');
      console.log('  asi el apagador y "npm run finalizar" la pueden cortar.\n');
      break;
    }

    case 'status': {
      if (!id) throw new Error('Falta el codigo. Uso: npm run status -- <CODIGO>');
      const { cuenta, sala } = await cuentaDe(id);
      const deLaApp = esDeLaApp(sala.name, cuenta.slug);
      console.log(`\n  Codigo:     ${sala.meetingCode}`);
      console.log(`  Link:       ${sala.meetingUri}`);
      console.log(`  Cuenta:     ${cuenta.email ?? cuenta.nombre}`);
      console.log(`  Origen:     ${deLaApp ? 'creada por este proyecto (se puede finalizar)' : 'creada a mano (solo lectura)'}`);
      console.log(`  Acceso:     ${sala.config?.accessType ?? '-'}`);
      if (sala.activeConference) {
        const n = await participantesActuales(sala.activeConference.conferenceRecord, cuenta.slug).catch(() => null);
        console.log('  Estado:     EN VIVO');
        console.log(`  Personas:   ${n ?? '-'}`);
      } else {
        console.log('  Estado:     sin llamada activa');
      }
      console.log();
      break;
    }

    case 'end': {
      if (!id) throw new Error('Falta el codigo. Uso: npm run end -- <CODIGO>');
      const { cuenta } = await cuentaDe(id);
      await finalizarReunion(id, cuenta.slug);
      console.log(`\nReunion ${id} finalizada\n`);
      break;
    }

    case 'delete': {
      if (!id) throw new Error('Falta el codigo. Uso: node src/cli.js delete <CODIGO>');
      const cuenta = resolverCuenta(cuentaPedida);
      await eliminarProgramada(id, cuenta.slug);
      console.log(`\nReunion programada ${id} eliminada de Calendar\n`);
      break;
    }

    default:
      ayuda();
  }
} catch (err) {
  fallar(err);
}
