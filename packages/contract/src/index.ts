/**
 * Wire types for the 10s-court-monitor REST API.
 * Source of truth — route handlers and 10s-mobile both import from here.
 */

// ---- Primitives ----

export type SlotStatus = "available" | "booked" | "closed" | "coaching";

export type VenueType = "courtside" | "clubspark";

export type ChannelType = "telegram" | "email" | "expo-push";

/** Per-day preferred times, e.g. `{ monday: ["18:00", "19:00"] }`. */
export type DayTimes = Record<string, string[]>;

export type VenueSummary = {
  slug: string;
  name: string;
};

/** Full venue as returned by GET /api/venues (scraper config). */
export type Venue = VenueSummary & {
  type: VenueType;
  clubsparkId?: string;
  clubsparkHost?: string;
};

export type AvailabilitySlot = {
  venueSlug: string;
  venueName: string;
  time: string;
  court: string;
  status: SlotStatus;
  price?: string | null;
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
