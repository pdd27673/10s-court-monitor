import { ScrapedSlot } from "./types";
import { Venue } from "../constants";

interface ClubSparkSession {
  ID: string;
  Name: string;
  Category: number;
  StartTime: number;
  EndTime: number;
  CourtCost: number;
  LightingCost: number;
}

interface ClubSparkResource {
  ID: string;
  Name: string;
  Days: Array<{
    Date: string;
    Sessions: ClubSparkSession[];
  }>;
}

interface ClubSparkResponse {
  EarliestStartTime: number;
  LatestEndTime: number;
  MinimumInterval: number;
  Resources: ClubSparkResource[];
}

// Convert 24-hour format to 12-hour am/pm format to match Courtside scraper
function convertTo12HourFormat(hour: number): string {
  if (hour === 0) return "12am";
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return "12pm";
  return `${hour - 12}pm`;
}

export async function scrapeClubSpark(
  venue: Venue,
  date: string
): Promise<ScrapedSlot[]> {
  if (!venue.clubsparkHost || !venue.clubsparkId) {
    throw new Error(`Venue ${venue.slug} missing ClubSpark config`);
  }

  const url = `https://${venue.clubsparkHost}/v0/VenueBooking/${venue.clubsparkId}/GetVenueSessions?resourceID=&startDate=${date}&endDate=${date}&roleId=`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; TennisNotifier/1.0)",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const data: ClubSparkResponse = await response.json();
  const slots: ScrapedSlot[] = [];

  // Generate all possible time slots based on operating hours
  const interval = data.MinimumInterval || 60;
  const startHour = Math.floor(data.EarliestStartTime / 60);
  const endHour = Math.floor(data.LatestEndTime / 60);

  for (const resource of data.Resources) {
    const courtName = resource.Name;
    const dayData = resource.Days.find((d) => d.Date.startsWith(date));
    const sessions = dayData?.Sessions || [];

    // Generate slots for each hour
    for (let hour = startHour; hour < endHour; hour++) {
      const timeMinutes = hour * 60;
      const timeStr = convertTo12HourFormat(hour);

      // Find session that covers this time slot
      const session = sessions.find(
        (s) => s.StartTime <= timeMinutes && s.EndTime > timeMinutes
      );

      let status: "available" | "booked" | "closed";
      let price: string | undefined;

      if (session) {
        if (session.Category === 0) {
          // Category 0 = Available slot that can be booked
          status = "available";
          const totalCost = session.CourtCost + session.LightingCost;
          price = `£${totalCost.toFixed(2)}`;
        } else if (session.Category === 1000) {
          // User booking - slot is taken
          status = "booked";
        } else {
          // Coaching/class/other - not available for booking
          status = "closed";
        }
      } else {
        // No session = available for booking
        status = "available";
        // Default price (could fetch from GetSettings if needed)
        price = "£10.00";
      }

      slots.push({
        venue: venue.slug,
        date,
        time: timeStr,
        court: courtName,
        status,
        price,
      });
    }
  }

  return slots;
}
