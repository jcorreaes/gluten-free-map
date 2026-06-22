# Gluten Free Social — Mapa interactivo

Aplicación web que consolida **10.570 lugares sin gluten** de 5 fuentes independientes en un único mapa interactivo con geolocalización, filtros y búsqueda por proximidad.

**Repo:** <https://github.com/jcorreaes/gluten-free-map>

---

## Funcionalidades

- **Geolocalización en tiempo real** — punto azul pulsante, lista ordenada por distancia Haversine
- **Bottom sheet móvil** — lista deslizable desde la parte inferior en dispositivos táctiles
- **Lazy loading** — 20 lugares a la vez con `IntersectionObserver` (sidebar y sheet móvil)
- **Filtros** — panel overlay con búsqueda por nombre, mapa, capa, categoría y nivel GF
- **Selección de marker** — card con nombre, lista de origen, nivel GF, certificado, distancia y enlace a Google Maps
- **Clustering automático** — `MarkerClusterGroup` para rendir 10k+ puntos sin degradar rendimiento
- **Actualización automática** — scripts de extracción + cron semanal en servidor

---

## Fuentes de datos

| # | Tipo | Nombre | Lugares |
|---|---|---|---|
| 1 | Google My Maps público | GF Social Internacional | 3.548 |
| 2 | Google My Maps público | GF Social ESP/ITA/POR | 5.893 |
| 3 | Lista guardada Google Maps (privada) | Lista personal Gluten-free | 74 |
| 4 | Lista guardada Google Maps | Sin gluten Canarias (AVATARA) | 125 |
| 5 | API GraphQL pública (singlu.io) | SinGlu | 1.337 |
| | **Total fusionado sin duplicados** | | **10.570** |

---

## Dataset

Los CSVs están en `public/data/`:

```
gluten_free_map.csv           ← dataset principal fusionado
gf_internacional.csv
gf_esp_ita_por.csv
lista_personal_glutenfree.csv
lista_singluten_canarias.csv
singlu.csv
```

**Columnas:**

| Campo | Descripción | Cobertura |
|---|---|---|
| `nombre` | Nombre del establecimiento | 100% |
| `lat` / `lng` | Coordenadas | 100% |
| `direccion` | Dirección postal | Parcial |
| `categoria` | Tipo de cocina / local | My Maps + SinGlu |
| `capa` | Capa del mapa de origen | My Maps + SinGlu |
| `mapa` | Nombre del mapa fuente | 100% |
| `lista` | Nombre de la lista fuente | 100% |
| `gf_nivel` | `"100%"` sin gluten / `"opciones"` GF-friendly | My Maps |
| `certificado` | `"si"` si tiene cert. de asociación celíaca | My Maps + SinGlu |
| `web` | URL del establecimiento | My Maps (descripción) |
| `telefono` | Teléfono | My Maps (descripción) |
| `gmaps_url` | Enlace directo a Google Maps | 100% |

**Deduplicación:** dos lugares se consideran el mismo si tienen el mismo nombre normalizado y están a ≤ 50 m entre sí. La primera fuente en `sources.json` gana en caso de colisión.

---

## Técnica de extracción

### My Maps públicos (fuentes 1 y 2) — Playwright

Los mapas embeben todos sus datos en `window._pageData` (~1.4 MB de JSON). Se extrae con Playwright headless:

```
data[1][6][layer][4][iconGroup][6][n]
  → place[4][0][1]   = [lat, lng]
  → place[5][0][0]   = nombre
  → place[5][0][1]   = descripción (web, teléfono, dirección)
```

### Listas guardadas (fuentes 3 y 4) — cookies de sesión

Google Maps expone un endpoint interno:

```
GET maps/preview/entitylist/getlist?pb=!1m4!1s{listId}...
```

Se invoca con cookies de sesión de Chrome (extraídas con `refresh_cookies.sh` via AppleScript). Respuesta:

```
data[0][8][n][2]       = nombre
data[0][8][n][1][4]    = dirección
data[0][8][n][1][5]    = [_, _, lat, lng, ...]
```

### SinGlu (fuente 5) — GraphQL público

Backend: `api.v3.wilbby.com/graphql`. Sin autenticación, paginación por cursor (100/página):

```graphql
query allDiscoveryEstablishments($filters, $pagination, ...) {
  allDiscoveryEstablishments(...) {
    data { _id title slug type certificates adress { lat lgn } }
    pageInfo { hasNextPage endCursor }
  }
}
```

---

## Scripts de actualización

```
scripts/update/
  update.py           ← orquestador principal
  sources.json        ← configuración de fuentes
  run_update.sh       ← wrapper para cron (log, git commit)
  refresh_cookies.sh  ← extrae cookies de Chrome en macOS
  requirements.txt    ← requests, playwright
  cookies.json.example
```

### Uso

```bash
cd scripts/update

# Actualizar todo
python3 update.py

# Solo una fuente
python3 update.py --source singlu

# Solo fuentes que no requieren auth
python3 update.py --skip-savedlists

# Sin regenerar el CSV combinado
python3 update.py --no-merge
```

### Renovar cookies (listas privadas)

```bash
# En macOS, con Chrome abierto y sesión Google activa:
bash refresh_cookies.sh

# Enviar a servidor remoto:
bash refresh_cookies.sh --send-to usuario@servidor
```

### Setup en servidor (mininuc)

```bash
git clone git@github.com:jcorreaes/gluten-free-map.git ~/Projects/gluten-free-map
cd ~/Projects/gluten-free-map/scripts/update
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/playwright install chromium --with-deps
```

**Cron semanal** (lunes 3:00 AM):

```
0 3 * * 1 /bin/bash ~/Projects/gluten-free-map/scripts/update/run_update.sh
```

El script guarda log en `scripts/update/logs/update.log` y hace git commit si los datos cambian. Descomentar `git push` en `run_update.sh` para disparar redeploy automático en Vercel.

---

## Stack técnico

| Tecnología | Uso |
|---|---|
| Next.js 16 (App Router) | Framework, `"use client"` + SSR desactivado para Leaflet |
| Tailwind CSS v4 | Estilos |
| react-leaflet + react-leaflet-cluster | Mapa y clustering |
| papaparse | Parsing de CSV en cliente |
| OpenStreetMap | Tiles gratuitos |
| Playwright | Extracción headless de My Maps |
| requests | Extracción de Saved Lists |

---

## Estructura

```
app/
  page.tsx          ← entry point (dynamic import ssr:false)
  layout.tsx        ← metadata + viewport (previene zoom iOS)
  globals.css       ← Tailwind + Leaflet CSS + animación pulse

components/
  MapApp.tsx        ← estado, geolocalización, filtros, lista, bottom sheet móvil
  MapView.tsx       ← mapa Leaflet: clusters, marker usuario, flyTo

public/data/
  gluten_free_map.csv        ← dataset principal (10.570 lugares)
  gf_internacional.csv
  gf_esp_ita_por.csv
  lista_personal_glutenfree.csv
  lista_singluten_canarias.csv
  singlu.csv

scripts/update/
  update.py
  sources.json
  run_update.sh
  refresh_cookies.sh
  requirements.txt
```

---

## Desarrollo local

```bash
git clone https://github.com/jcorreaes/gluten-free-map.git
cd gluten-free-map
npm install
npm run dev
```

Abre <http://localhost:3001>

---

## Notas

- La geolocalización es opcional — si se deniega, los lugares se muestran sin ordenar por distancia.
- El mapa arranca centrado en Canarias (28°N, 15.4°O, zoom 9).
- Las listas privadas (#3 y #4) requieren cookies vigentes para re-extracción; los datos ya extraídos están en el repo.
- `web` y `telefono` se populan al re-extraer My Maps (descripción libre de cada marcador).
