# DiseñoIA

Suite de diseño para impresión textil (sublimación, serigrafía, DTF) que corre **en el navegador**.

Subís la foto de una camiseta, taza, banner, wind banner o shorts y la IA hace el trabajo de producción:
- detecta cada arte y lo recrea plano y limpio;
- lo vectoriza separado por color;
- lo exporta listo para imprimir.

Además incluye creador de diseños, generador de imágenes, mockup 3D, fondo mágico, upscaler y fuentes.

## Instalar en otra PC

**Requisitos**
- [Node.js](https://nodejs.org) 20 o superior.
- Una forma de usar IA, a elección:
  - **Codex** (la app de escritorio de OpenAI, con la sesión iniciada con una cuenta de ChatGPT): no necesita claves de API;
  - **una clave de API** de Gemini, OpenAI, Anthropic o FAL, que se carga en **Ajustes** dentro de la app;
  - o nada: el **modo demo** permite probar el flujo sin IA.

**Pasos**

```bash
git clone https://github.com/UserBreus/DisenoIA.git
```
```bash
cd DisenoIA
```
```bash
npm install
```
```bash
npm run build
```
```bash
node bridge/codex-bridge.mjs
```

Después abrí **http://127.0.0.1:8787** en el navegador. El último comando levanta el puente local con Codex y sirve la app; dejá esa ventana abierta mientras la usás.

> En Windows, si PowerShell dice que "la ejecución de scripts está deshabilitada", usá `npm.cmd install` y `npm.cmd run build` en lugar de `npm …`.

Si no vas a usar Codex, también podés abrir `dist/index.html` directamente y elegir otro proveedor en **Ajustes**.

Para desarrollar: `npm run dev` (http://localhost:5173, con el puente corriendo en otra ventana).

## Por qué así

| Decisión | Motivo |
|---|---|
| TypeScript → JavaScript puro, sin framework | Carga instantánea y nada pesado que descargar |
| Un solo `dist/index.html` (~215 KB, ~75 KB gzip) | Se abre con doble clic o se sube a cualquier hosting estático |
| Sin backend propio | Las llamadas van del navegador a cada proveedor (o a Codex mediante el puente local) |
| Canvas 2D + WebGL2 propios | Recortes, máscaras, vectorizado y mockup 3D sin librerías |
| ZIP, TIFF CMYK, EPS y PDF escritos a mano | Sin dependencias de ejecución |

## Codex local (por defecto, sin API)

Usa la cuenta de ChatGPT con la que Codex está logueado en esta PC. El navegador no puede ejecutar programas, así que un puente mínimo en Node (`bridge/codex-bridge.mjs`, sin dependencias) recibe las solicitudes en `127.0.0.1:8787` y las ejecuta con `codex exec`:

- **Análisis:** se adjunta la foto (`-i`) y se devuelve el JSON. Usa `--ephemeral`, sandbox de solo lectura y sin herramientas.
- **Recreación:** se adjuntan las referencias y Codex usa su generador de imágenes integrado. El puente toma el PNG de `~/.codex/generated_images/<hilo>/`.

```bash
npm run codex    # terminal 1: puente (detecta codex.exe de la app de escritorio o del PATH)
npm run dev      # terminal 2: app en http://localhost:5173 (Vite redirige /codex al puente)
```

También podés usar solo el puente: después de `npm run build`, abrí `http://127.0.0.1:8787` y te sirve la app ya compilada en el mismo origen.

- **Medido en esta PC:**
  - Análisis con `gpt-6.1-sol`: entre ~20 s (foto simple) y ~80 s (camiseta compleja con 12 artes).
  - Recreación: entre ~30 y ~60 s.
- **Velocidad vs. calidad:** casi todo el tiempo es el turno del modelo.
  - El puente corre sin tu `config.toml` global, con instrucciones cortas y sin herramientas, y responde apenas termina el turno.
  - `gpt-6-luna` analiza en ~8 s pero lee mal textos y escenas complejas (escribió "la 14" en vez de "la IA" y vio un puente donde había un mercado). Por eso el análisis usa `gpt-6.1-sol`.
  - Podés cambiar el modelo con `CODEX_ANALYSIS_MODEL` o en **Ajustes**.
- **Recreación fiel:** el puente le exige al generador recibir la foto (`num_last_images_to_include`) y le pasa nuestro prompt textual, sin que el agente lo reescriba.
  - Después revisa el registro de la sesión de Codex. Si generó sin mirar la foto, reintenta con el modelo grande.
  - Los prompts están en modo edición: "editá esta imagen, conservá la ilustración, quitá solo X".
- **Concurrencia:** `CODEX_CONCURRENCY` (por defecto 2).
- **Otras variables:** `CODEX_BIN` (ruta a codex.exe), `BRIDGE_TOKEN` (exige el encabezado `x-bridge-token`) y `ALLOW_FILE_ORIGIN=1` (para abrir la app con file://).
- **Seguridad:** el puente escucha solo en 127.0.0.1 y únicamente acepta solicitudes de orígenes localhost.
- **Uso:** pensado para pruebas personales. Consume el cupo de tu plan de ChatGPT/Codex.
- Las opciones por API siguen disponibles en **Ajustes**.

## Proveedores (intercambiables)

| Paso | Opciones | Modelo por defecto (editable) |
|---|---|---|
| Todo (análisis y recreación) | **Codex local** (cuenta de ChatGPT, sin API) | el configurado en Codex |
| Análisis → JSON | Gemini, OpenAI o compatible (OpenRouter, gateways), Anthropic, Demo | `gemini-2.5-flash`, `gpt-4.1-mini`, `claude-sonnet-5-5` |
| Recreación | Gemini imagen, OpenAI Images (`/images/edits`, alfa nativo), FAL, Demo | `gemini-2.5-flash-image`, `gpt-image-1`, `fal-ai/nano-banana/edit` |
| Ampliar / vectorizar / quitar fondo | Local (gratis) o FAL | `recraft/upscale/crisp`, `recraft/vectorize`, `birefnet/v2` |

Las claves se guardan **sólo en `localStorage` de tu navegador**. Usá claves con límite de gasto. Si vas a publicar la app para terceros, poné un proxy propio delante de los proveedores (ver "Pendiente").

## Herramientas

| Herramienta | Qué hace |
|---|---|
| **Extractor** | Foto del producto → cada logo, texto y fondo recreado por separado, con versiones y exportación |
| **Creador** | Idea del cliente + producto → 2 modelos generados; el elegido va directo al Extractor |
| **Generador** | Imágenes desde texto con estilos (realista, anime, acuarela, caricatura, 3D, cine, vector, gráfico), proporción y cantidad |
| **Vectorizador** | **Preciso**: la IA detecta cada objeto, lo redibuja apto para vector (colores sólidos, bordes nítidos), se traza color por color y se une en su lugar. **Rápido**: motor propio sin IA. SVG, EPS, PDF |
| **Mockup 3D** | Camiseta (frente/espalda), taza, banner y wind banner en WebGL propio; foto en alta y video 360° |
| **Fondo mágico** | Quitar fondo (IA o rápido) o reemplazarlo por una escena nueva |
| **Recreador** | Limpiar y redibujar, variación o cambio de estilo de un arte |
| **Upscaler** | ×2 / ×4 con IA (re-render fiel) o clásico, conservando la transparencia |
| **Creador de fuentes** | Letterings con IA, fondo transparente, listos para vectorizar |
| **Buscador de fuentes** | Recortás el texto de una imagen e identifica la tipografía, con alternativas gratis de Google Fonts |
| **Biblioteca** | Todo lo generado, las extracciones y el registro de operaciones; descarga y "Enviar a…" otra herramienta |

Todo resultado se guarda solo en la biblioteca (IndexedDB) y se puede enviar a otra herramienta con un clic.

**El trabajo no se pierde al cambiar de herramienta**:
- Cada herramienta queda abierta en segundo plano: sus trabajos en curso siguen corriendo y, al volver, está todo como lo dejaste. Lo que le envíes desde otra herramienta le llega aunque ya esté abierta.
- Además se guarda una caché en la PC (IndexedDB, almacén `sessions`), así que sobrevive a una recarga o al cerrar el navegador. Incluye:
  - imágenes de entrada;
  - opciones;
  - textos;
  - la versión ya mejorada con IA del Vectorizador;
  - las estampas del Mockup 3D;
  - la extracción que estaba abierta.
Interfaz: negro dominante, blanco para texto y acciones, cian/magenta/amarillo como detalle.

## Vectorizado preciso

1. **Análisis**: un modelo de visión lista cada elemento (texto, logo, ícono, ilustración) con su recuadro ajustado, su paleta plana y su orden de apilado. Los patrones y escenas de atrás van al fondo.
2. **Preparación con IA** (solo al vectorizar):
   - cada recuadro se recorta y la IA lo redibuja con los colores exactos de su paleta;
   - sin degradés, sombras ni texturas, con bordes nítidos;
   - borra por nombre los elementos vecinos que se superponen.
3. **Separación por color, como en serigrafía**:
   - cada objeto se separa en **imágenes de un solo color** (negro sobre blanco), a 2400 px con bordes de precisión subpíxel;
   - se usan solo los colores de su paleta, con paleta estricta: nunca aparece un color que no va;
   - cada imagen se vectoriza por separado con el trazador propio (esquinas a dos escalas, curvas Bézier y rectas puras), con un umbral de ruido mínimo para no perder detalles chicos;
   - en cada objeto se ven sus separaciones, y un color que no va se apaga tocando su muestra.
4. **Superposición**: cada vector se pinta con su color exacto y se ubica en su lugar, con escala uniforme y sin deformación. Las capas se apilan con superposición (*trapping*) para que no queden rendijas.
   - El fondo se separa por color **desde el original**, sin redibujarlo, así no se inventan dibujos.
   - Debajo de los objetos se rellena con el color que lo rodea, para que no queden fantasmas.
   - Opcionalmente, el fondo se puede redibujar con IA.

La imagen preparada por la IA se guarda en la caché. Cambiar el detalle o los colores vuelve a trazar al instante, sin volver a usar IA, y cada objeto se puede rehacer por separado.

## Estructura

```text
src/
  app/         shell (riel, rutas), registro de herramientas, íconos, logo, piezas de UI
  tools/       una herramienta por archivo + mockup-gl (motor 3D propio)
  core/        types, catalog, schema (validación sin Zod), prompts versionados,
               image (recortes/máscaras), matte (alfa), pipeline, queue, store, settings
  providers/   analysis, image, fal, local, http (errores → FailureCode)
  export/      zip, tiff (CMYK PackBits), eps (SVG→EPS), index
  ui/          dom, settings
  main.ts      estados del Extractor e interfaz
```

## Verificado

- `tsc` estricto sin errores y build de producción.
- Flujo completo en modo demo en el navegador: carga, análisis, selección, recreación en cola, regeneración con corrección, versiones, ampliar, vectorizar, quitar fondo, historial y reapertura.
- El ZIP generado abre con .NET `ZipFile` (incluye nombres con ñ y tildes). El TIFF CMYK decodifica en Windows a 300 ppp, con la transparencia compuesta sobre blanco.

## Pendiente o con límites conocidos

- **Codex probado de punta a punta** (análisis y recreación reales). Los adaptadores por API (Gemini, OpenAI, Anthropic, FAL) siguen la documentación pública de cada API, pero todavía no se probaron con claves reales.
- **Sin backend, cuentas ni créditos**: es una herramienta personal. Para un servicio comercial hace falta un proxy que guarde las claves, autenticación y un libro mayor de créditos con idempotencia. El `intent` ya se genera en cada operación.
- **TIFF CMYK básico**: la conversión no usa perfiles ICC (FOGRA39). Validalo en tu RIP o convertí con perfil en Photoshop.
- **EPS**: cubre `path`, `rect`, `polygon`, `circle`, `ellipse`, grupos y `transform`. Los arcos SVG se aproximan con rectas.
- **Prompts**: versionados (`PROMPT_VERSION`). Conviene calibrarlos con un set de prueba propio: camiseta, mangas, raglán, shorts, taza, banners, texto chico, transparencias y oclusiones.
