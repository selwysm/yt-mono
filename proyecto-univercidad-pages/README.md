# Proxy de mi propio sitio con simulacion de conexion lenta

Proxy inverso (Node + Express) que sirve mi propia pagina
(`clase.alexandramarin.co`) e inyecta una simulacion de conexion lenta,
**conservando el envio real del formulario** (la reserva se sigue registrando).

## Importante: usar un subdominio DISTINTO

El proxy NO debe vivir en el mismo dominio que proxia, o se llamaria a si mismo
en bucle. Configuracion recomendada:

- `TARGET` = `https://clase.alexandramarin.co`  (contenido original)
- El proxy se publica en otro subdominio, p. ej. `evento.alexandramarin.co`.

Asi `clase` sigue intacto para las inscripciones reales y `evento` es la version
"lenta" para tus pruebas.

## Correr en local

```bash
npm install
npm run dev
# abre http://localhost:3000
```

## Variables de configuracion

| Variable | Que hace | Default |
|---|---|---|
| `TARGET` | Sitio propio a proxiar | `https://clase.alexandramarin.co` |
| `SERVER_DELAY_MS` | Retraso en la carga de la pagina (ms) | `0` |
| `FORM_DELAY_MS` | Duracion del "Cargando..." al enviar el form (ms) | `30000` |

Ejemplo para probar rapido:

```bash
SERVER_DELAY_MS=3000 FORM_DELAY_MS=4000 npm run dev
```

## Desplegar en Render

1. Sube esta carpeta a GitHub.
2. Render: New + -> Web Service -> conecta el repo (usa el `render.yaml`).
3. Custom Domain: agrega `evento.alexandramarin.co` y pon el CNAME que te den
   en GoDaddy (registro CNAME `evento`).

El envio del formulario se conserva: tras el "Cargando..." el formulario se
reenvia de verdad y la reserva se registra normalmente.
