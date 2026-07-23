/**
 * Wire types for the 10s-court-monitor REST API.
 * Source of truth — route handlers and 10s-mobile both import from here.
 */

// ---- Primitives ----

export type SlotStatus = "available" | "booked" | "closed" | "coaching";

export type VenueType = "courtside" | "clubspark";

export type ChannelType = "telegram" | "email" | "expo-push";

/** Per-day preferred times in canonical 24h `"HH:MM"`, e.g.
 * `{ monday: ["18:00", "19:00"] }`. The API stores and returns this form; the web
 * client renders am/pm for display. (Legacy am/pm labels like `"7pm"` are accepted
 * on write and normalised server-side for backward compatibility.) */
export type DayTimes = Record<string, string[]>;

export type VenueSummary = {
  slug: string;
  name: string;
};

/** Full venue as returned by GET /api/venues.
 *
 * Since 0.2.0 the API sources venues from the database (feed-enriched) rather than
 * the static scraper config, so the metadata/geo fields below are populated when
 * known. All are optional and additive — 0.1.0 clients keep compiling. `lat`/`lng`
 * (+`address`,`amenities`,`bookingUrl`) drive the map view. */
export type Venue = VenueSummary & {
  type: VenueType;
  clubsparkId?: string;
  clubsparkHost?: string;
  // ---- 0.2.0 additive metadata + geo (optional) ----
  operator?: string | null;
  address?: string | null;
  postcode?: string | null;
  amenities?: string[] | null;
  /** Booking deep-link template; `{date}` (YYYY-MM-DD) is substituted by clients. */
  bookingUrl?: string | null;
  active?: boolean;
  lat?: number | null;
  lng?: number | null;
};

export type AvailabilitySlot = {
  venueSlug: string;
  venueName: string;
  time: string;
  court: string;
  status: SlotStatus;
  price?: string | null;
  // ---- 0.2.0 additive normalized-time + booking fields (optional) ----
  /** ISO 8601 slot start (venue-local wall clock encodes the offset). */
  startsAt?: string | null;
  /** ISO 8601 slot end. */
  endsAt?: string | null;
  /** RPDE remaining uses (>0 = bookable); null for scraper-sourced rows. */
  remainingUses?: number | null;
  /** Resolved booking deep-link for this specific slot, when known. */
  bookingUrl?: string | null;
};

export type Watch = {
  id: number;
  userId: number;
  venue: VenueSummary | null;
  dayTimes: DayTimes | null;
  active: boolean;
};

export type Channel = {
  id: number;
  type: ChannelType | string;
  destination: string;
  active: boolean;
};

export type Me = {
  id: number;
  email: string;
  name: string | null;
  isAdmin: number;
  isAllowed: number;
};

export type ApiError = {
  error: string;
};

// ---- Request bodies ----

export type CreateWatchInput = {
  venueSlug?: string;
  dayTimes: DayTimes;
};

export type UpdateWatchInput = {
  dayTimes?: DayTimes | null;
  active?: boolean;
};

export type PatchWatchInput = {
  active: boolean;
};

export type CreateChannelInput = {
  type: ChannelType | string;
  destination: string;
};

/** Register a mobile device for Expo push (0.2.0 forward-hook — typed so
 * 10s-mobile can wire against it; the server notifier branch is not built yet). */
export type RegisterPushInput = {
  /** Expo push token, e.g. "ExponentPushToken[xxxxxxxx]". */
  expoPushToken: string;
  platform?: "ios" | "android";
};

export type UpdateChannelInput = {
  type?: ChannelType | string;
  destination?: string;
  active?: boolean;
};

// ---- Response envelopes ----

export type VenuesResponse = {
  venues: Venue[];
};

export type AvailabilityResponse = {
  venues: VenueSummary[];
  /** @deprecated Single-venue clients; prefer `venues`. */
  venue?: VenueSummary;
  date: string;
  slots: AvailabilitySlot[];
  lastUpdated: string | null;
};

export type WatchesResponse = {
  watches: Watch[];
};

export type WatchResponse = {
  watch: Watch;
};

export type ChannelsResponse = {
  channels: Channel[];
};

export type ChannelResponse = {
  channel: Channel;
};

export type MeResponse = {
  user: Me;
};

export type SuccessResponse = {
  success: boolean;
};
