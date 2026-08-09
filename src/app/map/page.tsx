"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import type { MapVenue } from "@/components/map/VenueMap";
import type { VenuesResponse } from "@pdd27673/10s-contract";

// Leaflet touches `window`, so the map must never render on the server.
const VenueMap = dynamic(() => import("@/components/map/VenueMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full grid place-items-center text-sm text-[var(--text-3)]">Loading map…</div>,
});

export default function MapPage() {
  const [venues, setVenues] = useState<MapVenue[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/venues");
        if (!res.ok) throw new Error(`venues ${res.status}`);
        const data = (await res.json()) as VenuesResponse;
        if (cancelled) return;
        const mapped: MapVenue[] = data.venues
          .filter((v) => v.lat != null && v.lng != null)
          .map((v) => ({
            slug: v.slug,
            name: v.name,
            lat: v.lat as number,
            lng: v.lng as number,
            type: v.type,
            address: v.address,
            postcode: v.postcode,
            bookingUrl: v.bookingUrl,
          }));
        setVenues(mapped);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col h-dvh">
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 shrink-0 group">
            <BrandMark className="w-7 h-7 group-hover:opacity-90 transition-opacity" />
            <span className="font-[family-name:var(--font-bricolage)] font-bold text-sm tracking-tight text-[var(--text)]">
              TFT
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--text-2)]">
              {status === "ready" ? `${venues.length} venue${venues.length === 1 ? "" : "s"} on the map` : "Venue map"}
            </span>
            <Link
              href="/dashboard"
              className="px-3 py-1.5 border border-[var(--border)] text-[var(--text-2)] rounded-lg text-sm hover:text-[var(--text)] transition-colors"
            >
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 relative">
        {status === "error" ? (
          <div className="h-full grid place-items-center text-sm text-[var(--text-3)]">
            Couldn&apos;t load venues. Try again later.
          </div>
        ) : status === "ready" && venues.length === 0 ? (
          <div className="h-full grid place-items-center text-sm text-[var(--text-3)] text-center px-6">
            No venues have coordinates yet. They populate once the facility feed has run.
          </div>
        ) : (
          <VenueMap venues={venues} />
        )}
      </main>
    </div>
  );
}
