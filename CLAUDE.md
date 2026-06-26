@AGENTS.md

# Gluten Free Map — guía para asistentes de IA

> ⚠️ **Lee primero `AGENTS.md` (importado arriba).** Esta versión de Next.js (16)
> trae *breaking changes* respecto a lo que conoces. Antes de escribir código de
> Next.js, consulta la guía relevante en `node_modules/next/dist/docs/` (solo
> existe tras `npm install`). Atiende a los avisos de deprecación.

Mapa interactivo que consolida **~10.570 lugares sin gluten** de 5 fuentes
independientes (Google My Maps, listas guardadas de Google Maps y la API GraphQL
de singlu.io). El front-end es una SPA de Next.js + Leaflet; los datos viven como
CSV estáticos en `public/data/` y se regeneran con scripts de Python.

## Arquitectura en una frase

CSV estático (`public/data/gluten_free_map.csv`) → `fetch` en el cliente →
parseo con papaparse → filtrado/ordenado por distancia en React → render con
Leaflet + clustering. **No hay backend ni base de datos en runtime**: la app es
100% cliente y los datos se actualizan offline con `scripts/update/`.

## Estructura del repositorio

```
app/                       App Router de Next.js
  page.tsx                 Entry point — dynamic import de MapApp con ssr:false
  layout.tsx               Metadata + viewport (maximumScale:1 evita zoom iOS), lang="es"
  globals.css              Tailwind v4 + CSS de Leaflet/cluster + animación del punto de usuario
  favicon.ico
components/
  MapApp.tsx               Componente principal (~800 líneas): estado, geolocalización,
                           filtros, búsqueda fuzzy, ruteo, card, lista, bottom sheet móvil
  MapView.tsx              Mapa Leaflet puro: TileLayer, clusters, marker de usuario,
                           polyline de ruta con gradiente, flyTo/fitBounds
public/data/               Datasets CSV (ver más abajo)
scripts/update/            Pipeline de extracción/actualización de datos (Python)
README.md                  Documentación de producto y de las fuentes (en español)
AGENTS.md                  Regla obligatoria sobre Next.js 16 (bloque auto-gestionado)
```

## Stack y convenciones de código

| Tecnología | Notas |
|---|---|
| **Next.js 16** (App Router) | React Compiler activado (`next.config.ts` → `reactCompiler: true`) |
| **React 19** | — |
| **TypeScript** estricto | `strict: true`, alias `@/*` → raíz del repo |
| **Tailwind CSS v4** | Vía `@tailwindcss/postcss`; estilos inline en JSX, sin archivos CSS por componente |
| **react-leaflet 5 + react-leaflet-cluster** | El mapa **debe** cargarse client-only |
| **fuse.js** | Búsqueda fuzzy por nombre de lugar |
| **papaparse** | Parseo de CSV en el cliente |

Convenciones observadas en el código existente (síguelas):

- **Todo el código de mapa es client-side.** Leaflet toca `window`, así que
  `MapApp` y `MapView` empiezan con `"use client"` y se importan con
  `dynamic(..., { ssr: false })`. Nunca renderices Leaflet en el servidor.
- **Comentarios y textos de UI en español.** Mantén el idioma; los identificadores
  de código están en inglés/español mezclado siguiendo el patrón actual.
- **Tipos compartidos viven en `MapApp.tsx`** (`Place`, `PlaceWithDist`) y se
  importan desde `MapView.tsx`. El esquema de `Place` refleja las columnas del CSV.
- **Estado en un solo componente.** `MapApp` concentra todo el estado con
  `useState`/`useMemo`/`useRef`; no hay store global ni context. El cálculo pesado
  (haversine, filtrado, fuse) está memoizado.
- **Colores y etiquetas por capa/mapa** se definen como constantes al inicio de
  `MapApp.tsx` (`LAYER_COLORS`, `MAP_LABELS`). Si añades una fuente o capa nueva,
  amplíalas ahí.
- **Distancias**: haversine en km en el cliente (`MapApp.tsx`), en metros en el
  pipeline de Python (`update.py`). El ruteo real usa OSRM (`routing.openstreetmap.de`).
- **Servicios externos sin clave**: geocoding/reverse-geocoding con Nominatim,
  ruteo con OSRM, tiles con CARTO/OpenStreetMap. Respeta sus rate limits y manda
  un `User-Agent` identificable (ver `geocode_addresses.py`).

## Modelo de datos (CSV)

`public/data/gluten_free_map.csv` es el dataset principal fusionado. Los CSV por
fuente (`gf_internacional.csv`, `gf_esp_ita_por.csv`, `lista_personal_glutenfree.csv`,
`lista_singluten_canarias.csv`, `singlu.csv`) son intermedios y se fusionan en él.

Columnas (orden canónico en `update.py` → `COLS`):

`nombre, lat, lng, direccion, categoria, capa, mapa, lista, gf_nivel, certificado, web, telefono, gmaps_url`

- `gf_nivel`: `"100%"` (sin gluten) o `"opciones"` (GF-friendly), derivado de la categoría.
- `certificado`: `"si"` si proviene de una asociación celíaca certificadora.
- `lat`/`lng` se parsean a `float` en cliente y Python; en el CSV son strings.
- **Deduplicación**: dos lugares son el mismo si tienen el nombre normalizado igual
  y están a ≤ 50 m (`DEDUP_M` en `update.py`). La primera fuente en `sources.json`
  gana en caso de colisión — el **orden de `sources.json` es la prioridad**.

## Comandos de desarrollo

```bash
npm install
npm run dev      # servidor de desarrollo (el README usa el puerto 3001)
npm run build    # build de producción
npm run start    # sirve el build
npm run lint     # eslint (config en eslint.config.mjs, basada en eslint-config-next)
```

No hay framework de tests configurado. La verificación es `npm run lint` +
`npm run build` + comprobación manual en el navegador.

## Pipeline de actualización de datos (`scripts/update/`)

Python puro (sin dependencias del front). Orquestador: `update.py`. Configuración
de fuentes: `sources.json`. Tres tipos de extractor:

| `type` | Fuente | Técnica |
|---|---|---|
| `mymaps` | Google My Maps público | Playwright headless → parsea `window._pageData` (JSON embebido ~1-2 MB) |
| `savedlist` | Lista guardada de Google Maps (privada) | `requests` al endpoint interno `entitylist/getlist` con `cookies.json`; fallback a Playwright interceptando la red |
| `singlu` | API GraphQL de singlu.io / `api.v3.wilbby.com` | `urllib`, paginación por cursor, sin auth |

```bash
cd scripts/update
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/playwright install chromium       # solo para fuentes mymaps

python3 update.py                            # actualiza todas las fuentes + fusiona
python3 update.py --source singlu            # solo una fuente (por id de sources.json)
python3 update.py --skip-savedlists          # solo fuentes sin auth
python3 update.py --no-merge                 # no regenera el CSV combinado
python3 geocode_addresses.py                 # rellena `direccion` faltante vía Nominatim (1 req/s, reanudable)
```

- `update.py` reescribe el CSV de cada fuente y luego `merge_all()` regenera
  `gluten_free_map.csv` deduplicado. `_enrich()` deriva `gf_nivel`, `certificado`,
  `gmaps_url` y normaliza `categoria` (género, erratas, separadores).
- Las **listas privadas** requieren cookies vigentes de Google. Se extraen en macOS
  con `refresh_cookies.sh` (AppleScript sobre Chrome). `cookies.json` está en
  `.gitignore` — nunca lo commitees; usa `cookies.json.example` como plantilla.
- `run_update.sh` es el wrapper de cron (venv, log rotado, `git commit` si los datos
  cambian; `git push` está comentado). Cron semanal documentado en el README.

## Reglas para cambios

1. **Antes de escribir Next.js/React**, lee la guía pertinente en
   `node_modules/next/dist/docs/` (regla de `AGENTS.md`). No asumas APIs de memoria.
2. **No rompas el contrato client-only del mapa**: cualquier componente que toque
   Leaflet debe ser `"use client"` y cargarse con `ssr: false`.
3. **Si cambias el esquema del CSV**, actualiza en conjunto: `COLS` en `update.py`,
   el tipo `Place` en `MapApp.tsx`, y la tabla de columnas del README.
4. **Datos**: regenera los CSV con `update.py`, no los edites a mano (salvo
   `geocode_addresses.py`, que sí muta `gluten_free_map.csv` in-place de forma controlada).
5. **No commitees** `cookies.json`, `.venv/`, `logs/` ni nada bajo `node_modules/`.
6. Verifica con `npm run lint` y, cuando sea relevante, `npm run build`.

## Notas de comportamiento

- El mapa arranca centrado en Canarias (`[28, -15.4]`, zoom 9).
- La geolocalización es opcional; si se deniega, los lugares se muestran sin ordenar
  por distancia (`dist = Infinity`).
- La UI distingue desktop (sidebar) y móvil (top bar + bottom sheet con vistas
  "Mapa"/"Lista"); ambas comparten el mismo estado de `MapApp`.
