/** Convierte errores de la API de Zoom en mensajes claros en espanol. */
export function explicarError(err) {
  const code = err?.zoom?.code;
  const msg = err?.zoom?.message || err?.message;

  switch (code) {
    case 124:
      return 'El token de acceso es invalido o expiro. Borra token.json y vuelve a intentar.';

    case 1001:
      return [
        'El usuario indicado no existe o no pertenece a esta cuenta.',
        'Revisa ZOOM_USER_ID en tu .env (usa "me" o el email del host).',
      ].join('\n');

    case 3001:
      return 'No existe una reunion con ese ID (o ya fue eliminada).';

    case 3002:
      return 'La reunion no esta en curso, no se puede finalizar.';

    case 300:
      return `Datos invalidos al crear la reunion: ${msg}`;

    case 429:
      return 'Se agoto el limite de peticiones de la API de Zoom. Espera unos segundos y reintenta.';

    case 4711:
    case 200:
      return [
        'La cuenta o la app no tienen permiso (scope) para esta accion.',
        'En Zoom Marketplace revisa que la app Server-to-Server OAuth tenga los scopes:',
        '  meeting:read, meeting:write, user:read (y webinar:* si usas webinars).',
      ].join('\n');
  }

  // Errores de red / OAuth sin "code" de Zoom
  if (err?.status === 401) {
    return 'Credenciales invalidas. Revisa ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET en .env';
  }

  return msg ?? String(err);
}

/** Imprime el error de forma legible y sale con codigo 1. */
export function fallar(err) {
  console.error('\n' + explicarError(err) + '\n');
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
}
