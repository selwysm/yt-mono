#!/usr/bin/env node
/**
 * WEBINARS (seminarios web).
 *
 *   npm run webinars                         TODOS (programados y pasados)
 *   npm run webinars -- pasados              solo los ya realizados
 *   npm run webinars -- proximos             solo los que faltan
 *   npm run webinars -- pasados --desde 2026-07-01 --hasta 2026-07-31
 *   npm run webinars -- status <ID>          datos de un webinar
 *   npm run webinars -- end <ID>             finaliza uno en curso
 *   node src/webinars.js delete <ID>         elimina uno programado
 */
import {
  listarWebinars,
  crearWebinar,
  obtenerWebinar,
  reporteWebinar,
  finalizarWebinar,
  eliminarWebinar,
} from './zoom.js';
import { fallar } from './errores.js';

const [, , comando, ...args] = process.argv;

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

function fecha(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

const CUANDO = { todos: 'todos', pasados: 'pasados', anteriores: 'pasados', proximos: 'proximos', programados: 'proximos' };

async function listar(cuando) {
  const items = await listarWebinars({ cuando, desde: f.desde, hasta: f.hasta });
  const etiqueta = { todos: 'webinar(s)', pasados: 'webinar(s) realizado(s)', proximos: 'webinar(s) proximo(s)' }[cuando];
  if (!items.length) { console.log(`\nNo hay ${etiqueta}.\n`); return; }
  console.log(`\n${items.length} ${etiqueta}\n`);
  const ahora = Date.now();
  for (const w of items) {
    // En 'proximos' Zoom ya filtro (no terminados); en el resto uso la fecha.
    const proximo = cuando === 'proximos' || new Date(w.start_time).getTime() >= ahora;
    console.log(`[ ${proximo ? 'proximo' : 'finalizado'} ]  ${w.topic}`);
    console.log(`   ID:      ${w.id}`);
    console.log(`   Inicio:  ${fecha(w.start_time)}`);
    console.log(`   Unirse:  ${w.join_url}`);
    if (proximo) console.log(`   Finalizar:  npm run webinars -- end ${w.id}`);
    console.log();
  }
}

try {
  switch (comando) {
    case undefined:
    case 'list':
    case 'todos':
      await listar('todos');
      break;

    case 'pasados':
    case 'anteriores':
      await listar('pasados');
      break;

    case 'proximos':
    case 'programados':
      await listar('proximos');
      break;

    case 'create': {
      if (!f.titulo) throw new Error('Falta --titulo "Mi seminario web"');
      const w = await crearWebinar({
        titulo: f.titulo,
        descripcion: f.descripcion ?? '',
        inicio: f.inicio,
        duracion: f.duracion ? Number(f.duracion) : undefined,
        zonaHoraria: f.zona,
        password: f.password,
      });
      console.log('\nWebinar creado\n');
      console.log(`  ID:        ${w.id}`);
      console.log(`  Titulo:    ${w.topic}`);
      console.log(`  Inicio:    ${fecha(w.start_time)}`);
      console.log(`  Duracion:  ${w.duration} min`);
      console.log(`  Password:  ${w.password ?? '(sin password)'}`);
      console.log(`\n  Registrarse/unirse:  ${w.join_url}`);
      if (w.start_url) console.log(`  Iniciar (host):      ${w.start_url}`);
      console.log(`\n  Para finalizarlo:  npm run webinars -- end ${w.id}\n`);
      break;
    }

    case 'status': {
      if (!id) throw new Error('Falta el ID. Uso: npm run webinars -- status <ID>');
      const w = await obtenerWebinar(id).catch(() => null);
      if (w) {
        console.log(`\n  Titulo:   ${w.topic}`);
        console.log(`  Estado:   ${w.status ?? '-'}`);
        console.log(`  Inicio:   ${fecha(w.start_time)}`);
        console.log(`  Duracion: ${w.duration} min`);
        console.log(`  Unirse:   ${w.join_url}`);
      } else {
        const r = await reporteWebinar(id);
        if (!r) throw new Error(`No se encontro el webinar ${id}.`);
        console.log(`\n  Titulo:        ${r.topic}`);
        console.log(`  Inicio:        ${fecha(r.start_time)}`);
        console.log(`  Fin:           ${fecha(r.end_time)}`);
        console.log(`  Participantes: ${r.participants_count ?? '-'}`);
      }
      console.log();
      break;
    }

    case 'end': {
      if (!id) throw new Error('Falta el ID. Uso: npm run webinars -- end <ID>');
      await finalizarWebinar(id);
      console.log(`\nWebinar ${id} finalizado\n`);
      break;
    }

    case 'delete': {
      if (!id) throw new Error('Falta el ID. Uso: node src/webinars.js delete <ID>');
      await eliminarWebinar(id);
      console.log(`\nWebinar ${id} eliminado\n`);
      break;
    }

    default:
      console.log(`
Webinars (seminarios web)

  npm run webinars                         TODOS (programados y pasados)
  npm run webinars -- pasados              solo los ya realizados
  npm run webinars -- proximos             solo los que faltan
  npm run webinars -- pasados --desde 2026-07-01 --hasta 2026-07-31

  npm run webinars -- create --titulo "Clase 1" [--inicio ISO] [--duracion 90] [--password 123]
  npm run webinars -- status <ID>          datos de un webinar
  npm run webinars -- end <ID>             finaliza uno en curso
  node src/webinars.js delete <ID>         elimina uno programado
`);
  }
} catch (err) {
  fallar(err);
}
