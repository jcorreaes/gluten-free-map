#!/usr/bin/env python3
"""
Enriquece gluten_free_map.csv con direcciones via Nominatim reverse geocoding.

- Salta filas que ya tienen direccion.
- Respeta el rate limit de Nominatim: 1 req/s.
- Guarda el CSV cada 50 geocodificaciones para no perder progreso si se interrumpe.
- Al relanzar, retoma donde lo dejó.

Uso:
  python3 geocode_addresses.py
  python3 geocode_addresses.py --limit 200    # procesa solo N filas (test)
  python3 geocode_addresses.py --dry-run      # muestra qué haría, sin hacer requests
"""

import argparse
import csv
import os
import time
import sys
import requests

CSV_PATH = os.path.join(os.path.dirname(__file__), "../../public/data/gluten_free_map.csv")
NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
HEADERS = {"User-Agent": "gluten-free-map/1.0 (jcorrea.es@gmail.com)"}
SAVE_EVERY = 50


def fmt_address(addr: dict) -> str:
    parts = []
    road = (
        addr.get("road")
        or addr.get("pedestrian")
        or addr.get("path")
        or addr.get("footway")
    )
    if road:
        house = addr.get("house_number", "")
        parts.append(f"{road} {house}".strip())
    city = (
        addr.get("city")
        or addr.get("town")
        or addr.get("village")
        or addr.get("municipality")
        or addr.get("county")
    )
    if city:
        postcode = addr.get("postcode", "")
        parts.append(f"{postcode} {city}".strip() if postcode else city)
    country = addr.get("country")
    if country:
        parts.append(country)
    return ", ".join(p for p in parts if p)


def reverse_geocode(lat: float, lng: float) -> str:
    try:
        r = requests.get(
            NOMINATIM_URL,
            params={"lat": lat, "lon": lng, "format": "json", "zoom": 18, "addressdetails": 1},
            headers=HEADERS,
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        return fmt_address(data.get("address", {}))
    except Exception as e:
        print(f"  [warn] geocode error: {e}", file=sys.stderr)
        return ""


def save_csv(path: str, rows: list[dict], fieldnames: list[str]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="Max rows to geocode (0 = all)")
    parser.add_argument("--dry-run", action="store_true", help="Don't make requests, just print")
    args = parser.parse_args()

    csv_path = os.path.abspath(CSV_PATH)
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        rows = list(reader)

    missing = [i for i, r in enumerate(rows) if not r.get("direccion", "").strip()]
    total = len(missing) if not args.limit else min(len(missing), args.limit)

    print(f"CSV: {len(rows)} lugares | sin dirección: {len(missing)} | a geocodificar: {total}")
    if args.dry_run:
        print("[dry-run] no se harán requests")

    geocoded = 0
    since_save = 0

    for n, idx in enumerate(missing[:total], 1):
        row = rows[idx]
        lat, lng = float(row["lat"]), float(row["lng"])
        nombre = row["nombre"]

        if args.dry_run:
            print(f"  [{n}/{total}] {nombre} ({lat:.5f}, {lng:.5f}) → (dry-run)")
            continue

        address = reverse_geocode(lat, lng)
        rows[idx]["direccion"] = address
        geocoded += 1
        since_save += 1

        status = address if address else "(sin resultado)"
        print(f"  [{n}/{total}] {nombre} → {status}")

        if since_save >= SAVE_EVERY:
            save_csv(csv_path, rows, fieldnames)
            print(f"  [guardado] {geocoded} geocodificaciones acumuladas")
            since_save = 0

        time.sleep(1)

    if not args.dry_run and since_save > 0:
        save_csv(csv_path, rows, fieldnames)
        print(f"\n[guardado] {geocoded} geocodificaciones en total")

    print(f"\nListo. {geocoded} direcciones añadidas.")


if __name__ == "__main__":
    main()
