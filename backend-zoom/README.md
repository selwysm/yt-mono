# Zoom Live API (CLI)

CLI para **crear, ver y finalizar reuniones (transmisiones) de Zoom**, gemelo del
proyecto `backend` de YouTube pero contra la API de Zoom.

Usa **Server-to-Server OAuth**: no hay flujo de navegador ni consentimiento de
usuario. Solo credenciales de cuenta y un `access_token` que se renueva solo.

## 1. Crear la app en Zoom

1. Entra a <https://marketplace.zoom.us> → **Develop → Build App**.
2. Elige **Server-to-Server OAuth**.
3. Copia `Account ID`, `Client ID` y `Client Secret`.
4. En **Scopes** agrega, como mínimo:
   - `meeting:read`, `meeting:write`
   - `user:read`
   - (si usarás webinars) `webinar:read`, `webinar:write`
   - (opcional, para métricas en vivo) `dashboard_meetings:read`
5. **Activate** la app.

## 2. Configurar

```bash
cd backend-zoom
npm install
cp .env.example .env
# edita .env con tus credenciales
```

## 3. Usar

```bash
npm run auth                              # valida credenciales y muestra tu usuario

npm run ver                               # reuniones EN VIVO ahora
npm run ver -- todas                      # todas las programadas
npm run ver -- finalizadas                # historial

npm run create -- --titulo "Clase 1" \
     --inicio 2026-08-20T15:00:00Z \
     --duracion 90

npm run status -- <ID>                    # estado y datos de una reunion
npm run start  -- <ID>                    # muestra el start_url (el host inicia)
npm run end    -- <ID>                    # FINALIZA la reunion en curso
npm run finalizar -- --todas              # finaliza todas las que estan en vivo

node src/cli.js delete <ID>               # elimina una reunion programada
```

## Notas de diseño

- **Iniciar**: Zoom no arranca una reunión por API; el host la inicia abriendo su
  `start_url` (contiene un token que expira ~2 h). Por eso `start` solo muestra ese enlace.
- **Finalizar**: `PATCH /meetings/{id}/status {action:"end"}`. Solo funciona si la
  reunión está *en curso*.
- **Grabación**: las reuniones se crean con `auto_recording: cloud`.
- El `access_token` se cachea en `token.json` (git-ignorado) y se renueva al expirar.

## Estructura

| Archivo | Rol |
|---|---|
| `src/auth.js` | Token Server-to-Server + cliente HTTP `zoom()` |
| `src/zoom.js` | Lógica: crear / listar / obtener / iniciar / finalizar / eliminar |
| `src/cli.js` | Comandos `create`/`start`/`end`/`status`/`list`/`delete` |
| `src/ver.js` | Ver reuniones por estado |
| `src/finalizar.js` | Finalizar una, varias o todas |
| `src/errores.js` | Traduce errores de Zoom a español |
| `src/index.js` | Exporta todo para usarlo como librería |
