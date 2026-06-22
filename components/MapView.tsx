"use client";

import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Pane, useMap } from "react-leaflet";

const userIcon = L.divIcon({
  className: "",
  html: `<div style="position:relative;width:54px;height:54px"><div class="user-location-ring"></div><div class="user-location-dot"></div></div>`,
  iconSize: [54, 54],
  iconAnchor: [27, 27],
});
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
        const opacity = 0.2 + (i / (segments - 1)) * 0.7;
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

      {/* User position — always visible, never clustered */}
      {userPosition && (
        <Marker position={userPosition} icon={userIcon} zIndexOffset={1000} />
      )}

      {/* Selected place — always visible, never clustered */}
      {selectedPlace && (() => {
        const color = layerColors[selectedPlace.capa] ?? layerColors[selectedPlace.mapa] ?? "#6b7280";
        return (
          <CircleMarker
            center={[selectedPlace.lat, selectedPlace.lng]}
            radius={12}
            pathOptions={{ color: "#fff", fillColor: color, fillOpacity: 1, weight: 3 }}
            eventHandlers={{ click: () => onSelect(selectedPlace) }}
          />
        );
      })()}

      <MarkerClusterGroup chunkedLoading disableClusteringAtZoom={12}>
        {places.map((p, i) => {
          const isSelected =
            selectedPlace?.nombre === p.nombre &&
            selectedPlace?.lat === p.lat &&
            selectedPlace?.lng === p.lng;
          if (isSelected) return null;
          const color = layerColors[p.capa] ?? layerColors[p.mapa] ?? "#6b7280";
          return (
            <CircleMarker
              key={i}
              center={[p.lat, p.lng]}
              radius={8}
              pathOptions={{ color: "#fff", fillColor: color, fillOpacity: 0.9, weight: 1.5 }}
              eventHandlers={{ click: () => onSelect(p) }}
            />
          );
        })}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
