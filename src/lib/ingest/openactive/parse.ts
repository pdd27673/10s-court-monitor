/**
 * Pure parsers for the OpenActive FacilityUse (venues + courts) and Slot
 * (availability) payloads, plus the Greater London filter that keeps ingestion
 * scoped to London while remaining fully data-driven (no hardcoded venue list).
 */
import { minutesFromIso, minutesToLabel } from "../../time";
import { isNonTennisName } from "../../non-tennis";

// --- Greater London bounding box (approx). Keeps the national feed London-only. ---
export const LONDON_BBOX = { minLat: 51.28, maxLat: 51.70, minLng: -0.53, maxLng: 0.34 };

export function isGreaterLondon(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  return lat >= LONDON_BBOX.minLat && lat <= LONDON_BBOX.maxLat && lng >= LONDON_BBOX.minLng && lng <= LONDON_BBOX.maxLng;
}

/** Known Tower Hamlets facility identifier -> existing venue slug, so the feed
 * links to the rows the website + scrapers already use instead of duplicating. */
export const TH_FACILITY_SLUGS: Record<string, string> = {
  "251": "bethnal-green-gardens",
  "252": "king-edward-memorial-park",
  "253": "poplar-rec-ground",
  "254": "ropemakers-field",
  "255": "st-johns-park",
  "256": "victoria-park",
  "257": "wapping-gardens",
};

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---- Feed-reference + legacy-label helpers (pure) ----

/** Extract the parent facility id from a facility-use / individual-facility-use
 * / slot @id, e.g. ".../facility-uses/251/individual-facility-uses/300" -> "251". */
export function facilityIdFromRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const m = /\/facility-uses\/(\d+)/.exec(ref);
  return m ? m[1] : null;
}

/** Court number from a court name — the last number in the string, tolerating a
 * trailing marker. Feed names are "Court 3"; the HTML scraper appends " -" to
 * coaching rows ("Tennis court 3 -"), so match the final digit group followed by
 * any non-digits. This keeps the feed and scraper court labels on one join key. */
export function courtNumberFromName(name: string | null | undefined): number | null {
  if (!name) return null;
  const m = /(\d+)\D*$/.exec(name.trim());
  return m ? parseInt(m[1], 10) : null;
}

/** Local date ("2026-07-12") from an ISO string, using the string's own wall
 * clock — no timezone conversion, matching how the scraper reads venue-local dates. */
export function localDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Scraper-style time label from an ISO string's wall clock:
 * "2026-07-12T17:00:00+01:00" -> "5pm". Whole hours match the labels the HTML
 * scraper stores ("7am", "12pm", "8pm") so feed + scraper rows share a key.
 * Minute-precise (":30" is kept as "5:30pm") so a half-hour slot doesn't collapse
 * onto the top-of-hour row under the (venue,date,time,court) unique key or mismatch
 * an "HH:MM" watch — delegates to the canonical `time.ts` helpers. */
export function hourLabel(iso: string): string | null {
  const mins = minutesFromIso(iso);
  return mins == null ? null : minutesToLabel(mins);
}

/** Availability status from an RPDE slot's `remainingUses`: >0 = bookable, else
 * taken. Uses the same status vocabulary as the HTML scraper ("available" |
 * "booked") so feed rows and scraper rows are interchangeable. */
export function feedSlotStatus(remainingUses: number | null | undefined): "available" | "booked" {
  return remainingUses != null && remainingUses > 0 ? "available" : "booked";
}

/** Transition rule shared with the HTML differ (`differ.ts`): a slot is "newly
 * available" only when it flips from a KNOWN non-available state to available.
 * A null prior status — first time we've seen the slot, e.g. during a backfill —
 * never counts, so backfills notify nothing. */
export function isNewlyAvailable(oldStatus: string | null, newStatus: string): boolean {
  return newStatus === "available" && oldStatus !== null && oldStatus !== "available";
}

// ---- FacilityUse ----

export interface ParsedCourt {
  externalId: string; // individual-facility-use @id
  name: string | null;
}

export interface ParsedVenue {
  externalId: string; // FacilityUse @id
  identifier: string; // numeric identifier
  slug: string;
  name: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  postcode: string | null;
  amenities: Record<string, boolean> | null;
  courts: ParsedCourt[];
}

interface RawAddress {
  streetAddress?: string;
  addressLocality?: string;
  addressRegion?: string;
  postalCode?: string;
}

interface RawFacilityUse {
  "@id"?: string;
  identifier?: string | number;
  name?: string;
  individualFacilityUse?: { "@id"?: string; name?: string }[];
  location?: {
    name?: string;
    address?: RawAddress;
    amenityFeature?: { name?: string; value?: boolean }[];
    geo?: { latitude?: number; longitude?: number };
  };
}

function formatAddress(a: RawAddress | undefined): string | null {
  if (!a) return null;
  const parts = [a.streetAddress, a.addressLocality, a.addressRegion].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Parse a FacilityUse. Returns null if it has no usable geo (can't London-filter). */
export function parseFacilityUse(data: RawFacilityUse): ParsedVenue | null {
  const externalId = data["@id"];
  if (!externalId) return null;
  const identifier = String(data.identifier ?? externalId.split("/").pop() ?? "");
  const geo = data.location?.geo;
  const lat = typeof geo?.latitude === "number" ? geo.latitude : null;
  const lng = typeof geo?.longitude === "number" ? geo.longitude : null;

  // Prefer the place name ("Abington Park") over the facility name
  // ("Tennis courts at Abington Park") for display + slug.
  const placeName = data.location?.name?.trim();
  const name = placeName || data.name?.replace(/^tennis courts at\s+/i, "").trim() || `Facility ${identifier}`;
  const slug = TH_FACILITY_SLUGS[identifier] ?? slugify(name);

  const amenities =
    data.location?.amenityFeature?.reduce<Record<string, boolean>>((acc, f) => {
      if (f.name) acc[f.name] = Boolean(f.value);
      return acc;
    }, {}) ?? null;

  const rawCourts = (data.individualFacilityUse ?? []).filter((c) => c["@id"]);
  // Drop non-tennis courts (padel, cricket nets …) so they never reach the
  // `courts` table — the slot ingest resolves feed slots against that table, so
  // a padel court filtered out here can't leak its slots into the feed.
  const courts: ParsedCourt[] = rawCourts
    .filter((c) => !isNonTennisName(c.name))
    .map((c) => ({ externalId: c["@id"] as string, name: c.name ?? null }));

  // Skip the whole facility when it's non-tennis: either the venue itself is
  // named for another sport (a dedicated padel club), or every court it listed
  // was non-tennis. A metadata-only facility (no court list) is left alone —
  // those are existing tennis venues we enrich, not new non-tennis ones.
  if (isNonTennisName(name) || (rawCourts.length > 0 && courts.length === 0)) {
    return null;
  }

  return {
    externalId,
    identifier,
    slug,
    name,
    lat,
    lng,
    address: formatAddress(data.location?.address),
    postcode: data.location?.address?.postalCode ?? null,
    amenities: amenities && Object.keys(amenities).length ? amenities : null,
    courts,
  };
}

// ---- Slot ----

export interface ParsedSlot {
  slotExternalId: string; // Slot @id
  courtExternalId: string; // facilityUse link -> individual-facility-use @id
  startsAt: string; // ISO
  endsAt: string | null;
  remainingUses: number | null;
  maxUses: number | null;
  price: number | null; // base offer price
  currency: string | null;
}

interface RawOffer {
  identifier?: string;
  price?: number;
  priceCurrency?: string;
}

interface RawSlot {
  "@id"?: string;
  facilityUse?: string;
  startDate?: string;
  endDate?: string;
  remainingUses?: number;
  maximumUses?: number;
  offers?: RawOffer[];
}

/** The "base" offer is the standard price; fall back to the cheapest listed. */
function basePrice(offers: RawOffer[] | undefined): { price: number | null; currency: string | null } {
  if (!offers?.length) return { price: null, currency: null };
  const base = offers.find((o) => o.identifier === "base") ?? offers[0];
  return { price: typeof base.price === "number" ? base.price : null, currency: base.priceCurrency ?? null };
}

/** Parse a Slot. Returns null if it lacks the fields needed to store it. */
export function parseSlot(data: RawSlot): ParsedSlot | null {
  const slotExternalId = data["@id"];
  const courtExternalId = data.facilityUse;
  const startsAt = data.startDate;
  if (!slotExternalId || !courtExternalId || !startsAt) return null;
  const { price, currency } = basePrice(data.offers);
  return {
    slotExternalId,
    courtExternalId,
    startsAt,
    endsAt: data.endDate ?? null,
    remainingUses: typeof data.remainingUses === "number" ? data.remainingUses : null,
    maxUses: typeof data.maximumUses === "number" ? data.maximumUses : null,
    price,
    currency,
  };
}
