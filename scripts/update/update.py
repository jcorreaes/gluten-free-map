#!/usr/bin/env python3
"""
Actualiza los datos del mapa gluten-free desde las fuentes originales.

Flujo completo:
  1. Para cada fuente en sources.json, extrae los lugares usando el extractor
     correspondiente (mymaps o savedlist) y escribe su CSV individual.
  2. Fusiona todos los CSVs individuales en gluten_free_map.csv, eliminando
     duplicados por proximidad geográfica (±11 m). La primera fuente en
     sources.json gana en caso de colisión.

Uso:
  python3 update.py                        # actualiza todas las fuentes
  python3 update.py --source gf_internacional
  python3 update.py --source singlu
  python3 update.py --skip-mymaps          # solo listas privadas
  python3 update.py --skip-savedlists      # solo mapas públicos
  python3 update.py --no-merge             # no regenera el CSV combinado

Tipos de fuente soportados:
  mymaps      Google My Maps público (Playwright + window._pageData)
  savedlist   Lista guardada Google Maps (requests + cookies.json)
  singlu      API GraphQL pública de singlu.io / wilbby.com (sin auth)

Requisitos:
  pip install -r requirements.txt
  playwright install chromium              # solo si hay fuentes tipo mymaps
"""

import json
import csv
import re
import sys
import math
import time
import argparse
import urllib.request
from pathlib import Path
from datetime import datetime
from urllib.parse import quote_plus

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
DATA_DIR = PROJECT_ROOT / "public" / "data"
SOURCES_FILE = SCRIPT_DIR / "sources.json"
COOKIES_FILE = SCRIPT_DIR / "cookies.json"
COLS = [
    "nombre", "lat", "lng", "direccion", "categoria", "capa", "mapa", "lista",
    "gf_nivel", "certificado", "web", "telefono", "gmaps_url",
]

# Asociaciones certificadoras de celíacos presentes en los datos
_CERT_ASSOCS = {
    "face", "acecan", "acecova", "acema", "acib",
    "associacio-celiacs-catalunya", "madrid-sensibles-gluten",
}

_URL_RE    = re.compile(r'https?://[^\s<>"\'()]+')
_PHONE_RE  = re.compile(r'(?<!\d)(?:\+34[\s.\-]?)?[679]\d{2}[\s.\-]?\d{3}[\s.\-]?\d{3}(?!\d)')


def _dist_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distancia Haversine en metros entre dos coordenadas."""
    R = 6_371_000
    dLat = (lat2 - lat1) * math.pi / 180
    dLng = (lng2 - lng1) * math.pi / 180
    a = (math.sin(dLat / 2) ** 2
         + math.cos(lat1 * math.pi / 180) * math.cos(lat2 * math.pi / 180)
         * math.sin(dLng / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _norm(name: str) -> str:
    return name.lower().strip()


def read_csv(path):
    p = Path(path)
    if not p.exists():
        return []
    with open(p, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore", restval="")
        w.writeheader()
        w.writerows(rows)


def _parse_description(raw: str) -> tuple[str, str, str]:
    """Extrae (web, telefono, direccion) del campo descripción de My Maps."""
    if not raw:
        return "", "", ""
    # Limpiar HTML y entidades
    clean = re.sub(r'<[^>]+>', ' ', raw)
    clean = re.sub(r'&(?:amp|nbsp|lt|gt|quot);', ' ', clean)
    clean = re.sub(r'\s+', ' ', clean).strip()

    urls   = _URL_RE.findall(raw)
    web    = urls[0].rstrip('.,)') if urls else ""

    phones   = _PHONE_RE.findall(clean)
    telefono = re.sub(r'[\s.\-]', '', phones[0]) if phones else ""

    # Lo que queda tras quitar URL y teléfono es candidato a dirección
    addr = _URL_RE.sub('', clean)
    addr = _PHONE_RE.sub('', addr)
    addr = re.sub(r'\s+', ' ', addr).strip()
    direccion = addr[:300] if len(addr) > 5 else ""

    return web, telefono, direccion


def _enrich(row: dict) -> dict:
    """Añade gf_nivel, certificado y gmaps_url derivados de los campos existentes."""
    cat = row.get("categoria", "").upper()
    cap = row.get("capa", "").lower()

    if "100%" in cat:
        gf_nivel = "100%"
    elif "OPCIONES" in cat:
        gf_nivel = "opciones"
    else:
        gf_nivel = ""

    if "CERT" in cat or any(a in cap for a in _CERT_ASSOCS):
        certificado = "si"
    else:
        certificado = ""

    nombre = row.get("nombre", "")
    lat    = row.get("lat", "")
    lng    = row.get("lng", "")
    gmaps  = f"https://www.google.com/maps/search/{quote_plus(nombre)}/@{lat},{lng},17z"

    return {
        **row,
        "gf_nivel":    row.get("gf_nivel")    or gf_nivel,
        "certificado": row.get("certificado") or certificado,
        "gmaps_url":   row.get("gmaps_url")   or gmaps,
        "web":       row.get("web", ""),
        "telefono":  row.get("telefono", ""),
    }


# ─── Extractor: Google My Maps (público) ──────────────────────────────────────

def extract_mymaps(url: str, source_name: str) -> list[dict]:
    """
    Extrae marcadores de un Google My Maps público parseando window._pageData.

    Google My Maps embebe todos los datos del mapa en una variable JS global
    (window._pageData) como string JSON de ~1-2 MB. No hay API pública, así que
    se usa Playwright para cargar la página y evaluar esa variable en el contexto
    del navegador.

    Estructura del JSON extraído (rutas relevantes):
      data[1][6]                  → lista de capas (layers)
      layer[2]                    → nombre de la capa
      layer[4]                    → lista de grupos de iconos (iconGroups)
      group[5]                    → categoría del grupo
      group[6][n]                 → lista de lugares
      place[4][0][1]              → [lat, lng]
      place[5][0][0]              → nombre del lugar
      place[5][0][1]              → descripción libre (puede contener dirección, web, tfno)
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  ✗ playwright no instalado. Ejecuta: pip install playwright && playwright install chromium")
        return []

    print(f"  → Cargando página…")
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(url, wait_until="networkidle", timeout=45_000)
        page.wait_for_function(
            "typeof window._pageData === 'string' && window._pageData.length > 1000",
            timeout=20_000,
        )
        data = page.evaluate("JSON.parse(window._pageData)")
        browser.close()

    layers = data[1][6]
    places = []

    for layer in layers:
        layer_name = layer[2]
        for group in (layer[4] or []):
            cat = group[5]
            category = ""
            if cat and isinstance(cat, list) and cat:
                category = cat[0] if isinstance(cat[0], str) else ""
            for place in (group[6] or []):
                try:
                    coords = place[4][0][1]
                    name   = place[5][0][0]
                    desc   = place[5][0][1] if len(place[5][0]) > 1 else ""
                    if name and coords and len(coords) >= 2:
                        web, telefono, direccion = _parse_description(desc or "")
                        places.append({
                            "nombre":    name,
                            "lat":       coords[0],
                            "lng":       coords[1],
                            "direccion": direccion,
                            "categoria": str(category),
                            "capa":      layer_name,
                            "mapa":      source_name,
                            "lista":     source_name,
                            "web":       web,
                            "telefono":  telefono,
                        })
                except (IndexError, TypeError, KeyError):
                    pass

    return places


# ─── Extractor: Lista guardada Google Maps (requiere auth) ────────────────────

def extract_savedlist(list_id: str, map_url: str, source_name: str) -> list[dict]:
    """
    Extrae lugares de una lista guardada de Google Maps.

    Estrategia (con fallback):
    1. Si hay cookies.json válidas → llama directamente al endpoint interno
       de Google Maps con requests (más rápido, sin abrir navegador).
    2. Si no hay cookies o el servidor responde 401 → Playwright intercepta
       la llamada de red que el propio mapa hace al cargar (requiere cookies
       vigentes inyectadas en el contexto del navegador headless).

    Para obtener / renovar las cookies: ejecuta refresh_cookies.sh desde macOS
    con Chrome abierto y sesión activa en Google Maps.
    """
    places = _savedlist_via_api(list_id, source_name)
    if places is not None:
        return places

    print("  → API directa falló, intentando con Playwright + intercepción de red…")
    return _savedlist_via_playwright(map_url, list_id, source_name)


def _savedlist_via_api(list_id: str, source_name: str):
    """
    Llama directamente al endpoint interno de Google Maps con cookies almacenadas.
    Devuelve None si las cookies no existen, están expiradas, o la respuesta es inválida.

    Endpoint:
      GET maps/preview/entitylist/getlist?pb=!1m4!1s{list_id}...

    La respuesta incluye un prefijo ")]}'\\n" — protección anti-XSSI (Cross-Site
    Script Inclusion) estándar de Google. Hay que eliminarlo antes de parsear JSON.
    """
    if not COOKIES_FILE.exists():
        print("  ⚠ cookies.json no encontrado. Ejecuta refresh_cookies.sh en tu Mac.")
        return None

    try:
        import requests
    except ImportError:
        print("  ✗ requests no instalado. Ejecuta: pip install requests")
        return None

    with open(COOKIES_FILE) as f:
        cookies = json.load(f)

    url = (
        "https://www.google.com/maps/preview/entitylist/getlist"
        f"?authuser=0&hl=es&gl=es"
        f"&pb=!1m4!1s{list_id}!2e1!3m1!1e1!2e2!3e3!4i500!8i3"
    )
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"
        ),
        "Referer": "https://www.google.com/maps/",
        "Accept-Language": "es-ES,es;q=0.9",
    }

    try:
        resp = requests.get(url, headers=headers, cookies=cookies, timeout=30)
    except Exception as e:
        print(f"  ✗ Error de red: {e}")
        return None

    if resp.status_code == 401:
        print("  ⚠ Cookies expiradas (401). Ejecuta refresh_cookies.sh para renovarlas.")
        return None

    raw = resp.text
    # Google antepone )]}'  a todas las respuestas JSON para prevenir XSSI
    if raw.startswith(")]}'"):
        raw = raw[4:].strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        print("  ✗ Respuesta no es JSON válido.")
        return None

    meta = data[0] if data else []
    if not meta or len(meta) < 9 or not meta[8]:
        print("  ⚠ Respuesta vacía (cookies probablemente expiradas).")
        return None

    return _parse_savedlist_response(meta, source_name)


def _savedlist_via_playwright(map_url: str, list_id: str, source_name: str) -> list[dict]:
    """
    Abre la URL del mapa con Playwright e intercepta la respuesta del endpoint
    entitylist/getlist que el propio mapa lanza al cargar.

    Se inyectan las cookies del archivo local (si existen) en el contexto del
    navegador headless para que Google acepte la sesión.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  ✗ playwright no instalado.")
        return []

    captured_meta = []

    def on_response(response):
        if "entitylist/getlist" in response.url and list_id[:10] in response.url:
            try:
                raw = response.text()
                if raw.startswith(")]}'"):
                    raw = raw[4:].strip()
                data = json.loads(raw)
                if data and data[0] and len(data[0]) >= 9:
                    captured_meta.append(data[0])
            except Exception:
                pass

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context()

        if COOKIES_FILE.exists():
            with open(COOKIES_FILE) as f:
                raw_cookies = json.load(f)
            context.add_cookies([
                {"name": k, "value": v, "domain": ".google.com", "path": "/"}
                for k, v in raw_cookies.items()
            ])

        page = context.new_page()
        page.on("response", on_response)
        print(f"  → Cargando mapa…")
        page.goto(map_url, wait_until="networkidle", timeout=45_000)
        browser.close()

    if not captured_meta:
        print("  ✗ No se capturó respuesta de la API. ¿Sesión activa?")
        return []

    return _parse_savedlist_response(captured_meta[0], source_name)


def _parse_savedlist_response(meta: list, source_name: str) -> list[dict]:
    """
    Convierte la respuesta cruda del endpoint entitylist/getlist a lista de dicts.

    Estructura del JSON (meta = data[0]):
      meta[4]           → título de la lista
      meta[8]           → lista de entradas
      entry[2]          → nombre del lugar
      entry[1]          → datos del lugar
      entry[1][5]       → coordenadas [_, _, lat, lng, ...]
      entry[1][4]       → dirección formateada
    """
    list_title = meta[4] if len(meta) > 4 else source_name
    places = []
    for entry in (meta[8] or []):
        try:
            place_data = entry[1]
            name = entry[2] if len(entry) > 2 else ""
            coords = place_data[5] if place_data and len(place_data) > 5 else None
            address = place_data[4] if place_data and len(place_data) > 4 else ""
            lat = coords[2] if coords and len(coords) > 2 else None
            lng = coords[3] if coords and len(coords) > 3 else None
            if name and lat is not None:
                places.append({
                    "nombre": name,
                    "lat": lat,
                    "lng": lng,
                    "direccion": address or "",
                    "categoria": "",
                    "capa": "",
                    "mapa": source_name,
                    "lista": list_title,
                })
        except (IndexError, TypeError, KeyError):
            pass
    return places


# ─── Extractor: SinGlu / Wilbby GraphQL API (pública, sin auth) ──────────────

_SINGLU_QUERY = """
fragment F on Establishment {
  _id title slug
  type
  certificates
  adress { lat lgn __typename }
  __typename
}
query allDiscoveryEstablishments(
  $filters: DiscoveryEstablishmentsFilters!,
  $sort: AllDiscoveryEstablishmentsSortMode,
  $pagination: PaginationInput!,
  $coordinates: CoordinatesInput!,
  $language: String
) {
  allDiscoveryEstablishments(
    filters: $filters sort: $sort pagination: $pagination
    coordinates: $coordinates language: $language
  ) {
    success count
    pageInfo { hasNextPage endCursor __typename }
    data { ...F }
    __typename
  }
}
"""


def extract_singlu(domain: str, source_name: str) -> list[dict]:
    """
    Extrae establecimientos desde la API GraphQL de Wilbby (backend de singlu.io).
    No requiere autenticación. Usa paginación por cursor (100 por página).
    """
    places = []
    cursor = None
    page = 0

    while True:
        page += 1
        payload = json.dumps({
            "operationName": "allDiscoveryEstablishments",
            "variables": {
                "filters": {
                    "community": "all",
                    "domain": domain,
                    "search": None,
                    "categoryIds": None,
                    "certificateIds": None,
                    "tipoIds": None,
                },
                "sort": "scope",
                "pagination": {"limit": 100, "cursor": cursor},
                "coordinates": {"lat": None, "lng": None},
                "language": "es",
            },
            "query": _SINGLU_QUERY,
        }).encode()

        req = urllib.request.Request(
            "https://api.v3.wilbby.com/graphql",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Origin": f"https://{domain}",
                "Referer": f"https://{domain}/",
                "Accept-Language": "es-ES,es;q=0.9",
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
                ),
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
        except Exception as e:
            print(f"  ✗ Error en página {page}: {e}")
            break

        if "errors" in data and not data.get("data"):
            print(f"  ✗ GraphQL error: {data['errors']}")
            break

        r = data["data"]["allDiscoveryEstablishments"]
        batch = r["data"]

        for item in batch:
            addr = item.get("adress") or {}
            lat = addr.get("lat")
            lng = addr.get("lgn")
            if not lat or not lng:
                continue
            categoria = (item.get("type") or {}).get("es", "")
            certs = item.get("certificates") or []
            places.append({
                "nombre": item["title"],
                "lat": lat,
                "lng": lng,
                "direccion": "",
                "categoria": categoria,
                "capa": ", ".join(certs),
                "mapa": source_name,
                "lista": source_name,
            })

        print(f"  → Página {page}: {len(batch)} establecimientos (total: {len(places)}/{r['count']})")

        if not r["pageInfo"]["hasNextPage"]:
            break
        cursor = r["pageInfo"]["endCursor"]
        time.sleep(0.3)

    return places


# ─── Merge ────────────────────────────────────────────────────────────────────

def merge_all(all_sources: list[dict]) -> tuple[int, int, int]:
    """
    Lee todos los CSVs individuales y genera el CSV combinado deduplicado.
    La primera fuente gana en caso de duplicado (orden en sources.json = prioridad).
    Devuelve (total, nuevos, eliminados).

    Estrategia de deduplicación: dos entradas se consideran el mismo lugar si
    comparten nombre normalizado Y están a ≤ 50 m. Esto evita el problema del
    grid boundary (dedup por redondeo de coordenadas fallaba en bordes de celda)
    y cubre pines del mismo sitio marcados a distintas posiciones según la fuente.
    """
    DEDUP_M = 50

    combined_path = DATA_DIR / "gluten_free_map.csv"
    prev_count = len(read_csv(combined_path))

    seen: list[dict] = []
    # índice nombre normalizado → posiciones en `seen` para búsqueda rápida
    by_name: dict[str, list[int]] = {}

    for src in all_sources:
        path = DATA_DIR / src["output"]
        rows = read_csv(path)
        added_here = 0
        for row in rows:
            try:
                lat = float(row["lat"])
                lng = float(row["lng"])
            except (ValueError, KeyError):
                continue

            name = _norm(row.get("nombre", ""))
            is_dup = any(
                _dist_m(lat, lng, float(seen[i]["lat"]), float(seen[i]["lng"])) <= DEDUP_M
                for i in by_name.get(name, [])
            )

            if not is_dup:
                by_name.setdefault(name, []).append(len(seen))
                seen.append(_enrich(row))
                added_here += 1

        if rows:
            print(f"  {src['name']}: {len(rows)} lugares  ({added_here} sin dupl. con fuentes anteriores)")

    write_csv(combined_path, seen)
    delta = len(seen) - prev_count
    return len(seen), max(0, delta), max(0, -delta)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Actualiza los datos del mapa gluten-free")
    parser.add_argument("--source", metavar="ID", help="Actualizar solo esta fuente (por id)")
    parser.add_argument("--skip-mymaps", action="store_true", help="Omitir fuentes tipo mymaps")
    parser.add_argument("--skip-savedlists", action="store_true", help="Omitir listas privadas")
    parser.add_argument("--no-merge", action="store_true", help="No regenerar CSV combinado")
    args = parser.parse_args()

    with open(SOURCES_FILE) as f:
        all_sources = json.load(f)

    sources_to_run = all_sources
    if args.source:
        sources_to_run = [s for s in all_sources if s["id"] == args.source]
        if not sources_to_run:
            sys.exit(f"Error: fuente '{args.source}' no encontrada en sources.json")
    if args.skip_mymaps:
        sources_to_run = [s for s in sources_to_run if s["type"] != "mymaps"]
    if args.skip_savedlists:
        sources_to_run = [s for s in sources_to_run if s["type"] != "savedlist"]

    print(f"🌾 Actualización de datos — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"{'─' * 52}")

    ok, skipped = 0, 0

    for src in sources_to_run:
        print(f"\n📍 {src['name']}  [{src['type']}]")
        try:
            if src["type"] == "mymaps":
                places = extract_mymaps(src["url"], src["name"])
            elif src["type"] == "savedlist":
                places = extract_savedlist(src["list_id"], src["map_url"], src["name"])
            elif src["type"] == "singlu":
                places = extract_singlu(src.get("domain", "singlu.io"), src["name"])
            else:
                print(f"  ✗ Tipo desconocido: {src['type']}")
                skipped += 1
                continue

            if not places:
                print("  ✗ No se obtuvieron lugares. Fuente omitida.")
                skipped += 1
                continue

            out_path = DATA_DIR / src["output"]
            prev_count = len(read_csv(out_path))
            write_csv(out_path, [_enrich(p) for p in places])

            diff = len(places) - prev_count
            sign = "+" if diff >= 0 else ""
            print(f"  ✓ {len(places)} lugares guardados  ({sign}{diff} respecto al anterior)")
            ok += 1

        except Exception as e:
            print(f"  ✗ Error inesperado: {e}")
            skipped += 1

    if not args.no_merge:
        print(f"\n{'─' * 52}")
        print("🔀 Fusionando y deduplicando todas las fuentes…")
        total, added, removed = merge_all(all_sources)
        print(f"\n── Resultado ──────────────────────────")
        print(f"   Total combinado : {total:,} lugares únicos")
        if added:   print(f"   ✅ Nuevos        : +{added}")
        if removed: print(f"   🗑  Eliminados    : -{removed}")
        if not added and not removed:
            print(f"   ✓ Sin cambios detectados")

    print(f"\n── Resumen ────────────────────────────")
    print(f"   Fuentes procesadas : {ok}")
    if skipped:
        print(f"   Fuentes omitidas   : {skipped}")
    print()


if __name__ == "__main__":
    main()
