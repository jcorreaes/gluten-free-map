"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import Papa from "papaparse";
import dynamic from "next/dynamic";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

export type Place = {
  nombre: string;
  lat: number;
  lng: number;
  categoria: string;
  capa: string;
  mapa: string;
  lista: string;
  direccion?: string;
  gf_nivel?: string;
  certificado?: string;
  web?: string;
  telefono?: string;
  gmaps_url?: string;
};

export type PlaceWithDist = Place & { dist: number };

const LAYER_COLORS: Record<string, string> = {
  "CERTIFICADOS / CERTIFIED":   "#16a34a",
  "Opiniones":                  "#2563eb",
  "Opinions":                   "#2563eb",
  "ASOC. Opinions":             "#9333ea",
  "Supporters":                 "#f59e0b",
  "Lista personal Gluten-free": "#dc2626",
  "Sin gluten Canarias":        "#ea580c",
};

const MAP_LABELS: Record<string, string> = {
  "GF Social Internacional":    "🌍 Internacional",
  "GF Social ESP/ITA/POR":      "🇪🇸🇮🇹🇵🇹 ESP / ITA / POR",
  "Lista personal Gluten-free": "⭐ Lista personal",
  "Sin gluten Canarias":        "🌴 Sin gluten Canarias",
};

function getColor(capa: string, mapa: string) {
  return LAYER_COLORS[capa] ?? LAYER_COLORS[mapa] ?? "#6b7280";
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDist(km: number) {
  if (km === Infinity) return "";
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export default function MapApp() {
  const [places, setPlaces]             = useState<Place[]>([]);
  const [userPos, setUserPos]           = useState<[number, number] | null>(null);
  const [geoStatus, setGeoStatus]       = useState<"idle" | "loading" | "ok" | "denied">("loading");
  const [flyTarget, setFlyTarget]       = useState<[number, number, number] | null>(null);
  const [filtersOpen, setFiltersOpen]   = useState(false);
  const [search, setSearch]             = useState("");
  const [selectedMaps, setSelectedMaps] = useState<Set<string>>(new Set());
  const [selectedLayers, setSelectedLayers] = useState<Set<string>>(new Set());
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [cardState, setCardState]        = useState<{ idx: number; sig: string }>({ idx: 0, sig: "" });
  const [sheetOpen, setSheetOpen]       = useState(true);
  const [mobileView, setMobileView]     = useState<"mapa" | "lista">("mapa");
  const [radiusKm, setRadiusKm]         = useState(60);
  const [searchPos, setSearchPos]       = useState<[number, number] | null>(null);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationSuggestions, setLocationSuggestions] = useState<Array<{ lat: number; lng: number; label: string }>>([]);
  const [route, setRoute]               = useState<[number, number][] | null>(null);
  const [routeInfo, setRouteInfo]       = useState<{ duration: number; distance: number } | null>(null);
  const [routeMode, setRouteMode]       = useState<"foot" | "driving">("foot");
  const [fitBounds, setFitBounds]       = useState<[[number, number], [number, number]] | null>(null);

  const geoWatchRef     = useRef<number | null>(null);
  const touchStartX     = useRef<number | null>(null);
  const locationDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/data/gluten_free_map.csv")
      .then((r) => r.text())
      .then((csv) => {
        const result = Papa.parse<Place>(csv, { header: true, skipEmptyLines: true });
        setPlaces(
          result.data.map((r) => ({
            ...r,
            lat: parseFloat(String(r.lat)),
            lng: parseFloat(String(r.lng)),
          }))
        );
      });
  }, []);

  // For button re-click: clears old watch + starts new one (setState ok from event handler)
  const requestGeo = useCallback(() => {
    if (!navigator.geolocation) { setGeoStatus("denied"); return; }
    if (geoWatchRef.current !== null) navigator.geolocation.clearWatch(geoWatchRef.current);
    setGeoStatus("loading");
    geoWatchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setUserPos((prev) => {
          if (!prev) setFlyTarget([coords[0], coords[1], 13]);
          return coords;
        });
        setGeoStatus("ok");
      },
      () => setGeoStatus("denied"),
      { enableHighAccuracy: true }
    );
  }, []);

  // Init: start geo watch on mount — no synchronous setState in body; callbacks are async
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setUserPos((prev) => {
          if (!prev) setFlyTarget([coords[0], coords[1], 13]);
          return coords;
        });
        setGeoStatus("ok");
      },
      () => setGeoStatus("denied"),
      { enableHighAccuracy: true }
    );
    geoWatchRef.current = id;
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const withDist = useMemo<PlaceWithDist[]>(() => {
    const ref = searchPos ?? userPos;
    return places.map((p) => ({
      ...p,
      dist: ref ? haversine(ref[0], ref[1], p.lat, p.lng) : Infinity,
    }));
  }, [places, searchPos, userPos]);

  const filtered = useMemo(() =>
    withDist
      .filter((p) => {
        if (p.dist !== Infinity && p.dist > radiusKm) return false;
        if (selectedMaps.size && !selectedMaps.has(p.mapa)) return false;
        if (selectedLayers.size && !selectedLayers.has(p.capa)) return false;
        if (selectedCats.size && !selectedCats.has(p.categoria?.trim())) return false;
        if (search && !p.nombre.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => a.dist - b.dist),
    [withDist, selectedMaps, selectedLayers, selectedCats, search, radiusKm]
  );

  // Derived from paired state: resets to 0 when filter criteria change without an effect
  const filterSig = `${search}|${[...selectedMaps].sort().join()}|${[...selectedLayers].sort().join()}|${[...selectedCats].sort().join()}`;
  const cardIndex   = cardState.sig === filterSig ? cardState.idx : 0;
  const currentPlace = filtered[cardIndex] ?? null;

  function goToCard(idx: number) {
    const p = filtered[idx];
    if (!p) return;
    setCardState({ idx, sig: filterSig });
    setFlyTarget([p.lat, p.lng, 15]);
    setSheetOpen(true);
    setRoute(null);
    setRouteInfo(null);
    setFitBounds(null);
  }

  function nextCard() { if (cardIndex < filtered.length - 1) goToCard(cardIndex + 1); }
  function prevCard() { if (cardIndex > 0) goToCard(cardIndex - 1); }

  // Called when the user taps a marker on the map
  function handleSelectPlace(p: PlaceWithDist) {
    const idx = filtered.findIndex(
      (x) => x.nombre === p.nombre && x.lat === p.lat && x.lng === p.lng
    );
    if (idx >= 0) goToCard(idx);
  }

  function toggle<T>(set: Set<T>, val: T, setter: (s: Set<T>) => void) {
    const next = new Set(set);
    next.has(val) ? next.delete(val) : next.add(val);
    setter(next);
  }

  function clearFilters() {
    setSelectedMaps(new Set());
    setSelectedLayers(new Set());
    setSelectedCats(new Set());
    setSearch("");
    setRadiusKm(60);
  }

  // ── Location search (Nominatim) ───────────────────────────────────────────────

  function handleLocationChange(q: string) {
    setLocationQuery(q);
    if (locationDebounce.current) clearTimeout(locationDebounce.current);
    if (q.length < 3) { setLocationSuggestions([]); return; }
    locationDebounce.current = setTimeout(() => {
      fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`,
        { headers: { "Accept-Language": "es,en" } }
      )
        .then((r) => r.json())
        .then((data: Array<{ lat: string; lon: string; display_name: string }>) => {
          setLocationSuggestions(data.map((r) => ({
            lat: parseFloat(r.lat),
            lng: parseFloat(r.lon),
            label: r.display_name,
          })));
        })
        .catch(() => {});
    }, 350);
  }

  function selectLocation(s: { lat: number; lng: number; label: string }) {
    setSearchPos([s.lat, s.lng]);
    setLocationQuery(s.label.split(",").slice(0, 2).join(",").trim());
    setLocationSuggestions([]);
    setFlyTarget([s.lat, s.lng, 13]);
  }

  function clearLocation() {
    setSearchPos(null);
    setLocationQuery("");
    setLocationSuggestions([]);
  }

  // ── Route fetching (OSRM) ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!currentPlace || !userPos) return;
    const ctrl = new AbortController();
    const [fromLat, fromLng] = userPos;
    const { lat: toLat, lng: toLng } = currentPlace;
    // routing.openstreetmap.de has both routed-car and routed-foot profiles
    const profile = routeMode === "driving" ? "routed-car" : "routed-foot";
    fetch(
      `https://routing.openstreetmap.de/${profile}/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`,
      { signal: ctrl.signal }
    )
      .then((r) => r.json())
      .then((data: { routes?: Array<{ geometry: { coordinates: [number, number][] }; duration: number; distance: number }> }) => {
        const r0 = data.routes?.[0];
        if (!r0) return;
        const coords: [number, number][] = r0.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        const lats = coords.map(([lat]) => lat);
        const lngs = coords.map(([, lng]) => lng);
        setRoute(coords);
        setRouteInfo({ duration: r0.duration, distance: r0.distance });
        setFitBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]]);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [currentPlace, userPos, routeMode]);

  function fmtRouteDist(m: number) {
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
  }

  function fmtDuration(s: number) {
    if (s < 3600) return `${Math.round(s / 60)} min`;
    return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)} min`;
  }

  // ── Filter / place data ───────────────────────────────────────────────────────

  const maps       = useMemo(() => [...new Set(places.map((p) => p.mapa))].sort(), [places]);
  const layers     = useMemo(() => [...new Set(places.map((p) => p.capa))].filter(Boolean).sort(), [places]);
  const categories = useMemo(() => [...new Set(places.map((p) => p.categoria?.trim()))].filter(Boolean).sort(), [places]);

  const activeFilters  = selectedMaps.size + selectedLayers.size + selectedCats.size + (search ? 1 : 0);

  // ── Filter panel ─────────────────────────────────────────────────────────────

  const filterPanel = (
    <div className="fixed inset-0 bg-white z-[1200] overflow-y-auto">
      <div className="sticky top-0 bg-white border-b border-gray-100 px-3 py-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Filtros</p>
        <button type="button" onClick={() => setFiltersOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
      </div>

      <div className="p-3">
        <input
          type="search"
          placeholder="Buscar por nombre..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      <div className="px-3 pb-3 border-t border-gray-100 pt-2">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Radio de búsqueda</p>
          <span className="text-xs font-bold text-green-700">{radiusKm} km</span>
        </div>
        <input
          type="range"
          min={5}
          max={500}
          step={5}
          value={radiusKm}
          onChange={(e) => setRadiusKm(Number(e.target.value))}
          aria-label="Radio de búsqueda en kilómetros"
          className="w-full accent-green-600"
        />
        <div className="flex justify-between text-[10px] text-gray-300 mt-0.5">
          <span>5 km</span><span>500 km</span>
        </div>
      </div>

      <div className="px-3 pb-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Mapas</p>
        {maps.map((m) => (
          <label key={m} className="flex items-center gap-2 py-1 cursor-pointer">
            <input type="checkbox" checked={selectedMaps.has(m)} onChange={() => toggle(selectedMaps, m, setSelectedMaps)} className="rounded" />
            <span className="text-xs text-gray-700">{MAP_LABELS[m] ?? m}</span>
          </label>
        ))}
      </div>

      <div className="px-3 pb-3 border-t border-gray-100 pt-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Capas</p>
        {layers.map((l) => (
          <label key={l} className="flex items-center gap-2 py-1 cursor-pointer">
            <input type="checkbox" checked={selectedLayers.has(l)} onChange={() => toggle(selectedLayers, l, setSelectedLayers)} className="rounded" />
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: LAYER_COLORS[l] ?? "#6b7280" }} />
            <span className="text-xs text-gray-700">{l}</span>
          </label>
        ))}
      </div>

      <div className="px-3 pb-3 border-t border-gray-100 pt-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Categorías</p>
        {categories.map((c) => (
          <label key={c} className="flex items-center gap-2 py-0.5 cursor-pointer">
            <input type="checkbox" checked={selectedCats.has(c)} onChange={() => toggle(selectedCats, c, setSelectedCats)} className="rounded" />
            <span className="text-xs text-gray-700">{c}</span>
          </label>
        ))}
      </div>

      {activeFilters > 0 && (
        <div className="px-3 pb-4">
          <button
            type="button"
            onClick={clearFilters}
            className="w-full py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Limpiar filtros
          </button>
        </div>
      )}
    </div>
  );

  // ── Place card ────────────────────────────────────────────────────────────────

  const card = (() => {
    if (places.length === 0) {
      return <p className="text-center text-gray-400 text-sm mt-10">Cargando datos…</p>;
    }
    if (filtered.length === 0) {
      return (
        <div className="flex flex-col items-center gap-3 p-6 text-center mt-4">
          <p className="text-gray-400 text-sm">Sin lugares con estos filtros</p>
          <button type="button" onClick={clearFilters} className="text-xs text-green-700 underline">
            Limpiar filtros
          </button>
        </div>
      );
    }
    if (!currentPlace) return null;

    const dist = fmtDist(currentPlace.dist);

    return (
      <div
        className="flex flex-col select-none touch-pan-y"
        onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touchStartX.current === null) return;
          const dx = e.changedTouches[0].clientX - touchStartX.current;
          touchStartX.current = null;
          if (Math.abs(dx) < 30) return;
          if (dx < 0) { nextCard(); } else { prevCard(); }
        }}
      >
        {/* Card body */}
        <div className="mx-5 pt-5 pb-5">

          {/* Name + distance in same row */}
          <div className="flex items-start gap-3 mb-4">
            <h2 className="flex-1 text-[17px] font-bold text-gray-900 leading-snug">
              {currentPlace.nombre}
            </h2>
            {dist && (
              <div className="flex-shrink-0 text-right">
                <p className="text-2xl font-black text-green-600 leading-none tracking-tight">{dist}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">de tu posición</p>
              </div>
            )}
          </div>

          {/* Details */}
          <div className="space-y-2 text-sm text-gray-600">
            {currentPlace.gf_nivel && (
              <p className="text-xs font-medium text-green-700">
                {currentPlace.gf_nivel === "100%" ? "🌿 100% sin gluten" : "🍃 Opciones sin gluten"}
              </p>
            )}
            {currentPlace.categoria && (
              <p className="truncate">{currentPlace.categoria}</p>
            )}
            {currentPlace.direccion && (
              <p className="text-xs text-gray-500 leading-snug line-clamp-2">
                📍 {currentPlace.direccion}
              </p>
            )}
            {currentPlace.telefono && (
              <p className="text-xs text-gray-500">📞 {currentPlace.telefono}</p>
            )}
          </div>

          {/* Google Maps link */}
          {currentPlace.gmaps_url && (
            <a
              href={currentPlace.gmaps_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-gray-500" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5S10.62 6.5 12 6.5s2.5 1.12 2.5 2.5S13.38 11.5 12 11.5z"/>
              </svg>
              Ver en Google Maps
            </a>
          )}

          {/* Route info */}
          {routeInfo ? (
            <div className="mt-3 flex items-center gap-2 p-3 bg-blue-50 rounded-xl">
              <div className="flex-1">
                <p className="text-sm font-bold text-blue-700">{fmtDuration(routeInfo.duration)}</p>
                <p className="text-xs text-blue-400">{fmtRouteDist(routeInfo.distance)}</p>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => { setRoute(null); setRouteInfo(null); setFitBounds(null); setRouteMode("foot"); }}
                  className={`px-2 py-1 text-xs rounded-lg transition-colors ${routeMode === "foot" ? "bg-blue-600 text-white" : "text-blue-400 hover:bg-blue-100"}`}
                >🚶</button>
                <button
                  type="button"
                  onClick={() => { setRoute(null); setRouteInfo(null); setFitBounds(null); setRouteMode("driving"); }}
                  className={`px-2 py-1 text-xs rounded-lg transition-colors ${routeMode === "driving" ? "bg-blue-600 text-white" : "text-blue-400 hover:bg-blue-100"}`}
                >🚗</button>
              </div>
            </div>
          ) : userPos && (
            <div className="mt-3 flex items-center justify-center h-8 text-xs text-gray-300">
              Calculando ruta…
            </div>
          )}
        </div>

        {/* Navigation bar */}
        <div className="flex-shrink-0 border-t border-gray-100 px-2 py-2 flex items-center justify-between">
          <button
            type="button"
            onClick={prevCard}
            disabled={cardIndex === 0}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:cursor-default transition-colors"
            aria-label="Lugar anterior"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/>
            </svg>
          </button>

          <span className="text-xs text-gray-400 tabular-nums">
            {(cardIndex + 1).toLocaleString()}
            <span className="text-gray-300 mx-1">/</span>
            {filtered.length.toLocaleString()}
          </span>

          <button
            type="button"
            onClick={nextCard}
            disabled={cardIndex === filtered.length - 1}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:cursor-default transition-colors"
            aria-label="Lugar siguiente"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/>
            </svg>
          </button>
        </div>
      </div>
    );
  })();

  // ── Lista view (mobile) ───────────────────────────────────────────────────────

  const listaView = (
    <div className="flex-1 overflow-y-auto">
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <p className="text-gray-400 text-sm">Sin lugares con estos filtros</p>
          <button type="button" onClick={clearFilters} className="text-xs text-green-700 underline">
            Limpiar filtros
          </button>
        </div>
      ) : (
        filtered.map((p, idx) => {
          const color = getColor(p.capa, p.mapa);
          const dist  = fmtDist(p.dist);
          return (
            <button
              key={idx}
              type="button"
              onClick={() => { goToCard(idx); setMobileView("mapa"); }}
              className="w-full text-left px-4 py-3 border-b border-gray-100 flex items-center gap-3 active:bg-gray-50"
            >
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{p.nombre}</p>
                {p.categoria && <p className="text-xs text-gray-500 truncate">{p.categoria}</p>}
              </div>
              {dist && <span className="text-xs font-bold text-green-600 flex-shrink-0">{dist}</span>}
            </button>
          );
        })
      )}
    </div>
  );

  // ── Header button classes (dark bg = green header; light bg = white header) ───

  const geoButtonClass = `p-1.5 rounded-lg transition-colors flex-shrink-0 ${
    geoStatus === "ok"      ? "bg-blue-500 text-white" :
    geoStatus === "loading" ? "bg-white/30 text-white animate-pulse" :
    geoStatus === "denied"  ? "bg-red-500/70 text-white" :
                              "bg-white/20 text-white hover:bg-white/30"
  }`;

  const filterButtonClass = `relative p-1.5 rounded-lg flex-shrink-0 transition-colors ${
    filtersOpen || activeFilters > 0 ? "bg-yellow-400 text-gray-900" : "bg-white/20 text-white hover:bg-white/30"
  }`;

  const geoButtonClassLight = `p-1.5 rounded-lg transition-colors flex-shrink-0 ${
    geoStatus === "ok"      ? "bg-blue-500 text-white" :
    geoStatus === "loading" ? "bg-gray-100 text-gray-400 animate-pulse" :
    geoStatus === "denied"  ? "bg-red-500 text-white" :
                              "bg-gray-100 text-gray-600 hover:bg-gray-200"
  }`;

  const filterButtonClassLight = `relative p-1.5 rounded-lg flex-shrink-0 transition-colors ${
    filtersOpen || activeFilters > 0 ? "bg-yellow-400 text-gray-900" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
  }`;

  const filterSvg = (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V17a1 1 0 01-1.447.894l-4-2A1 1 0 017 15v-4.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd" />
    </svg>
  );

  const geoSvg = (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
    </svg>
  );

  // ── Render ────────────────────────────────────────────────────────────────────

  const filterBadge = activeFilters > 0 && (
    <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold leading-none">
      {activeFilters}
    </span>
  );

  return (
    <div className="flex h-full w-full overflow-hidden">

      {/* Global filter overlay */}
      {filtersOpen && filterPanel}

      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex w-72 flex-shrink-0 bg-white border-r border-gray-200 flex-col overflow-hidden shadow-sm">
        <div className="px-3 py-3 bg-green-700 text-white flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold leading-tight truncate">🌾 Gluten Free Social</h1>
            <p className="text-xs text-green-200 mt-0.5">
              {filtered.length.toLocaleString()} lugares
              {geoStatus === "ok" && " · por cercanía"}
            </p>
          </div>
          <button type="button" onClick={requestGeo} title="Mi ubicación" className={geoButtonClass}>{geoSvg}</button>
          <button type="button" onClick={() => setFiltersOpen((o) => !o)} title="Filtros" className={filterButtonClass}>
            {filterSvg}{filterBadge}
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          {card}
        </div>
      </aside>

      {/* ── Mobile top bar: location search + Mapa/Lista toggle ── */}
      <div className="md:hidden fixed top-0 inset-x-0 z-[1002] px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">

          {/* Location search */}
          <div className="flex-1 relative">
            <div className="flex items-center h-10 rounded-full pl-3 pr-2 gap-2 bg-white/50 backdrop-blur-md border border-white/70 shadow-sm transition-all duration-200 focus-within:bg-white/92 focus-within:border-gray-200 focus-within:shadow-md">
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
              </svg>
              <input
                type="text"
                placeholder="Buscar zona…"
                value={locationQuery}
                onChange={(e) => handleLocationChange(e.target.value)}
                className="flex-1 text-sm bg-transparent outline-none min-w-0 text-gray-800 placeholder-gray-400"
              />
              {searchPos && (
                <button type="button" onClick={clearLocation} className="text-gray-400 leading-none flex-shrink-0 px-1">✕</button>
              )}
            </div>
            {locationSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1.5 bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
                {locationSuggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => selectLocation(s)}
                    className="w-full text-left px-4 py-2.5 text-xs text-gray-700 border-b border-gray-50 last:border-0 active:bg-gray-50"
                  >
                    {s.label.split(",").slice(0, 3).join(", ")}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Mapa/Lista toggle */}
          <div className="flex h-10 bg-white/50 backdrop-blur-md border border-white/70 shadow-sm rounded-full p-1 gap-0.5 flex-shrink-0">
            <button
              type="button"
              onClick={() => setMobileView("mapa")}
              className={`text-sm px-3 h-full rounded-full transition-colors font-semibold ${mobileView === "mapa" ? "bg-green-700 text-white" : "text-gray-600"}`}
            >
              Mapa
            </button>
            <button
              type="button"
              onClick={() => { setMobileView("lista"); setSheetOpen(true); }}
              className={`text-sm px-3 h-full rounded-full transition-colors font-semibold ${mobileView === "lista" ? "bg-green-700 text-white" : "text-gray-600"}`}
            >
              Lista
            </button>
          </div>

        </div>
      </div>

      {/* ── Map ── */}
      <div className="flex-1 relative">
        <MapView
          places={filtered}
          layerColors={LAYER_COLORS}
          selectedPlace={currentPlace}
          onSelect={handleSelectPlace}
          userPosition={userPos}
          flyTarget={flyTarget}
          route={route}
          routeMode={routeMode}
          fitBounds={fitBounds}
        />
      </div>

      {/* ── Mobile bottom sheet ── */}
      <div
        className={`md:hidden fixed inset-x-0 bottom-0 z-[1001] flex flex-col bg-white rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out
          ${mobileView === "lista" ? "h-[82vh]" : "h-auto max-h-[82vh]"}
          ${sheetOpen ? "translate-y-0" : "translate-y-[calc(100%_-_4rem)]"}`}
      >
        {mobileView === "mapa" ? (
          /* Minimal white handle for card mode */
          <div
            className="flex-shrink-0 rounded-t-2xl cursor-pointer select-none"
            onClick={() => setSheetOpen((o) => !o)}
          >
            <div className="flex justify-center pt-2.5 pb-1.5">
              <div className="w-8 h-1 rounded-full bg-gray-200" />
            </div>
            <div className="px-3 pb-2 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
              <p className="text-xs text-gray-400">
                {filtered.length.toLocaleString()} lugares{geoStatus === "ok" && " · por cercanía"}
              </p>
              <div className="flex gap-1">
                <button type="button" onClick={requestGeo} title="Mi ubicación" className={geoButtonClassLight}>{geoSvg}</button>
                <button type="button" onClick={() => setFiltersOpen((o) => !o)} title="Filtros" className={filterButtonClassLight}>
                  {filterSvg}{filterBadge}
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Green header for lista mode */
          <div
            className="flex-shrink-0 bg-green-700 rounded-t-2xl cursor-pointer select-none"
            onClick={() => setSheetOpen((o) => !o)}
          >
            <div className="flex justify-center pt-2.5 pb-1">
              <div className="w-8 h-1 rounded-full bg-white/40" />
            </div>
            <div className="px-3 pb-3 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white leading-tight truncate">🌾 Gluten Free Social</p>
                <p className="text-xs text-green-200">
                  {filtered.length.toLocaleString()} lugares{geoStatus === "ok" && " · por cercanía"}
                </p>
              </div>
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={requestGeo} title="Mi ubicación" className={geoButtonClass}>{geoSvg}</button>
                <button type="button" onClick={() => setFiltersOpen((o) => !o)} title="Filtros" className={filterButtonClass}>
                  {filterSvg}{filterBadge}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Sheet body */}
        <div className={`relative ${mobileView === "lista" ? "flex-1 flex flex-col overflow-hidden" : "overflow-y-auto"}`}>
          {mobileView === "lista" ? listaView : card}
        </div>
      </div>

    </div>
  );
}
