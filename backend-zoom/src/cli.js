#!/usr/bin/env node
import {
  listarTransmisiones,
  obtenerTransmision,
  crearTransmision,
  iniciarTransmision,
  finalizarTransmision,
  eliminarTransmision,
  saludDelStream,
} from './zoom.js';
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

const ESTADOS = { waiting: 'en espera', started: 'EN VIVO' };

function fecha(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

function fila(m) {
  return `  ${String(m.id).padEnd(12)} ${fecha(m.start_time).padEnd(18)} ${m.topic}`;
}

function ayuda() {
  console.log(`
Transmisiones (reuniones) de Zoom

  npm run auth                          Valida tus credenciales (Server-to-Server OAuth)

  npm run list                          Lista tus reuniones programadas
  npm run list -- --tipo live           Filtra: scheduled | live | upcoming | previous_meetings

  npm run create -- --titulo "Clase 1" [opciones]
       --descripcion "texto"
       --inicio 2026-08-20T15:00:00Z    (por defecto: en 1 minuto)
       --duracion 90                    (minutos, por defecto 60)
       --zona America/Bogota
       --password 123456
       --tipo reunion|webinar           (por defecto reunion)

  npm run start -- <ID>                 Muestra el start_url (el host inicia la reunion)
  npm run end -- <ID>                   FINALIZA la reunion en curso
  npm run status -- <ID>                Estado y datos de la reunion

  node src/cli.js delete <ID>           Elimina una reunion programada
`);
}

try {
  switch (comando) {
    case 'list': {
      const items = await listarTransmisiones(f.tipo ?? 'scheduled');
      if (!items.length) { console.log('No hay reuniones.'); break; }
      console.log(`\n${items.length} reunion(es):\n`);
      console.log('  ID           INICIO             TITULO');
      items.forEach((m) => console.log(fila(m)));
      console.log();
      break;
    }

    case 'create': {
      if (!f.titulo) throw new Error('Falta --titulo "Mi reunion"');
      const m = await crearTransmision({
        titulo: f.titulo,
        descripcion: f.descripcion ?? '',
        inicio: f.inicio,
        duracion: f.duracion ? Number(f.duracion) : undefined,
        zonaHoraria: f.zona,
        tipo: f.tipo ?? 'reunion',
        password: f.password,
      });
      console.log('\nReunion creada\n');
      console.log(`  ID:        ${m.id}`);
      console.log(`  Titulo:    ${m.topic}`);
      console.log(`  Inicio:    ${fecha(m.start_time)}`);
      console.log(`  Duracion:  ${m.duration} min`);
      console.log(`  Password:  ${m.password ?? '(sin password)'}`);
      console.log(`\n  Unirse (participantes):  ${m.join_url}`);
      console.log(`  Iniciar (host):          ${m.start_url}`);
      console.log(`\n  Para finalizarla:  npm run end -- ${m.id}\n`);
      break;
    }

    case 'start': {
      if (!id) throw new Error('Falta el ID. Uso: npm run start -- <ID>');
      const r = await iniciarTransmision(id);
      console.log(`\nAbre este enlace como host para iniciar "${r.topic}":\n`);
      console.log(`  ${r.start_url}\n`);
      console.log(`Participantes se unen en:  ${r.join_url}\n`);
      break;
    }

    case 'end': {
      if (!id) throw new Error('Falta el ID. Uso: npm run end -- <ID>');
      await finalizarTransmision(id);
      console.log(`\nReunion ${id} finalizada\n`);
      break;
    }

    case 'status': {
      if (!id) throw new Error('Falta el ID. Uso: npm run status -- <ID>');
      const m = await obtenerTransmision(id);
      console.log(`\n  Titulo:     ${m.topic}`);
      console.log(`  Estado:     ${ESTADOS[m.status] ?? m.status}`);
      console.log(`  Inicio:     ${fecha(m.start_time)}`);
      console.log(`  Duracion:   ${m.duration} min`);
      console.log(`  Zona:       ${m.timezone ?? '-'}`);
      console.log(`  Unirse:     ${m.join_url}`);
      const s = await saludDelStream(id);
      if (s) {
        console.log(`  Participantes ahora: ${s.participants ?? '-'}`);
      }
      console.log();
      break;
    }

    case 'delete': {
      if (!id) throw new Error('Falta el ID. Uso: node src/cli.js delete <ID>');
      await eliminarTransmision(id);
      console.log(`\nReunion ${id} eliminada\n`);
      break;
    }

    default:
      ayuda();
  }
} catch (err) {
  fallar(err);
}
