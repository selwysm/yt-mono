/**
 * Ejemplo de uso programatico (sin CLI).
 * Ejecutar:  node src/ejemplo.js
 */
import {
  listarCuentas, listarEnTodasLasCuentas, crearTransmision, finalizarTransmision,
} from './index.js';

// 1. Que cuentas hay configuradas
const cuentas = listarCuentas();
console.log(`${cuentas.length} cuenta(s):`);
cuentas.forEach((c) => console.log(' -', c.slug, '->', c.canal?.titulo));

// 2. Que esta EN VIVO en cada canal
console.log('\nEn vivo ahora:');
for (const g of await listarEnTodasLasCuentas('active')) {
  console.log(` [${g.cuenta.slug}] ${g.transmisiones.length} transmision(es)`);
  g.transmisiones.forEach((b) => console.log('   -', b.id, b.snippet.title));
}

// 3. Crear en una cuenta concreta (descomentar para usarlo de verdad)
// const nueva = await crearTransmision({
//   titulo: 'Prueba desde la API',
//   privacidad: 'private',
//   cuenta: cuentas[0].slug,
// });
// console.log('Creada:', nueva.broadcast.id, nueva.watchUrl);
// console.log('RTMP:', nueva.rtmp.servidor, '| clave:', nueva.rtmp.claveDeTransmision);

// 4. Finalizar (descomentar para usarlo de verdad)
// await finalizarTransmision('ID_AQUI', cuentas[0].slug);
