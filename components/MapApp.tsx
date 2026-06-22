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
  return km === Infinity ? "" : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

const PAGE = 20;

export default function MapApp() {
  const [places, setPlaces]               = useState<Place[]>([]);
  const [userPos, setUserPos]             = useState<[number, number] | null>(null);
  const [geoStatus, setGeoStatus]         = useState<"idle" | "loading" | "ok" | "denied">("idle");
  const [selectedPlace, setSelectedPlace] = useState<PlaceWithDist | null>(null);
  const [flyTarget, setFlyTarget]         = useState<[number, number, number] | null>(null);
  const [filtersOpen, setFiltersOpen]     = useState(false);
  const [search, setSearch]               = useState("");
  const [selectedMaps, setSelectedMaps]   = useState<Set<string>>(new Set());
  const [selectedLayers, setSelectedLayers] = useState<Set<string>>(new Set());
  const [selectedCats, setSelectedCats]   = useState<Set<string>>(new Set());
  const [onlyCertified, setOnlyCertified] = useState(false);
  const [selectedGfNivel, setSelectedGfNivel] = useState<Set<string>>(new Set());
  const [page, setPage]                   = useState(1);
  const [sheetOpen, setSheetOpen]         = useState(false);

  const listRef            = useRef<HTMLDivElement>(null);
  const mobileListRef      = useRef<HTMLDivElement>(null);
  const sentinelRef        = useRef<HTMLDivElement>(null);
  const mobileSentinelRef  = useRef<HTMLDivElement>(null);
  const geoWatchRef        = useRef<number | null>(null);

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

  const requestGeo = useCallback(() => {
    if (!navigator.geolocation) return;
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

  useEffect(() => {
    requestGeo();
    return () => {
      if (geoWatchRef.current !== null) navigator.geolocation.clearWatch(geoWatchRef.current);
    };
  }, [requestGeo]);

  const withDist = useMemo<PlaceWithDist[]>(() =>
    places.map((p) => ({
      ...p,
      dist: userPos ? haversine(userPos[0], userPos[1], p.lat, p.lng) : Infinity,
    })),
    [places, userPos]
  );

  const filtered = useMemo(() =>
    withDist
      .filter((p) => {
        if (selectedMaps.size && !selectedMaps.has(p.mapa)) return false;
        if (selectedLayers.size && !selectedLayers.has(p.capa)) return false;
        if (selectedCats.size && !selectedCats.has(p.categoria?.trim())) return false;
        if (selectedGfNivel.size && !selectedGfNivel.has(p.gf_nivel ?? "")) return false;
        if (onlyCertified && p.certificado !== "si") return false;
        if (search && !p.nombre.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => a.dist - b.dist),
    [withDist, selectedMaps, selectedLayers, selectedCats, selectedGfNivel, onlyCertified, search]
  );

  useEffect(() => {
    setPage(1);
    listRef.current?.scrollTo(0, 0);
    mobileListRef.current?.scrollTo(0, 0);
  }, [filtered]);

  const visible = useMemo(() => filtered.slice(0, page * PAGE), [filtered, page]);

  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && visible.length < filtered.length)
        setPage((p) => p + 1);
    });
    if (sentinelRef.current)       obs.observe(sentinelRef.current);
    if (mobileSentinelRef.current) obs.observe(mobileSentinelRef.current);
    return () => obs.disconnect();
  }, [visible.length, filtered.length]);

  function handleSelectPlace(p: PlaceWithDist) {
    setSelectedPlace(p);
    setFlyTarget([p.lat, p.lng, 15]);
    setSheetOpen(true);
  }

  function toggle<T>(set: Set<T>, val: T, setter: (s: Set<T>) => void) {
    const next = new Set(set);
    next.has(val) ? next.delete(val) : next.add(val);
    setter(next);
  }

  const maps       = useMemo(() => [...new Set(places.map((p) => p.mapa))].sort(), [places]);
  const layers     = useMemo(() => [...new Set(places.map((p) => p.capa))].filter(Boolean).sort(), [places]);
  const categories = useMemo(() => [...new Set(places.map((p) => p.categoria?.trim()))].filter(Boolean).sort(), [places]);

  const activeFilters = selectedMaps.size + selectedLayers.size + selectedCats.size + selectedGfNivel.size + (onlyCertified ? 1 : 0) + (search ? 1 : 0);

  // ── Shared sub-trees ──────────────────────────────────────────────────────

  const filterPanel = (
    <div className="absolute inset-0 bg-white z-10 overflow-y-auto">
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
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Sin gluten</p>
        {(["100%", "opciones"] as const).map((v) => (
          <label key={v} className="flex items-center gap-2 py-1 cursor-pointer">
            <input type="checkbox" checked={selectedGfNivel.has(v)} onChange={() => toggle(selectedGfNivel, v, setSelectedGfNivel)} className="rounded" />
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${v === "100%" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
              {v === "100%" ? "100% sin gluten" : "Opciones GF"}
            </span>
          </label>
        ))}
        <label className="flex items-center gap-2 py-1 cursor-pointer">
          <input type="checkbox" checked={onlyCertified} onChange={() => setOnlyCertified((v) => !v)} className="rounded" />
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">✓ Solo certificados</span>
        </label>
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
            onClick={() => { setSelectedMaps(new Set()); setSelectedLayers(new Set()); setSelectedCats(new Set()); setSelectedGfNivel(new Set()); setOnlyCertified(false); setSearch(""); }}
            type="button"
            className="w-full py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Limpiar filtros
          </button>
        </div>
      )}
    </div>
  );

  const selectedCard = selectedPlace && (() => {
    const color = getColor(selectedPlace.capa, selectedPlace.mapa);
    return (
      <div className="m-3 rounded-lg border p-3 text-xs" style={{ borderColor: color, background: color + "14" }}>

        {/* Nombre + cerrar */}
        <div className="flex items-start justify-between gap-1">
          <p className="font-semibold text-gray-800 leading-tight text-sm">{selectedPlace.nombre}</p>
          <button type="button" onClick={() => setSelectedPlace(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0 ml-1">✕</button>
        </div>

        {/* Badges gf_nivel + certificado */}
        {(selectedPlace.gf_nivel || selectedPlace.certificado === "si") && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {selectedPlace.gf_nivel === "100%" && (
              <span className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold text-[10px]">100% sin gluten</span>
            )}
            {selectedPlace.gf_nivel === "opciones" && (
              <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold text-[10px]">Opciones GF</span>
            )}
            {selectedPlace.certificado === "si" && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold text-[10px]">✓ Certificado</span>
            )}
          </div>
        )}

        {/* Fuente + capa + categoría + distancia */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
          <span className="text-gray-500">{MAP_LABELS[selectedPlace.mapa] ?? selectedPlace.mapa}</span>
        </div>
        {selectedPlace.capa      && <p className="mt-0.5 text-gray-400 pl-3.5">{selectedPlace.capa}</p>}
        {selectedPlace.categoria && <p className="mt-0.5 text-gray-400 pl-3.5">{selectedPlace.categoria}</p>}
        {selectedPlace.dist !== Infinity && (
          <p className="mt-0.5 text-gray-400 pl-3.5">{fmtDist(selectedPlace.dist)} · a tu posición</p>
        )}

        {/* Datos de contacto */}
        {selectedPlace.direccion && (
          <p className="mt-2 text-gray-600 leading-tight">{selectedPlace.direccion}</p>
        )}
        {selectedPlace.telefono && (
          <a href={`tel:${selectedPlace.telefono}`} className="mt-1 flex items-center gap-1.5 text-blue-600 hover:underline">
            <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z"/></svg>
            {selectedPlace.telefono}
          </a>
        )}
        {selectedPlace.web && (
          <a href={selectedPlace.web} target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-1.5 text-blue-600 hover:underline truncate">
            <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.083 9h1.946c.089-1.546.383-2.97.837-4.118A6.004 6.004 0 004.083 9zM10 2a8 8 0 100 16A8 8 0 0010 2zm0 2c-.076 0-.232.032-.465.262-.238.234-.497.623-.737 1.182-.389.907-.673 2.142-.766 3.556h3.936c-.093-1.414-.377-2.649-.766-3.556-.24-.56-.5-.948-.737-1.182C10.232 4.032 10.076 4 10 4zm3.971 5c-.089-1.546-.383-2.97-.837-4.118A6.004 6.004 0 0115.917 9h-1.946zm-2.003 2H8.032c.093 1.414.377 2.649.766 3.556.24.56.5.948.737 1.182.233.23.389.262.465.262.076 0 .232-.032.465-.262.238-.234.498-.623.737-1.182.389-.907.673-2.142.766-3.556zm1.166 4.118c.454-1.147.748-2.572.837-4.118h1.946a6.004 6.004 0 01-2.783 4.118zm-6.268 0C6.412 13.97 6.118 12.546 6.03 11H4.083a6.004 6.004 0 002.783 4.118z" clipRule="evenodd"/></svg>
            <span className="truncate">{selectedPlace.web.replace(/^https?:\/\/(www\.)?/, '')}</span>
          </a>
        )}

        {/* Enlace Google Maps */}
        {selectedPlace.gmaps_url && (
          <a
            href={selectedPlace.gmaps_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2.5 flex items-center justify-center gap-1.5 py-1.5 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg text-gray-600 transition-colors font-medium"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd"/></svg>
            Ver en Google Maps
          </a>
        )}
      </div>
    );
  })();

  function placeList(sentinel: React.RefObject<HTMLDivElement | null>) {
    return (
      <>
        {places.length === 0 ? (
          <p className="text-center text-gray-400 text-sm mt-8">Cargando datos…</p>
        ) : (
          <ul>
            {visible.map((p, i) => {
              const isSelected =
                selectedPlace?.lat === p.lat &&
                selectedPlace?.lng === p.lng &&
                selectedPlace?.nombre === p.nombre;
              const color = getColor(p.capa, p.mapa);
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => handleSelectPlace(p)}
                    className={`w-full text-left px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 transition-colors flex items-start gap-2.5 ${
                      isSelected ? "bg-gray-100" : ""
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 font-medium leading-snug truncate">{p.nombre}</p>
                      <p className="text-xs text-gray-400 truncate mt-0.5">
                        {[p.categoria, MAP_LABELS[p.mapa] ?? p.mapa].filter(Boolean).join(" · ")}
                      </p>
                      {(p.gf_nivel || p.certificado === "si") && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {p.gf_nivel === "100%" && <span className="text-[10px] px-1 py-0.5 rounded bg-green-100 text-green-700 font-medium leading-none">100%</span>}
                          {p.gf_nivel === "opciones" && <span className="text-[10px] px-1 py-0.5 rounded bg-blue-100 text-blue-700 font-medium leading-none">GF</span>}
                          {p.certificado === "si" && <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-medium leading-none">✓</span>}
                        </div>
                      )}
                    </div>
                    {p.dist !== Infinity && (
                      <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">{fmtDist(p.dist)}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {visible.length < filtered.length && (
          <div ref={sentinel} className="h-8 flex items-center justify-center">
            <span className="text-xs text-gray-300">Cargando más…</span>
          </div>
        )}
      </>
    );
  }

  const geoButtonClass = `p-1.5 rounded-lg transition-colors flex-shrink-0 ${
    geoStatus === "ok"      ? "bg-blue-500 text-white" :
    geoStatus === "loading" ? "bg-white/30 text-white animate-pulse" :
    geoStatus === "denied"  ? "bg-red-500/70 text-white" :
                              "bg-white/20 text-white hover:bg-white/30"
  }`;

  return (
    <div className="flex h-full w-full overflow-hidden">

      {/* ── Desktop sidebar (hidden on mobile) ── */}
      <aside className="hidden md:flex w-72 flex-shrink-0 bg-white border-r border-gray-200 flex-col overflow-hidden shadow-sm">
        <div className="px-3 py-3 bg-green-700 text-white flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold leading-tight truncate">🌾 Gluten Free Social</h1>
            <p className="text-xs text-green-200 mt-0.5">
              {filtered.length.toLocaleString()} lugares
              {geoStatus === "ok" && " · ordenados por cercanía"}
            </p>
          </div>
          <button type="button" onClick={requestGeo} title="Ir a mi ubicación" className={geoButtonClass}>
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
            </svg>
          </button>
          <button type="button" onClick={() => setFiltersOpen((o) => !o)} title="Filtros" className={`relative p-1.5 rounded-lg flex-shrink-0 transition-colors ${filtersOpen || activeFilters > 0 ? "bg-yellow-400 text-gray-900" : "bg-white/20 text-white hover:bg-white/30"}`}>
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V17a1 1 0 01-1.447.894l-4-2A1 1 0 017 15v-4.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd" />
            </svg>
            {activeFilters > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold leading-none">
                {activeFilters}
              </span>
            )}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto relative" ref={listRef}>
          {filtersOpen && filterPanel}
          {selectedCard}
          {placeList(sentinelRef)}
        </div>
      </aside>

      {/* ── Map ── */}
      <div className="flex-1 relative">
        <MapView
          places={filtered}
          layerColors={LAYER_COLORS}
          selectedPlace={selectedPlace}
          onSelect={handleSelectPlace}
          userPosition={userPos}
          flyTarget={flyTarget}
        />
      </div>

      {/* ── Mobile bottom sheet (hidden on desktop) ── */}
      <div
        className={`md:hidden fixed inset-x-0 bottom-0 z-[1001] h-[82vh] flex flex-col bg-white rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out ${sheetOpen ? "translate-y-0" : "translate-y-[calc(82vh-4rem)]"}`}
      >
        {/* Drag handle + header — always visible in peek mode */}
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
                {filtered.length.toLocaleString()} lugares
                {geoStatus === "ok" && " · por cercanía"}
              </p>
            </div>
            {/* stopPropagation so buttons don't toggle the sheet */}
            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={requestGeo} title="Ir a mi ubicación" className={geoButtonClass}>
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                </svg>
              </button>
              <button type="button" onClick={() => setFiltersOpen((o) => !o)} title="Filtros" className={`relative p-1.5 rounded-lg flex-shrink-0 transition-colors ${filtersOpen || activeFilters > 0 ? "bg-yellow-400 text-gray-900" : "bg-white/20 text-white hover:bg-white/30"}`}>
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L13 10.414V17a1 1 0 01-1.447.894l-4-2A1 1 0 017 15v-4.586L3.293 6.707A1 1 0 013 6V3z" clipRule="evenodd" />
                </svg>
                {activeFilters > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold leading-none">
                    {activeFilters}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto relative" ref={mobileListRef}>
          {filtersOpen && filterPanel}
          {selectedCard}
          {placeList(mobileSentinelRef)}
        </div>
      </div>

    </div>
  );
}
