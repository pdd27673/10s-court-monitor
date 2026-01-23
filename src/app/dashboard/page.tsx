"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { VENUES } from "@/lib/constants";

interface Slot {
  time: string;
  court: string;
  status: "available" | "booked" | "closed";
  price: string | null;
}

interface VenueAvailability {
  venue: { slug: string; name: string };
  date: string;
  slots: Slot[];
}

function getStatusColor(status: string) {
  switch (status) {
    case "available":
      return "bg-green-500";
    case "booked":
      return "bg-red-400";
    case "closed":
      return "bg-gray-300";
    default:
      return "bg-gray-200";
  }
}

function getNext7Days(): string[] {
  const dates: string[] = [];
  const today = new Date();

  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    dates.push(date.toISOString().split("T")[0]);
  }

  return dates;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export default function Dashboard() {
  const { status } = useSession();
  const router = useRouter();
  const [selectedVenue, setSelectedVenue] = useState<string>(VENUES[0].slug);
  const [selectedDate, setSelectedDate] = useState(getNext7Days()[0]);
  const [availability, setAvailability] = useState<VenueAvailability | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  const dates = getNext7Days();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;

    async function fetchAvailability() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/availability?venue=${selectedVenue}&date=${selectedDate}`
        );
        const data = await res.json();
        setAvailability(data);
      } catch (error) {
        console.error("Failed to fetch availability:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchAvailability();
  }, [selectedVenue, selectedDate, status]);

  // Group slots by time
  const slotsByTime: Record<string, Slot[]> = {};
  if (availability?.slots) {
    for (const slot of availability.slots) {
      if (!slotsByTime[slot.time]) slotsByTime[slot.time] = [];
      slotsByTime[slot.time].push(slot);
    }
  }

  // Show loading while checking auth
  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  // Don't render dashboard content if not authenticated
  if (status !== "authenticated") {
    return null;
  }

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Tennis Court Availability</h1>
      <p className="text-gray-600 dark:text-gray-400 mb-8">
        Tower Hamlets tennis courts
      </p>

      {/* Venue selector */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Venue</label>
        <select
          value={selectedVenue}
          onChange={(e) => setSelectedVenue(e.target.value)}
          className="w-full p-2 border rounded-lg bg-white dark:bg-gray-800 dark:border-gray-700"
        >
          {VENUES.map((venue) => (
            <option key={venue.slug} value={venue.slug}>
              {venue.name}
            </option>
          ))}
        </select>
      </div>

      {/* Date selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">Date</label>
        <div className="flex gap-2 flex-wrap">
          {dates.map((date) => (
            <button
              key={date}
              onClick={() => setSelectedDate(date)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedDate === date
                  ? "bg-green-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {formatDate(date)}
            </button>
          ))}
        </div>
      </div>

      {/* Availability grid */}
      <div className="border rounded-lg overflow-hidden dark:border-gray-700">
        <div className="bg-gray-50 dark:bg-gray-800 px-4 py-3 border-b dark:border-gray-700">
          <h2 className="font-semibold">
            {availability?.venue?.name ?? "Loading..."}
          </h2>
          <p className="text-sm text-gray-500">{formatDate(selectedDate)}</p>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : Object.keys(slotsByTime).length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No availability data. Run a scrape first.
          </div>
        ) : (
          <div className="divide-y dark:divide-gray-700">
            {Object.entries(slotsByTime).map(([time, slots]) => (
              <div
                key={time}
                className="flex items-center px-4 py-3 gap-4"
              >
                <span className="w-16 font-medium text-gray-700 dark:text-gray-300">
                  {time}
                </span>
                <div className="flex gap-2 flex-1">
                  {slots.map((slot) => (
                    <div
                      key={`${slot.time}-${slot.court}`}
                      className={`flex-1 px-3 py-2 rounded text-center text-sm ${getStatusColor(slot.status)} ${
                        slot.status === "available"
                          ? "text-white font-medium"
                          : slot.status === "booked"
                            ? "text-white"
                            : "text-gray-600"
                      }`}
                    >
                      <div>{slot.court}</div>
                      {slot.status === "available" && slot.price && (
                        <div className="text-xs opacity-90">{slot.price}</div>
                      )}
                      {slot.status === "booked" && (
                        <div className="text-xs opacity-75">Booked</div>
                      )}
                      {slot.status === "closed" && (
                        <div className="text-xs opacity-75">Closed</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-4 flex gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-green-500"></div>
          <span>Available</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-red-400"></div>
          <span>Booked</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-gray-300"></div>
          <span>Closed</span>
        </div>
      </div>

      {/* Link to booking site */}
      <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
          Ready to book?
        </p>
        <a
          href={`https://tennistowerhamlets.com/book/courts/${selectedVenue}/${selectedDate}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
        >
          Book on Courtside →
        </a>
      </div>
    </main>
  );
}
