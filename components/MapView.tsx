"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Popup, CircleMarker, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { type PlaceWithDist } from "./MapApp";

type Props = {
  places: PlaceWithDist[];
  layerColors: Record<string, string>;
  selectedPlace: PlaceWithDist | null;
  onSelect: (place: PlaceWithDist) => void;
  userPosition: [number, number] | null;
  flyTarget: [number, number, number] | null;
};

function MapController({ target }: { target: [number, number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target[0], target[1]], target[2], { duration: 1.2 });
  }, [target, map]);
  return null;
}

export default function MapView({ places, layerColors, selectedPlace, onSelect, userPosition, flyTarget }: Props) {
  return (
    <MapContainer center={[28, -15.4]} zoom={9} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapController target={flyTarget} />

      {/* User position */}
      {userPosition && (
        <>
          <CircleMarker
            center={userPosition}
            radius={14}
            pathOptions={{ color: "#3b82f6", fillColor: "#3b82f6", fillOpacity: 0.15, weight: 0 }}
            className="user-pulse"
          />
          <CircleMarker
            center={userPosition}
            radius={6}
            pathOptions={{ color: "#fff", fillColor: "#3b82f6", fillOpacity: 1, weight: 2.5 }}
          >
            <Popup><span className="text-sm font-medium">Tu ubicación</span></Popup>
          </CircleMarker>
        </>
      )}

      <MarkerClusterGroup chunkedLoading>
        {places.map((p, i) => {
          const isSelected =
            selectedPlace?.nombre === p.nombre &&
            selectedPlace?.lat === p.lat &&
            selectedPlace?.lng === p.lng;
          const color = layerColors[p.capa] ?? layerColors[p.mapa] ?? "#6b7280";
          return (
            <CircleMarker
              key={i}
              center={[p.lat, p.lng]}
              radius={isSelected ? 10 : 7}
              pathOptions={{
                color: isSelected ? "#000" : color,
                fillColor: color,
                fillOpacity: isSelected ? 1 : 0.85,
                weight: isSelected ? 3 : 1.5,
              }}
              eventHandlers={{ click: () => onSelect(p) }}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold">{p.nombre}</p>
                  {p.categoria && <p className="text-gray-500 text-xs mt-0.5">{p.categoria}</p>}
                  {p.capa && <p className="text-gray-400 text-xs">{p.capa}</p>}
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
