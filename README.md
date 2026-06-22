# Gluten Free Social — Mapa interactivo

Aplicación web que consolida **9.562 lugares sin gluten** de 4 fuentes de Google Maps en un único mapa interactivo con geolocalización, filtros y búsqueda por proximidad.

**Repo:** <https://github.com/jcorreaes/gluten-free-map>

---

## Captura

> *(captura pendiente — ejecuta `npm run dev` y visita <http://localhost:3000>)*

---

## Funcionalidades

- **Geolocalización en tiempo real** — punto azul pulsante en el mapa, ordenación automática por distancia
- **Lista por proximidad** — todos los lugares ordenados por distancia Haversine (m / km)
- **Lazy loading** — 20 items a la vez mediante `IntersectionObserver`
- **Filtros** — panel overlay con búsqueda por nombre, filtros por mapa/capa/categoría, badge contador de filtros activos
- **Selección de marker** — card informativa en sidebar (nombre, origen, capa, categoría, dirección) + vuelo del mapa a zoom 15
- **Clustering automático** — `MarkerClusterGroup` para rendir 9.562 puntos sin degradar performance
- **Código de colores por origen**

| Color | Origen |
| --- | --- |
| Verde `#16a34a` | Certificados / Certified |
| Azul `#2563eb` | Opiniones / Opinions |
| Morado `#9333ea` | ASOC. Opinions |
| Ámbar `#f59e0b` | Supporters |
| Rojo `#dc2626` | Lista personal Gluten-free |
| Naranja `#ea580c` | Sin gluten Canarias |

---

## Fuentes de datos

| # | Tipo | Lugares |
| --- | --- | --- |
| 1 | Google My Maps público — *GF Social Internacional* (`mid=1Hi800OmeH5SQYbjxOEOIKLxkO7yB48Y`) | 3.548 |
| 2 | Google My Maps público — *GF Social ESP/ITA/POR* (`mid=15R-QwBeH48riYRcscfmk3JUeZ-2FM00`) | 5.893 |
| 3 | Lista guardada Google Maps (privada) — *Gluten-free* (`listId=tlScaqRZmK3Q6unrCf4p0u_-0Xuykg`) | 74 |
| 4 | Lista guardada Google Maps (pública compartida) — *Sin gluten Canarias* (`listId=JhyV-IMBcP4YGNJ7_SGlyrHqb-Pf3w`) | 125 |
| | **Total fusionado (sin duplicados)** | **9.562** |

Los CSVs resultantes se encuentran en `/public/data/`:

```text
gluten_free_map.csv          ← dataset principal fusionado
gf_internacional.csv
gf_esp_ita_por.csv
lista_personal_glutenfree.csv
lista_singluten_canarias.csv
```

Columnas del dataset principal: `nombre`, `lat`, `lng`, `direccion`, `categoria`, `capa`, `mapa`, `lista`

---

## Técnica de extracción

### My Maps públicos (fuentes #1 y #2)

Los mapas de Google My Maps embeben todos los datos en la variable global `window._pageData` como un JSON de ~1.4 MB. Se extrae con **Playwright headless**:

```text
data[1][6][layer][iconGroup][6][n]
  → place[4][0][1]     = [lat, lng]
  → place[5][0][0]     = nombre
```

### Listas privadas (fuentes #3 y #4)

Google Maps expone un endpoint interno que devuelve los lugares de una lista guardada:

```text
maps/preview/entitylist/getlist?pb=!1m4!1s{listId}...
```

Se invoca con `fetch(url, { credentials: 'include' })` desde la sesión de Chrome autenticada del usuario (via AppleScript para inyectar el fetch en la pestaña activa). La respuesta JSON sigue la estructura:

```text
data[0][8][n][2]         = nombre
data[0][8][n][1][5][2]   = lat
data[0][8][n][1][5][3]   = lng
```

---

## Stack técnico

- **Next.js 16** (App Router, `"use client"`)
- **Tailwind CSS v4**
- **react-leaflet** + **react-leaflet-cluster** (`MarkerClusterGroup`)
- **papaparse** — parsing de CSV en cliente
- **OpenStreetMap** — tiles gratuitos via `{s}.tile.openstreetmap.org`

---

## Estructura del proyecto

```text
app/
  page.tsx          ← entry point (dynamic import con ssr:false)
  layout.tsx        ← layout con metadata
  globals.css       ← Tailwind + Leaflet CSS + animación pulse usuario

components/
  MapApp.tsx        ← lógica principal: estado, geolocalización, filtros, lista
  MapView.tsx       ← mapa Leaflet: clusters, marker usuario, MapController (flyTo)

public/data/
  gluten_free_map.csv
  gf_internacional.csv
  gf_esp_ita_por.csv
  lista_personal_glutenfree.csv
  lista_singluten_canarias.csv
```

---

## Instalación y uso local

```bash
git clone https://github.com/jcorreaes/gluten-free-map.git
cd gluten-free-map
npm install
npm run dev
```

Abre <http://localhost:3000>

---

## Notas de uso

- La geolocalización es **opcional** — si se deniega, los lugares se muestran sin ordenar por distancia.
- Los datos son un snapshot estático (CSV). Para actualizar, hay que re-ejecutar los scripts de extracción y reemplazar los CSVs en `/public/data/`.
- Las listas privadas (#3 y #4) requieren una sesión autenticada en Google Maps para la extracción; los datos ya extraídos están incluidos en el repo.
- El mapa arranca centrado en Canarias (28°N, 15.4°O, zoom 9) por ser la región con mayor concentración de datos propios.
