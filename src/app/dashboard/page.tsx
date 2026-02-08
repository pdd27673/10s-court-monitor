"use client";

import { Suspense, useEffect, useState, Fragment } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { VENUES, type Venue } from "@/lib/constants";
import { getBookingUrl } from "@/lib/utils/link-helpers";

interface Slot {
  venueSlug?: string;
  venueName?: string;
  time: string;
  court: string;
  status: "available" | "booked" | "closed" | "coaching";
  price: string | null;
}

interface VenueAvailability {
  venues?: { slug: string; name: string }[];
  venue?: { slug: string; name: string }; // Keep for backward compatibility
  date: string;
  slots: Slot[];
  lastUpdated: string | null;
}

interface Watch {
  id: number;
  venueSlug: string | null;
  venueName: string | null;
  dayTimes: {
    monday: string[];
    tuesday: string[];
    wednesday: string[];
    thursday: string[];
    friday: string[];
    saturday: string[];
    sunday: string[];
  };
  // Legacy fields for backward compatibility during migration
  weekdayTimes?: string[];
  weekendTimes?: string[];
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

// localStorage utility helpers for dashboard preferences
const STORAGE_KEY = "dashboard-preferences";

interface DashboardPreferences {
  selectedVenues: string[];
  selectedDate?: string;
  activeTab?: "availability" | "settings" | "admin";
}

function saveDashboardPreferences(prefs: Partial<DashboardPreferences>) {
  try {
    const existing = loadDashboardPreferences();
    const updated = { ...existing, ...prefs };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error("Failed to save preferences:", error);
  }
}

function loadDashboardPreferences(): DashboardPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const prefs = JSON.parse(stored);
      // Validate venues still exist
      if (prefs.selectedVenues) {
        const validVenues = prefs.selectedVenues.filter((slug: string) => 
          VENUES.some(v => v.slug === slug)
        );
        prefs.selectedVenues = validVenues.length > 0 ? validVenues : [VENUES[0].slug];
      }
      return prefs;
    }
  } catch (error) {
    console.error("Failed to load preferences:", error);
  }
  return { selectedVenues: [VENUES[0].slug] };
}

function DashboardContent() {
  const { status, data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isGuest = searchParams.get("guest") === "true";

  console.log("[Dashboard] searchParams:", searchParams.toString());
  console.log("[Dashboard] isGuest:", isGuest);
  console.log("[Dashboard] session status:", status);

  // Initialize from localStorage with validation
  const [selectedVenues, setSelectedVenues] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const prefs = loadDashboardPreferences();
      return prefs.selectedVenues.length > 0 ? prefs.selectedVenues : [VENUES[0].slug];
    }
    return [VENUES[0].slug];
  });

  const [selectedDate, setSelectedDate] = useState(() => {
    if (typeof window !== "undefined") {
      const prefs = loadDashboardPreferences();
      const dates = getNext7Days();
      return prefs.selectedDate && dates.includes(prefs.selectedDate) 
        ? prefs.selectedDate 
        : dates[0];
    }
    return getNext7Days()[0];
  });

  const [availability, setAvailability] = useState<VenueAvailability | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [venueDropdownOpen, setVenueDropdownOpen] = useState(false);

  // Management state
  const [watches, setWatches] = useState<Watch[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loadingWatches, setLoadingWatches] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  
  // Initialize activeTab from URL or localStorage
  const tabFromUrl = searchParams.get("tab") as "availability" | "settings" | "admin" | null;
  const [activeTab, setActiveTab] = useState<"availability" | "settings" | "admin">(() => {
    if (tabFromUrl) return tabFromUrl === "admin" ? "admin" : tabFromUrl === "settings" ? "settings" : "availability";
    
    if (typeof window !== "undefined") {
      const prefs = loadDashboardPreferences();
      return prefs.activeTab || "availability";
    }
    return "availability";
  });
  
  // Admin sub-tab state
  const adminSubTabFromUrl = searchParams.get("adminTab") as "overview" | "users" | "requests" | "system" | "database" | null;
  const [adminSubTab, setAdminSubTab] = useState<"overview" | "users" | "requests" | "system" | "database">(
    adminSubTabFromUrl || "overview"
  );

  // Update activeTab when URL changes (e.g., on reload)
  useEffect(() => {
    const tab = searchParams.get("tab") as "availability" | "settings" | "admin" | null;
    if (tab === "admin") {
      setActiveTab("admin");
    } else if (tab === "settings") {
      setActiveTab("settings");
    } else if (tab === "availability" || tab === null) {
      setActiveTab("availability");
    }
    
    const adminTab = searchParams.get("adminTab") as "overview" | "users" | "requests" | "system" | "database" | null;
    if (adminTab) {
      setAdminSubTab(adminTab);
    }
  }, [searchParams]);

  // Form state
  const [showWatchForm, setShowWatchForm] = useState(false);
  const [editingWatch, setEditingWatch] = useState<Watch | null>(null);
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  
  // Bulk selection state
  const [selectedWatchIds, setSelectedWatchIds] = useState<Set<number>>(new Set());
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);

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

  // Close dropdown on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setVenueDropdownOpen(false);
      }
    };
    if (venueDropdownOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [venueDropdownOpen]);

  // Save venue preferences to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      saveDashboardPreferences({ selectedVenues });
    }
  }, [selectedVenues]);

  // Save date preference to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      saveDashboardPreferences({ selectedDate });
    }
  }, [selectedDate]);

  // Save active tab preference to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      saveDashboardPreferences({ activeTab });
    }
  }, [activeTab]);

  // Fetch availability (works for both guests and authenticated users)
  useEffect(() => {
    if (status === "loading") return;
    if (!isGuest && status !== "authenticated") return;
    if (selectedVenues.length === 0) return;

    async function fetchAvailability() {
      setLoading(true);
      try {
        const venueParam = selectedVenues.join(",");
        const res = await fetch(
          `/api/availability?venue=${venueParam}&date=${selectedDate}`
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
  }, [selectedVenues, selectedDate, status, isGuest]);

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
              dayTimes: {
                monday: string[];
                tuesday: string[];
                wednesday: string[];
                thursday: string[];
                friday: string[];
                saturday: string[];
                sunday: string[];
              } | null;
              active: number | boolean;
            }) => ({
              id: w.id,
              venueSlug: w.venue?.slug || null,
              venueName: w.venue?.name || null,
              dayTimes: w.dayTimes || {
                monday: [],
                tuesday: [],
                wednesday: [],
                thursday: [],
                friday: [],
                saturday: [],
                sunday: [],
              },
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

  // Check if user is admin
  useEffect(() => {
    if (status !== "authenticated" || !session?.user?.email) return;
    
    const checkAdminStatus = async () => {
      try {
        const res = await fetch("/api/user/me");
        if (res.ok) {
          const data = await res.json();
          setIsAdmin(data.user?.isAdmin === 1);
        }
      } catch (error) {
        console.error("Failed to check admin status:", error);
      }
    };
    
    checkAdminStatus();
  }, [status, session?.user?.email]);

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
    venueSlugs: string[];
    dayTimes: {
      monday: string[];
      tuesday: string[];
      wednesday: string[];
      thursday: string[];
      friday: string[];
      saturday: string[];
      sunday: string[];
    };
  }) => {
    try {
      // Create one watch per selected venue
      const results = await Promise.all(
        watchData.venueSlugs.map(venueSlug =>
          fetch("/api/watches", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              venueSlug,
              dayTimes: watchData.dayTimes,
            }),
          })
        )
      );

      // Check if all requests succeeded
      const errors = results.filter(res => !res.ok);
      if (errors.length > 0) {
        throw new Error(`Failed to create ${errors.length} watch(es)`);
      }

      await fetchWatches();
      setShowWatchForm(false);
      const count = watchData.venueSlugs.length;
      showMessage("success", `${count} watch${count > 1 ? 'es' : ''} created successfully!`);
    } catch (error: any) {
      showMessage("error", error.message || "Failed to create watch");
    }
  };

  const handleUpdateWatch = async (watchId: number, watchData: {
    venueSlugs: string[];
    dayTimes: {
      monday: string[];
      tuesday: string[];
      wednesday: string[];
      thursday: string[];
      friday: string[];
      saturday: string[];
      sunday: string[];
    };
  }) => {
    try {
      const res = await fetch(`/api/watches/${watchId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayTimes: watchData.dayTimes,
        }),
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

  // Bulk operations
  const handleBulkDelete = async () => {
    if (selectedWatchIds.size === 0) return;
    const count = selectedWatchIds.size;
    if (!confirm(`Are you sure you want to delete ${count} watch${count > 1 ? 'es' : ''}?`)) return;

    try {
      await Promise.all(
        Array.from(selectedWatchIds).map(id =>
          fetch(`/api/watches/${id}`, { method: "DELETE" })
        )
      );
      await fetchWatches();
      setSelectedWatchIds(new Set());
      setSelectionMode(false);
      showMessage("success", `Deleted ${count} watch${count > 1 ? 'es' : ''} successfully!`);
    } catch (error: any) {
      showMessage("error", error.message || "Failed to delete watches");
    }
  };

  const handleBulkToggle = async (activate: boolean) => {
    if (selectedWatchIds.size === 0) return;
    const count = selectedWatchIds.size;

    try {
      await Promise.all(
        Array.from(selectedWatchIds).map(id =>
          fetch(`/api/watches/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: activate }),
          })
        )
      );
      await fetchWatches();
      setSelectedWatchIds(new Set());
      showMessage("success", `${activate ? 'Activated' : 'Paused'} ${count} watch${count > 1 ? 'es' : ''} successfully!`);
    } catch (error: any) {
      showMessage("error", error.message || `Failed to ${activate ? 'activate' : 'pause'} watches`);
    }
  };

  const handleBulkEdit = async (dayTimes: {
    monday: string[];
    tuesday: string[];
    wednesday: string[];
    thursday: string[];
    friday: string[];
    saturday: string[];
    sunday: string[];
  }) => {
    const count = selectedWatchIds.size;
    try {
      await Promise.all(
        Array.from(selectedWatchIds).map(id =>
          fetch(`/api/watches/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dayTimes }),
          })
        )
      );
      await fetchWatches();
      setSelectedWatchIds(new Set());
      setBulkEditMode(false);
      showMessage("success", `Updated ${count} watch${count > 1 ? 'es' : ''} successfully!`);
    } catch (error: any) {
      showMessage("error", error.message || "Failed to update watches");
    }
  };

  const toggleWatchSelection = (watchId: number) => {
    setSelectedWatchIds(prev => {
      const next = new Set(prev);
      if (next.has(watchId)) {
        next.delete(watchId);
      } else {
        next.add(watchId);
      }
      return next;
    });
  };

  const selectAllWatches = () => {
    setSelectedWatchIds(new Set(watches.map(w => w.id)));
  };

  const clearSelection = () => {
    setSelectedWatchIds(new Set());
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

  // Group slots by time and venue, aggregating counts and prices
  const slotsByTimeAndVenue: Record<string, Record<string, { available: number; booked: number; closed: number; coaching: number; prices: number[] }>> = {};
  const allTimes = new Set<string>();
  
  if (availability?.slots) {
    for (const slot of availability.slots) {
      const venueSlug = slot.venueSlug || "";
      const time = slot.time;
      allTimes.add(time);
      
      if (!slotsByTimeAndVenue[time]) {
        slotsByTimeAndVenue[time] = {};
      }
      if (!slotsByTimeAndVenue[time][venueSlug]) {
        slotsByTimeAndVenue[time][venueSlug] = { available: 0, booked: 0, closed: 0, coaching: 0, prices: [] };
      }
      
      if (slot.status === "available") {
        slotsByTimeAndVenue[time][venueSlug].available++;
        // Extract numeric price from string like "£10.00"
        if (slot.price) {
          const priceMatch = slot.price.match(/[\d.]+/);
          if (priceMatch) {
            slotsByTimeAndVenue[time][venueSlug].prices.push(parseFloat(priceMatch[0]));
          }
        }
      } else if (slot.status === "booked") {
        slotsByTimeAndVenue[time][venueSlug].booked++;
      } else if (slot.status === "closed") {
        slotsByTimeAndVenue[time][venueSlug].closed++;
      } else if (slot.status === "coaching") {
        slotsByTimeAndVenue[time][venueSlug].coaching++;
      }
    }
  }

  // Get venue info for selected venues
  const selectedVenueInfo = selectedVenues
    .map((slug) => {
      const venue = VENUES.find((v) => v.slug === slug);
      return venue ? { slug: venue.slug, name: venue.name } : null;
    })
    .filter((v): v is { slug: string; name: string } => v !== null);

  // Sort times properly (convert to 24-hour format for comparison)
  const sortedTimes = Array.from(allTimes).sort((a, b) => {
    const parseTime = (timeStr: string): number => {
      const match = timeStr.match(/(\d+)(am|pm)/i);
      if (!match) return 0;
      let hours = parseInt(match[1], 10);
      const period = match[2].toLowerCase();
      
      if (period === "pm" && hours !== 12) {
        hours += 12;
      } else if (period === "am" && hours === 12) {
        hours = 0;
      }
      return hours;
    };
    
    return parseTime(a) - parseTime(b);
  });

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
      {/* Back button */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors mb-6"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        Back to Home
      </Link>
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
            className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 -mb-px cursor-pointer ${
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
            className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 -mb-px cursor-pointer ${
              activeTab === "settings"
                ? "border-green-600 text-green-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Watches & Alerts
          </button>
          {isAdmin && (
            <button
              onClick={() => {
                setActiveTab("admin");
                router.push("/dashboard?tab=admin&adminTab=overview", { scroll: false });
              }}
              className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 -mb-px cursor-pointer ${
                activeTab === "admin"
                  ? "border-green-600 text-green-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Admin
            </button>
          )}
        </div>
      )}

      {/* Availability Tab */}
      {(activeTab === "availability" || isGuest) && (
        <>
          {/* Venue selector - Multi-select Dropdown */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">
              Venues (select multiple)
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setVenueDropdownOpen(!venueDropdownOpen)}
                className="w-full p-2 border rounded-lg bg-white dark:bg-gray-800 dark:border-gray-700 text-left flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {selectedVenues.length === 0
                    ? "Select venues..."
                    : selectedVenues.length === 1
                    ? VENUES.find((v) => v.slug === selectedVenues[0])?.name || "Select venues..."
                    : `${selectedVenues.length} venues selected`}
                </span>
                <svg
                  className={`w-5 h-5 text-gray-500 transition-transform ${
                    venueDropdownOpen ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {venueDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setVenueDropdownOpen(false)}
                  />
                  <div className="absolute z-20 w-full mt-1 bg-white dark:bg-gray-800 border rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    <div className="p-2">
                      {/* Select All Checkbox */}
                      <label
                        className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer border-b border-gray-200 dark:border-gray-700 mb-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedVenues.length === VENUES.length}
                          ref={(input) => {
                            if (input) {
                              input.indeterminate = selectedVenues.length > 0 && selectedVenues.length < VENUES.length;
                            }
                          }}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedVenues(VENUES.map(v => v.slug));
                            } else {
                              setSelectedVenues([VENUES[0].slug]);
                            }
                          }}
                          className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                        />
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          All Venues
                        </span>
                      </label>

                      {VENUES.map((venue) => {
                        const isSelected = selectedVenues.includes(venue.slug);
                        return (
                          <label
                            key={venue.slug}
                            className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedVenues([...selectedVenues, venue.slug]);
                                } else {
                                  const newSelection = selectedVenues.filter(
                                    (v) => v !== venue.slug
                                  );
                                  if (newSelection.length > 0) {
                                    setSelectedVenues(newSelection);
                                  }
                                }
                              }}
                              className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-300">
                              {venue.name}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {selectedVenues.length === 0 && (
                <p className="text-xs text-red-500 mt-2">
                  Please select at least one venue
                </p>
              )}
              {selectedVenues.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedVenues.map((venueSlug) => {
                    const venue = VENUES.find((v) => v.slug === venueSlug);
                    if (!venue) return null;
                    return (
                      <span
                        key={venueSlug}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 rounded text-xs"
                      >
                        {venue.name}
                        <button
                          onClick={() => {
                            setSelectedVenues(
                              selectedVenues.filter((v) => v !== venueSlug)
                            );
                          }}
                          className="hover:text-green-600 dark:hover:text-green-300"
                          aria-label={`Remove ${venue.name}`}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Date selector */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">Date</label>
            <div className="flex gap-2 flex-wrap">
              {dates.map((date) => (
                <button
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
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

          {/* Availability table */}
          <div className="border rounded-lg overflow-hidden dark:border-gray-700">
            <div className="bg-gray-50 dark:bg-gray-800 px-4 py-3 border-b dark:border-gray-700">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="font-semibold">Availability</h2>
                  <p className="text-sm text-gray-500">{formatDate(selectedDate)}</p>
                </div>
                {availability?.lastUpdated && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 rounded-full border border-gray-200 dark:border-gray-600">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </span>
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                      Updated {new Date(availability.lastUpdated).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {loading ? (
              <div className="p-8 text-center text-gray-500">Loading...</div>
            ) : selectedVenueInfo.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                Please select at least one venue
              </div>
            ) : sortedTimes.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No availability data. Run a scrape first.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full" style={{ tableLayout: "fixed", minWidth: "600px" }}>
                  <colgroup>
                    <col style={{ width: "80px" }} />
                    {selectedVenueInfo.map((venue) => (
                      <col key={venue.slug} style={{ width: "150px" }} />
                    ))}
                  </colgroup>
                  <thead className="bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 sticky left-0 bg-gray-50 dark:bg-gray-800 z-10 border-r dark:border-gray-700">
                        Time
                      </th>
                      {selectedVenueInfo.map((venue) => (
                        <th
                          key={venue.slug}
                          className="px-4 py-3 text-center text-sm font-semibold text-gray-700 dark:text-gray-300"
                        >
                          {venue.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-gray-700">
                    {sortedTimes.map((time) => (
                      <tr key={time} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <td className="px-4 py-3 font-medium text-gray-700 dark:text-gray-300 sticky left-0 bg-white dark:bg-gray-900 z-10 border-r dark:border-gray-700">
                          {time}
                        </td>
                        {selectedVenueInfo.map((venue) => {
                          const venueData = slotsByTimeAndVenue[time]?.[venue.slug] || {
                            available: 0,
                            booked: 0,
                            closed: 0,
                            coaching: 0,
                            prices: [],
                          };
                          const total = venueData.available + venueData.booked + venueData.closed + venueData.coaching;
                          const hasAvailable = venueData.available > 0;
                          const isCoaching = venueData.coaching > 0 && venueData.available === 0;
                          const isBooked = venueData.booked > 0 && venueData.available === 0 && venueData.coaching === 0;
                          const isClosed = total > 0 && venueData.available === 0 && venueData.booked === 0 && venueData.coaching === 0;

                          let statusClass = "bg-gray-100 dark:bg-gray-800 text-gray-600";
                          let statusText = "No data";
                          let showCount = false;
                          let statusCount = 0;
                          let minPrice: number | null = null;

                          if (hasAvailable) {
                            statusClass = "bg-green-500 text-white";
                            statusText = "Available";
                            statusCount = venueData.available;
                            showCount = true;
                            if (venueData.prices.length > 0) {
                              minPrice = Math.min(...venueData.prices);
                            }
                          } else if (isCoaching) {
                            statusClass = "bg-blue-400 text-white";
                            statusText = "Coaching";
                          } else if (isBooked) {
                            statusClass = "bg-red-400 text-white";
                            statusText = "Booked";
                          } else if (isClosed) {
                            statusClass = "bg-gray-300 text-gray-600";
                            statusText = "Closed";
                          }

                          const cellContent = (
                            <div className={`px-3 py-2 rounded text-center text-sm font-medium min-h-[60px] flex flex-col justify-center ${statusClass}`}>
                              <div>{statusText}</div>
                              <div className="text-xs opacity-90 mt-1 h-8 flex flex-col items-center justify-center">
                                {showCount && total > 0 && (
                                  <>
                                    <div>{statusCount} court{statusCount !== 1 ? "s" : ""}</div>
                                    {minPrice !== null && (
                                      <div className="text-[10px] opacity-75">from £{minPrice.toFixed(2)}</div>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          );

                          return (
                            <td key={venue.slug} className="px-4 py-3">
                              {hasAvailable ? (
                                <a
                                  href={getBookingUrl(venue.slug, selectedDate)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block hover:opacity-90 transition-opacity cursor-pointer"
                                >
                                  {cellContent}
                                </a>
                              ) : (
                                cellContent
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
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
              <div className="w-4 h-4 rounded bg-blue-400"></div>
              <span>Coaching</span>
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
          {selectedVenues.length > 0 && (
            <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Ready to book?
              </p>
              <div className="flex flex-wrap gap-2">
                {selectedVenues.map((venueSlug) => {
                  const venue = VENUES.find((v) => v.slug === venueSlug);
                  if (!venue) return null;
                  return (
                    <a
                      key={venueSlug}
                      href={getBookingUrl(venueSlug, selectedDate)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors text-sm"
                    >
                      Book {venue.name}
                    </a>
                  );
                })}
              </div>
            </div>
          )}
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
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setSelectionMode(!selectionMode);
                    if (selectionMode) {
                      setSelectedWatchIds(new Set());
                    }
                  }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors text-sm ${
                    selectionMode
                      ? "bg-blue-600 text-white hover:bg-blue-700"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                  }`}
                  title="Bulk delete watches"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  {selectionMode && "Cancel"}
                </button>
                <button
                  onClick={() => {
                    setEditingWatch(null);
                    setShowWatchForm(true);
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors text-sm"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add
                </button>
              </div>
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
              <div className="space-y-6">
                {/* Bulk Actions Bar */}
                {selectionMode && selectedWatchIds.size > 0 && (
                  <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-2 border-blue-500 dark:border-blue-600 rounded-lg p-4 shadow-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {selectedWatchIds.size} watch{selectedWatchIds.size > 1 ? 'es' : ''} selected
                        </span>
                        <button
                          onClick={clearSelection}
                          className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                        >
                          Clear selection
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleBulkToggle(true)}
                          className="px-3 py-1.5 text-xs bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 text-green-700 dark:text-green-300 rounded-lg font-medium transition-colors"
                        >
                          Activate All
                        </button>
                        <button
                          onClick={() => handleBulkToggle(false)}
                          className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium transition-colors"
                        >
                          Pause All
                        </button>
                        <button
                          onClick={() => setBulkEditMode(true)}
                          className="px-3 py-1.5 text-xs bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-lg font-medium transition-colors"
                        >
                          Bulk Edit
                        </button>
                        <button
                          onClick={handleBulkDelete}
                          className="px-3 py-1.5 text-xs bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded-lg font-medium transition-colors"
                        >
                          Delete ({selectedWatchIds.size})
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Select All Checkbox - Only show in selection mode */}
                {watches.length > 0 && selectionMode && (
                  <div className="flex items-center gap-2 pb-2">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={selectedWatchIds.size === watches.length && watches.length > 0}
                        ref={(input) => {
                          if (input) {
                            input.indeterminate = selectedWatchIds.size > 0 && selectedWatchIds.size < watches.length;
                          }
                        }}
                        onChange={(e) => {
                          if (e.target.checked) {
                            selectAllWatches();
                          } else {
                            clearSelection();
                          }
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-5 h-5 border-2 rounded-md bg-white dark:bg-gray-800 transition-all duration-200 flex items-center justify-center group-hover:border-green-500 dark:group-hover:border-green-500 peer-focus:ring-2 peer-focus:ring-green-500 peer-focus:ring-offset-1 peer-checked:bg-green-600 peer-checked:border-green-600 peer-indeterminate:bg-green-600 peer-indeterminate:border-green-600 border-gray-300 dark:border-gray-600">
                        {selectedWatchIds.size === watches.length && watches.length > 0 ? (
                          <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : selectedWatchIds.size > 0 && selectedWatchIds.size < watches.length ? (
                          <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M5 12h14" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
                          </svg>
                        ) : null}
                      </div>
                      <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">
                        Select all watches
                      </span>
                    </label>
                  </div>
                )}

                {(() => {
                  // Color palette for watches
                  const WATCH_COLORS = [
                    { bg: 'bg-blue-500', bgLight: 'bg-blue-100', bgDark: 'dark:bg-blue-900/30', text: 'text-blue-700', textDark: 'dark:text-blue-300', border: 'border-blue-500', borderLight: 'border-blue-200', borderDark: 'dark:border-blue-800' },
                    { bg: 'bg-purple-500', bgLight: 'bg-purple-100', bgDark: 'dark:bg-purple-900/30', text: 'text-purple-700', textDark: 'dark:text-purple-300', border: 'border-purple-500', borderLight: 'border-purple-200', borderDark: 'dark:border-purple-800' },
                    { bg: 'bg-pink-500', bgLight: 'bg-pink-100', bgDark: 'dark:bg-pink-900/30', text: 'text-pink-700', textDark: 'dark:text-pink-300', border: 'border-pink-500', borderLight: 'border-pink-200', borderDark: 'dark:border-pink-800' },
                    { bg: 'bg-indigo-500', bgLight: 'bg-indigo-100', bgDark: 'dark:bg-indigo-900/30', text: 'text-indigo-700', textDark: 'dark:text-indigo-300', border: 'border-indigo-500', borderLight: 'border-indigo-200', borderDark: 'dark:border-indigo-800' },
                    { bg: 'bg-cyan-500', bgLight: 'bg-cyan-100', bgDark: 'dark:bg-cyan-900/30', text: 'text-cyan-700', textDark: 'dark:text-cyan-300', border: 'border-cyan-500', borderLight: 'border-cyan-200', borderDark: 'dark:border-cyan-800' },
                    { bg: 'bg-emerald-500', bgLight: 'bg-emerald-100', bgDark: 'dark:bg-emerald-900/30', text: 'text-emerald-700', textDark: 'dark:text-emerald-300', border: 'border-emerald-500', borderLight: 'border-emerald-200', borderDark: 'dark:border-emerald-800' },
                    { bg: 'bg-amber-500', bgLight: 'bg-amber-100', bgDark: 'dark:bg-amber-900/30', text: 'text-amber-700', textDark: 'dark:text-amber-300', border: 'border-amber-500', borderLight: 'border-amber-200', borderDark: 'dark:border-amber-800' },
                    { bg: 'bg-orange-500', bgLight: 'bg-orange-100', bgDark: 'dark:bg-orange-900/30', text: 'text-orange-700', textDark: 'dark:text-orange-300', border: 'border-orange-500', borderLight: 'border-orange-200', borderDark: 'dark:border-orange-800' },
                  ];

                  // Assign colors to watches
                  const watchesWithColors = watches.map((watch, index) => ({
                    ...watch,
                    color: WATCH_COLORS[index % WATCH_COLORS.length],
                  })) as Array<Watch & { color: typeof WATCH_COLORS[0] }>;

                  // Group watches by venue
                  type WatchWithColor = Watch & { color: typeof WATCH_COLORS[0] };
                  const groupedWatches = watchesWithColors.reduce((acc, watch) => {
                    const venueKey = watch.venueName ?? "Other";
                    if (!acc[venueKey]) {
                      acc[venueKey] = [];
                    }
                    acc[venueKey].push(watch);
                    return acc;
                  }, {} as Record<string, WatchWithColor[]>);

                  return Object.entries(groupedWatches).map(([venueName, venueWatches]) => {
                    const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
                    const DAY_LABELS = {
                      monday: 'Mon',
                      tuesday: 'Tue',
                      wednesday: 'Wed',
                      thursday: 'Thu',
                      friday: 'Fri',
                      saturday: 'Sat',
                      sunday: 'Sun',
                    };

                    // Get all unique time slots across all watches
                    const allTimeSlots = new Set<string>();
                    venueWatches.forEach(watch => {
                      Object.values(watch.dayTimes).forEach(times => {
                        times.forEach(time => allTimeSlots.add(time));
                      });
                    });
                    const sortedTimeSlots = TIME_SLOTS.filter(t => allTimeSlots.has(t));

                    return (
                      <div key={venueName} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800">
                        {/* Venue Header with Watch Legend */}
                        <div className="bg-gray-50 dark:bg-gray-900/50 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                              <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100">{venueName}</h3>
                              <span className="text-xs text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700">
                                {venueWatches.length} watch{venueWatches.length > 1 ? 'es' : ''}
                              </span>
                            </div>
                          </div>
                          {/* Watch Color Legend */}
                          <div className="flex flex-wrap gap-3 mt-2">
                            {venueWatches.map((watch) => (
                              <div key={watch.id} className="flex items-center gap-1.5">
                                <div className={`w-3 h-3 rounded-full ${watch.color.bg}`}></div>
                                <span className="text-xs text-gray-600 dark:text-gray-400">
                                  {watch.venueName || 'Watch'} {watch.active ? '' : '(Paused)'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                      {/* Calendar View */}
                      <div className="p-4">
                        {sortedTimeSlots.length === 0 ? (
                          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
                            No times configured for any watch
                          </p>
                        ) : (
                          <div className="overflow-x-auto">
                            <div className="inline-block min-w-full">
                              {/* Calendar Header */}
                              <div className="grid grid-cols-8 gap-1 mb-2">
                                <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 py-2">
                                  Time
                                </div>
                                {DAYS.map((day) => (
                                  <div key={day} className="text-xs font-semibold text-gray-700 dark:text-gray-300 text-center py-2">
                                    {DAY_LABELS[day]}
                                  </div>
                                ))}
                              </div>

                              {/* Calendar Rows */}
                              <div className="space-y-1">
                                {sortedTimeSlots.map((time) => (
                                  <div key={time} className="grid grid-cols-8 gap-1">
                                    {/* Time Label */}
                                    <div className="text-xs text-gray-600 dark:text-gray-400 py-1.5 flex items-center">
                                      {time}
                                    </div>
                                    
                                    {/* Day Columns */}
                                    {DAYS.map((day) => {
                                      // Find watches that have this time on this day
                                      const watchesForThisSlot = venueWatches.filter((watch): watch is WatchWithColor => 
                                        watch.dayTimes[day]?.includes(time) ?? false
                                      );

                                      return (
                                        <div
                                          key={day}
                                          className="min-h-[32px] border border-gray-200 dark:border-gray-700 rounded p-1 flex flex-wrap gap-0.5 items-start"
                                        >
                                          {watchesForThisSlot.map((watch) => {
                                            const isSelected = selectedWatchIds.has(watch.id);
                                            return (
                                              <div
                                                key={watch.id}
                                                className={`flex-1 min-w-[20px] h-6 rounded ${watch.color.bgLight} ${watch.color.bgDark} border ${watch.color.borderLight} ${watch.color.borderDark} flex items-center justify-center cursor-pointer transition-all ${
                                                  isSelected ? 'ring-2 ring-blue-500' : ''
                                                } ${!watch.active ? 'opacity-50' : ''}`}
                                                title={`${watch.venueName || 'Watch'} - ${time} ${day}`}
                                                onClick={() => {
                                                  if (selectionMode) {
                                                    toggleWatchSelection(watch.id);
                                                  } else {
                                                    const { color, ...watchWithoutColor } = watch;
                                                    setEditingWatch(watchWithoutColor);
                                                  }
                                                }}
                                              >
                                                {selectionMode && (
                                                  <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleWatchSelection(watch.id)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="sr-only peer"
                                                  />
                                                )}
                                                <div className={`w-2 h-2 rounded-full ${watch.color.bg}`}></div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      );
                                    })}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Watch Actions Row */}
                        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex flex-wrap gap-2">
                          {venueWatches.map((watch) => {
                            const isSelected = selectedWatchIds.has(watch.id);
                            const activeDays = Object.entries(watch.dayTimes)
                              .filter(([_, times]) => times.length > 0);
                            const totalTimeSlots = Object.values(watch.dayTimes)
                              .reduce((sum, times) => sum + times.length, 0);

                            return (
                              <div
                                key={watch.id}
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                                  isSelected
                                    ? "bg-blue-50 dark:bg-blue-900/10 border-blue-500"
                                    : "bg-gray-50 dark:bg-gray-900/30 border-gray-200 dark:border-gray-700"
                                }`}
                              >
                                {/* Checkbox - Only show in selection mode */}
                                {selectionMode && (
                                  <label className="cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggleWatchSelection(watch.id)}
                                      className="sr-only peer"
                                    />
                                    <div className={`w-4 h-4 border-2 rounded-md bg-white dark:bg-gray-800 transition-all duration-200 flex items-center justify-center peer-focus:ring-2 peer-focus:ring-green-500 peer-focus:ring-offset-1 ${
                                      isSelected
                                        ? "bg-green-600 border-green-600 shadow-sm"
                                        : "border-gray-300 dark:border-gray-600"
                                    }`}>
                                      {isSelected && (
                                        <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                        </svg>
                                      )}
                                    </div>
                                  </label>
                                )}
                                
                                {/* Color Indicator */}
                                <div className={`w-3 h-3 rounded-full ${watch.color.bg}`}></div>
                                
                                {/* Watch Info */}
                                <div className="flex items-center gap-2">
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                    watch.active
                                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                                      : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                                  }`}>
                                    {watch.active ? "Active" : "Paused"}
                                  </span>
                                  {totalTimeSlots > 0 && (
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                      {totalTimeSlots} slots
                                    </span>
                                  )}
                                </div>

                                {/* Actions */}
                                <div className="flex gap-1 ml-auto">
                                  <button
                                    onClick={() => handleToggleWatch(watch.id, watch.active)}
                                    className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
                                      watch.active
                                        ? "bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                                        : "bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 text-green-700 dark:text-green-300"
                                    }`}
                                    title={watch.active ? "Pause watch" : "Activate watch"}
                                  >
                                    {watch.active ? "Pause" : "Activate"}
                                  </button>
                                  <button
                                    onClick={() => {
                                      const { color, ...watchWithoutColor } = watch;
                                      setEditingWatch(watchWithoutColor);
                                    }}
                                    className="px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded font-medium transition-colors"
                                    title="Edit watch"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleDeleteWatch(watch.id)}
                                    className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded font-medium transition-colors"
                                    title="Delete watch"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                });
                })()}
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

      {/* Admin Tab (admin only) */}
      {activeTab === "admin" && isAuthenticated && isAdmin && (
        <div className="space-y-6">
          {/* Admin Sub-tabs */}
          <div className="flex gap-2 border-b dark:border-gray-700">
            <button
              onClick={() => {
                setAdminSubTab("overview");
                router.push("/dashboard?tab=admin&adminTab=overview", { scroll: false });
              }}
              className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 -mb-px cursor-pointer ${
                adminSubTab === "overview"
                  ? "border-green-600 text-green-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => {
                setAdminSubTab("users");
                router.push("/dashboard?tab=admin&adminTab=users", { scroll: false });
              }}
              className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 -mb-px cursor-pointer ${
                adminSubTab === "users"
                  ? "border-green-600 text-green-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Users
            </button>
            <button
              onClick={() => {
                setAdminSubTab("requests");
                router.push("/dashboard?tab=admin&adminTab=requests", { scroll: false });
              }}
              className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 -mb-px cursor-pointer ${
                adminSubTab === "requests"
                  ? "border-green-600 text-green-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Registration Requests
            </button>
            <button
              onClick={() => {
                setAdminSubTab("system");
                router.push("/dashboard?tab=admin&adminTab=system", { scroll: false });
              }}
              className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 -mb-px cursor-pointer ${
                adminSubTab === "system"
                  ? "border-green-600 text-green-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              System
            </button>
            <button
              onClick={() => {
                setAdminSubTab("database");
                router.push("/dashboard?tab=admin&adminTab=database", { scroll: false });
              }}
              className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 -mb-px cursor-pointer ${
                adminSubTab === "database"
                  ? "border-green-600 text-green-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Database
            </button>
          </div>

          {/* Admin Sub-tab Content */}
          {adminSubTab === "overview" && <AdminOverview setAdminSubTab={setAdminSubTab} router={router} />}
          {adminSubTab === "users" && <AdminUsers showMessage={showMessage} />}
          {adminSubTab === "requests" && <AdminRequests showMessage={showMessage} />}
          {adminSubTab === "system" && <AdminSystem showMessage={showMessage} />}
          {adminSubTab === "database" && <AdminDatabase showMessage={showMessage} />}
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

      {/* Bulk Edit Modal */}
      {bulkEditMode && (
        <BulkEditWatchModal
          selectedCount={selectedWatchIds.size}
          onClose={() => {
            setBulkEditMode(false);
          }}
          onSubmit={(dayTimes) => {
            handleBulkEdit(dayTimes);
          }}
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
    venueSlugs: string[];
    dayTimes: {
      monday: string[];
      tuesday: string[];
      wednesday: string[];
      thursday: string[];
      friday: string[];
      saturday: string[];
      sunday: string[];
    };
  }) => void;
  timeSlots: string[];
}) {
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
  const DAY_LABELS = {
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday',
    sunday: 'Sunday',
  };
  const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;
  const WEEKENDS = ['saturday', 'sunday'] as const;

  // For editing, we only edit one watch at a time (single venue)
  const [selectedVenues, setSelectedVenues] = useState<string[]>(
    watch?.venueSlug ? [watch.venueSlug] : []
  );
  const [venueDropdownOpen, setVenueDropdownOpen] = useState(false);
  const [venueSearch, setVenueSearch] = useState("");
  const [dayViewTab, setDayViewTab] = useState<'all' | 'weekdays' | 'weekends'>('all');
  
  const [dayTimes, setDayTimes] = useState<{
    monday: string[];
    tuesday: string[];
    wednesday: string[];
    thursday: string[];
    friday: string[];
    saturday: string[];
    sunday: string[];
  }>(
    watch?.dayTimes || {
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    }
  );
  
  // Track which days are enabled (have times selected)
  const [enabledDays, setEnabledDays] = useState<Set<string>>(() => {
    const enabled = new Set<string>();
    if (watch?.dayTimes) {
      DAYS.forEach(day => {
        if (watch.dayTimes[day] && watch.dayTimes[day].length > 0) {
          enabled.add(day);
        }
      });
    }
    return enabled;
  });
  
  const [submitting, setSubmitting] = useState(false);
  
  const toggleDay = (day: typeof DAYS[number]) => {
    setEnabledDays(prev => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
        // Clear times when disabling day
        setDayTimes(prevTimes => ({ ...prevTimes, [day]: [] }));
      } else {
        next.add(day);
      }
      return next;
    });
  };

  const toggleTime = (day: typeof DAYS[number], time: string) => {
    setDayTimes(prev => {
      const newTimes = prev[day].includes(time)
        ? prev[day].filter(t => t !== time)
        : [...prev[day], time].sort();
      
      // Auto-enable day if times are added, auto-disable if all times removed
      setEnabledDays(prevEnabled => {
        const next = new Set(prevEnabled);
        if (newTimes.length > 0) {
          next.add(day);
        } else {
          next.delete(day);
        }
        return next;
      });
      
      return {
        ...prev,
        [day]: newTimes,
      };
    });
  };

  // Get days to display based on active tab
  const getDaysToDisplay = () => {
    switch (dayViewTab) {
      case 'weekdays':
        return WEEKDAYS;
      case 'weekends':
        return WEEKENDS;
      default:
        return DAYS;
    }
  };

  // Quick selection helpers
  const selectTimeRange = (day: typeof DAYS[number], startTime: string, endTime: string) => {
    const startIdx = timeSlots.indexOf(startTime);
    const endIdx = timeSlots.indexOf(endTime);
    if (startIdx === -1 || endIdx === -1) return;
    
    const range = timeSlots.slice(startIdx, endIdx + 1);
    setDayTimes(prev => ({
      ...prev,
      [day]: [...new Set([...prev[day], ...range])].sort(),
    }));
  };

  const applyToDays = (days: readonly string[], times: string[]) => {
    setDayTimes(prev => {
      const updated = { ...prev };
      days.forEach(day => {
        updated[day as typeof DAYS[number]] = [...times].sort();
      });
      return updated;
    });
  };

  const clearDays = (days: readonly string[]) => {
    setDayTimes(prev => {
      const updated = { ...prev };
      days.forEach(day => {
        updated[day as typeof DAYS[number]] = [];
      });
      return updated;
    });
  };

  // Preset templates
  const applyPreset = (preset: 'evening' | 'morning' | 'afternoon' | 'all-day') => {
    let times: string[] = [];
    switch (preset) {
      case 'evening':
        // Only include 6pm, 7pm, 8pm, 9pm, 10pm (exclude 12pm and 1pm-5pm)
        times = timeSlots.filter(t => {
          return t === '6pm' || t === '7pm' || t === '8pm' || t === '9pm' || t === '10pm';
        });
        break;
      case 'morning':
        times = timeSlots.filter(t => {
          const hour = parseInt(t.replace(/[^0-9]/g, ''));
          const isAM = t.includes('am');
          return isAM && hour >= 7 && hour <= 12;
        });
        break;
      case 'afternoon':
        // Include 12pm and 1pm-5pm
        times = timeSlots.filter(t => {
          return t === '12pm' || t === '1pm' || t === '2pm' || t === '3pm' || t === '4pm' || t === '5pm';
        });
        break;
      case 'all-day':
        times = [...timeSlots];
        break;
    }
    applyToDays(DAYS, times);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate at least one venue selected
    if (selectedVenues.length === 0) {
      alert("Please select at least one venue");
      return;
    }

    // Validate at least one time slot selected across all days
    const hasAnyTime = DAYS.some(day => dayTimes[day].length > 0);
    if (!hasAnyTime) {
      alert("Please select at least one time slot for any day");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        venueSlugs: selectedVenues,
        dayTimes,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const filteredVenues = VENUES.filter(venue =>
    venue.name.toLowerCase().includes(venueSearch.toLowerCase())
  );

  const removeVenue = (slug: string) => {
    setSelectedVenues(prev => prev.filter(v => v !== slug));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-5xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="p-6 border-b dark:border-gray-700">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-semibold">
                {watch ? "Edit Watch" : "Create New Watch"}
              </h2>
              {!watch && (
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Select venues and times to get notified when slots become available
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              disabled={submitting}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Venue Selection - Enhanced with chips */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Select Venues {!watch && <span className="text-gray-500 font-normal">(select multiple)</span>}
            </label>
            
            {/* Selected venues as chips */}
            {selectedVenues.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {selectedVenues.map((slug) => {
                  const venue = VENUES.find(v => v.slug === slug);
                  return (
                    <span
                      key={slug}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded-full text-sm"
                    >
                      {venue?.name}
                      {!watch && (
                        <button
                          type="button"
                          onClick={() => removeVenue(slug)}
                          className="ml-1 hover:text-green-600 dark:hover:text-green-200"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
            )}

            <div className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  if (!watch) setVenueDropdownOpen(!venueDropdownOpen);
                }}
                className={`w-full p-3 border-2 rounded-lg text-left flex items-center justify-between transition-colors ${
                  watch 
                    ? 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 cursor-not-allowed opacity-60'
                    : selectedVenues.length > 0
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700 hover:bg-green-100 dark:hover:bg-green-900/30 cursor-pointer'
                    : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 hover:border-green-400 dark:hover:border-green-600 cursor-pointer'
                }`}
                disabled={!!watch}
              >
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {selectedVenues.length === 0
                    ? "Click to select venues..."
                    : selectedVenues.length === 1
                    ? VENUES.find((v) => v.slug === selectedVenues[0])?.name || "Select venues..."
                    : `${selectedVenues.length} venues selected`}
                </span>
                <svg
                  className={`w-5 h-5 text-gray-500 transition-transform ${
                    venueDropdownOpen ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {venueDropdownOpen && !watch && (
                <>
                  <div
                    className="fixed inset-0"
                    style={{ zIndex: 55 }}
                    onClick={() => {
                      setVenueDropdownOpen(false);
                      setVenueSearch("");
                    }}
                  />
                  <div 
                    className="absolute w-full mt-1 bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 rounded-lg shadow-xl max-h-80 overflow-hidden flex flex-col"
                    style={{ zIndex: 60 }}
                  >
                    {/* Search input */}
                    <div className="p-2 border-b dark:border-gray-700">
                      <input
                        type="text"
                        placeholder="Search venues..."
                        value={venueSearch}
                        onChange={(e) => setVenueSearch(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                    
                    <div className="overflow-y-auto max-h-64">
                      <div className="p-2">
                        {/* Select All Checkbox */}
                        <label
                          className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer border-b border-gray-200 dark:border-gray-700 mb-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={filteredVenues.length > 0 && filteredVenues.every(v => selectedVenues.includes(v.slug))}
                            ref={(input) => {
                              if (input) {
                                const selectedCount = filteredVenues.filter(v => selectedVenues.includes(v.slug)).length;
                                input.indeterminate = selectedCount > 0 && selectedCount < filteredVenues.length;
                              }
                            }}
                            onChange={(e) => {
                              if (e.target.checked) {
                                const newVenues = [...new Set([...selectedVenues, ...filteredVenues.map(v => v.slug)])];
                                setSelectedVenues(newVenues);
                              } else {
                                setSelectedVenues(selectedVenues.filter(v => !filteredVenues.some(fv => fv.slug === v)));
                              }
                            }}
                            className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                          />
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {venueSearch ? `All (${filteredVenues.length})` : "All Venues"}
                          </span>
                        </label>

                        {filteredVenues.length === 0 ? (
                          <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                            No venues found
                          </div>
                        ) : (
                          filteredVenues.map((venue) => {
                            const isSelected = selectedVenues.includes(venue.slug);
                            return (
                              <label
                                key={venue.slug}
                                className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedVenues([...selectedVenues, venue.slug]);
                                    } else {
                                      setSelectedVenues(selectedVenues.filter(v => v !== venue.slug));
                                    }
                                  }}
                                  className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                                />
                                <span className="text-sm text-gray-700 dark:text-gray-300">
                                  {venue.name}
                                </span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
            {watch && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Venue cannot be changed when editing. Delete and create new watches to change venues.
              </p>
            )}
          </div>

          {/* Quick Presets */}
          <div>
            <label className="block text-sm font-medium mb-2">Quick Presets</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => applyPreset('evening')}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                🌆 Evening (6pm-10pm)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('morning')}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                🌅 Morning (7am-12pm)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('afternoon')}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                ☀️ Afternoon (12pm-5pm)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('all-day')}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                🕐 All Day
              </button>
            </div>
          </div>

          {/* Quick Day Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">Quick Day Selection</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const weekdaysTimes = WEEKDAYS.flatMap(day => dayTimes[day]);
                  const mostCommonTimes = weekdaysTimes.length > 0 
                    ? [...new Set(weekdaysTimes)].sort()
                    : ['6pm', '7pm', '8pm'];
                  applyToDays(WEEKDAYS, mostCommonTimes);
                }}
                className="px-3 py-1.5 text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
              >
                Apply to Weekdays
              </button>
              <button
                type="button"
                onClick={() => {
                  const weekendTimes = WEEKENDS.flatMap(day => dayTimes[day]);
                  const mostCommonTimes = weekendTimes.length > 0 
                    ? [...new Set(weekendTimes)].sort()
                    : ['9am', '10am', '11am', '12pm', '1pm', '2pm'];
                  applyToDays(WEEKENDS, mostCommonTimes);
                }}
                className="px-3 py-1.5 text-sm bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors"
              >
                Apply to Weekends
              </button>
              <button
                type="button"
                onClick={() => clearDays(DAYS)}
                className="px-3 py-1.5 text-sm bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
              >
                Clear All Days
              </button>
            </div>
          </div>

          {/* Day Time Selectors - Tabbed Interface */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <label className="block text-sm font-medium">
                Select times for each day
              </label>
              {/* Day View Tabs */}
              <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setDayViewTab('all')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    dayViewTab === 'all'
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  All Days
                </button>
                <button
                  type="button"
                  onClick={() => setDayViewTab('weekdays')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    dayViewTab === 'weekdays'
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  Weekdays
                </button>
                <button
                  type="button"
                  onClick={() => setDayViewTab('weekends')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    dayViewTab === 'weekends'
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  Weekends
                </button>
              </div>
            </div>
            
            {/* Days Grid - 2 columns for compact view */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {getDaysToDisplay().map((day) => {
                const selectedCount = dayTimes[day].length;
                const isEnabled = enabledDays.has(day);
                return (
                  <div key={day} className={`border-2 dark:border-gray-700 rounded-lg p-4 transition-all ${
                    isEnabled 
                      ? 'bg-white dark:bg-gray-800 hover:border-green-400 dark:hover:border-green-600' 
                      : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700 opacity-60'
                  }`}>
                    {/* Day Header with Toggle */}
                    <div className="flex items-center justify-between mb-3 pb-2 border-b dark:border-gray-700">
                      <div className="flex items-center gap-2 flex-1">
                        {/* Day Toggle */}
                        <button
                          type="button"
                          onClick={() => toggleDay(day)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                            isEnabled
                              ? 'bg-green-600'
                              : 'bg-gray-300 dark:bg-gray-600'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              isEnabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                        <div className="flex items-center gap-2">
                          <h3 className={`text-sm font-semibold ${isEnabled ? '' : 'text-gray-400 dark:text-gray-500'}`}>
                            {DAY_LABELS[day]}
                          </h3>
                          {selectedCount > 0 && isEnabled && (
                            <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-xs font-medium">
                              {selectedCount}
                            </span>
                          )}
                        </div>
                      </div>
                      {selectedCount > 0 && isEnabled && (
                        <button
                          type="button"
                          onClick={() => setDayTimes(prev => ({ ...prev, [day]: [] }))}
                          className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    
                    {/* Only show time selection if day is enabled */}
                    {isEnabled && (
                      <>
                        {/* Quick time range buttons */}
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          <button
                            type="button"
                            onClick={() => selectTimeRange(day, '6pm', '10pm')}
                            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                          >
                            + Evening
                          </button>
                          <button
                            type="button"
                            onClick={() => selectTimeRange(day, '7am', '12pm')}
                            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                          >
                            + Morning
                          </button>
                          <button
                            type="button"
                            onClick={() => selectTimeRange(day, '12pm', '5pm')}
                            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                          >
                            + Afternoon
                          </button>
                        </div>
                        
                        {/* Time slot grid - more compact */}
                        <div className="grid grid-cols-4 gap-1.5">
                          {timeSlots.map((time) => (
                            <button
                              key={time}
                              type="button"
                              onClick={() => toggleTime(day, time)}
                              className={`p-1.5 rounded text-xs font-medium border-2 transition-all cursor-pointer ${
                                dayTimes[day].includes(time)
                                  ? "bg-green-600 text-white border-green-600 shadow-sm"
                                  : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 hover:bg-green-50 dark:hover:bg-green-900/20 hover:border-green-400 dark:hover:border-green-600"
                              }`}
                            >
                              {time}
                            </button>
                          ))}
                        </div>
                        
                        {dayTimes[day].length > 0 && (
                          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                            <span className="font-medium">Selected:</span> {dayTimes[day].join(", ")}
                          </p>
                        )}
                      </>
                    )}
                    {!isEnabled && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-2">
                        Toggle to enable this day
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Summary */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm text-blue-800 dark:text-blue-300">
                <p className="font-medium mb-1">Summary</p>
                <p>
                  {selectedVenues.length === 0 ? (
                    "Select at least one venue"
                  ) : (
                    <>
                      Creating <strong>{selectedVenues.length}</strong> watch{selectedVenues.length > 1 ? 'es' : ''} for{' '}
                      <strong>{selectedVenues.length === 1 ? VENUES.find(v => v.slug === selectedVenues[0])?.name : `${selectedVenues.length} venues`}</strong>
                      {DAYS.some(day => dayTimes[day].length > 0) && (
                        <> with time preferences for {DAYS.filter(day => dayTimes[day].length > 0).length} day{DAYS.filter(day => dayTimes[day].length > 0).length > 1 ? 's' : ''}</>
                      )}
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex gap-3 justify-end pt-4 border-t dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 border-2 border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 font-medium transition-colors"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium shadow-md hover:shadow-lg transition-all disabled:cursor-not-allowed"
              disabled={submitting || selectedVenues.length === 0}
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Saving...
                </span>
              ) : watch ? (
                "Update Watch"
              ) : (
                `Create ${selectedVenues.length > 1 ? `${selectedVenues.length} ` : ''}Watch${selectedVenues.length > 1 ? 'es' : ''}`
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Bulk Edit Watch Modal Component
function BulkEditWatchModal({
  selectedCount,
  onClose,
  onSubmit,
  timeSlots,
}: {
  selectedCount: number;
  onClose: () => void;
  onSubmit: (dayTimes: {
    monday: string[];
    tuesday: string[];
    wednesday: string[];
    thursday: string[];
    friday: string[];
    saturday: string[];
    sunday: string[];
  }) => void;
  timeSlots: string[];
}) {
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
  const DAY_LABELS = {
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday',
    sunday: 'Sunday',
  };
  const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;
  const WEEKENDS = ['saturday', 'sunday'] as const;

  const [dayTimes, setDayTimes] = useState<{
    monday: string[];
    tuesday: string[];
    wednesday: string[];
    thursday: string[];
    friday: string[];
    saturday: string[];
    sunday: string[];
  }>({
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  });
  const [dayViewTab, setDayViewTab] = useState<'all' | 'weekdays' | 'weekends'>('all');
  const [submitting, setSubmitting] = useState(false);

  const toggleTime = (day: typeof DAYS[number], time: string) => {
    setDayTimes(prev => ({
      ...prev,
      [day]: prev[day].includes(time)
        ? prev[day].filter(t => t !== time)
        : [...prev[day], time].sort(),
    }));
  };

  const selectTimeRange = (day: typeof DAYS[number], startTime: string, endTime: string) => {
    const startIdx = timeSlots.indexOf(startTime);
    const endIdx = timeSlots.indexOf(endTime);
    if (startIdx === -1 || endIdx === -1) return;
    
    const range = timeSlots.slice(startIdx, endIdx + 1);
    setDayTimes(prev => ({
      ...prev,
      [day]: [...new Set([...prev[day], ...range])].sort(),
    }));
  };

  const applyToDays = (days: readonly string[], times: string[]) => {
    setDayTimes(prev => {
      const updated = { ...prev };
      days.forEach(day => {
        updated[day as typeof DAYS[number]] = [...times].sort();
      });
      return updated;
    });
  };

  const clearDays = (days: readonly string[]) => {
    setDayTimes(prev => {
      const updated = { ...prev };
      days.forEach(day => {
        updated[day as typeof DAYS[number]] = [];
      });
      return updated;
    });
  };

  const applyPreset = (preset: 'evening' | 'morning' | 'afternoon' | 'all-day') => {
    let times: string[] = [];
    switch (preset) {
      case 'evening':
        times = timeSlots.filter(t => {
          return t === '6pm' || t === '7pm' || t === '8pm' || t === '9pm' || t === '10pm';
        });
        break;
      case 'morning':
        times = timeSlots.filter(t => {
          const hour = parseInt(t.replace(/[^0-9]/g, ''));
          const isAM = t.includes('am');
          return isAM && hour >= 7 && hour <= 12;
        });
        break;
      case 'afternoon':
        times = timeSlots.filter(t => {
          return t === '12pm' || t === '1pm' || t === '2pm' || t === '3pm' || t === '4pm' || t === '5pm';
        });
        break;
      case 'all-day':
        times = [...timeSlots];
        break;
    }
    applyToDays(DAYS, times);
  };

  const getDaysToDisplay = () => {
    switch (dayViewTab) {
      case 'weekdays':
        return WEEKDAYS;
      case 'weekends':
        return WEEKENDS;
      default:
        return DAYS;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const hasAnyTime = DAYS.some(day => dayTimes[day].length > 0);
    if (!hasAnyTime) {
      alert("Please select at least one time slot for any day");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(dayTimes);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-5xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="p-6 border-b dark:border-gray-700">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Bulk Edit Watches</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Apply the same time preferences to {selectedCount} selected watch{selectedCount > 1 ? 'es' : ''}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              disabled={submitting}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Quick Presets */}
          <div>
            <label className="block text-sm font-medium mb-2">Quick Presets</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => applyPreset('evening')}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                🌆 Evening (6pm-10pm)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('morning')}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                🌅 Morning (7am-12pm)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('afternoon')}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                ☀️ Afternoon (12pm-5pm)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('all-day')}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                🕐 All Day
              </button>
            </div>
          </div>

          {/* Quick Day Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">Quick Day Selection</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const weekdaysTimes = WEEKDAYS.flatMap(day => dayTimes[day]);
                  const mostCommonTimes = weekdaysTimes.length > 0 
                    ? [...new Set(weekdaysTimes)].sort()
                    : ['6pm', '7pm', '8pm'];
                  applyToDays(WEEKDAYS, mostCommonTimes);
                }}
                className="px-3 py-1.5 text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
              >
                Apply to Weekdays
              </button>
              <button
                type="button"
                onClick={() => {
                  const weekendTimes = WEEKENDS.flatMap(day => dayTimes[day]);
                  const mostCommonTimes = weekendTimes.length > 0 
                    ? [...new Set(weekendTimes)].sort()
                    : ['9am', '10am', '11am', '12pm', '1pm', '2pm'];
                  applyToDays(WEEKENDS, mostCommonTimes);
                }}
                className="px-3 py-1.5 text-sm bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors"
              >
                Apply to Weekends
              </button>
              <button
                type="button"
                onClick={() => clearDays(DAYS)}
                className="px-3 py-1.5 text-sm bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
              >
                Clear All Days
              </button>
            </div>
          </div>

          {/* Day Time Selectors - Tabbed Interface */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <label className="block text-sm font-medium">
                Select times for each day
              </label>
              <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setDayViewTab('all')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    dayViewTab === 'all'
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  All Days
                </button>
                <button
                  type="button"
                  onClick={() => setDayViewTab('weekdays')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    dayViewTab === 'weekdays'
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  Weekdays
                </button>
                <button
                  type="button"
                  onClick={() => setDayViewTab('weekends')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    dayViewTab === 'weekends'
                      ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  Weekends
                </button>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {getDaysToDisplay().map((day) => {
                const selectedCount = dayTimes[day].length;
                return (
                  <div key={day} className="border-2 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800 transition-all hover:border-green-400 dark:hover:border-green-600">
                    <div className="flex items-center justify-between mb-3 pb-2 border-b dark:border-gray-700">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold">{DAY_LABELS[day]}</h3>
                        {selectedCount > 0 && (
                          <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-xs font-medium">
                            {selectedCount}
                          </span>
                        )}
                      </div>
                      {selectedCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setDayTimes(prev => ({ ...prev, [day]: [] }))}
                          className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      <button
                        type="button"
                        onClick={() => selectTimeRange(day, '6pm', '10pm')}
                        className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        + Evening
                      </button>
                      <button
                        type="button"
                        onClick={() => selectTimeRange(day, '7am', '12pm')}
                        className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        + Morning
                      </button>
                      <button
                        type="button"
                        onClick={() => selectTimeRange(day, '12pm', '5pm')}
                        className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        + Afternoon
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-4 gap-1.5">
                      {timeSlots.map((time) => (
                        <button
                          key={time}
                          type="button"
                          onClick={() => toggleTime(day, time)}
                          className={`p-1.5 rounded text-xs font-medium border-2 transition-all cursor-pointer ${
                            dayTimes[day].includes(time)
                              ? "bg-green-600 text-white border-green-600 shadow-sm"
                              : "bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 hover:bg-green-50 dark:hover:bg-green-900/20 hover:border-green-400 dark:hover:border-green-600"
                          }`}
                        >
                          {time}
                        </button>
                      ))}
                    </div>
                    
                    {dayTimes[day].length > 0 && (
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                        <span className="font-medium">Selected:</span> {dayTimes[day].join(", ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex gap-3 justify-end pt-4 border-t dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 border-2 border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 font-medium transition-colors"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium shadow-md hover:shadow-lg transition-all disabled:cursor-not-allowed"
              disabled={submitting}
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Updating...
                </span>
              ) : (
                `Apply to ${selectedCount} Watch${selectedCount > 1 ? 'es' : ''}`
              )}
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

// Admin Components
function AdminOverview({ setAdminSubTab, router }: { setAdminSubTab: (tab: "overview" | "users" | "requests" | "system" | "database") => void; router: any }) {
  const [stats, setStats] = useState<any>(null);
  const [recentNotifications, setRecentNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/admin/stats");
      const data = await res.json();
      setStats(data.stats);
      setRecentNotifications(data.recentNotifications);
    } catch (error) {
      console.error("Failed to fetch stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const navigateTo = (tab: "users" | "requests" | "system") => {
    setAdminSubTab(tab);
    router.push(`/dashboard?tab=admin&adminTab=${tab}`, { scroll: false });
  };

  if (loading) {
    return <div className="p-4 text-center text-gray-500">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <button
          onClick={() => navigateTo("users")}
          className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 hover:shadow-lg transition-shadow text-left cursor-pointer"
        >
          <div className="text-2xl font-bold mb-1">{stats?.totalUsers || 0}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Total Users</div>
          <div className="text-xs text-gray-500 mt-1">{stats?.allowedUsers || 0} allowed</div>
        </button>
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4">
          <div className="text-2xl font-bold mb-1">{stats?.activeWatches || 0}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Active Watches</div>
          <div className="text-xs text-gray-500 mt-1">{stats?.totalWatches || 0} total</div>
        </div>
        <button
          onClick={() => navigateTo("requests")}
          className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 hover:shadow-lg transition-shadow text-left cursor-pointer"
        >
          <div className="text-2xl font-bold mb-1">{stats?.pendingRequests || 0}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Pending Requests</div>
          <div className="text-xs text-gray-500 mt-1">Awaiting approval</div>
        </button>
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4">
          <div className="text-2xl font-bold mb-1">{stats?.totalChannels || 0}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Notification Channels</div>
          <div className="text-xs text-gray-500 mt-1">Active channels</div>
        </div>
        <button
          onClick={() => navigateTo("system")}
          className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 hover:shadow-lg transition-shadow text-left cursor-pointer"
        >
          <div className="text-2xl font-bold mb-1">{stats?.totalSlots || 0}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Total Slots</div>
          <div className="text-xs text-gray-500 mt-1">{stats?.totalVenues || 0} venues</div>
        </button>
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4">
          <div className="text-2xl font-bold mb-1">{stats?.totalNotifications || 0}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Notifications Sent</div>
          <div className="text-xs text-gray-500 mt-1">All time</div>
        </div>
      </div>

      {/* Recent Notifications */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold mb-4">Recent Notifications</h2>
        {recentNotifications.length > 0 ? (
          <div className="space-y-2">
            {recentNotifications.map((notification: any) => (
              <div
                key={notification.id}
                className="flex items-center justify-between py-2 border-b dark:border-gray-700 last:border-0"
              >
                <span className="text-sm">{notification.slotKey}</span>
                <span className="text-xs text-gray-500">
                  {new Date(notification.sentAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No recent notifications</p>
        )}
      </div>
    </div>
  );
}

function AdminUsers({ showMessage }: { showMessage: (type: "success" | "error", text: string) => void }) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const [userDetails, setUserDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      setUsers(data.users);
    } catch (error) {
      console.error("Failed to fetch users:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUserDetails = async (userId: number) => {
    setLoadingDetails(true);
    try {
      const [watchesRes, channelsRes] = await Promise.all([
        fetch(`/api/admin/users/${userId}/watches`),
        fetch(`/api/admin/users/${userId}/channels`)
      ]);
      
      const watchesData = await watchesRes.json();
      const channelsData = await channelsRes.json();
      
      setUserDetails({
        watches: watchesData.watches || [],
        channels: channelsData.channels || []
      });
    } catch (error) {
      console.error("Failed to fetch user details:", error);
      showMessage("error", "Failed to load user details");
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleAddUser = async (email: string, name: string, isAllowed: boolean, isAdmin: boolean) => {
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, isAllowed, isAdmin }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create user");
      }

      await fetchUsers();
      setShowAddUserForm(false);
      showMessage("success", "User created successfully");
    } catch (error: any) {
      showMessage("error", error.message || "Failed to create user");
    }
  };

  const toggleUserExpand = async (userId: number) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      setUserDetails(null);
    } else {
      setExpandedUserId(userId);
      await fetchUserDetails(userId);
    }
  };

  const handleToggleAllowed = async (userId: number, currentValue: number) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAllowed: !currentValue }),
      });

      if (!res.ok) throw new Error("Failed to update user");

      await fetchUsers();
      showMessage("success", "User status updated");
    } catch (error) {
      showMessage("error", "Failed to update user");
    }
  };

  const handleToggleAdmin = async (userId: number, currentValue: number) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAdmin: !currentValue }),
      });

      if (!res.ok) throw new Error("Failed to update user");

      await fetchUsers();
      showMessage("success", "Admin status updated");
    } catch (error) {
      showMessage("error", "Failed to update user");
    }
  };

  const handleDeleteUser = async (userId: number, email: string) => {
    if (!confirm(`Are you sure you want to delete user ${email}? This action cannot be undone.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete user");

      await fetchUsers();
      showMessage("success", "User deleted successfully");
    } catch (error) {
      showMessage("error", "Failed to delete user");
    }
  };

  const filteredUsers = users.filter(
    (user) =>
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return <div className="p-4 text-center text-gray-500">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header with Add User Button */}
      <div className="flex justify-between items-center">
        <input
          type="text"
          placeholder="Search by email or name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 mr-4"
        />
        <button
          onClick={() => setShowAddUserForm(true)}
          className="px-4 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors whitespace-nowrap"
        >
          + Add User
        </button>
      </div>

      {/* Users Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  User
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Watches
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Channels
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Created
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {filteredUsers.map((user) => (
                <Fragment key={user.id}>
                  <tr className="hover:bg-gray-50 dark:hover:bg-gray-900">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleUserExpand(user.id)}
                          className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                        >
                          {expandedUserId === user.id ? "▼" : "▶"}
                        </button>
                        <div className="flex flex-col">
                          <span className="font-medium text-sm">{user.email}</span>
                          {user.name && (
                            <span className="text-xs text-gray-500">{user.name}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs rounded w-fit ${
                            user.isAllowed
                              ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                              : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                          }`}
                        >
                          {user.isAllowed ? "Allowed" : "Not Allowed"}
                        </span>
                        {user.isAdmin === 1 && (
                          <span className="inline-block px-2 py-0.5 text-xs rounded bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 w-fit">
                            Admin
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">{user.watchCount}</td>
                    <td className="px-4 py-3 text-sm">{user.channelCount}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => handleToggleAllowed(user.id, user.isAllowed)}
                          className={`px-2 py-1 text-xs rounded ${
                            user.isAllowed
                              ? "bg-red-100 dark:bg-red-900 hover:bg-red-200 dark:hover:bg-red-800"
                              : "bg-green-100 dark:bg-green-900 hover:bg-green-200 dark:hover:bg-green-800"
                          }`}
                        >
                          {user.isAllowed ? "Revoke" : "Allow"}
                        </button>
                        <button
                          onClick={() => handleToggleAdmin(user.id, user.isAdmin)}
                          className="px-2 py-1 text-xs bg-purple-100 dark:bg-purple-900 hover:bg-purple-200 dark:hover:bg-purple-800 rounded"
                        >
                          {user.isAdmin ? "Remove Admin" : "Make Admin"}
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user.id, user.email)}
                          className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900 hover:bg-red-200 dark:hover:bg-red-800 rounded"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedUserId === user.id && (
                    <tr key={`${user.id}-details`}>
                      <td colSpan={6} className="px-4 py-4 bg-gray-50 dark:bg-gray-900">
                        {loadingDetails ? (
                          <div className="text-center text-gray-500 text-sm">Loading details...</div>
                        ) : userDetails ? (
                          <div className="space-y-4">
                            {/* Watches Section */}
                            <div>
                              <h4 className="font-semibold text-sm mb-2">Watches ({userDetails.watches.length})</h4>
                              {userDetails.watches.length > 0 ? (
                                <div className="space-y-2">
                                  {userDetails.watches.map((watch: any) => (
                                    <div key={watch.id} className="bg-white dark:bg-gray-800 rounded p-3 text-sm">
                                      <div className="flex justify-between items-start">
                                        <div className="flex-1">
                                          <p className="font-medium">{watch.venueName || "All Venues"}</p>
                                          <div className="mt-2 space-y-1">
                                            {watch.dayTimes && Object.entries(watch.dayTimes)
                                              .filter(([_, times]: [string, any]) => times?.length > 0)
                                              .map(([day, times]: [string, any]) => (
                                                <p key={day} className="text-xs text-gray-500">
                                                  <span className="capitalize font-medium">{day}:</span> {times.join(", ")}
                                                </p>
                                              ))}
                                            {watch.dayTimes && Object.values(watch.dayTimes).every((times: any) => !times || times.length === 0) && (
                                              <p className="text-xs text-gray-500 italic">No times set</p>
                                            )}
                                          </div>
                                        </div>
                                        <span className={`px-2 py-0.5 text-xs rounded ${watch.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"}`}>
                                          {watch.active ? "Active" : "Paused"}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-gray-500">No watches configured</p>
                              )}
                            </div>

                            {/* Channels Section */}
                            <div>
                              <h4 className="font-semibold text-sm mb-2">Notification Channels ({userDetails.channels.length})</h4>
                              {userDetails.channels.length > 0 ? (
                                <div className="space-y-2">
                                  {userDetails.channels.map((channel: any) => (
                                    <div key={channel.id} className="bg-white dark:bg-gray-800 rounded p-3 text-sm">
                                      <div className="flex justify-between items-center">
                                        <div>
                                          <p className="font-medium capitalize">{channel.type}</p>
                                          <p className="text-xs text-gray-500">{channel.destination}</p>
                                        </div>
                                        <span className={`px-2 py-0.5 text-xs rounded ${channel.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"}`}>
                                          {channel.active ? "Active" : "Paused"}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-gray-500">No notification channels configured</p>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="text-center text-gray-500 text-sm">Failed to load details</div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {filteredUsers.length === 0 && (
          <div className="p-8 text-center text-gray-500 text-sm">
            No users found matching your search.
          </div>
        )}
      </div>

      <div className="text-sm text-gray-500">
        Showing {filteredUsers.length} of {users.length} users
      </div>

      {/* Add User Modal */}
      {showAddUserForm && (
        <AddUserModal
          onClose={() => setShowAddUserForm(false)}
          onSubmit={handleAddUser}
        />
      )}
    </div>
  );
}

function AddUserModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (email: string, name: string, isAllowed: boolean, isAdmin: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [isAllowed, setIsAllowed] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      alert("Email is required");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(email.trim(), name.trim(), isAllowed, isAdmin);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full">
        <div className="p-6 border-b dark:border-gray-700">
          <h2 className="text-xl font-semibold">Add New User</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Email *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full p-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
              className="w-full p-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isAllowed"
              checked={isAllowed}
              onChange={(e) => setIsAllowed(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="isAllowed" className="text-sm">Allow user access</label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isAdmin"
              checked={isAdmin}
              onChange={(e) => setIsAdmin(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="isAdmin" className="text-sm">Make admin</label>
          </div>

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
              {submitting ? "Creating..." : "Create User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AdminRequests({ showMessage }: { showMessage: (type: "success" | "error", text: string) => void }) {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    try {
      const res = await fetch("/api/admin/requests");
      const data = await res.json();
      setRequests(data.requests);
    } catch (error) {
      console.error("Failed to fetch requests:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (requestId: number, email: string) => {
    if (!confirm(`Approve registration for ${email}?`)) return;

    try {
      const res = await fetch(`/api/admin/requests/${requestId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });

      if (!res.ok) throw new Error("Failed to approve request");

      await fetchRequests();
      showMessage("success", `Approved ${email} - account created and welcome email sent`);
    } catch (error) {
      showMessage("error", "Failed to approve request");
    }
  };

  const handleReject = async (requestId: number, email: string) => {
    if (!confirm(`Reject registration for ${email}? They will be notified via email.`)) return;

    try {
      const res = await fetch(`/api/admin/requests/${requestId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });

      if (!res.ok) throw new Error("Failed to reject request");

      await fetchRequests();
      showMessage("success", `Rejected ${email} - rejection email sent`);
    } catch (error) {
      showMessage("error", "Failed to reject request");
    }
  };

  const handleDelete = async (requestId: number, email: string) => {
    if (!confirm(`Delete registration request from ${email}? This action cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/admin/requests/${requestId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete request");

      await fetchRequests();
      showMessage("success", "Request deleted");
    } catch (error) {
      showMessage("error", "Failed to delete request");
    }
  };

  const filteredRequests = requests.filter((req) =>
    filter === "all" ? true : req.status === filter
  );

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  if (loading) {
    return <div className="p-4 text-center text-gray-500">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex gap-2 border-b dark:border-gray-700">
        {(["all", "pending", "approved", "rejected"] as const).map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 -mb-px capitalize cursor-pointer ${
              filter === status
                ? "border-green-600 text-green-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {status}
            {status === "pending" && pendingCount > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 rounded-full text-xs">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Requests List */}
      <div className="space-y-3">
        {filteredRequests.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6 text-center text-gray-500 text-sm">
            No {filter !== "all" ? filter : ""} requests found
          </div>
        ) : (
          filteredRequests.map((request) => (
            <div
              key={request.id}
              className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold">{request.email}</h3>
                    <span
                      className={`px-2 py-0.5 text-xs rounded ${
                        request.status === "pending"
                          ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
                          : request.status === "approved"
                            ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                            : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                      }`}
                    >
                      {request.status}
                    </span>
                  </div>
                  {request.name && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                      Name: {request.name}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mb-2">
                    Submitted: {new Date(request.createdAt).toLocaleString()}
                  </p>
                  {request.reason && (
                    <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-900 rounded">
                      <p className="text-xs font-medium mb-1">Reason:</p>
                      <p className="text-xs text-gray-700 dark:text-gray-300">{request.reason}</p>
                    </div>
                  )}
                  {request.reviewedAt && (
                    <p className="text-xs text-gray-500 mt-2">
                      Reviewed: {new Date(request.reviewedAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  {request.status === "pending" && (
                    <>
                      <button
                        onClick={() => handleApprove(request.id, request.email)}
                        className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(request.id, request.email)}
                        className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleDelete(request.id, request.email)}
                    className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="text-sm text-gray-500">
        Showing {filteredRequests.length} of {requests.length} requests
      </div>
    </div>
  );
}

function AdminSystem({ showMessage }: { showMessage: (type: "success" | "error", text: string) => void }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [cleanupDays, setCleanupDays] = useState(7);
  const [logs, setLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [showVenueForm, setShowVenueForm] = useState(false);
  const [venues, setVenues] = useState<any[]>([]);

  useEffect(() => {
    fetchLogs();
    fetchVenues();
  }, []);

  const fetchLogs = async () => {
    setLoadingLogs(true);
    try {
      const res = await fetch("/api/admin/logs");
      const data = await res.json();
      setLogs(data.logs || []);
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    } finally {
      setLoadingLogs(false);
    }
  };

  const fetchVenues = async () => {
    try {
      const res = await fetch("/api/admin/venues");
      const data = await res.json();
      setVenues(data.venues || []);
    } catch (error) {
      console.error("Failed to fetch venues:", error);
    }
  };

  const handleAddVenue = async (venueData: any) => {
    try {
      const res = await fetch("/api/admin/venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(venueData),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to add venue");
      }

      await fetchVenues();
      setShowVenueForm(false);
      showMessage("success", "Venue added successfully");
    } catch (error: any) {
      showMessage("error", error.message || "Failed to add venue");
    }
  };

  const handleDeleteVenue = async (venueId: number, venueName: string) => {
    if (!confirm(`Delete venue "${venueName}"? This will also delete all associated watches and slots.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/admin/venues/${venueId}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete venue");

      await fetchVenues();
      showMessage("success", "Venue deleted successfully");
    } catch (error) {
      showMessage("error", "Failed to delete venue");
    }
  };

  const handleRunScrape = async () => {
    setLoading("scrape");
    try {
      const res = await fetch("/api/admin/scrape", {
        method: "POST",
      });

      if (!res.ok) throw new Error("Failed to start scrape");

      showMessage("success", "Scrape job started successfully");
    } catch (error) {
      showMessage("error", "Failed to start scrape");
    } finally {
      setLoading(null);
    }
  };

  const handleRunCleanup = async () => {
    if (!confirm(`Delete data older than ${cleanupDays} days?`)) return;

    setLoading("cleanup");
    try {
      const res = await fetch("/api/admin/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: cleanupDays }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error("Failed to run cleanup");

      showMessage(
        "success",
        `Cleanup completed: ${data.deletedSlots} slots, ${data.deletedLogs} logs deleted`
      );
    } catch (error) {
      showMessage("error", "Failed to run cleanup");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Scraper Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold mb-2">Manual Scrape</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Trigger a manual scrape of all venues for the next 7 days. This will also notify
            users of any newly available slots.
          </p>
        </div>
        <button
          onClick={handleRunScrape}
          disabled={loading === "scrape"}
          className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading === "scrape" ? "Starting..." : "Run Scrape Now"}
        </button>
        <p className="mt-3 text-xs text-gray-500">
          Note: The scrape runs automatically on a schedule. Only use this if you need immediate
          results.
        </p>
      </div>

      {/* Cleanup Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold mb-2">Database Cleanup</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Remove old slot data and notification logs to keep the database lean. This runs
            automatically after each scrape.
          </p>
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium">Delete data older than:</label>
            <input
              type="number"
              min="1"
              max="90"
              value={cleanupDays}
              onChange={(e) => setCleanupDays(parseInt(e.target.value, 10) || 7)}
              className="w-20 p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
            />
            <span className="text-sm">days</span>
          </div>
        </div>
        <button
          onClick={handleRunCleanup}
          disabled={loading === "cleanup"}
          className="px-6 py-2 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading === "cleanup" ? "Running..." : "Run Cleanup Now"}
        </button>
        <p className="mt-3 text-xs text-gray-500">
          Warning: This will permanently delete old data. Make sure to export data first if needed.
        </p>
      </div>

      {/* Environment Info */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold mb-4">System Information</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b dark:border-gray-700">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Node Environment</span>
            <span className="text-sm">{process.env.NODE_ENV || "production"}</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b dark:border-gray-700">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Auto Cleanup</span>
            <span className="text-sm">After each scrape (keeps last 7 days by default)</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Cron Schedule</span>
            <span className="text-sm">Configured in hosting platform (Railway/cron-job.org)</span>
          </div>
        </div>
      </div>

      {/* Venue Management */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Venue Management</h2>
          <button
            onClick={() => setShowVenueForm(true)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 text-sm"
          >
            + Add Venue
          </button>
        </div>
        <div className="space-y-2">
          {venues.map((venue) => (
            <div key={venue.id} className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-900 rounded">
              <div>
                <p className="font-medium text-sm">{venue.name}</p>
                <p className="text-xs text-gray-500">{venue.slug} • {venue.type}</p>
              </div>
              <button
                onClick={() => handleDeleteVenue(venue.id, venue.name)}
                className="px-3 py-1 text-xs bg-red-100 dark:bg-red-900 hover:bg-red-200 dark:hover:bg-red-800 rounded"
              >
                Delete
              </button>
            </div>
          ))}
          {venues.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-4">No venues configured</p>
          )}
        </div>
      </div>

      {/* System Logs */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Recent System Logs</h2>
          <button
            onClick={fetchLogs}
            className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
          >
            Refresh
          </button>
        </div>
        {loadingLogs ? (
          <div className="text-center text-gray-500 text-sm py-4">Loading logs...</div>
        ) : logs.length > 0 ? (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {logs.map((log) => (
              <div key={log.id} className="text-xs p-2 bg-gray-50 dark:bg-gray-900 rounded font-mono">
                <div className="flex items-start gap-2">
                  <span className="text-gray-500">{new Date(log.timestamp).toLocaleString()}</span>
                  <span className={`px-1 rounded ${
                    log.level === "error" ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                    log.level === "warn" ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300" :
                    "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                  }`}>{log.level}</span>
                  <span className="flex-1">{log.message}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 text-center py-4">No recent logs</p>
        )}
      </div>

      {/* Add Venue Modal */}
      {showVenueForm && (
        <AddVenueModal
          onClose={() => setShowVenueForm(false)}
          onSubmit={handleAddVenue}
        />
      )}
    </div>
  );
}

function AddVenueModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (venueData: any) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [type, setType] = useState("clubspark");
  const [clubsparkHost, setClubsparkHost] = useState("");
  const [clubsparkId, setClubsparkId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) {
      alert("Name and slug are required");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        slug: slug.trim(),
        type,
        clubsparkHost: type === "clubspark" ? clubsparkHost.trim() : null,
        clubsparkId: type === "clubspark" ? clubsparkId.trim() : null,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b dark:border-gray-700">
          <h2 className="text-xl font-semibold">Add New Venue</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Venue Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Victoria Park"
              className="w-full p-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Slug *</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="victoria-park"
              className="w-full p-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600"
              required
            />
            <p className="text-xs text-gray-500 mt-1">URL-friendly identifier (e.g., victoria-park)</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Type *</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full p-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600"
            >
              <option value="clubspark">ClubSpark</option>
              <option value="courtside">Courtside</option>
            </select>
          </div>

          {type === "clubspark" && (
            <>
              <div>
                <label className="block text-sm font-medium mb-2">ClubSpark Host</label>
                <input
                  type="text"
                  value={clubsparkHost}
                  onChange={(e) => setClubsparkHost(e.target.value)}
                  placeholder="clubspark.lta.org.uk"
                  className="w-full p-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">ClubSpark ID</label>
                <input
                  type="text"
                  value={clubsparkId}
                  onChange={(e) => setClubsparkId(e.target.value)}
                  placeholder="12345"
                  className="w-full p-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600"
                />
              </div>
            </>
          )}

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
              {submitting ? "Adding..." : "Add Venue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AdminDatabase({ showMessage }: { showMessage: (type: "success" | "error", text: string) => void }) {
  const [dbStats, setDbStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchDbStats();
  }, []);

  const fetchDbStats = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/database/stats");
      const data = await res.json();
      setDbStats(data.stats);
    } catch (error) {
      console.error("Failed to fetch DB stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/admin/database/export");
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `database-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      showMessage("success", "Database exported successfully");
    } catch (error) {
      showMessage("error", "Failed to export database");
    } finally {
      setExporting(false);
    }
  };

  const handleVacuum = async () => {
    if (!confirm("Run VACUUM on the database? This will optimize the database file size.")) {
      return;
    }

    try {
      const res = await fetch("/api/admin/database/vacuum", {
        method: "POST",
      });

      if (!res.ok) throw new Error("Vacuum failed");

      await fetchDbStats();
      showMessage("success", "Database vacuumed successfully");
    } catch (error) {
      showMessage("error", "Failed to vacuum database");
    }
  };

  if (loading) {
    return <div className="p-4 text-center text-gray-500">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Database Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4">
          <div className="text-2xl font-bold mb-1">{dbStats?.tables?.users || 0}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Total Users</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4">
          <div className="text-2xl font-bold mb-1">{dbStats?.tables?.watches || 0}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Total Watches</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4">
          <div className="text-2xl font-bold mb-1">{dbStats?.tables?.slots || 0}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Total Slots</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4">
          <div className="text-2xl font-bold mb-1">{dbStats?.tables?.notificationLog || 0}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Notification Logs</div>
        </div>
      </div>

      {/* Database Operations */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold mb-4">Database Operations</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border dark:border-gray-700 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Export Database</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Download a complete JSON backup of the database
            </p>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
            >
              {exporting ? "Exporting..." : "Export to JSON"}
            </button>
          </div>

          <div className="border dark:border-gray-700 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Vacuum Database</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              Optimize database file size by reclaiming unused space
            </p>
            <button
              onClick={handleVacuum}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm"
            >
              Run VACUUM
            </button>
          </div>
        </div>
      </div>

      {/* Database Info */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold mb-4">Database Information</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b dark:border-gray-700">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Database Type</span>
            <span className="text-sm">SQLite</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b dark:border-gray-700">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">ORM</span>
            <span className="text-sm">Drizzle ORM</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b dark:border-gray-700">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Database File</span>
            <span className="text-sm font-mono text-xs">sqlite.db</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Last Backup</span>
            <span className="text-sm text-gray-500">Export to create backup</span>
          </div>
        </div>
      </div>

      {/* Table Details */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold mb-4">Table Details</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Table Name</th>
                <th className="px-4 py-2 text-right font-medium">Row Count</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {Object.entries(dbStats?.tables || {}).map(([table, count]) => (
                <tr key={table}>
                  <td className="px-4 py-2 font-mono text-xs">{table}</td>
                  <td className="px-4 py-2 text-right">{count as number}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
