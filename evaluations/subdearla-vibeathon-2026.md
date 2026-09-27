# Evaluación: Subdearla (Nerdearla Vibeathon 2026)

Repo: https://github.com/Lortbyron/subdearla (se leyó el código, no se ejecutó; se clonó sin shallow).
Campos de la API de Gemini verificados contra google-genai 2.25.0, la misma versión fijada en uv.lock.

## Ventana de tiempo (elegibilidad)
- Primer commit 0ac86ff: 24/09 17:28 GMT-3. Último commit f52a72e: 25/09 14:39 GMT-3. 19 commits en `main`, ninguno fuera de la ventana.
- Repo en GitHub creado el 2026-09-25T17:42:31Z, último push 17:42:39Z (un solo push). No es fork. La API de eventos no devuelve ningún PushEvent.
- Señales a revisar: primer commit grande (1838 líneas, ~45 % del código); commits 2 a 4 en 15 minutos; zona horaria -05:00. Nada de esto prueba trabajo previo.

## Gate: PASA
1. Audio: micrófono/entrada de línea (captura.html:166-173), audios de prueba + subida de archivos, script con ffmpeg (scripts/enviar_audio.py).
2. Transcripción en vivo: gemini-3.5-transcribe-live con parciales y finales (app/sesion.py).
3. Traducción EN→ES: Flash traduce a es/en/pt-BR en una sola llamada JSON (app/traductor.py:159-187), más traducción provisoria.
4. Subtítulos: index.html, pantalla del escenario, overlay.html.
5. 10 salas en config/salas.yaml; README.md:230-249 explica cómo escalar.

Demo: el link del README es el marcador `LINK_DEL_VIDEO` (duración declarada 1:59). Devpost pidió captcha, así que no se pudo revisar.

## Puntajes
| Criterio | Nota | Referencia | Motivo |
|---|---|---|---|
| Calidad | 3.5 | = Glosa/aura | El glosario por sala llega a custom_vocabulary y al prompt de traducción; contexto de 3 frases |
| Latencia | 3.5 | = Glosa/Live Subs | Bloques de 100 ms, parciales, traducción provisoria cada 1,2 s; sin medición de extremo a extremo |
| Escalabilidad | 3.5 | = Glosa | Salas en YAML, costo por sala, un proceso con estado en memoria |
| Despliegue | 4.0 | entre aura y Glosa | Reconexión, rotación a 8–9,5 min, GoAway, recuperación tras reinicio, panel, SRT/VTT con tiempos reales, Docker; auth que falla abierta, sin HTTPS, el público no ve las caídas |
| Innovación | 4.5 | = Glosa | Nerd Radar, "Ponete al día", NerdCut, carteles QR, captura desatendida, costo en vivo |
| **Total** | **19.0/25** | | Promedio 3.8 |

## Auth (análisis de seguimiento)
- Un solo token compartido, `INGESTA_TOKEN` (main.py:40). Se verifica en la ingesta WS (main.py:82) y en `exigir_clave` (main.py:238-240), que protege nueva-charla, marcar y clips.
- Falla abierta: con el token vacío (el valor por defecto de .env.example) todo queda sin protección.
- Sin auth: /api/estado, export.*, /api/videos, /api/clips, /videos, /clips, /resumen (este último dispara llamadas pagas a Gemini y `idioma` no se valida; radar.py:179).
- El token viaja en la URL (captura.html:118, panel.html:133,147, clips.html:182). No hay HTTPS ni rate limiting.

## Mejoras de mayor impacto
1. Exigir el token y proteger todos los endpoints de administración; validar `idioma` (~2 h).
2. Publicar eventos de estado de la sala para que el público vea las caídas (~2 h).
3. Caddy/HTTPS, ffmpeg en el Dockerfile, volúmenes para videos/ y clips/, /healthz (~3 h).
4. Métricas de latencia de extremo a extremo en el panel (~3 h).
5. Salas y glosario en tiempo de ejecución (~1 día).

## Notas para la planilla
3.5 | 3.5 | 3.5 | 4 | 4.5 | 19 | 3.8
- Buena calidad: el glosario por sala llega tanto a la transcripción como a la traducción, que además usa las frases previas como contexto
- Muy buen diseño de latencia: parciales en vivo y traducción provisoria del texto en curso, aunque falta medir el delay de punta a punta
- Las salas se definen en un YAML y el costo es por sala, no por espectador; corre en un solo proceso con estado en memoria
- Operación sólida: reconexión y rotación de la sesión de Gemini, recuperación tras reinicio, panel con semáforo y costo en vivo, y export SRT/VTT con tiempos reales
- Conviene exigir la clave de producción (hoy, si no se configura, todo queda abierto) y avisarle al público cuando una sala pierde la señal
- Nerd Radar, "Ponete al día", NerdCut y los carteles QR suman mucho valor más allá del pedido
