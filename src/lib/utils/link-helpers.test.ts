import { describe, it, expect } from "vitest";
import { getBookingUrl } from "./link-helpers";
import { VENUES } from "../constants";

// Pick real venues out of the static config so the test tracks reality rather
// than a hand-rolled fixture.
const clubsparkMainLta = VENUES.find(
  (v) => v.type === "clubspark" && v.clubsparkHost === "clubspark.lta.org.uk" && v.clubsparkId
);
const clubsparkCustomHost = VENUES.find(
  (v) => v.type === "clubspark" && v.clubsparkHost && v.clubsparkHost !== "clubspark.lta.org.uk"
);
const courtside = VENUES.find((v) => v.type === "courtside");

describe("getBookingUrl", () => {
  it("returns '#' for an unknown venue slug", () => {
    expect(getBookingUrl("no-such-venue")).toBe("#");
    expect(getBookingUrl("no-such-venue", "2026-07-17")).toBe("#");
  });

  it("builds a Courtside URL without a date", () => {
    if (!courtside) return;
    expect(getBookingUrl(courtside.slug)).toBe(
      `https://tennistowerhamlets.com/book/courts/${courtside.slug}`
    );
  });

  it("builds a Courtside URL with a date", () => {
    if (!courtside) return;
    expect(getBookingUrl(courtside.slug, "2026-07-17")).toBe(
      `https://tennistowerhamlets.com/book/courts/${courtside.slug}/2026-07-17`
    );
  });

  it("puts the venue id in the path for main-LTA ClubSpark hosts", () => {
    if (!clubsparkMainLta) return;
    const base = getBookingUrl(clubsparkMainLta.slug);
    expect(base).toBe(
      `https://clubspark.lta.org.uk/${clubsparkMainLta.clubsparkId}/Booking/BookByDate`
    );
    expect(getBookingUrl(clubsparkMainLta.slug, "2026-07-17")).toBe(
      `${base}#?date=2026-07-17&role=guest`
    );
  });

  it("omits the venue id from the path for custom ClubSpark hosts", () => {
    if (!clubsparkCustomHost) return;
    const base = getBookingUrl(clubsparkCustomHost.slug);
    expect(base).toBe(`https://${clubsparkCustomHost.clubsparkHost}/Booking/BookByDate`);
    expect(getBookingUrl(clubsparkCustomHost.slug, "2026-07-17")).toBe(
      `${base}#?date=2026-07-17&role=guest`
    );
  });
});
