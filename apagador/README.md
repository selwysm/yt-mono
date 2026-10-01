# Apagador de transmisiones

Finaliza **todo lo que esté en vivo** en YouTube, Zoom y Google Meet, una y otra
vez, durante un periodo. Usa las funciones de `../backend`, `../backend-zoom` y
`../backend-meet` (sus `.env` y `tokens/`), sin modificarlos.

```bash
cd apagador
npm run apagar                             # cada 5 s durante 60 min
npm run apagar -- --minutos 30 --cada 10   # otro periodo / intervalo
```

Ctrl+C lo detiene y muestra el resumen. `caffeinate` evita que el Mac se duerma.

## Qué revisa en cada vuelta

| Plataforma | Qué finaliza |
|---|---|
| YouTube | Transmisiones EN VIVO de **todas** las cuentas de `backend/tokens/` |
| Zoom | Reuniones EN VIVO del usuario `ZOOM_USER_ID` |
| Zoom | Webinars en curso (ver nota) |
| Meet | Llamadas EN VIVO de **todas** las cuentas de `backend-meet/tokens/` (ver nota) |

**Webinars:** Zoom no tiene filtro "en vivo" para webinars. Si la cuenta tiene
Dashboard (Business+) se usa `/metrics/webinars?type=live`; si no, se intenta
finalizar cada webinar próximo programado entre hace 12 h y dentro de 2 h. Los
que no están en curso se ignoran.

**Meet:** Google solo deja finalizar las salas creadas por `backend-meet`
(`npm run create` / `npm run sala`). Si detecta una Meet creada a mano en vivo,
lo avisa **una vez** en el log para que alguien la corte desde Meet.

## Log

Todo queda en `logs/apagador-AAAA-MM-DD.log`. Un error repetido (token vencido,
sin red) se muestra una sola vez y el ciclo sigue.

## ⚠️ Cuidado

Mientras corre, **cualquier transmisión que alguien inicie se corta en segundos**.

Cuota de YouTube: ~1 440 unidades por hora con 2 cuentas (de 10 000 diarias).
No conviene correrlo muchas horas el mismo día.
