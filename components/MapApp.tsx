"use client";

import { useEffect, useState, useMemo } from "react";
import Papa from "papaparse";
import dynamic from "next/dynamic";

const MapView = dynamic(() => import("./MapView"), { ssr: false });

export type Place = {
  nombre: string;
  lat: number;
  lng: number;
  categoria: string;
  capa: string;
};

const LAYER_COLORS: Record<string, string> = {
  "CERTIFICADOS / CERTIFIED": "#16a34a",
  "Opinions": "#2563eb",
  "ASOC. Opinions": "#9333ea",
};

export default function MapApp() {
  const [places, setPlaces] = useState<Place[]>([]);
  const [search, setSearch] = useState("");
  const [selectedLayers, setSelectedLayers] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/data/gluten_free_map.csv")
      .then((r) => r.text())
      .then((csv) => {
        const result = Papa.parse<Place>(csv, { header: true, skipEmptyLines: true });
        const parsed = result.data.map((r) => ({
          ...r,
          lat: parseFloat(String(r.lat)),
          lng: parseFloat(String(r.lng)),
        }));
        setPlaces(parsed);
      });
  }, []);

  const layers = useMemo(() => [...new Set(places.map((p) => p.capa))].sort(), [places]);
  const categories = useMemo(
    () =>
      [...new Set(places.map((p) => p.categoria.trim()))].filter(Boolean).sort(),
    [places]
  );

  const filtered = useMemo(() => {
    return places.filter((p) => {
      if (selectedLayers.size > 0 && !selectedLayers.has(p.capa)) return false;
      if (selectedCategories.size > 0 && !selectedCategories.has(p.categoria.trim())) return false;
      if (search && !p.nombre.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [places, selectedLayers, selectedCategories, search]);

  function toggleLayer(l: string) {
    setSelectedLayers((prev) => {
      const next = new Set(prev);
      next.has(l) ? next.delete(l) : next.add(l);
      return next;
    });
  }

  function toggleCategory(c: string) {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Sidebar */}
      <aside className="w-72 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden shadow-sm">
        <div className="p-4 border-b border-gray-100 bg-green-700 text-white">
          <h1 className="text-base font-bold leading-tight">🌾 Gluten Free Social</h1>
          <p className="text-xs text-green-200 mt-0.5">{filtered.length} / {places.length} lugares</p>
        </div>

        <div className="p-3 border-b border-gray-100">
          <input
            type="search"
            placeholder="Buscar lugar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Capas</p>
            {layers.map((l) => (
              <label key={l} className="flex items-center gap-2 py-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedLayers.has(l)}
                  onChange={() => toggleLayer(l)}
                  className="rounded"
                />
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: LAYER_COLORS[l] ?? "#6b7280" }}
                />
                <span className="text-xs text-gray-700 leading-tight">{l}</span>
              </label>
            ))}
          </div>

          <div className="p-3 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Categorías</p>
            {categories.map((c) => (
              <label key={c} className="flex items-center gap-2 py-0.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedCategories.has(c)}
                  onChange={() => toggleCategory(c)}
                  className="rounded"
                />
                <span className="text-xs text-gray-700">{c}</span>
              </label>
            ))}
          </div>
        </div>

        {(selectedLayers.size > 0 || selectedCategories.size > 0 || search) && (
          <div className="p-3 border-t border-gray-100">
            <button
              onClick={() => {
                setSelectedLayers(new Set());
                setSelectedCategories(new Set());
                setSearch("");
              }}
              className="w-full py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Limpiar filtros
            </button>
          </div>
        )}
      </aside>

      {/* Map */}
      <div className="flex-1 relative">
        {places.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Cargando datos...
          </div>
        ) : (
          <MapView places={filtered} layerColors={LAYER_COLORS} />
        )}
      </div>
    </div>
  );
}
