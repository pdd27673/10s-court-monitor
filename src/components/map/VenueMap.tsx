"use client";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapVenue = {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  type?: string;
  address?: string | null;
  postcode?: string | null;
  bookingUrl?: string | null;
};

// Greater London-ish default centre + zoom, used when we can't fit to markers
// (e.g. zero venues have coordinates yet).
const LONDON: [number, number] = [51.5074, -0.1278];

// A self-contained SVG pin as a Leaflet divIcon. Avoids Leaflet's default
// marker-image asset (which breaks under bundlers) and needs no external request,
// so it works cleanly under the app's CSP. Colour distinguishes the operator.
function pinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "venue-pin",
    html: `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M13 0C5.82 0 0 5.82 0 13c0 9.25 13 21 13 21s13-11.75 13-21C26 5.82 20.18 0 13 0z" fill="${color}"/>
      <circle cx="13" cy="13" r="5" fill="#ffffff"/>
    </svg>`,
    iconSize: [26, 34],
    iconAnchor: [13, 34], // tip of the pin
    popupAnchor: [0, -30],
  });
}

const COURTSIDE_PIN = pinIcon("#16a34a"); // green
const CLUBSPARK_PIN = pinIcon("#2563eb"); // blue

/**
 * Leaflet + OpenStreetMap venue map. Renders one marker per venue that has
 * coordinates, with a popup for name/address/booking. Client-only — the page
 * imports it via `next/dynamic` with `ssr:false` because Leaflet needs `window`.
 */
export default function VenueMap({ venues }: { venues: MapVenue[] }) {
  const withCoords = venues.filter(
    (v) => typeof v.lat === "number" && typeof v.lng === "number" && !Number.isNaN(v.lat) && !Number.isNaN(v.lng)
  );

  // Centre on the mean of known venue coordinates, else London.
  const center: [number, number] = withCoords.length
    ? [
        withCoords.reduce((s, v) => s + v.lat, 0) / withCoords.length,
        withCoords.reduce((s, v) => s + v.lng, 0) / withCoords.length,
      ]
    : LONDON;

  return (
    <MapContainer center={center} zoom={12} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {withCoords.map((v) => (
        <Marker key={v.slug} position={[v.lat, v.lng]} icon={v.type === "clubspark" ? CLUBSPARK_PIN : COURTSIDE_PIN}>
          <Popup>
            <div style={{ minWidth: 160 }}>
              <strong>{v.name}</strong>
              {v.type && <div style={{ fontSize: 12, opacity: 0.7 }}>{v.type}</div>}
              {v.address && (
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  {v.address}
                  {v.postcode ? `, ${v.postcode}` : ""}
                </div>
              )}
              {v.bookingUrl && (
                <div style={{ marginTop: 6 }}>
                  <a href={v.bookingUrl.replace("{date}", "")} target="_blank" rel="noreferrer">
                    Book →
                  </a>
                </div>
              )}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
