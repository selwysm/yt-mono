/**
 * Almacen de cuentas de YouTube.
 *
 * Cada cuenta es un archivo en  tokens/<slug>.json  con esta forma:
 *   { slug, nombre, canal: { id, titulo }, agregada, tokens: {...} }
 *
 * La cuenta activa (la que se usa cuando no pasas --cuenta) se guarda
 * en tokens/_config.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(__dirname, '..');
export const DIR_TOKENS = path.join(RAIZ, 'tokens');
const CONFIG = path.join(DIR_TOKENS, '_config.json');
const TOKEN_VIEJO = path.join(RAIZ, 'token.json');

/** "Alexandra Marin | Bienes raíces" -> "alexandra-marin-bienes-raices" */
export function aSlug(texto) {
  return String(texto)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // quita tildes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'cuenta';
}

function asegurarDir() {
  if (!fs.existsSync(DIR_TOKENS)) fs.mkdirSync(DIR_TOKENS, { recursive: true });
}

function rutaDe(slug) {
  return path.join(DIR_TOKENS, `${slug}.json`);
}

function leerConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; }
}

function escribirConfig(cfg) {
  asegurarDir();
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
}

/* ------------------------------------------------------------------ */
/* Operaciones                                                         */
/* ------------------------------------------------------------------ */

/** Todas las cuentas guardadas, ordenadas por nombre. */
export function listarCuentas() {
  if (!fs.existsSync(DIR_TOKENS)) return [];
  return fs.readdirSync(DIR_TOKENS)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(DIR_TOKENS, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Una cuenta por slug, o null. */
export function obtenerCuenta(slug) {
  try { return JSON.parse(fs.readFileSync(rutaDe(slug), 'utf8')); } catch { return null; }
}

/**
 * Resuelve el nombre que escribio el usuario contra las cuentas guardadas.
 * Acepta el slug exacto, o una coincidencia parcial del nombre/canal.
 * Lanza error si no existe o si es ambiguo.
 */
export function resolverCuenta(texto) {
  const cuentas = listarCuentas();
  if (!cuentas.length) {
    throw new Error('No hay cuentas configuradas. Agrega una con: npm run cuentas -- agregar <nombre>');
  }

  if (!texto) {
    const activa = cuentaActiva();
    if (activa) return activa;
    if (cuentas.length === 1) return cuentas[0];
    throw new Error(
      `Hay ${cuentas.length} cuentas y ninguna activa. Usa --cuenta <nombre>, o fija una con: npm run cuentas -- usar <nombre>`
    );
  }

  const exacta = cuentas.find((c) => c.slug === texto);
  if (exacta) return exacta;

  const t = texto.toLowerCase();
  const parciales = cuentas.filter(
    (c) => c.slug.includes(t) || c.nombre.toLowerCase().includes(t) ||
           (c.canal?.titulo ?? '').toLowerCase().includes(t)
  );
  if (parciales.length === 1) return parciales[0];
  if (parciales.length > 1) {
    throw new Error(
      `"${texto}" coincide con varias cuentas: ${parciales.map((c) => c.slug).join(', ')}. Se mas especifico.`
    );
  }
  throw new Error(
    `No existe la cuenta "${texto}". Disponibles: ${cuentas.map((c) => c.slug).join(', ')}`
  );
}

/** Crea o actualiza una cuenta. */
export function guardarCuenta({ slug, nombre, canal, tokens }) {
  asegurarDir();
  const previa = obtenerCuenta(slug);
  const registro = {
    slug,
    nombre: nombre ?? previa?.nombre ?? slug,
    canal: canal ?? previa?.canal ?? null,
    agregada: previa?.agregada ?? new Date().toISOString(),
    actualizada: new Date().toISOString(),
    // Conserva el refresh_token previo si el nuevo no trae uno.
    tokens: { ...(previa?.tokens ?? {}), ...tokens },
  };
  fs.writeFileSync(rutaDe(slug), JSON.stringify(registro, null, 2));
  return registro;
}

/** Guarda solo los tokens renovados, sin tocar el resto. */
export function actualizarTokens(slug, tokens) {
  const c = obtenerCuenta(slug);
  if (!c) return;
  c.tokens = { ...c.tokens, ...tokens };
  c.actualizada = new Date().toISOString();
  fs.writeFileSync(rutaDe(slug), JSON.stringify(c, null, 2));
}

/** Borra una cuenta del almacen (no revoca el acceso en Google). */
export function borrarCuenta(slug) {
  const ruta = rutaDe(slug);
  if (!fs.existsSync(ruta)) return false;
  fs.unlinkSync(ruta);
  const cfg = leerConfig();
  if (cfg.activa === slug) {
    delete cfg.activa;
    escribirConfig(cfg);
  }
  return true;
}

/** Marca una cuenta como la activa por defecto. */
export function activar(slug) {
  escribirConfig({ ...leerConfig(), activa: slug });
}

/** La cuenta activa, o null. */
export function cuentaActiva() {
  const { activa } = leerConfig();
  return activa ? obtenerCuenta(activa) : null;
}

/** Genera un slug libre a partir de un nombre deseado. */
export function slugDisponible(nombre) {
  const base = aSlug(nombre);
  if (!obtenerCuenta(base)) return base;
  for (let i = 2; i < 100; i++) {
    if (!obtenerCuenta(`${base}-${i}`)) return `${base}-${i}`;
  }
  throw new Error('No pude generar un slug libre.');
}
