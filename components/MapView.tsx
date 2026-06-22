"use client";

import { MapContainer, TileLayer, Popup, CircleMarker } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { type Place } from "./MapApp";

type Props = {
  places: Place[];
  layerColors: Record<string, string>;
  selectedPlace: Place | null;
  onSelect: (place: Place) => void;
};

export default function MapView({ places, layerColors, selectedPlace, onSelect }: Props) {
  return (
    <MapContainer
      center={[20, 0]}
      zoom={2}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
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
