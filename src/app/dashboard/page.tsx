"use client";

import { Suspense, useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
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

interface Watch {
  id: number;
  venueSlug: string | null;
  venueName: string | null;
  weekdayTimes: string[];
  weekendTimes: string[];
  active: boolean;
}

interface Channel {
  id: number;
  type: string;
  destination: string;
  active: boolean;
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

function DashboardContent() {
  const { status, data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isGuest = searchParams.get("guest") === "true";

  console.log("[Dashboard] searchParams:", searchParams.toString());
  console.log("[Dashboard] isGuest:", isGuest);
  console.log("[Dashboard] session status:", status);

  const [selectedVenue, setSelectedVenue] = useState<string>(VENUES[0].slug);
  const [selectedDate, setSelectedDate] = useState(getNext7Days()[0]);
  const [availability, setAvailability] = useState<VenueAvailability | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  // Management state
  const [watches, setWatches] = useState<Watch[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loadingWatches, setLoadingWatches] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [activeTab, setActiveTab] = useState<"availability" | "settings">(
    "availability"
  );

  const dates = getNext7Days();
  const isAuthenticated = status === "authenticated";

  // Redirect unauthenticated non-guests to login
  useEffect(() => {
    if (status === "unauthenticated" && !isGuest) {
      router.push("/login");
    }
  }, [status, router, isGuest]);

  // Fetch availability (works for both guests and authenticated users)
  useEffect(() => {
    if (status === "loading") return;
    if (!isGuest && status !== "authenticated") return;

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
  }, [selectedVenue, selectedDate, status, isGuest]);

  // Fetch watches and channels for authenticated users
  useEffect(() => {
    if (status !== "authenticated") return;

    async function fetchWatches() {
      setLoadingWatches(true);
      try {
        const res = await fetch("/api/watches");
        const data = await res.json();
        if (data.watches) {
          setWatches(
            data.watches.map(
              (w: {
                id: number;
                venueSlug: string | null;
                venueName: string | null;
                weekdayTimes: string | null;
                weekendTimes: string | null;
                active: number | boolean;
              }) => ({
                id: w.id,
                venueSlug: w.venueSlug,
                venueName: w.venueName,
                weekdayTimes: w.weekdayTimes ? JSON.parse(w.weekdayTimes) : [],
                weekendTimes: w.weekendTimes ? JSON.parse(w.weekendTimes) : [],
                active: Boolean(w.active),
              })
            )
          );
        }
      } catch (error) {
        console.error("Failed to fetch watches:", error);
      } finally {
        setLoadingWatches(false);
      }
    }

    async function fetchChannels() {
      setLoadingChannels(true);
      try {
        const res = await fetch("/api/channels");
        const data = await res.json();
        if (data.channels) {
          setChannels(data.channels);
        }
      } catch (error) {
        console.error("Failed to fetch channels:", error);
      } finally {
        setLoadingChannels(false);
      }
    }

    fetchWatches();
    fetchChannels();
  }, [status]);

  // Group slots by time
  const slotsByTime: Record<string, Slot[]> = {};
  if (availability?.slots) {
    for (const slot of availability.slots) {
      if (!slotsByTime[slot.time]) slotsByTime[slot.time] = [];
      slotsByTime[slot.time].push(slot);
    }
  }

  // Show loading while checking auth (unless guest)
  if (status === "loading" && !isGuest) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  // Don't render if unauthenticated and not guest
  if (status === "unauthenticated" && !isGuest) {
    return null;
  }

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Tennis Court Availability</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Tower Hamlets tennis courts
          </p>
        </div>
        <div className="flex items-center gap-4">
          {isGuest ? (
            <Link
              href="/login"
              className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors text-sm"
            >
              Sign In
            </Link>
          ) : isAuthenticated ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {session?.user?.email}
              </span>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm"
              >
                Sign Out
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Guest banner */}
      {isGuest && (
        <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            You&apos;re viewing as a guest.{" "}
            <Link href="/login" className="underline font-medium">
              Sign in
            </Link>{" "}
            to set up notifications and manage your preferences.
          </p>
        </div>
      )}

      {/* Tabs for authenticated users */}
      {isAuthenticated && (
        <div className="flex gap-2 mb-6 border-b dark:border-gray-700">
          <button
            onClick={() => setActiveTab("availability")}
            className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 -mb-px ${
              activeTab === "availability"
                ? "border-green-600 text-green-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Availability
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 -mb-px ${
              activeTab === "settings"
                ? "border-green-600 text-green-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Watches & Alerts
          </button>
        </div>
      )}

      {/* Availability Tab */}
      {(activeTab === "availability" || isGuest) && (
        <>
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
                      {slots.map((slot) => {
                        const baseClasses = `flex-1 px-3 py-2 rounded text-center text-sm ${getStatusColor(slot.status)} ${
                          slot.status === "available"
                            ? "text-white font-medium"
                            : slot.status === "booked"
                              ? "text-white"
                              : "text-gray-600"
                        }`;

                        const content = (
                          <>
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
                          </>
                        );

                        if (slot.status === "available") {
                          return (
                            <a
                              key={`${slot.time}-${slot.court}`}
                              href={`https://tennistowerhamlets.com/book/courts/${selectedVenue}/${selectedDate}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`${baseClasses} hover:opacity-90 cursor-pointer transition-opacity`}
                            >
                              {content}
                            </a>
                          );
                        }

                        return (
                          <div key={`${slot.time}-${slot.court}`} className={baseClasses}>
                            {content}
                          </div>
                        );
                      })}
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
              Book on Courtside
            </a>
          </div>
        </>
      )}

      {/* Settings Tab (authenticated only) */}
      {activeTab === "settings" && isAuthenticated && (
        <div className="space-y-8">
          {/* Watches Section */}
          <section>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Your Watches</h2>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Watches define which venues and time slots you want to be notified
              about when they become available.
            </p>

            {loadingWatches ? (
              <div className="p-4 text-center text-gray-500">Loading...</div>
            ) : watches.length === 0 ? (
              <div className="p-6 border border-dashed rounded-lg dark:border-gray-700 text-center">
                <p className="text-gray-500 mb-4">No watches configured yet.</p>
                <p className="text-sm text-gray-400">
                  Contact admin to set up watches for your account.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {watches.map((watch) => (
                  <div
                    key={watch.id}
                    className={`p-4 border rounded-lg dark:border-gray-700 ${
                      watch.active
                        ? "bg-white dark:bg-gray-800"
                        : "bg-gray-50 dark:bg-gray-900 opacity-60"
                    }`}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-medium">
                          {watch.venueName ?? "All Venues"}
                        </h3>
                        <span
                          className={`inline-block mt-1 text-xs px-2 py-0.5 rounded ${
                            watch.active
                              ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                          }`}
                        >
                          {watch.active ? "Active" : "Paused"}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-gray-500 dark:text-gray-400 mb-1">
                          Weekday Times
                        </p>
                        <p>
                          {watch.weekdayTimes.length > 0
                            ? watch.weekdayTimes.join(", ")
                            : "Not set"}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500 dark:text-gray-400 mb-1">
                          Weekend Times
                        </p>
                        <p>
                          {watch.weekendTimes.length > 0
                            ? watch.weekendTimes.join(", ")
                            : "Not set"}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Notification Channels Section */}
          <section>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Notification Channels</h2>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Choose how you want to receive notifications when courts become
              available.
            </p>

            {loadingChannels ? (
              <div className="p-4 text-center text-gray-500">Loading...</div>
            ) : channels.length === 0 ? (
              <div className="p-6 border border-dashed rounded-lg dark:border-gray-700 text-center">
                <p className="text-gray-500 mb-4">
                  No notification channels configured.
                </p>
                <p className="text-sm text-gray-400">
                  Contact admin to set up notifications for your account.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {channels.map((channel) => (
                  <div
                    key={channel.id}
                    className={`p-4 border rounded-lg dark:border-gray-700 flex items-center justify-between ${
                      channel.active
                        ? "bg-white dark:bg-gray-800"
                        : "bg-gray-50 dark:bg-gray-900 opacity-60"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          channel.type === "telegram"
                            ? "bg-blue-100 dark:bg-blue-900"
                            : channel.type === "email"
                              ? "bg-purple-100 dark:bg-purple-900"
                              : "bg-green-100 dark:bg-green-900"
                        }`}
                      >
                        {channel.type === "telegram" && (
                          <span className="text-blue-600 dark:text-blue-400">
                            T
                          </span>
                        )}
                        {channel.type === "email" && (
                          <span className="text-purple-600 dark:text-purple-400">
                            @
                          </span>
                        )}
                        {channel.type === "whatsapp" && (
                          <span className="text-green-600 dark:text-green-400">
                            W
                          </span>
                        )}
                      </div>
                      <div>
                        <p className="font-medium capitalize">{channel.type}</p>
                        <p className="text-sm text-gray-500">
                          {channel.destination}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        channel.active
                          ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      {channel.active ? "Active" : "Paused"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Help Section */}
          <section className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <h3 className="font-medium mb-2">Need help?</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              To modify your watches or notification channels, contact the
              administrator. Self-service management coming soon.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}

function SuspenseFallback() {
  console.log("[Dashboard] Suspense fallback rendering");
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-gray-500">Loading...</div>
    </div>
  );
}

export default function Dashboard() {
  console.log("[Dashboard] Wrapper rendering, window.location:", typeof window !== "undefined" ? window.location.href : "SSR");

  return (
    <Suspense fallback={<SuspenseFallback />}>
      <DashboardContent />
    </Suspense>
  );
}
