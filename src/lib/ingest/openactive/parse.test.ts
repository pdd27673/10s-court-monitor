import { describe, it, expect } from "vitest";
import {
  parseFacilityUse,
  parseSlot,
  isGreaterLondon,
  slugify,
  facilityIdFromRef,
  courtNumberFromName,
  localDate,
  hourLabel,
  feedSlotStatus,
  isNewlyAvailable,
} from "./parse";

// Trimmed real payloads from the Premier Tennis OpenActive feed.
const FACILITY_TH = {
  "@id": "https://api.premiertennis.co.uk/openactive/feed/facility-uses/251",
  identifier: "251",
  name: "Tennis courts at Bethnal Green Gardens",
  individualFacilityUse: [
    { "@id": ".../251/individual-facility-uses/300", name: "Court 1" },
    { "@id": ".../251/individual-facility-uses/301", name: "Court 2" },
  ],
  location: {
    name: "Bethnal Green Gardens",
    address: { streetAddress: "Cambridge Heath Rd", addressLocality: "London", addressRegion: "Greater London", postalCode: "E2 0EU" },
    amenityFeature: [{ name: "Toilets", value: true }, { name: "Floodlit courts", value: false }],
    geo: { latitude: 51.52503, longitude: -0.05335 },
  },
};

const FACILITY_NORTHAMPTON = {
  "@id": "https://api.premiertennis.co.uk/openactive/feed/facility-uses/29",
  identifier: "29",
  name: "Tennis courts at Abington Park",
  individualFacilityUse: [{ "@id": ".../29/individual-facility-uses/38", name: "Court 1" }],
  location: { name: "Abington Park", geo: { latitude: 52.245093, longitude: -0.867082 } },
};

const SLOT = {
  "@id": ".../facility-uses/20/individual-facility-uses/216/slots/2194460",
  facilityUse: "https://api.premiertennis.co.uk/openactive/feed/facility-uses/20/individual-facility-uses/216",
  startDate: "2026-07-12T17:00:00+01:00",
  endDate: "2026-07-12T18:00:00+01:00",
  remainingUses: 1,
  maximumUses: 1,
  offers: [
    { identifier: "base", name: "Standard", price: 8.5, priceCurrency: "GBP" },
    { identifier: "adult-consession", price: 5.25, priceCurrency: "GBP" },
  ],
};

describe("isGreaterLondon", () => {
  it("accepts London, rejects Northampton and missing geo", () => {
    expect(isGreaterLondon(51.525, -0.053)).toBe(true);
    expect(isGreaterLondon(52.245, -0.867)).toBe(false);
    expect(isGreaterLondon(null, null)).toBe(false);
  });
});

describe("slugify", () => {
  it("kebab-cases and handles ampersands", () => {
    expect(slugify("St John's Park")).toBe("st-john-s-park");
    expect(slugify("Rec & Gardens")).toBe("rec-and-gardens");
  });
});

describe("parseFacilityUse", () => {
  it("maps a known TH facility to its existing slug with courts + geo + amenities", () => {
    const v = parseFacilityUse(FACILITY_TH)!;
    expect(v.slug).toBe("bethnal-green-gardens"); // mapped, not slugified
    expect(v.name).toBe("Bethnal Green Gardens");
    expect(v.identifier).toBe("251");
    expect(v.lat).toBeCloseTo(51.52503);
    expect(v.postcode).toBe("E2 0EU");
    expect(v.address).toContain("Cambridge Heath Rd");
    expect(v.courts).toHaveLength(2);
    expect(v.amenities).toEqual({ Toilets: true, "Floodlit courts": false });
  });

  it("slugifies an unknown facility from its place name", () => {
    const v = parseFacilityUse(FACILITY_NORTHAMPTON)!;
    expect(v.slug).toBe("abington-park");
    expect(v.courts).toHaveLength(1);
  });

  it("keeps every court of a mixed venue, flagging the padel one as non-tennis", () => {
    const v = parseFacilityUse({
      "@id": "https://api.premiertennis.co.uk/openactive/feed/facility-uses/900",
      identifier: "900",
      name: "Tennis courts at Mixed Park",
      individualFacilityUse: [
        { "@id": ".../900/individual-facility-uses/1", name: "Court 1" },
        { "@id": ".../900/individual-facility-uses/2", name: "Padel Court 1" },
        { "@id": ".../900/individual-facility-uses/3", name: "Court 2" },
      ],
      location: { name: "Mixed Park", geo: { latitude: 51.5, longitude: -0.1 } },
    })!;
    // Seeded, not dropped: the padel court stays so slot resolution can tell a
    // deliberate exclusion from a court we forgot to seed.
    expect(v.courts.map((c) => [c.name, c.nonTennis])).toEqual([
      ["Court 1", false],
      ["Padel Court 1", true],
      ["Court 2", false],
    ]);
  });

  it("flags every court of a normal tennis facility as tennis", () => {
    const v = parseFacilityUse(FACILITY_TH)!;
    expect(v.courts.map((c) => c.nonTennis)).toEqual([false, false]);
  });

  it("skips a facility whose courts are all non-tennis", () => {
    const v = parseFacilityUse({
      "@id": ".../facility-uses/901",
      identifier: "901",
      // Innocuous venue name, so this exercises the all-courts-flagged skip
      // rather than the non-tennis-venue-name skip below.
      name: "Tennis courts at Riverside Sports",
      individualFacilityUse: [
        { "@id": ".../901/individual-facility-uses/1", name: "Padel Court 1" },
        { "@id": ".../901/individual-facility-uses/2", name: "Padel Court 2" },
      ],
      location: { name: "Riverside Sports", geo: { latitude: 51.5, longitude: -0.1 } },
    });
    expect(v).toBeNull();
  });

  it("keeps a metadata-only facility with no court list", () => {
    const v = parseFacilityUse({
      "@id": ".../facility-uses/903",
      identifier: "903",
      name: "Tennis courts at Meta Park",
      location: { name: "Meta Park", geo: { latitude: 51.5, longitude: -0.1 } },
    });
    expect(v).not.toBeNull(); // enrichment of an existing tennis venue, not a skip
    expect(v!.courts).toEqual([]);
  });

  it("skips a facility named for a non-tennis sport", () => {
    const v = parseFacilityUse({
      "@id": ".../facility-uses/902",
      identifier: "902",
      name: "Padel Club London",
      individualFacilityUse: [{ "@id": ".../902/individual-facility-uses/1", name: "Court 1" }],
      location: { name: "Padel Club London", geo: { latitude: 51.5, longitude: -0.1 } },
    });
    expect(v).toBeNull();
  });
});

describe("feed-reference + label helpers", () => {
  it("facilityIdFromRef extracts the parent facility id", () => {
    expect(facilityIdFromRef("https://x/facility-uses/251/individual-facility-uses/300")).toBe("251");
    expect(facilityIdFromRef(".../facility-uses/20/individual-facility-uses/216/slots/9")).toBe("20");
    expect(facilityIdFromRef(null)).toBeNull();
    expect(facilityIdFromRef("no-match")).toBeNull();
  });

  it("courtNumberFromName reads the trailing number of either naming style", () => {
    expect(courtNumberFromName("Court 3")).toBe(3);
    expect(courtNumberFromName("Tennis court 12")).toBe(12);
    expect(courtNumberFromName("Tennis court 1 -")).toBe(1); // scraper coaching marker
    expect(courtNumberFromName("Unknown")).toBeNull();
    expect(courtNumberFromName(null)).toBeNull();
  });

  it("localDate + hourLabel read the wall clock, not UTC", () => {
    expect(localDate("2026-07-12T17:00:00+01:00")).toBe("2026-07-12");
    expect(hourLabel("2026-07-12T17:00:00+01:00")).toBe("5pm");
    expect(hourLabel("2026-07-12T07:00:00+01:00")).toBe("7am");
    expect(hourLabel("2026-07-12T12:00:00+01:00")).toBe("12pm");
    expect(hourLabel("2026-07-12T00:00:00+01:00")).toBe("12am");
    // Minute-precise: a half-hour slot keeps its minutes (no collision onto "5pm").
    expect(hourLabel("2026-07-12T17:30:00+01:00")).toBe("5:30pm");
    expect(hourLabel("bad")).toBeNull();
  });

  it("feedSlotStatus maps remainingUses to the scraper's status words", () => {
    expect(feedSlotStatus(1)).toBe("available");
    expect(feedSlotStatus(3)).toBe("available");
    expect(feedSlotStatus(0)).toBe("booked");
    expect(feedSlotStatus(null)).toBe("booked");
    expect(feedSlotStatus(undefined)).toBe("booked");
  });

  it("isNewlyAvailable fires only on a known non-available → available flip", () => {
    expect(isNewlyAvailable("booked", "available")).toBe(true);
    expect(isNewlyAvailable("closed", "available")).toBe(true);
    expect(isNewlyAvailable(null, "available")).toBe(false); // backfill: never notify
    expect(isNewlyAvailable("available", "available")).toBe(false); // no change
    expect(isNewlyAvailable("booked", "booked")).toBe(false);
  });
});

describe("parseSlot", () => {
  it("extracts court link, times, availability and base price", () => {
    const s = parseSlot(SLOT)!;
    expect(s.courtExternalId).toContain("individual-facility-uses/216");
    expect(s.startsAt).toBe("2026-07-12T17:00:00+01:00");
    expect(s.remainingUses).toBe(1);
    expect(s.price).toBe(8.5); // base offer, not the concession
    expect(s.currency).toBe("GBP");
  });

  it("returns null when required fields are missing", () => {
    expect(parseSlot({ startDate: "2026-01-01" })).toBeNull();
  });
});
