export interface ScrapedSlot {
  venue: string;
  date: string;
  time: string;
  court: string;
  status: "available" | "booked" | "closed";
  price?: string;
}
