/** Convierte errores de las APIs de Google (Meet / Calendar) en mensajes claros en espanol. */
export function explicarError(err) {
  const data = err?.response?.data;

  // Errores de OAuth (token vencido o revocado): { error: 'invalid_grant' }
  if (data?.error === 'invalid_grant' || err?.message === 'invalid_grant') {
    return [
      'El token de esta cuenta expiro o fue revocado.',
      'Vuelve a autorizarla:  npm run cuentas -- agregar "<nombre>"',
    ].join('\n');
  }

  const api = typeof data?.error === 'object' ? data.error : null;
  const motivo = api?.errors?.[0]?.reason ?? api?.details?.find((d) => d.reason)?.reason;
  const meta = api?.details?.find((d) => d.metadata)?.metadata;
  const status = api?.status;

  switch (motivo) {
    case 'accessNotConfigured':
    case 'SERVICE_DISABLED': {
      const servicio = meta?.service ?? 'meet.googleapis.com';
      const nombre = servicio.startsWith('calendar') ? 'Google Calendar API' : 'Google Meet API';
      return [
        `La ${nombre} no esta habilitada en tu proyecto de Google Cloud.`,
        '',
        'Solucion (un clic):',
        `  https://console.developers.google.com/apis/api/${servicio}/overview?project=${meta?.consumer?.split('/')[1] ?? meta?.containerInfo ?? 'TU_PROYECTO'}`,
        '  -> boton "Habilitar" -> espera 1-2 minutos -> vuelve a intentar.',
      ].join('\n');
    }

    case 'ACCESS_TOKEN_SCOPE_INSUFFICIENT':
    case 'insufficientPermissions':
      return [
        'La cuenta no concedio todos los permisos que pide este proyecto.',
        'Vuelve a autorizarla marcando TODAS las casillas:  npm run cuentas -- agregar "<nombre>"',
      ].join('\n');

    case 'rateLimitExceeded':
    case 'RATE_LIMIT_EXCEEDED':
    case 'quotaExceeded':
      return 'Se supero el limite de peticiones de la API de Google. Espera un momento y reintenta.';
  }

  switch (status) {
    case 'PERMISSION_DENIED':
      return [
        'Google no permite esta accion sobre esa reunion.',
        'Si la reunion se creo a mano (meet.google.com o Google Calendar), la API no puede',
        'finalizarla: solo puede con las creadas por este proyecto (npm run create / npm run sala).',
        'Finalizala desde Meet con "Finalizar la llamada para todos".',
      ].join('\n');

    case 'NOT_FOUND':
      return 'No existe esa reunion, o esta cuenta no tiene acceso a ella.';

    case 'FAILED_PRECONDITION':
      return 'La reunion no tiene una llamada activa: no hay nada que finalizar.';

    case 'RESOURCE_EXHAUSTED':
      return 'Se supero el limite de peticiones de la API de Meet. Espera un momento y reintenta.';

    case 'UNAUTHENTICATED':
      return 'El token de esta cuenta no es valido. Vuelve a autorizarla:  npm run cuentas -- agregar "<nombre>"';
  }

  return api?.message ?? err?.message ?? String(err);
}

/** Imprime el error de forma legible y sale con codigo 1. */
export function fallar(err) {
  console.error('\n' + explicarError(err) + '\n');
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
}
