# alexandramarinbr-origen (puerta trasera)

Copia estatica de `https://evento.alexandramarinbr.com/rg-co` (GreatPages),
usada como origen del proxy de Render.

## Estructura

- `rg-co/index.html`: pagina de registro (nuevo diseno).
- `gr/index.html`: pagina de gracias + boton de WhatsApp.
- `index.html`: redirige a `/rg-co`.

El formulario conserva el comportamiento real (GreatPages). Tras enviar, va a
`/gr`. El proxy cambia el grupo de WhatsApp por `WHATSAPP_BR`. El Meta Pixel
esta desactivado en ambas paginas.

## Probar en local

```
python3 -m http.server 8090
```

Abre http://localhost:8090/rg-co o http://localhost:8090/gr
