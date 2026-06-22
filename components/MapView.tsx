"use client";

import { MapContainer, TileLayer, Popup, CircleMarker } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { type Place } from "./MapApp";

type Props = {
  places: Place[];
  layerColors: Record<string, string>;
};

export default function MapView({ places, layerColors }: Props) {
  return (
    <MapContainer
      center={[20, 0]}
      zoom={2}
      style={{ height: "100%", width: "100%" }}
      preferCanvas
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MarkerClusterGroup chunkedLoading>
        {places.map((p, i) => (
          <CircleMarker
            key={i}
            center={[p.lat, p.lng]}
            radius={7}
            pathOptions={{
              color: layerColors[p.capa] ?? layerColors[p.mapa] ?? "#6b7280",
              fillColor: layerColors[p.capa] ?? layerColors[p.mapa] ?? "#6b7280",
              fillOpacity: 0.85,
              weight: 1.5,
            }}
          >
            <Popup>
              <div className="text-sm">
                <p className="font-semibold">{p.nombre}</p>
                <p className="text-gray-500 text-xs mt-0.5">{p.categoria}</p>
                <p className="text-gray-400 text-xs">{p.capa}</p>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
