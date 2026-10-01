// Punto de entrada para usar el proyecto como libreria desde otro codigo.
export {
  getAuthenticatedClient, getMeetClient, getCalendarClient, autorizarEnNavegador,
  registrarCuentaConCodigo, urlDeAutorizacion,
} from './auth.js';
export {
  listarCuentas, obtenerCuenta, resolverCuenta, guardarCuenta,
  borrarCuenta, activar, cuentaActiva,
} from './cuentas.js';
export {
  crearSala, programarReunion, salaFija, obtenerSala,
  listarEnVivo, listarEnVivoEnTodasLasCuentas, listarFinalizadas, listarProgramadas,
  participantesActuales, finalizarReunion, eliminarProgramada,
  enTodasLasCuentas, buscarSalaEnCuentas, esDeLaApp, aNombreDeSala,
} from './meet.js';
