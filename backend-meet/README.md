# Reuniones de Google Meet desde la API

Crea, programa, ve y **finaliza** reuniones de Google Meet desde Node.js.
Gemelo de `backend` (YouTube) y `backend-zoom`: mismos comandos, varias cuentas.

## ⚠️ La regla más importante

La API de Google **solo deja finalizar las reuniones creadas por este proyecto**
(`npm run create` o `npm run sala`). Las que alguien crea a mano en
meet.google.com o en Google Calendar **se pueden ver pero no finalizar**, aunque
sean de tu misma cuenta. Para esas: en Meet, *"Finalizar la llamada para todos"*.

Por eso cada cuenta tiene una **sala fija** (`npm run sala`): un link permanente
para usar siempre en vez de crear reuniones a mano. Esa sí se puede cortar.

## Requisitos previos

Usa las **mismas credenciales de Google Cloud** que `backend` (el `.env` ya está
copiado). Solo hay que habilitar dos APIs más en ese proyecto:

1. **Google Meet API** →
   https://console.developers.google.com/apis/api/meet.googleapis.com/overview?project=343669020529
2. **Google Calendar API** →
   https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=343669020529

Botón **Habilitar** en cada una → espera 1-2 minutos.

Tu correo debe seguir en *Google Auth Platform → Público → Usuarios de prueba*
(igual que para YouTube).

## Instalación

```bash
cd backend-meet
npm install
```

## 1. Agregar las cuentas

Los tokens de YouTube **no sirven** aquí (tienen otros permisos): hay que
autorizar cada cuenta una vez. En la pantalla de Google **marca todas las casillas**.

```bash
npm run cuentas -- agregar "Alexandra"          # navegador en ESTA máquina
npm run cuentas -- agregar-manual "Alexandra"   # navegador en OTRA máquina
npm run diagnostico                             # revisa permisos y APIs
```

Meet funciona con el **Gmail**, no con el canal de YouTube. Si tus dos canales
cuelgan del mismo Gmail, aquí será **una sola cuenta**. Si vuelves a agregar un
Gmail que ya existe, se actualiza (no se duplica).

## 2. Comandos

### Gestionar cuentas

```bash
npm run cuentas                              # lista las cuentas (* = activa)
npm run cuentas -- usar <nombre>             # fija la cuenta por defecto
npm run cuentas -- borrar <nombre>           # la quita del almacén
```

### Sala fija (recomendado)

```bash
npm run sala                        # muestra (o crea la primera vez) la sala fija
npm run sala -- --cuenta otra       # la de otra cuenta
npm run sala -- --nueva             # la reemplaza por un link nuevo
```

### Crear reuniones

```bash
# Link inmediato
npm run create -- --titulo "Reunión rápida"

# Programada en Google Calendar (hora de Bogotá si no pones zona)
npm run create -- --titulo "Clase 1" --inicio 2026-10-01T15:00 --duracion 90

# Con invitados (Google les manda el correo) y acceso abierto
npm run create -- --titulo "Clase 1" --inicio 2026-10-01T15:00 \
     --invitados "ana@gmail.com,luis@gmail.com" --acceso abierta
```

`--acceso`: `abierta` (entra cualquiera con el link), `confiable` (cuentas de
tu organización) o `restringida` (solo invitados; el resto pide permiso).

### Ver reuniones

```bash
npm run ver                          # EN VIVO, en TODAS las cuentas
npm run ver -- programadas           # las programadas por el proyecto
npm run ver -- finalizadas           # historial (Google lo guarda 30 días)
npm run ver -- todas                 # en vivo + programadas
npm run ver -- --cuenta alexandra    # solo esa cuenta
```

Las EN VIVO muestran si son del proyecto (se pueden finalizar) o creadas a mano.

### Finalizar

```bash
npm run finalizar -- abc-defg-hij             # detecta sola la cuenta
npm run finalizar -- --todas                  # todas las EN VIVO de TODAS las cuentas
npm run finalizar -- --todas --cuenta alexandra
npm run finalizar -- --todas --si             # sin confirmación
```

Finalizar saca a todos de la llamada. **El link sigue sirviendo**: si alguien
vuelve a entrar, arranca una llamada nueva.

### Otros

```bash
npm run status -- abc-defg-hij       # estado, origen y personas conectadas
node src/cli.js delete abc-defg-hij  # borra una programada (su evento de Calendar)
```

El código acepta `abc-defg-hij`, `https://meet.google.com/abc-defg-hij` o `spaces/xxxx`.

## Cómo funciona

| Concepto | Qué es |
|---|---|
| **Sala** (*space*) | El link `meet.google.com/abc-defg-hij`. Permanente, reutilizable. |
| **Llamada** (*conference*) | Cada vez que alguien entra y arranca. Está EN VIVO mientras no termine. |
| **Evento de Calendar** | Solo para las programadas: fecha, invitados y el link de la sala. |

- No hay "iniciar": la llamada arranca cuando entra la primera persona.
- No hay RTMP: Meet no transmite a OBS como YouTube.
- La API no permite borrar salas; `delete` borra el evento de Calendar.
- Las salas creadas se registran en `tokens/<slug>.json` → `salas`. Si borras
  la cuenta con `npm run cuentas -- borrar`, se pierde ese registro.

## Uso desde código

```js
import { crearSala, listarEnVivoEnTodasLasCuentas, finalizarReunion } from './src/index.js';

const sala = await crearSala({ titulo: 'Clase', cuenta: 'alexandra' });
console.log(sala.meetingUri);

for (const g of await listarEnVivoEnTodasLasCuentas()) {
  for (const r of g.items) if (r.deLaApp) await finalizarReunion(r.spaceName, g.cuenta.slug);
}
```

## Errores comunes

| Error | Causa |
|---|---|
| `Google Meet API no está habilitada` | Falta el paso de Requisitos previos |
| `No se concedieron todos los permisos` | Desmarcaste casillas al autorizar. Repite y marca todas |
| `Google no permite esta acción sobre esa reunión` | La reunión se creó a mano: no se puede finalizar por API |
| `No tiene una llamada activa` | No hay nadie en la reunión |
| `El token expiró o fue revocado` | Vuelve a correr `npm run cuentas -- agregar "<nombre>"` |

## Seguridad

`.env` y `tokens/` están en `.gitignore`. **No los subas a GitHub.**
Cada archivo de `tokens/` da acceso a Meet y Calendar de esa cuenta.

## Depurar

```bash
DEBUG=1 npm run ver
```
