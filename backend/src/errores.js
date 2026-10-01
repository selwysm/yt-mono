/** Convierte errores de la API de Google en mensajes claros en espanol. */
export function explicarError(err) {
  const api = err?.response?.data?.error;
  const motivo = api?.errors?.[0]?.reason ?? api?.details?.[0]?.reason;
  const proyecto = api?.details?.find((d) => d.metadata)?.metadata?.containerInfo;

  switch (motivo) {
    case 'accessNotConfigured':
    case 'SERVICE_DISABLED':
      return [
        'La YouTube Data API v3 no esta habilitada en tu proyecto de Google Cloud.',
        '',
        'Solucion (un clic):',
        `  https://console.developers.google.com/apis/api/youtube.googleapis.com/overview?project=${proyecto ?? 'TU_PROYECTO'}`,
        '  -> boton "Habilitar" -> espera 1-2 minutos -> vuelve a intentar.',
      ].join('\n');

    case 'liveStreamingNotEnabled':
      return [
        'Tu canal todavia no tiene habilitadas las transmisiones en vivo.',
        '  1. Verifica el canal en https://youtube.com/verify',
        '  2. Activa el "en vivo" en https://youtube.com/livestreaming',
        '  3. La primera activacion puede tardar hasta 24 horas.',
      ].join('\n');

    case 'errorStreamInactive':
      return 'El stream no esta recibiendo video. Inicia OBS/ffmpeg apuntando al RTMP y reintenta.';

    case 'invalidTransition':
      return 'La transmision no esta en un estado que permita ese cambio. Revisa con: npm run status -- <ID>';

    case 'quotaExceeded':
      return 'Se agoto la cuota diaria de la API (10 000 unidades). Se reinicia a medianoche hora del Pacifico.';

    case 'forbidden':
    case 'insufficientPermissions':
      return [
        'La cuenta autorizada no tiene permiso sobre ese canal.',
        'Borra token.json y vuelve a correr "npm run auth" con la cuenta dueña del canal.',
      ].join('\n');

    case 'authError':
    case 'invalid_grant':
      return 'El token expiro o fue revocado. Borra token.json y corre "npm run auth" de nuevo.';

    default:
      return api?.message ?? err?.message ?? String(err);
  }
}

/** Imprime el error de forma legible y sale con codigo 1. */
export function fallar(err) {
  console.error('\n' + explicarError(err) + '\n');
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
}
