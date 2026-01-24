"use client";

import { Suspense, useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { VENUES, type Venue } from "@/lib/constants";

// Helper function to get booking URL for a venue
function getBookingUrl(venueSlug: string, date?: string): string {
  const venue = VENUES.find((v) => v.slug === venueSlug);
  if (!venue) return "#";

  if (venue.type === "clubspark" && venue.clubsparkHost && venue.clubsparkId) {
    // ClubSpark booking URLs with date parameter
    // For main LTA site (clubspark.lta.org.uk), include venue ID in path
    const isMainLtaSite = venue.clubsparkHost === "clubspark.lta.org.uk";
    const basePath = isMainLtaSite 
      ? `https://${venue.clubsparkHost}/${venue.clubsparkId}/Booking/BookByDate`
      : `https://${venue.clubsparkHost}/Booking/BookByDate`;
    
    if (date) {
      return `${basePath}#?date=${date}`;
    }
    return basePath;
  }
  
  // Courtside venues
  if (date) {
    return `https://tennistowerhamlets.com/book/courts/${venueSlug}/${date}`;
  }
  return `https://tennistowerhamlets.com/book/courts/${venueSlug}`;
}

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
  // Initialize activeTab from URL or default to availability
  const tabFromUrl = searchParams.get("tab") as "availability" | "settings" | null;
  const [activeTab, setActiveTab] = useState<"availability" | "settings">(
    tabFromUrl === "settings" ? "settings" : "availability"
  );

  // Update activeTab when URL changes (e.g., on reload)
  useEffect(() => {
    const tab = searchParams.get("tab") as "availability" | "settings" | null;
    if (tab === "settings") {
      setActiveTab("settings");
    } else if (tab === "availability" || tab === null) {
      setActiveTab("availability");
    }
  }, [searchParams]);

  // Form state
  const [showWatchForm, setShowWatchForm] = useState(false);
  const [editingWatch, setEditingWatch] = useState<Watch | null>(null);
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Available time slots
  const TIME_SLOTS = [
    "7am", "8am", "9am", "10am", "11am", "12pm",
    "1pm", "2pm", "3pm", "4pm", "5pm", "6pm",
    "7pm", "8pm", "9pm", "10pm",
  ];

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

  // Define fetch functions outside useEffect so they can be called from handlers
  const fetchWatches = async () => {
    if (status !== "authenticated") return;
    
    setLoadingWatches(true);
    try {
      const res = await fetch("/api/watches");
      const data = await res.json();
      if (data.watches) {
        setWatches(
          data.watches.map(
            (w: {
              id: number;
              venue?: { slug: string; name: string } | null;
              weekdayTimes: string[] | null;
              weekendTimes: string[] | null;
              active: number | boolean;
            }) => ({
              id: w.id,
              venueSlug: w.venue?.slug || null,
              venueName: w.venue?.name || null,
              weekdayTimes: w.weekdayTimes || [],
              weekendTimes: w.weekendTimes || [],
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
  };

  const fetchChannels = async () => {
    if (status !== "authenticated") return;
    
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
  };

  // Fetch watches and channels for authenticated users
  useEffect(() => {
    if (status !== "authenticated") return;
    fetchWatches();
    fetchChannels();
  }, [status]);

  // Show message helper
  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  // Watch management functions
  const handleCreateWatch = async (watchData: {
    venueSlug: string | null;
    weekdayTimes: string[];
    weekendTimes: string[];
  }) => {
    try {
      const res = await fetch("/api/watches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(watchData),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create watch");
      }

      await fetchWatches();
      setShowWatchForm(false);
      showMessage("success", "Watch created successfully!");
    } catch (error: any) {
      showMessage("error", error.message || "Failed to create watch");
    }
  };

  const handleUpdateWatch = async (watchId: number, watchData: {
    venueSlug: string | null;
    weekdayTimes: string[];
    weekendTimes: string[];
  }) => {
    try {
      const res = await fetch(`/api/watches/${watchId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(watchData),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to update watch");
      }

      await fetchWatches();
      setEditingWatch(null);
      showMessage("success", "Watch updated successfully!");
    } catch (error: any) {
      showMessage("error", error.message || "Failed to update watch");
    }
  };

  const handleDeleteWatch = async (watchId: number) => {
    if (!confirm("Are you sure you want to delete this watch?")) return;

    try {
      const res = await fetch(`/api/watches/${watchId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to delete watch");
      }

      await fetchWatches();
      showMessage("success", "Watch deleted successfully!");
    } catch (error: any) {
      showMessage("error", error.message || "Failed to delete watch");
    }
  };

  const handleToggleWatch = async (watchId: number, currentActive: boolean) => {
    try {
      const res = await fetch(`/api/watches/${watchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !currentActive }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to toggle watch");
      }

      await fetchWatches();
      showMessage("success", `Watch ${!currentActive ? "activated" : "paused"} successfully!`);
    } catch (error: any) {
      showMessage("error", error.message || "Failed to toggle watch");
    }
  };

  // Channel management functions
  const handleCreateChannel = async (channelData: {
    type: string;
    destination: string;
  }) => {
    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(channelData),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create channel");
      }

      await fetchChannels();
      setShowChannelForm(false);
      showMessage("success", "Channel added successfully!");
    } catch (error: any) {
      showMessage("error", error.message || "Failed to create channel");
    }
  };

  const handleUpdateChannel = async (channelId: number, channelData: {
    type?: string;
    destination?: string;
  }) => {
    try {
      const res = await fetch(`/api/channels/${channelId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(channelData),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to update channel");
      }

      await fetchChannels();
      setEditingChannel(null);
      showMessage("success", "Channel updated successfully!");
    } catch (error: any) {
      showMessage("error", error.message || "Failed to update channel");
    }
  };

  const handleDeleteChannel = async (channelId: number) => {
    if (!confirm("Are you sure you want to delete this channel?")) return;

    try {
      const res = await fetch(`/api/channels/${channelId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to delete channel");
      }

      await fetchChannels();
      showMessage("success", "Channel deleted successfully!");
    } catch (error: any) {
      showMessage("error", error.message || "Failed to delete channel");
    }
  };

  const handleToggleChannel = async (channelId: number, currentActive: boolean) => {
    try {
      const res = await fetch(`/api/channels/${channelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !currentActive }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to toggle channel");
      }

      await fetchChannels();
      showMessage("success", `Channel ${!currentActive ? "activated" : "paused"} successfully!`);
    } catch (error: any) {
      showMessage("error", error.message || "Failed to toggle channel");
    }
  };

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
            London tennis courts
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
            onClick={() => {
              setActiveTab("availability");
              router.push("/dashboard?tab=availability", { scroll: false });
            }}
            className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 -mb-px ${
              activeTab === "availability"
                ? "border-green-600 text-green-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Availability
          </button>
          <button
            onClick={() => {
              setActiveTab("settings");
              router.push("/dashboard?tab=settings", { scroll: false });
            }}
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
                              href={getBookingUrl(selectedVenue, selectedDate)}
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
              href={getBookingUrl(selectedVenue, selectedDate)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
            >
              Book Now
            </a>
          </div>
        </>
      )}

      {/* Settings Tab (authenticated only) */}
      {activeTab === "settings" && isAuthenticated && (
        <div className="space-y-8">
          {/* Message Banner */}
          {message && (
            <div
              className={`p-4 rounded-lg ${
                message.type === "success"
                  ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                  : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
              }`}
            >
              <p
                className={`text-sm ${
                  message.type === "success"
                    ? "text-green-800 dark:text-green-200"
                    : "text-red-800 dark:text-red-200"
                }`}
              >
                {message.text}
              </p>
            </div>
          )}

          {/* Watches Section */}
          <section>
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-xl font-semibold">Your Watches</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Watches define which venues and time slots you want to be notified
                  about when they become available.
                </p>
              </div>
              <button
                onClick={() => {
                  setEditingWatch(null);
                  setShowWatchForm(true);
                }}
                className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors text-sm"
              >
                + Create Watch
              </button>
            </div>

            {loadingWatches ? (
              <div className="p-4 text-center text-gray-500">Loading...</div>
            ) : watches.length === 0 ? (
              <div className="p-6 border border-dashed rounded-lg dark:border-gray-700 text-center">
                <p className="text-gray-500 mb-4">No watches configured yet.</p>
                <button
                  onClick={() => {
                    setEditingWatch(null);
                    setShowWatchForm(true);
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors text-sm"
                >
                  Create Your First Watch
                </button>
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
                      <div className="flex-1">
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
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleToggleWatch(watch.id, watch.active)}
                          className={`px-3 py-1 text-xs rounded ${
                            watch.active
                              ? "bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
                              : "bg-green-100 dark:bg-green-900 hover:bg-green-200 dark:hover:bg-green-800"
                          }`}
                        >
                          {watch.active ? "Pause" : "Activate"}
                        </button>
                        <button
                          onClick={() => setEditingWatch(watch)}
                          className="px-3 py-1 text-xs bg-blue-100 dark:bg-blue-900 hover:bg-blue-200 dark:hover:bg-blue-800 rounded"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteWatch(watch.id)}
                          className="px-3 py-1 text-xs bg-red-100 dark:bg-red-900 hover:bg-red-200 dark:hover:bg-red-800 rounded"
                        >
                          Delete
                        </button>
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
              <div>
                <h2 className="text-xl font-semibold">Notification Channels</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Choose how you want to receive notifications when courts become
                  available.
                </p>
              </div>
              <button
                onClick={() => {
                  setEditingChannel(null);
                  setShowChannelForm(true);
                }}
                className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors text-sm"
              >
                + Add Channel
              </button>
            </div>

            {loadingChannels ? (
              <div className="p-4 text-center text-gray-500">Loading...</div>
            ) : channels.length === 0 ? (
              <div className="p-6 border border-dashed rounded-lg dark:border-gray-700 text-center">
                <p className="text-gray-500 mb-4">
                  No notification channels configured.
                </p>
                <button
                  onClick={() => {
                    setEditingChannel(null);
                    setShowChannelForm(true);
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors text-sm"
                >
                  Add Your First Channel
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {channels.map((channel) => (
                  <div
                    key={channel.id}
                    className={`p-4 border rounded-lg dark:border-gray-700 ${
                      channel.active
                        ? "bg-white dark:bg-gray-800"
                        : "bg-gray-50 dark:bg-gray-900 opacity-60"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
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
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${
                            channel.active
                              ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                          }`}
                        >
                          {channel.active ? "Active" : "Paused"}
                        </span>
                        <button
                          onClick={() => handleToggleChannel(channel.id, channel.active)}
                          className={`px-3 py-1 text-xs rounded ${
                            channel.active
                              ? "bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"
                              : "bg-green-100 dark:bg-green-900 hover:bg-green-200 dark:hover:bg-green-800"
                          }`}
                        >
                          {channel.active ? "Pause" : "Activate"}
                        </button>
                        <button
                          onClick={() => setEditingChannel(channel)}
                          className="px-3 py-1 text-xs bg-blue-100 dark:bg-blue-900 hover:bg-blue-200 dark:hover:bg-blue-800 rounded"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteChannel(channel.id)}
                          className="px-3 py-1 text-xs bg-red-100 dark:bg-red-900 hover:bg-red-200 dark:hover:bg-red-800 rounded"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Watch Form Modal */}
      {(showWatchForm || editingWatch) && (
        <WatchFormModal
          watch={editingWatch}
          onClose={() => {
            setShowWatchForm(false);
            setEditingWatch(null);
          }}
          onSubmit={editingWatch
            ? (data) => handleUpdateWatch(editingWatch.id, data)
            : handleCreateWatch}
          timeSlots={TIME_SLOTS}
        />
      )}

      {/* Channel Form Modal */}
      {(showChannelForm || editingChannel) && (
        <ChannelFormModal
          channel={editingChannel}
          userEmail={session?.user?.email || ""}
          onClose={() => {
            setShowChannelForm(false);
            setEditingChannel(null);
          }}
          onSubmit={editingChannel
            ? (data) => handleUpdateChannel(editingChannel.id, data)
            : handleCreateChannel}
        />
      )}
    </main>
  );
}

// Watch Form Modal Component
function WatchFormModal({
  watch,
  onClose,
  onSubmit,
  timeSlots,
}: {
  watch: Watch | null;
  onClose: () => void;
  onSubmit: (data: {
    venueSlug: string | null;
    weekdayTimes: string[];
    weekendTimes: string[];
  }) => void;
  timeSlots: string[];
}) {
  const [venueSlug, setVenueSlug] = useState<string | null>(
    watch?.venueSlug || null
  );
  const [weekdayTimes, setWeekdayTimes] = useState<string[]>(
    watch?.weekdayTimes || []
  );
  const [weekendTimes, setWeekendTimes] = useState<string[]>(
    watch?.weekendTimes || []
  );
  const [submitting, setSubmitting] = useState(false);

  const toggleTime = (
    time: string,
    times: string[],
    setTimes: (times: string[]) => void
  ) => {
    if (times.includes(time)) {
      setTimes(times.filter((t) => t !== time));
    } else {
      setTimes([...times, time].sort());
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (weekdayTimes.length === 0 && weekendTimes.length === 0) {
      alert("Please select at least one time slot for weekdays or weekends");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        venueSlug,
        weekdayTimes,
        weekendTimes,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b dark:border-gray-700">
          <h2 className="text-xl font-semibold">
            {watch ? "Edit Watch" : "Create New Watch"}
          </h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Venue Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">Venue</label>
            <select
              value={venueSlug || ""}
              onChange={(e) =>
                setVenueSlug(e.target.value || null)
              }
              className="w-full p-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600"
            >
              <option value="">All Venues</option>
              {VENUES.map((venue) => (
                <option key={venue.slug} value={venue.slug}>
                  {venue.name}
                </option>
              ))}
            </select>
          </div>

          {/* Weekday Times */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Weekday Times (Mon-Fri)
            </label>
            <div className="grid grid-cols-4 gap-2">
              {timeSlots.map((time) => (
                <button
                  key={time}
                  type="button"
                  onClick={() =>
                    toggleTime(time, weekdayTimes, setWeekdayTimes)
                  }
                  className={`p-2 rounded text-sm border transition-colors ${
                    weekdayTimes.includes(time)
                      ? "bg-green-600 text-white border-green-600"
                      : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600"
                  }`}
                >
                  {time}
                </button>
              ))}
            </div>
            {weekdayTimes.length > 0 && (
              <p className="mt-2 text-sm text-gray-500">
                Selected: {weekdayTimes.join(", ")}
              </p>
            )}
          </div>

          {/* Weekend Times */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Weekend Times (Sat-Sun)
            </label>
            <div className="grid grid-cols-4 gap-2">
              {timeSlots.map((time) => (
                <button
                  key={time}
                  type="button"
                  onClick={() =>
                    toggleTime(time, weekendTimes, setWeekendTimes)
                  }
                  className={`p-2 rounded text-sm border transition-colors ${
                    weekendTimes.includes(time)
                      ? "bg-green-600 text-white border-green-600"
                      : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600"
                  }`}
                >
                  {time}
                </button>
              ))}
            </div>
            {weekendTimes.length > 0 && (
              <p className="mt-2 text-sm text-gray-500">
                Selected: {weekendTimes.join(", ")}
              </p>
            )}
          </div>

          {/* Form Actions */}
          <div className="flex gap-3 justify-end pt-4 border-t dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              disabled={submitting}
            >
              {submitting ? "Saving..." : watch ? "Update Watch" : "Create Watch"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Channel Form Modal Component
function ChannelFormModal({
  channel,
  userEmail,
  onClose,
  onSubmit,
}: {
  channel: Channel | null;
  userEmail: string;
  onClose: () => void;
  onSubmit: (data: { type: string; destination: string }) => void;
}) {
  const [type, setType] = useState<string>(channel?.type || "email");
  const [destination, setDestination] = useState<string>(
    channel?.destination || userEmail
  );
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destination.trim()) {
      alert("Please enter a destination");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({ type, destination: destination.trim() });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full">
        <div className="p-6 border-b dark:border-gray-700">
          <h2 className="text-xl font-semibold">
            {channel ? "Edit Channel" : "Add Notification Channel"}
          </h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Channel Type */}
          <div>
            <label className="block text-sm font-medium mb-2">Channel Type</label>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                if (e.target.value === "email" && !channel) {
                  setDestination(userEmail);
                }
              }}
              className="w-full p-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600"
              disabled={!!channel}
            >
              <option value="email">Email</option>
              <option value="telegram">Telegram</option>
            </select>
          </div>

          {/* Destination */}
          <div>
            <label className="block text-sm font-medium mb-2">
              {type === "email"
                ? "Email Address"
                : type === "telegram"
                  ? "Telegram Chat ID"
                  : "WhatsApp Number"}
            </label>
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder={
                type === "email"
                  ? "email@example.com"
                  : type === "telegram"
                    ? "123456789"
                    : "+1234567890"
              }
              className="w-full p-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600"
              required
            />
            {type === "telegram" && (
              <div className="mt-2 space-y-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <p className="text-xs font-medium text-blue-900 dark:text-blue-200 mb-2">
                  How to get your Telegram Chat ID:
                </p>
                <ol className="text-xs text-blue-800 dark:text-blue-300 space-y-1.5 list-decimal list-inside">
                  <li>
                    <a
                      href="https://t.me/MvgMonitorBot"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    >
                      Click here to open @MvgMonitorBot
                    </a>
                  </li>
                  <li>Send any message (like "/start" or "Hello")</li>
                  <li>The bot will automatically reply with your Chat ID</li>
                  <li>Copy the number and paste it in the field above</li>
                </ol>
                <a
                  href="https://t.me/MvgMonitorBot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-2 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium"
                >
                  Open @MvgMonitorBot
                </a>
              </div>
            )}
          </div>

          {/* Form Actions */}
          <div className="flex gap-3 justify-end pt-4 border-t dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              disabled={submitting}
            >
              {submitting
                ? "Saving..."
                : channel
                  ? "Update Channel"
                  : "Add Channel"}
            </button>
          </div>
        </form>
      </div>
    </div>
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
