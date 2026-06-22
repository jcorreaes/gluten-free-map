"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Pane, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { type PlaceWithDist } from "./MapApp";

type Props = {
  places: PlaceWithDist[];
  layerColors: Record<string, string>;
  selectedPlace: PlaceWithDist | null;
  onSelect: (place: PlaceWithDist) => void;
  userPosition: [number, number] | null;
  flyTarget: [number, number, number] | null;
  route: [number, number][] | null;
  routeMode: "foot" | "driving";
  fitBounds: [[number, number], [number, number]] | null;
};

function GradientPolyline({ positions, color, weight, dashArray }: {
  positions: [number, number][];
  color: string;
  weight: number;
  dashArray?: string;
}) {
  const n = positions.length;
  if (n < 2) return null;
  const segments = 14;
  return (
    <>
      {Array.from({ length: segments }, (_, i) => {
        const start = Math.floor((i / segments) * (n - 1));
        const end = Math.floor(((i + 1) / segments) * (n - 1));
        const opacity = 0.9 - (i / (segments - 1)) * 0.8;
        return (
          <Polyline
            key={i}
            pane="routePane"
            positions={positions.slice(start, end + 1)}
            pathOptions={{ color, weight, opacity, dashArray }}
          />
        );
      })}
    </>
  );
}

function MapController({ target, fitBounds }: { target: [number, number, number] | null; fitBounds: [[number, number], [number, number]] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target[0], target[1]], target[2], { duration: 1.2 });
  }, [target, map]);
  useEffect(() => {
    if (fitBounds) map.fitBounds(fitBounds, {
      paddingTopLeft: [40, 120],
      paddingBottomRight: [40, 320],
      maxZoom: 16,
    });
  }, [fitBounds, map]);
  return null;
}

export default function MapView({ places, layerColors, selectedPlace, onSelect, userPosition, flyTarget, route, routeMode, fitBounds }: Props) {
  return (
    <MapContainer center={[28, -15.4]} zoom={9} preferCanvas zoomControl={false} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      <MapController target={flyTarget} fitBounds={fitBounds} />

      {/* Route rendered in a low-z pane so markers always appear above */}
      <Pane name="routePane" style={{ zIndex: 350 }}>
        {route && (
          routeMode === "driving"
            ? <GradientPolyline positions={route} color="#dc2626" weight={4} />
            : <GradientPolyline positions={route} color="#2563eb" weight={4} dashArray="10 6" />
        )}
      </Pane>

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
          />
        </>
      )}

      <MarkerClusterGroup chunkedLoading disableClusteringAtZoom={12}>
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
              radius={isSelected ? 12 : 8}
              pathOptions={{
                color: "#fff",
                fillColor: color,
                fillOpacity: isSelected ? 1 : 0.9,
                weight: isSelected ? 3 : 1.5,
              }}
              eventHandlers={{ click: () => onSelect(p) }}
            />
          );
        })}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
