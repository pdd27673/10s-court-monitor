import { VENUES } from "../constants";

/**
 * Generate the booking URL for a venue
 * @param venueSlug - The slug of the venue (e.g., "stratford-park")
 * @param date - Optional date in YYYY-MM-DD format
 * @returns The booking URL for the venue
 */
export function getBookingUrl(venueSlug: string, date?: string): string {
  const venue = VENUES.find((v) => v.slug === venueSlug);
  if (!venue) return "#";

  if (venue.type === "clubspark" && venue.clubsparkHost && venue.clubsparkId) {
    // ClubSpark booking URLs with date parameter
    // For main LTA site (clubspark.lta.org.uk), include venue ID in path
    // For custom hosts, the venue ID is not in the path
    const isMainLtaSite = venue.clubsparkHost === "clubspark.lta.org.uk";
    const basePath = isMainLtaSite 
      ? `https://${venue.clubsparkHost}/${venue.clubsparkId}/Booking/BookByDate`
      : `https://${venue.clubsparkHost}/Booking/BookByDate`;
    
    if (date) {
      return `${basePath}#?date=${date}&role=guest`;
    }
    return basePath;
  }
  
  // Courtside venues
  if (date) {
    return `https://tennistowerhamlets.com/book/courts/${venueSlug}/${date}`;
  }
  return `https://tennistowerhamlets.com/book/courts/${venueSlug}`;
}
