# Transmisiones en vivo de YouTube desde la API

Crea, inicia y **finaliza** transmisiones en vivo de YouTube desde Node.js.
Funciona tanto con las transmisiones creadas por la API como con las que ya
creaste desde **YouTube Studio** (aparecen en `npm run list` y se pueden
finalizar con `npm run end`).

## Requisitos previos

1. **Canal con transmisiones habilitadas.** En https://youtube.com/verify verifica
   tu canal. La primera activación del "en vivo" puede tardar hasta 24 horas.
2. **API de YouTube Data v3 habilitada** en tu proyecto de Google Cloud.
3. **Tu correo agregado como usuario de prueba**:
   Google Auth Platform → *Público* → *Usuarios de prueba* → agrega tu Gmail.
   Sin esto, el login da "Acceso bloqueado".

## Instalación

```bash
npm install
```

Las credenciales ya están en `.env`. Si creas unas nuevas, copia `.env.example`.

## 1. Agregar tu primera cuenta

El proyecto maneja **varias cuentas de YouTube a la vez**. Cada una se guarda
en `tokens/<slug>.json` y se identifica por un *slug* corto.

```bash
# El navegador está en ESTA máquina:
npm run cuentas -- agregar "Canal principal"

# El navegador está en OTRA máquina (te da una URL para copiar):
npm run cuentas -- agregar-manual "Canal principal"
```

En el navegador: elige la cuenta dueña del canal → si sale "Google no verificó
esta app", entra por **Configuración avanzada → Ir a … (no seguro)** → acepta.

Si vienes de la versión de una sola cuenta, tu `token.json` se migra solo la
primera vez que corras cualquier comando (queda como `token.json.respaldo`).

## 2. Habilitar la YouTube Data API v3

Un solo clic, en el proyecto de Google Cloud:

https://console.developers.google.com/apis/api/youtube.googleapis.com/overview?project=343669020529

Botón **Habilitar** → espera 1-2 minutos a que propague.

## 3. Comandos

### Gestionar cuentas

```bash
npm run cuentas                              # lista las cuentas (* = activa)
npm run cuentas -- agregar "Otro canal"      # agrega otra
npm run cuentas -- agregar-manual "Otro"     # agrega desde otro computador
npm run cuentas -- usar <nombre>             # fija la cuenta por defecto
npm run cuentas -- borrar <nombre>           # la quita del almacén
npm run diagnostico                          # revisa TODAS las cuentas
```

El `<nombre>` acepta el slug exacto o un trozo del nombre/canal: si tienes
`alexandra-marin-bienes-raices-flipping`, basta con escribir `alexandra`.

### Ver transmisiones

```bash
npm run ver                          # EN VIVO, en TODAS las cuentas
npm run ver -- programadas           # las agendadas
npm run ver -- finalizadas           # historial
npm run ver -- todas                 # todos los estados
npm run ver -- --cuenta alexandra    # solo esa cuenta
```

Con más de una cuenta agrupa los resultados por canal. Si una cuenta falla
(token vencido, canal sin permiso), lo reporta en su grupo y sigue con las demás.

### Finalizar transmisiones

```bash
npm run finalizar -- <ID>                      # detecta solo en qué cuenta está
npm run finalizar -- <ID1> <ID2>               # varias
npm run finalizar -- --todas                   # todas las EN VIVO de TODAS las cuentas
npm run finalizar -- --todas --cuenta alexandra  # solo esa cuenta
npm run finalizar -- --todas --si              # sin confirmación
```

No necesitas decir de qué cuenta es un ID: lo busca en todas. Igual funciona
con las transmisiones creadas desde **YouTube Studio**.

### Crear transmisiones

```bash
npm run create -- --titulo "Clase 1" --privacidad unlisted
npm run create -- --titulo "Clase 1" --cuenta otro-canal
npm run status -- <ID>               # estado + salud del stream
npm run start  -- <ID>               # forzar paso a EN VIVO
```

`create` usa la **cuenta activa** salvo que pases `--cuenta`, y siempre imprime
en qué canal va a crear antes de hacerlo.

Al crear, la salida te da el **servidor RTMP** y la **clave de transmisión**
para pegar en OBS (*Ajustes → Emisión → Servicio: Personalizado*).

## 4. Cómo funciona el ciclo de vida

```
created ──(bind stream)──> ready ──> testing ──> live ──> complete
```

- `created`: el evento existe pero no tiene stream conectado.
- `ready`: ya tiene stream RTMP vinculado, esperando video.
- `live`: en vivo. Se llega con `npm run start` o solo si `enableAutoStart`.
- `complete`: finalizada. Se llega con `npm run end` o solo si `enableAutoStop`.

Por defecto se crean con **autoStart y autoStop activados**: en cuanto OBS
empieza a enviar video, pasa a vivo sola; cuando cortas, se finaliza sola.
Usa `--no-autostart` / `--no-autostop` si quieres controlarlo tú por API.

## 5. Enviar video sin OBS (para probar rápido)

Con ffmpeg, una barra de color de prueba:

```bash
ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=30 \
       -f lavfi -i sine=frequency=1000 \
       -c:v libx264 -preset veryfast -b:v 2500k -g 60 \
       -c:a aac -b:a 128k -f flv \
       "rtmp://a.rtmp.youtube.com/live2/TU_CLAVE_DE_TRANSMISION"
```

## 6. Uso desde código

```js
import {
  listarCuentas, listarEnTodasLasCuentas,
  crearTransmision, finalizarTransmision,
} from './src/index.js';

// Todas las cuentas configuradas
console.log(listarCuentas().map((c) => c.slug));

// Qué está en vivo en cada canal
for (const g of await listarEnTodasLasCuentas('active')) {
  console.log(g.cuenta.slug, g.transmisiones.length);
}

// Crear en una cuenta concreta
const r = await crearTransmision({
  titulo: 'Mi clase',
  privacidad: 'unlisted',
  cuenta: 'alexandra',
});
console.log(r.watchUrl, r.rtmp.claveDeTransmision);

await finalizarTransmision(r.broadcast.id, 'alexandra');
```

Ver `src/ejemplo.js`.

## Errores comunes

| Error | Causa |
|---|---|
| `Acceso bloqueado: no completó el proceso de verificación` | Falta agregar tu correo en *Usuarios de prueba* |
| `liveStreamingNotEnabled` | El canal no tiene el "en vivo" habilitado, o autorizaste una cuenta sin canal. Corre `npm run diagnostico` |
| `accessNotConfigured` / `SERVICE_DISABLED` | Falta habilitar la YouTube Data API v3 (paso 2) |
| `errorStreamInactive` al hacer `start` | No hay video entrando por RTMP |
| `invalidTransition` | El estado actual no permite ese salto (revisa con `status`) |
| `quotaExceeded` | La cuota diaria por defecto es 10 000 unidades; crear una transmisión gasta ~50 |

## Seguridad

`.env` y la carpeta `tokens/` están en `.gitignore`. **No los subas a GitHub.**
Cada archivo de `tokens/` da acceso completo a un canal de YouTube: trátalos
como contraseñas y haz una copia de respaldo fuera del proyecto.
Las credenciales actuales estuvieron expuestas en un chat: cuando termines el
proyecto, bórralas en Google Cloud Console y genera unas nuevas.

## Nota sobre la API key

La API key (`YOUTUBE_API_KEY`) **no sirve** para crear o finalizar transmisiones:
solo permite lecturas públicas. Todo lo de `liveBroadcasts` requiere OAuth, que
es lo que hace `npm run auth`.

## Depurar

Para ver el error crudo de la API en vez del mensaje resumido:

```bash
DEBUG=1 npm run ver
```
