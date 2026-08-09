"use client";

import { Suspense, useEffect, useState, Fragment, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { courtLabelImpliesCoaching } from "@/lib/coaching-label";
import { dayTimesToLabels } from "@/lib/time";
import { VENUES } from "@/lib/constants";
import { getBookingUrl } from "@/lib/utils/link-helpers";
import { SiteNav } from "@/components/layout/SiteNav";

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

interface Match {
  slotKey: string;
  sentAt: string;
  venueSlug: string;
  venueName: string;
  date: string;
  time: string;
  court: string;
  currentStatus: "available" | "booked" | "closed" | "coaching" | "expired" | "unknown";
  isExpired: boolean;
}

interface AdminStats {
  totalUsers: number;
  allowedUsers: number;
  activeWatches: number;
  totalWatches: number;
  totalNotifications: number;
  pendingRequests: number;
  totalVenues: number;
  totalSlots: number;
  totalChannels: number;
}

interface AdminNotification {
  id: number;
  slotKey: string;
  sentAt: string;
}

interface AdminUser {
  id: number;
  email: string;
  name: string | null;
  isAllowed: number;
  isAdmin: number;
  createdAt: string;
  watchCount: number;
  channelCount: number;
}

interface AdminUserDetails {
  watches: Watch[];
  channels: Channel[];
}

interface AdminVenue {
  id: number;
  slug: string;
  name: string;
  type?: string;
  clubsparkHost?: string;
  clubsparkId?: string;
}

interface VenueFormData {
  name: string;
  slug: string;
  type: string;
  clubsparkHost: string | null;
  clubsparkId: string | null;
}

interface RegistrationRequest {
  id: number;
  email: string;
  name: string | null;
  reason: string | null;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
}

interface SystemLog {
  id: number;
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

interface DbStats {
  tables: {
    users: number;
    watches: number;
    slots: number;
    notificationLog: number;
    venues: number;
    channels: number;
  };
  databaseSize?: string;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

const DASHBOARD_DAYS = 9;

function getNextDays(): string[] {
  const dates: string[] = [];
  const today = new Date();

  for (let i = 0; i < DASHBOARD_DAYS; i++) {
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
      const dates = getNextDays();
      return prefs.selectedDate && dates.includes(prefs.selectedDate) 
        ? prefs.selectedDate 
        : dates[0];
    }
    return getNextDays()[0];
  });

  const [availability, setAvailability] = useState<VenueAvailability | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [venueDropdownOpen, setVenueDropdownOpen] = useState(false);

  // Management state
  const [watches, setWatches] = useState<Watch[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [alertsPage, setAlertsPage] = useState(0);
  const ALERTS_PER_PAGE = 10;
  const [loadingWatches, setLoadingWatches] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);
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

  // Ref for scrolling to alerts panel
  const alertsRef = useRef<HTMLDivElement>(null);

  // Available time slots
  const TIME_SLOTS = [
    "7am", "8am", "9am", "10am", "11am", "12pm",
    "1pm", "2pm", "3pm", "4pm", "5pm", "6pm",
    "7pm", "8pm", "9pm", "10pm",
  ];

  const dates = getNextDays();
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
  const fetchWatches = useCallback(async () => {
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
              // The API stores canonical HH:MM; this picker works in am/pm labels,
              // so map every time back to its label on hydration ("19:00" → "7pm").
              dayTimes: (dayTimesToLabels(w.dayTimes) as Watch["dayTimes"]) || {
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
  }, [status]);

  const fetchChannels = useCallback(async () => {
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
  }, [status]);

  const fetchMatches = useCallback(async () => {
    if (status !== "authenticated") return;

    setLoadingMatches(true);
    try {
      const res = await fetch("/api/user/matches");
      const data = await res.json();
      if (data.matches) {
        setMatches(data.matches);
      }
    } catch (error) {
      console.error("Failed to fetch matches:", error);
    } finally {
      setLoadingMatches(false);
    }
  }, [status]);

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

  // Fetch watches, channels, and matches for authenticated users
  useEffect(() => {
    if (status !== "authenticated") return;
    fetchWatches();
    fetchChannels();
    fetchMatches();
  }, [status, fetchWatches, fetchChannels, fetchMatches]);

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
    } catch (error) {
      showMessage("error", getErrorMessage(error));
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
    } catch (error) {
      showMessage("error", getErrorMessage(error));
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
    } catch (error) {
      showMessage("error", getErrorMessage(error));
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
    } catch (error) {
      showMessage("error", getErrorMessage(error));
    }
  };

  // Bulk operations
  const handleBulkDelete = async () => {
    if (selectedWatchIds.size === 0) return;
    const count = selectedWatchIds.size;
    if (!confirm(`Are you sure you want to delete ${count} watch${count > 1 ? 'es' : ''}?`)) return;

    try {
      const results = await Promise.allSettled(
        Array.from(selectedWatchIds).map(id =>
          fetch(`/api/watches/${id}`, { method: "DELETE" })
        )
      );

      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      await fetchWatches();
      setSelectedWatchIds(new Set());
      setSelectionMode(false);

      if (succeeded > 0) {
        showMessage("success", `Deleted ${succeeded} watch${succeeded > 1 ? 'es' : ''} successfully${failed > 0 ? ` (${failed} failed)` : ''}!`);
      } else {
        showMessage("error", "Failed to delete watches");
      }
    } catch (error) {
      showMessage("error", error instanceof Error ? error.message : "Failed to delete watches");
    }
  };

  const handleBulkToggle = async (activate: boolean) => {
    if (selectedWatchIds.size === 0) return;

    try {
      const results = await Promise.allSettled(
        Array.from(selectedWatchIds).map(id =>
          fetch(`/api/watches/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: activate }),
          })
        )
      );

      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      await fetchWatches();
      setSelectedWatchIds(new Set());

      if (succeeded > 0) {
        showMessage("success", `${activate ? 'Activated' : 'Paused'} ${succeeded} watch${succeeded > 1 ? 'es' : ''} successfully${failed > 0 ? ` (${failed} failed)` : ''}!`);
      } else {
        showMessage("error", `Failed to ${activate ? 'activate' : 'pause'} watches`);
      }
    } catch (error) {
      showMessage("error", error instanceof Error ? error.message : `Failed to ${activate ? 'activate' : 'pause'} watches`);
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
    try {
      const results = await Promise.allSettled(
        Array.from(selectedWatchIds).map(id =>
          fetch(`/api/watches/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dayTimes }),
          })
        )
      );

      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      await fetchWatches();
      setSelectedWatchIds(new Set());
      setBulkEditMode(false);

      if (succeeded > 0) {
        showMessage("success", `Updated ${succeeded} watch${succeeded > 1 ? 'es' : ''} successfully${failed > 0 ? ` (${failed} failed)` : ''}!`);
      } else {
        showMessage("error", "Failed to update watches");
      }
    } catch (error) {
      showMessage("error", error instanceof Error ? error.message : "Failed to update watches");
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
    } catch (error) {
      showMessage("error", getErrorMessage(error));
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
    } catch (error) {
      showMessage("error", getErrorMessage(error));
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
    } catch (error) {
      showMessage("error", getErrorMessage(error));
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
    } catch (error) {
      showMessage("error", getErrorMessage(error));
    }
  };

  // Check if a time/venue/date matches any of the user's active watches
  function slotMatchesWatch(time: string, venueSlug: string, dateStr: string): boolean {
    if (!watches.length) return false;
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();
    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
    const dayName = dayNames[dayOfWeek];

    return watches.some((watch) => {
      if (!watch.active) return false;
      if (watch.venueSlug !== null && watch.venueSlug !== venueSlug) return false;
      const dayPrefs: string[] = watch.dayTimes[dayName] || [];
      return dayPrefs.some((t) => t.toLowerCase().trim() === time.toLowerCase().trim());
    });
  }

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

      // Courtside: "Group coaching" in court label but missing coaching/class CSS → stored as closed
      const status =
        slot.status === "closed" && courtLabelImpliesCoaching(slot.court)
          ? "coaching"
          : slot.status;
      
      if (status === "available") {
        slotsByTimeAndVenue[time][venueSlug].available++;
        // Extract numeric price from string like "£10.00"
        if (slot.price) {
          const priceMatch = slot.price.match(/[\d.]+/);
          if (priceMatch) {
            slotsByTimeAndVenue[time][venueSlug].prices.push(parseFloat(priceMatch[0]));
          }
        }
      } else if (status === "booked") {
        slotsByTimeAndVenue[time][venueSlug].booked++;
      } else if (status === "closed") {
        slotsByTimeAndVenue[time][venueSlug].closed++;
      } else if (status === "coaching") {
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
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <div className="flex items-center gap-2 text-[var(--text-2)]">
          <span className="inline-block w-4 h-4 rounded-full border-2 border-[var(--green)] border-t-transparent animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  // Don't render if unauthenticated and not guest
  if (status === "unauthenticated" && !isGuest) {
    return null;
  }

  // Map activeTab → SiteNav tab id
  const navTabMap: Record<string, "courts" | "alerts" | "settings" | "admin"> = {
    availability: "courts",
    settings: "settings",
    admin: "admin",
  };
  const dashTabMap: Record<string, "availability" | "settings" | "admin"> = {
    courts: "availability",
    alerts: "availability", // alerts shown on courts tab
    settings: "settings",
    admin: "admin",
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      {/* Sticky top nav with integrated tabs */}
      <SiteNav
        userEmail={isAuthenticated ? session?.user?.email : null}
        isAdmin={isAdmin}
        isGuest={isGuest}
        activeTab={navTabMap[activeTab] ?? "courts"}
        onTabChange={(tab) => {
          if (tab === "alerts") {
            // Switch to courts tab and scroll to alerts panel
            setActiveTab("availability");
            router.push("/dashboard?tab=availability", { scroll: false });
            setTimeout(() => {
              alertsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 100);
            return;
          }
          const dashTab = dashTabMap[tab] ?? "availability";
          setActiveTab(dashTab);
          if (dashTab === "admin") {
            router.push("/dashboard?tab=admin&adminTab=overview", { scroll: false });
          } else {
            router.push(`/dashboard?tab=${dashTab}`, { scroll: false });
          }
        }}
      />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Guest banner */}
      {isGuest && (
        <div className="mb-6 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-between gap-4">
          <p className="text-sm text-amber-400">
            Browsing as guest — no notifications or saved preferences.
          </p>
          <Link
            href="/login"
            className="shrink-0 px-3 py-1.5 bg-[var(--green)] text-black rounded-lg text-xs font-semibold hover:bg-green-400 transition-all duration-150"
          >
            Sign in
          </Link>
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
                className="w-full p-2 border rounded-lg bg-[var(--surface)] text-left flex items-center justify-between hover:bg-[var(--surface)] transition-colors"
              >
                <span className="text-sm text-[var(--text)]">
                  {selectedVenues.length === 0
                    ? "Select venues..."
                    : selectedVenues.length === 1
                    ? VENUES.find((v) => v.slug === selectedVenues[0])?.name || "Select venues..."
                    : `${selectedVenues.length} venues selected`}
                </span>
                <svg
                  className={`w-5 h-5 text-[var(--text-2)] transition-transform ${
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
                  <div className="absolute z-20 w-full mt-1 bg-[var(--surface)] border rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    <div className="p-2">
                      {/* Select All Checkbox */}
                      <label
                        className="flex items-center gap-2 p-2 rounded hover:bg-[var(--surface)] cursor-pointer border-b border-[var(--border)] mb-1"
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
                          className="w-4 h-4 text-green-600 border-[var(--border)] rounded focus:ring-green-500"
                        />
                        <span className="text-sm font-medium text-[var(--text)]">
                          All Venues
                        </span>
                      </label>

                      {VENUES.map((venue) => {
                        const isSelected = selectedVenues.includes(venue.slug);
                        return (
                          <label
                            key={venue.slug}
                            className="flex items-center gap-2 p-2 rounded hover:bg-[var(--surface)] cursor-pointer"
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
                              className="w-4 h-4 text-green-600 border-[var(--border)] rounded focus:ring-green-500"
                            />
                            <span className="text-sm text-[var(--text)]">
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
                        className="inline-flex items-center gap-1 px-2 py-1 bg-[var(--green)]/10 text-[var(--green)] rounded text-xs"
                      >
                        {venue.name}
                        <button
                          onClick={() => {
                            setSelectedVenues(
                              selectedVenues.filter((v) => v !== venueSlug)
                            );
                          }}
                          className="hover:text-green-600"
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
            <label className="block text-xs font-medium text-[var(--text-3)] uppercase tracking-widest mb-2">Date</label>
            <div className="flex gap-2 flex-wrap">
              {dates.map((date) => (
                <button
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer ${
                    selectedDate === date
                      ? "bg-[var(--green)] text-black shadow-[0_0_12px_rgba(34,197,94,0.2)]"
                      : "bg-[var(--surface)] border border-[var(--border)] text-[var(--text-2)] hover:border-[var(--text-3)] hover:text-[var(--text)]"
                  }`}
                >
                  {formatDate(date)}
                </button>
              ))}
            </div>
          </div>

          {/* Availability table */}
          <div className="border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="bg-[var(--surface)] px-4 py-3 border-b border-[var(--border)]">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="font-semibold text-[var(--text)]">Availability</h2>
                  <p className="text-xs text-[var(--text-3)] font-[family-name:var(--font-mono)] mt-0.5">{formatDate(selectedDate)}</p>
                </div>
                {availability?.lastUpdated && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--surface-2)] rounded-full border border-[var(--border)]">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--green)] opacity-60"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--green)]"></span>
                    </span>
                    <span className="text-xs font-[family-name:var(--font-mono)] text-[var(--text-3)]">
                      {new Date(availability.lastUpdated).toLocaleString("en-GB", {
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
              <div className="p-8 text-center flex items-center justify-center gap-2 text-[var(--text-2)]">
                <span className="inline-block w-4 h-4 rounded-full border-2 border-[var(--green)] border-t-transparent animate-spin" />
                Loading courts...
              </div>
            ) : selectedVenueInfo.length === 0 ? (
              <div className="p-8 text-center text-[var(--text-3)]">
                Select at least one venue above
              </div>
            ) : sortedTimes.length === 0 ? (
              <div className="p-8 text-center text-[var(--text-3)]">
                No data yet — check back after the next scrape.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full" style={{ tableLayout: "fixed", minWidth: "600px" }}>
                  <colgroup>
                    <col style={{ width: "76px" }} />
                    {selectedVenueInfo.map((venue) => (
                      <col key={venue.slug} style={{ width: "150px" }} />
                    ))}
                  </colgroup>
                  <thead className="bg-[var(--surface-2)] border-b border-[var(--border)]">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-[var(--text-3)] uppercase tracking-widest sticky left-0 bg-[var(--bg)] z-10 border-r border-[var(--border)]">
                        Time
                      </th>
                      {selectedVenueInfo.map((venue) => (
                        <th
                          key={venue.slug}
                          className="px-4 py-2.5 text-center text-xs font-semibold text-[var(--text-2)] uppercase tracking-widest"
                        >
                          {venue.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {sortedTimes.map((time) => {
                      return (
                      <tr key={time} className="transition-colors duration-100 hover:bg-[var(--surface)]">
                        <td className="px-4 py-2.5 sticky left-0 z-10 border-r border-[var(--border)] bg-[var(--bg)] text-[var(--text-2)]">
                          <span className="font-[family-name:var(--font-mono)] text-sm tabular-nums">{time}</span>
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

                          let statusClass = "bg-transparent text-[var(--text-3)] border border-transparent";
                          let statusText = "—";
                          let showCount = false;
                          let statusCount = 0;
                          let minPrice: number | null = null;

                          if (hasAvailable) {
                            statusClass = "bg-[var(--green)]/10 border border-[var(--green)]/30 text-[var(--green)]";
                            statusText = "Available";
                            statusCount = venueData.available;
                            showCount = true;
                            if (venueData.prices.length > 0) {
                              minPrice = Math.min(...venueData.prices);
                            }
                          } else if (isCoaching) {
                            statusClass = "bg-blue-500/10 border border-blue-500/20 text-blue-400";
                            statusText = "Coaching";
                          } else if (isBooked) {
                            statusClass = "bg-red-500/10 border border-red-500/20 text-red-400/70";
                            statusText = "Booked";
                          } else if (isClosed) {
                            statusClass = "bg-[var(--surface)] border border-[var(--border-subtle)] text-[var(--text-3)]";
                            statusText = "Closed";
                          }

                          const cellMatchesWatch =
                            hasAvailable &&
                            isAuthenticated &&
                            slotMatchesWatch(time, venue.slug, selectedDate);

                          const cellContent = (
                            <div
                              className={`relative px-2 py-2 rounded-lg text-center text-xs font-medium min-h-[52px] flex flex-col justify-center gap-0.5 ${statusClass}`}
                            >
                              {cellMatchesWatch && (
                                <span
                                  title="Your watch covers this time — courts available to book"
                                  className="absolute top-1.5 right-1.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[var(--green)] text-black text-[8px] font-bold z-10 pointer-events-none"
                                >
                                  ★
                                </span>
                              )}
                              <div className="font-semibold">{statusText}</div>
                              {showCount && total > 0 && (
                                <div className="opacity-70">
                                  <div className="font-[family-name:var(--font-mono)]">{statusCount} court{statusCount !== 1 ? "s" : ""}</div>
                                  {minPrice !== null && (
                                    <div className="text-[10px]">from £{minPrice.toFixed(2)}</div>
                                  )}
                                </div>
                              )}
                            </div>
                          );

                          return (
                            <td key={venue.slug} className="px-2 py-2">
                              {hasAvailable ? (
                                <a
                                  href={getBookingUrl(venue.slug, selectedDate)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block hover:scale-[1.02] transition-transform duration-100 cursor-pointer"
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
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-[var(--green)]/30 border border-[var(--green)]/50"></div>
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
              <div className="w-3 h-3 rounded bg-[var(--surface-3)] border border-[var(--border)]"></div>
              <span>Closed</span>
            </div>
            {isAuthenticated && watches.some(w => w.active) && (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[var(--green)] text-black text-[8px] font-bold">★</span>
                <span>Watch match — bookable</span>
              </div>
            )}
          </div>

          {/* Quick book links */}
          {selectedVenues.length > 0 && (
            <div className="mt-6 flex items-center gap-3 flex-wrap">
              <span className="text-xs text-[var(--text-3)] uppercase tracking-widest">Quick book:</span>
              {selectedVenues.map((venueSlug) => {
                const venue = VENUES.find((v) => v.slug === venueSlug);
                if (!venue) return null;
                return (
                  <a
                    key={venueSlug}
                    href={getBookingUrl(venueSlug, selectedDate)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--green)] hover:text-[var(--green)] rounded-lg text-xs font-medium transition-all duration-150"
                  >
                    {venue.name}
                    <svg className="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                );
              })}
            </div>
          )}

          {/* My Recent Alerts — always visible below the table for authenticated users */}
          {isAuthenticated && (
            <div className="mt-8" ref={alertsRef}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-[var(--text)] uppercase tracking-widest">Recent Alerts</h2>
                {matches.length > 0 && (
                  <span className="text-xs text-[var(--text-3)]">
                    {alertsPage * ALERTS_PER_PAGE + 1}–{Math.min((alertsPage + 1) * ALERTS_PER_PAGE, matches.length)} of {matches.length}
                  </span>
                )}
              </div>
              {loadingMatches ? (
                <div className="flex items-center gap-2 py-4 text-[var(--text-3)] text-sm">
                  <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-[var(--green)] border-t-transparent animate-spin" />
                  Loading alerts...
                </div>
              ) : matches.length === 0 ? (
                <div className="py-6 border border-dashed border-[var(--border)] rounded-xl text-center text-sm text-[var(--text-3)]">
                  No alerts yet.{" "}
                  <button
                    onClick={() => {
                      setActiveTab("settings");
                      router.push("/dashboard?tab=settings", { scroll: false });
                    }}
                    className="text-[var(--green)] hover:underline cursor-pointer"
                  >
                    Set up a watch
                  </button>
                  {" "}to get notified when slots open.
                </div>
              ) : (
                <div className="border border-[var(--border)] rounded-xl overflow-hidden">
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {matches.slice(alertsPage * ALERTS_PER_PAGE, (alertsPage + 1) * ALERTS_PER_PAGE).map((match) => {
                      const isAvailable = match.currentStatus === "available";
                      const isExpired = match.isExpired || match.currentStatus === "expired";
                      const isTaken = !isAvailable && !isExpired;

                      return (
                        <div key={match.slotKey} className="flex items-center justify-between px-4 py-3 gap-3 hover:bg-[var(--surface)] transition-colors duration-100">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm text-[var(--text)]">{match.venueName}</span>
                              <span className="text-[var(--border)] text-xs">·</span>
                              <span className="text-sm text-[var(--text-2)] font-[family-name:var(--font-mono)]">
                                {new Date(match.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                              </span>
                              <span className="text-[var(--border)] text-xs">·</span>
                              <span className="text-sm font-[family-name:var(--font-mono)] text-[var(--text-2)]">{match.time}</span>
                              <span className="text-xs text-[var(--text-3)] truncate max-w-[120px] font-[family-name:var(--font-mono)]">{match.court}</span>
                            </div>
                            <div className="text-xs text-[var(--text-3)] mt-0.5">
                              Alerted {new Date(match.sentAt!).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {isAvailable ? (
                              <>
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--green)]/10 text-[var(--green)] border border-[var(--green)]/20">
                                  Available
                                </span>
                                <a
                                  href={getBookingUrl(match.venueSlug, match.date)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-3 py-1.5 bg-[var(--green)] text-black rounded-lg text-xs font-semibold hover:bg-green-400 transition-all duration-150 shadow-[0_0_8px_rgba(34,197,94,0.2)]"
                                >
                                  Book Now
                                </a>
                              </>
                            ) : isExpired ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--surface-2)] text-[var(--text-3)] border border-[var(--border)]">
                                Expired
                              </span>
                            ) : isTaken ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                                Taken
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--surface-2)] text-[var(--text-3)] border border-[var(--border)]">
                                Unknown
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {matches.length > ALERTS_PER_PAGE && (
                    <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--border)] bg-[var(--surface)]">
                      <button
                        onClick={() => setAlertsPage((p) => Math.max(0, p - 1))}
                        disabled={alertsPage === 0}
                        className="flex items-center gap-1 text-xs text-[var(--text-2)] hover:text-[var(--text)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                        </svg>
                        Prev
                      </button>
                      <span className="text-xs text-[var(--text-3)]">
                        Page {alertsPage + 1} / {Math.ceil(matches.length / ALERTS_PER_PAGE)}
                      </span>
                      <button
                        onClick={() => setAlertsPage((p) => Math.min(Math.ceil(matches.length / ALERTS_PER_PAGE) - 1, p + 1))}
                        disabled={(alertsPage + 1) * ALERTS_PER_PAGE >= matches.length}
                        className="flex items-center gap-1 text-xs text-[var(--text-2)] hover:text-[var(--text)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        Next
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              )}
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
              className={`px-4 py-3 rounded-xl border text-sm ${
                message.type === "success"
                  ? "bg-[var(--green)]/10 border-[var(--green)]/20 text-[var(--green)]"
                  : "bg-red-500/10 border-red-500/20 text-red-400"
              }`}
            >
              <p
                className={`text-sm ${
                  message.type === "success"
                    ? "text-[var(--green)]"
                    : "text-red-400"
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
                <p className="text-sm text-[var(--text-2)] mt-1">
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
                      ? "bg-[var(--green)] text-black hover:bg-green-400"
                      : "bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--surface-3)]"
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
                  className="flex items-center gap-2 px-4 py-2 bg-[var(--green)] text-black rounded-lg font-semibold hover:bg-green-400 transition-colors text-sm"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add
                </button>
              </div>
            </div>

            {loadingWatches ? (
              <div className="p-4 text-center text-[var(--text-2)]">Loading...</div>
            ) : watches.length === 0 ? (
              <div className="p-6 border border-dashed rounded-xl text-center">
                <p className="text-[var(--text-2)] mb-4">No watches configured yet.</p>
                <button
                  onClick={() => {
                    setEditingWatch(null);
                    setShowWatchForm(true);
                  }}
                  className="px-4 py-2 bg-[var(--green)] text-black rounded-lg font-semibold hover:bg-green-400 transition-colors text-sm"
                >
                  Create Your First Watch
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Bulk Actions Bar */}
                {selectionMode && selectedWatchIds.size > 0 && (
                  <div className="sticky top-0 z-10 bg-[var(--surface)] border-2 border-[var(--green)] rounded-lg p-4 shadow-lg">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-[var(--text)]">
                          {selectedWatchIds.size} watch{selectedWatchIds.size > 1 ? 'es' : ''} selected
                        </span>
                        <button
                          onClick={clearSelection}
                          className="text-xs text-[var(--text-2)] hover:text-[var(--text)]"
                        >
                          Clear selection
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleBulkToggle(true)}
                          className="px-3 py-1.5 text-xs bg-[var(--green)]/10 hover:bg-[var(--green)]/20 text-[var(--green)] rounded-lg font-medium transition-colors"
                        >
                          Activate All
                        </button>
                        <button
                          onClick={() => handleBulkToggle(false)}
                          className="px-3 py-1.5 text-xs bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] rounded-lg font-medium transition-colors"
                        >
                          Pause All
                        </button>
                        <button
                          onClick={() => setBulkEditMode(true)}
                          className="px-3 py-1.5 text-xs bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] rounded-lg font-medium transition-colors"
                        >
                          Bulk Edit
                        </button>
                        <button
                          onClick={handleBulkDelete}
                          className="px-3 py-1.5 text-xs bg-[var(--red)]/10 hover:bg-[var(--red)]/20 text-[var(--red)] border border-[var(--red)]/20 rounded-lg font-medium transition-colors"
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
                      <div className="w-5 h-5 border-2 rounded-md bg-[var(--surface)] transition-all duration-200 flex items-center justify-center group-hover:border-[var(--green)] peer-focus:ring-1 peer-focus:ring-[var(--green-border)] peer-checked:bg-[var(--green)] peer-checked:border-[var(--green)] peer-indeterminate:bg-[var(--green)] peer-indeterminate:border-[var(--green)] border-[var(--border)]">
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
                      <span className="text-sm text-[var(--text)] font-medium">
                        Select all watches
                      </span>
                    </label>
                  </div>
                )}

                {(() => {
                  /** Single theme for all watches (matches app --green) */
                  const WATCH_DISPLAY_COLOR = {
                    bg: "bg-[var(--green)]",
                    bgLight: "bg-[var(--green-dim)]",
                    border: "border-[var(--green-border)]",
                  } as const;

                  const watchesWithColors = watches.map((watch) => ({
                    ...watch,
                    color: WATCH_DISPLAY_COLOR,
                  })) as Array<Watch & { color: typeof WATCH_DISPLAY_COLOR }>;

                  // Group watches by venue
                  type WatchWithColor = Watch & { color: typeof WATCH_DISPLAY_COLOR };
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
                      <div key={venueName} className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--surface)] border border-[var(--border)]">
                        {/* Venue Header with Watch Legend */}
                        <div className="bg-[var(--surface)] px-4 py-3 border-b border-[var(--border)]">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                              <h3 className="font-semibold text-lg text-[var(--text)]">{venueName}</h3>
                              <span className="text-xs text-[var(--text-2)] bg-[var(--surface)] px-2 py-0.5 rounded-full border border-[var(--border)]">
                                {venueWatches.length} watch{venueWatches.length > 1 ? 'es' : ''}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 mt-2 text-xs text-[var(--text-2)]">
                            <span
                              className="mt-0.5 w-3 h-3 rounded-full bg-[var(--green)] shrink-0"
                              aria-hidden
                            />
                            <span>
                              {venueWatches.map((w, i) => (
                                <span key={w.id}>
                                  {i > 0 ? " · " : ""}
                                  {w.venueName || "Watch"}
                                  {!w.active ? " (paused)" : ""}
                                </span>
                              ))}
                            </span>
                          </div>
                        </div>

                      {/* Calendar View */}
                      <div className="p-4">
                        {sortedTimeSlots.length === 0 ? (
                          <p className="text-sm text-[var(--text-2)] text-center py-8">
                            No times configured for any watch
                          </p>
                        ) : (
                          <div className="overflow-x-auto">
                            <div className="inline-block min-w-full">
                              {/* Calendar Header */}
                              <div className="grid grid-cols-8 gap-1 mb-2">
                                <div className="text-xs font-semibold text-[var(--text-2)] py-2">
                                  Time
                                </div>
                                {DAYS.map((day) => (
                                  <div key={day} className="text-xs font-semibold text-[var(--text)] text-center py-2">
                                    {DAY_LABELS[day]}
                                  </div>
                                ))}
                              </div>

                              {/* Calendar Rows */}
                              <div className="space-y-1">
                                {sortedTimeSlots.map((time) => (
                                  <div key={time} className="grid grid-cols-8 gap-1">
                                    {/* Time Label */}
                                    <div className="text-xs text-[var(--text-2)] py-1.5 flex items-center">
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
                                          className="min-h-[32px] border border-[var(--border)] rounded p-1 flex flex-wrap gap-0.5 items-start"
                                        >
                                          {watchesForThisSlot.map((watch) => {
                                            const isSelected = selectedWatchIds.has(watch.id);
                                            return (
                                              <div
                                                key={watch.id}
                                                className={`flex-1 min-w-[20px] h-6 rounded ${watch.color.bgLight} border ${watch.color.border} flex items-center justify-center cursor-pointer transition-all ${
                                                  isSelected ? "ring-2 ring-[var(--green)] ring-offset-2 ring-offset-[var(--bg)]" : ""
                                                } ${!watch.active ? "opacity-50" : ""}`}
                                                title={`${watch.venueName || 'Watch'} - ${time} ${day}`}
                                                onClick={() => {
                                                  if (selectionMode) {
                                                    toggleWatchSelection(watch.id);
                                                  } else {
                                                    const { color: _color, ...watchWithoutColor } = watch;
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
                        <div className="mt-4 pt-4 border-t border-[var(--border)] flex flex-wrap gap-2">
                          {venueWatches.map((watch) => {
                            const isSelected = selectedWatchIds.has(watch.id);
                            const totalTimeSlots = Object.values(watch.dayTimes)
                              .reduce((sum, times) => sum + times.length, 0);

                            return (
                              <div
                                key={watch.id}
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                                  isSelected
                                    ? "bg-[var(--green-dim)] border-[var(--green)]"
                                    : "bg-[var(--surface)] border-[var(--border)]"
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
                                    <div className={`w-4 h-4 border-2 rounded-md bg-[var(--surface)] transition-all duration-200 flex items-center justify-center peer-focus:ring-2 peer-focus:ring-green-500 peer-focus:ring-offset-1 ${
                                      isSelected
                                        ? "bg-[var(--green)] border-[var(--green)] shadow-sm"
                                        : "border-[var(--border)]"
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
                                      ? "bg-[var(--green)]/10 text-[var(--green)]"
                                      : "bg-[var(--surface-3)] text-[var(--text-2)]"
                                  }`}>
                                    {watch.active ? "Active" : "Paused"}
                                  </span>
                                  {totalTimeSlots > 0 && (
                                    <span className="text-xs text-[var(--text-2)]">
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
                                        ? "bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)]"
                                        : "bg-[var(--green)]/10 hover:bg-[var(--green)]/20 text-[var(--green)]"
                                    }`}
                                    title={watch.active ? "Pause watch" : "Activate watch"}
                                  >
                                    {watch.active ? "Pause" : "Activate"}
                                  </button>
                                  <button
                                    onClick={() => {
                                      const { color: _color, ...watchWithoutColor } = watch;
                                      setEditingWatch(watchWithoutColor);
                                    }}
                                    className="px-2 py-1 text-xs bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] rounded font-medium transition-colors"
                                    title="Edit watch"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleDeleteWatch(watch.id)}
                                    className="px-2 py-1 text-xs bg-[var(--red)]/10 hover:bg-[var(--red)]/20 text-[var(--red)] border border-[var(--red)]/20 rounded font-medium transition-colors"
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
                <p className="text-sm text-[var(--text-2)] mt-1">
                  Choose how you want to receive notifications when courts become
                  available.
                </p>
              </div>
              <button
                onClick={() => {
                  setEditingChannel(null);
                  setShowChannelForm(true);
                }}
                className="px-4 py-2 bg-[var(--green)] text-black rounded-lg font-semibold hover:bg-green-400 transition-colors text-sm"
              >
                + Add Channel
              </button>
            </div>

            {loadingChannels ? (
              <div className="p-4 text-center text-[var(--text-2)]">Loading...</div>
            ) : channels.length === 0 ? (
              <div className="p-6 border border-dashed rounded-xl text-center">
                <p className="text-[var(--text-2)] mb-4">
                  No notification channels configured.
                </p>
                <button
                  onClick={() => {
                    setEditingChannel(null);
                    setShowChannelForm(true);
                  }}
                  className="px-4 py-2 bg-[var(--green)] text-black rounded-lg font-semibold hover:bg-green-400 transition-colors text-sm"
                >
                  Add Your First Channel
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {channels.map((channel) => (
                  <div
                    key={channel.id}
                    className={`p-4 border rounded-lg ${
                      channel.active
                        ? "bg-[var(--surface)]"
                        : "bg-[var(--surface)] opacity-60"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center ${
                            channel.type === "telegram"
                              ? "bg-blue-100"
                              : channel.type === "email"
                                ? "bg-purple-100"
                                : "bg-green-100"
                          }`}
                        >
                          {channel.type === "telegram" && (
                            <span className="text-blue-600">
                              T
                            </span>
                          )}
                          {channel.type === "email" && (
                            <span className="text-purple-600">
                              @
                            </span>
                          )}
                          {channel.type === "whatsapp" && (
                            <span className="text-green-600">
                              W
                            </span>
                          )}
                        </div>
                        <div>
                          <p className="font-medium capitalize">{channel.type}</p>
                          <p className="text-sm text-[var(--text-2)]">
                            {channel.destination}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${
                            channel.active
                              ? "bg-[var(--green)]/10 text-[var(--green)]"
                              : "bg-[var(--surface-2)] text-[var(--text-2)]"
                          }`}
                        >
                          {channel.active ? "Active" : "Paused"}
                        </span>
                        <button
                          onClick={() => handleToggleChannel(channel.id, channel.active)}
                          className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                            channel.active
                              ? "bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)]"
                              : "bg-[var(--green)]/10 hover:bg-[var(--green)]/20 text-[var(--green)]"
                          }`}
                        >
                          {channel.active ? "Pause" : "Activate"}
                        </button>
                        <button
                          onClick={() => setEditingChannel(channel)}
                          className="px-3 py-1 text-xs bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] rounded font-medium transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteChannel(channel.id)}
                          className="px-3 py-1 text-xs bg-[var(--red)]/10 hover:bg-[var(--red)]/20 text-[var(--red)] border border-[var(--red)]/20 rounded font-medium transition-colors"
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
          <div className="flex justify-center gap-2 border-b border-[var(--border)]">
            <button
              onClick={() => {
                setAdminSubTab("overview");
                router.push("/dashboard?tab=admin&adminTab=overview", { scroll: false });
              }}
              className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 -mb-px cursor-pointer ${
                adminSubTab === "overview"
                  ? "border-[var(--green)] text-[var(--green)]"
                  : "border-transparent text-[var(--text-3)] hover:text-[var(--text-2)]"
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
                  ? "border-[var(--green)] text-[var(--green)]"
                  : "border-transparent text-[var(--text-3)] hover:text-[var(--text-2)]"
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
                  ? "border-[var(--green)] text-[var(--green)]"
                  : "border-transparent text-[var(--text-3)] hover:text-[var(--text-2)]"
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
                  ? "border-[var(--green)] text-[var(--green)]"
                  : "border-transparent text-[var(--text-3)] hover:text-[var(--text-2)]"
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
                  ? "border-[var(--green)] text-[var(--green)]"
                  : "border-transparent text-[var(--text-3)] hover:text-[var(--text-2)]"
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
    </div>
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
    // Enable all days that received times
    if (times.length > 0) {
      setEnabledDays(prev => {
        const next = new Set(prev);
        days.forEach(day => next.add(day));
        return next;
      });
    }
  };

  const clearDays = (days: readonly string[]) => {
    setDayTimes(prev => {
      const updated = { ...prev };
      days.forEach(day => {
        updated[day as typeof DAYS[number]] = [];
      });
      return updated;
    });
    // Disable cleared days
    setEnabledDays(prev => {
      const next = new Set(prev);
      days.forEach(day => next.delete(day));
      return next;
    });
  };

  /** Days affected by Quick Presets — matches the All / Weekdays / Weekends tab */
  const getPresetTargetDays = (): readonly (typeof DAYS[number])[] => {
    switch (dayViewTab) {
      case "weekdays":
        return WEEKDAYS;
      case "weekends":
        return WEEKENDS;
      default:
        return DAYS;
    }
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
    applyToDays(getPresetTargetDays(), times);
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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--surface-2)] rounded-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="p-6 border-b border-[var(--border)]">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-semibold">
                {watch ? "Edit Watch" : "Create New Watch"}
              </h2>
              {!watch && (
                <p className="mt-1 text-sm text-[var(--text-2)]">
                  Select venues and times to get notified when slots become available
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-[var(--text-3)] hover:text-[var(--text-2)]"
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
              Select Venues {!watch && <span className="text-[var(--text-2)] font-normal">(select multiple)</span>}
            </label>
            
            {/* Selected venues as chips */}
            {selectedVenues.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {selectedVenues.map((slug) => {
                  const venue = VENUES.find(v => v.slug === slug);
                  return (
                    <span
                      key={slug}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-[var(--green)]/10 text-[var(--green)] rounded-full text-sm"
                    >
                      {venue?.name}
                      {!watch && (
                        <button
                          type="button"
                          onClick={() => removeVenue(slug)}
                          className="ml-1 hover:text-green-600"
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
                    ? 'bg-[var(--surface-2)] border-[var(--border)] cursor-not-allowed opacity-60'
                    : selectedVenues.length > 0
                    ? 'bg-[var(--green-dim)] border-[var(--green-border)] hover:bg-[rgba(34,197,94,0.18)] hover:border-[var(--green)] cursor-pointer'
                    : 'bg-[var(--surface)] border-[var(--border)] hover:border-[var(--green)]/50 cursor-pointer'
                }`}
                disabled={!!watch}
              >
                <span className="text-sm text-[var(--text)]">
                  {selectedVenues.length === 0
                    ? "Click to select venues..."
                    : selectedVenues.length === 1
                    ? VENUES.find((v) => v.slug === selectedVenues[0])?.name || "Select venues..."
                    : `${selectedVenues.length} venues selected`}
                </span>
                <svg
                  className={`w-5 h-5 text-[var(--text-2)] transition-transform ${
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
                    className="absolute w-full mt-1 bg-[var(--surface)] border-2 border-[var(--border)] rounded-lg shadow-xl max-h-80 overflow-hidden flex flex-col"
                    style={{ zIndex: 60 }}
                  >
                    {/* Search input */}
                    <div className="p-2 border-b">
                      <input
                        type="text"
                        placeholder="Search venues..."
                        value={venueSearch}
                        onChange={(e) => setVenueSearch(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:outline-none focus:border-[var(--green)] focus:ring-1 focus:ring-[var(--green-border)]"
                      />
                    </div>
                    
                    <div className="overflow-y-auto max-h-64">
                      <div className="p-2">
                        {/* Select All Checkbox */}
                        <label
                          className="flex items-center gap-2 p-2 rounded hover:bg-[var(--surface)] cursor-pointer border-b border-[var(--border)] mb-1"
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
                            className="w-4 h-4 text-green-600 border-[var(--border)] rounded focus:ring-green-500"
                          />
                          <span className="text-sm font-medium text-[var(--text)]">
                            {venueSearch ? `All (${filteredVenues.length})` : "All Venues"}
                          </span>
                        </label>

                        {filteredVenues.length === 0 ? (
                          <div className="p-4 text-center text-sm text-[var(--text-2)]">
                            No venues found
                          </div>
                        ) : (
                          filteredVenues.map((venue) => {
                            const isSelected = selectedVenues.includes(venue.slug);
                            return (
                              <label
                                key={venue.slug}
                                className="flex items-center gap-2 p-2 rounded hover:bg-[var(--surface)] cursor-pointer"
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
                                  className="w-4 h-4 text-green-600 border-[var(--border)] rounded focus:ring-green-500"
                                />
                                <span className="text-sm text-[var(--text)]">
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
              <p className="mt-2 text-xs text-[var(--text-2)]">
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
                className="px-3 py-1.5 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--surface)] transition-colors"
              >
                🌆 Evening (6pm-10pm)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('morning')}
                className="px-3 py-1.5 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--surface)] transition-colors"
              >
                🌅 Morning (7am-12pm)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('afternoon')}
                className="px-3 py-1.5 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--surface)] transition-colors"
              >
                ☀️ Afternoon (12pm-5pm)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('all-day')}
                className="px-3 py-1.5 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--surface)] transition-colors"
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
                  setDayViewTab("weekdays");
                  const weekdaysTimes = WEEKDAYS.flatMap(day => dayTimes[day]);
                  const mostCommonTimes = weekdaysTimes.length > 0 
                    ? [...new Set(weekdaysTimes)].sort()
                    : ['6pm', '7pm', '8pm'];
                  applyToDays(WEEKDAYS, mostCommonTimes);
                }}
                className="px-3 py-1.5 text-sm bg-blue-50 text-blue-700 border border-blue-300 rounded-lg hover:bg-blue-100 transition-colors"
              >
                Apply to Weekdays
              </button>
              <button
                type="button"
                onClick={() => {
                  setDayViewTab("weekends");
                  const weekendTimes = WEEKENDS.flatMap(day => dayTimes[day]);
                  const mostCommonTimes = weekendTimes.length > 0 
                    ? [...new Set(weekendTimes)].sort()
                    : ['9am', '10am', '11am', '12pm', '1pm', '2pm'];
                  applyToDays(WEEKENDS, mostCommonTimes);
                }}
                className="px-3 py-1.5 text-sm bg-purple-50 text-purple-700 border border-purple-300 rounded-lg hover:bg-purple-100 transition-colors"
              >
                Apply to Weekends
              </button>
              <button
                type="button"
                onClick={() => clearDays(DAYS)}
                className="px-3 py-1.5 text-sm bg-red-50 text-red-700 border border-red-300 rounded-lg hover:bg-red-100 transition-colors"
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
              <div className="flex gap-1 bg-[var(--surface-2)] p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setDayViewTab('all')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    dayViewTab === 'all'
                      ? 'bg-[var(--surface)] text-[var(--text)] shadow-sm'
                      : 'text-[var(--text-2)] hover:text-[var(--text)]'
                  }`}
                >
                  All Days
                </button>
                <button
                  type="button"
                  onClick={() => setDayViewTab('weekdays')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    dayViewTab === 'weekdays'
                      ? 'bg-[var(--surface)] text-[var(--text)] shadow-sm'
                      : 'text-[var(--text-2)] hover:text-[var(--text)]'
                  }`}
                >
                  Weekdays
                </button>
                <button
                  type="button"
                  onClick={() => setDayViewTab('weekends')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    dayViewTab === 'weekends'
                      ? 'bg-[var(--surface)] text-[var(--text)] shadow-sm'
                      : 'text-[var(--text-2)] hover:text-[var(--text)]'
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
                  <div key={day} className={`border-2 rounded-lg p-4 transition-all ${
                    isEnabled 
                      ? 'bg-[var(--surface)] hover:border-green-400' 
                      : 'bg-[var(--surface)] border-[var(--border)] opacity-60'
                  }`}>
                    {/* Day Header with Toggle */}
                    <div className="flex items-center justify-between mb-3 pb-2 border-b">
                      <div className="flex items-center gap-2 flex-1">
                        {/* Day Toggle */}
                        <button
                          type="button"
                          onClick={() => toggleDay(day)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:outline-none focus:border-[var(--green)] focus:ring-1 focus:ring-[var(--green-border)]  ${
                            isEnabled
                              ? 'bg-[var(--green)]'
                              : 'bg-[var(--surface-3)]'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-[var(--surface)] transition-transform ${
                              isEnabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                        <div className="flex items-center gap-2">
                          <h3 className={`text-sm font-semibold ${isEnabled ? '' : 'text-[var(--text-3)]'}`}>
                            {DAY_LABELS[day]}
                          </h3>
                          {selectedCount > 0 && isEnabled && (
                            <span className="px-2 py-0.5 bg-[var(--green)]/10 text-[var(--green)] rounded-full text-xs font-medium">
                              {selectedCount}
                            </span>
                          )}
                        </div>
                      </div>
                      {selectedCount > 0 && isEnabled && (
                        <button
                          type="button"
                          onClick={() => setDayTimes(prev => ({ ...prev, [day]: [] }))}
                          className="text-xs text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors"
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
                            className="px-2 py-1 text-xs border border-[var(--border)] rounded hover:bg-[var(--surface)] transition-colors"
                          >
                            + Evening
                          </button>
                          <button
                            type="button"
                            onClick={() => selectTimeRange(day, '7am', '12pm')}
                            className="px-2 py-1 text-xs border border-[var(--border)] rounded hover:bg-[var(--surface)] transition-colors"
                          >
                            + Morning
                          </button>
                          <button
                            type="button"
                            onClick={() => selectTimeRange(day, '12pm', '5pm')}
                            className="px-2 py-1 text-xs border border-[var(--border)] rounded hover:bg-[var(--surface)] transition-colors"
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
                                  ? "bg-[var(--green)] text-black border-[var(--green)] shadow-sm"
                                  : "bg-[var(--surface)] border-[var(--border)] hover:bg-[var(--green-dim)] hover:border-[var(--green-border)]"
                              }`}
                            >
                              {time}
                            </button>
                          ))}
                        </div>
                        
                        {dayTimes[day].length > 0 && (
                          <p className="mt-2 text-xs text-[var(--text-2)] line-clamp-1">
                            <span className="font-medium">Selected:</span> {dayTimes[day].join(", ")}
                          </p>
                        )}
                      </>
                    )}
                    {!isEnabled && (
                      <p className="text-xs text-[var(--text-3)] italic text-center py-2">
                        Toggle to enable this day
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Summary */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm text-blue-800">
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
          <div className="flex gap-3 justify-end pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 border-2 border-[var(--border)] rounded-lg hover:bg-[var(--surface)] font-medium transition-colors"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 bg-[var(--green)] text-black rounded-lg hover:bg-green-400 disabled:opacity-50 font-medium shadow-md hover:shadow-lg transition-all disabled:cursor-not-allowed"
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

  const getPresetTargetDays = (): readonly (typeof DAYS[number])[] => {
    switch (dayViewTab) {
      case "weekdays":
        return WEEKDAYS;
      case "weekends":
        return WEEKENDS;
      default:
        return DAYS;
    }
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
    applyToDays(getPresetTargetDays(), times);
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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--surface-2)] rounded-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="p-6 border-b border-[var(--border)]">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Bulk Edit Watches</h2>
              <p className="mt-1 text-sm text-[var(--text-2)]">
                Apply the same time preferences to {selectedCount} selected watch{selectedCount > 1 ? 'es' : ''}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-[var(--text-3)] hover:text-[var(--text-2)]"
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
                className="px-3 py-1.5 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--surface)] transition-colors"
              >
                🌆 Evening (6pm-10pm)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('morning')}
                className="px-3 py-1.5 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--surface)] transition-colors"
              >
                🌅 Morning (7am-12pm)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('afternoon')}
                className="px-3 py-1.5 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--surface)] transition-colors"
              >
                ☀️ Afternoon (12pm-5pm)
              </button>
              <button
                type="button"
                onClick={() => applyPreset('all-day')}
                className="px-3 py-1.5 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--surface)] transition-colors"
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
                  setDayViewTab("weekdays");
                  const weekdaysTimes = WEEKDAYS.flatMap(day => dayTimes[day]);
                  const mostCommonTimes = weekdaysTimes.length > 0 
                    ? [...new Set(weekdaysTimes)].sort()
                    : ['6pm', '7pm', '8pm'];
                  applyToDays(WEEKDAYS, mostCommonTimes);
                }}
                className="px-3 py-1.5 text-sm bg-blue-50 text-blue-700 border border-blue-300 rounded-lg hover:bg-blue-100 transition-colors"
              >
                Apply to Weekdays
              </button>
              <button
                type="button"
                onClick={() => {
                  setDayViewTab("weekends");
                  const weekendTimes = WEEKENDS.flatMap(day => dayTimes[day]);
                  const mostCommonTimes = weekendTimes.length > 0 
                    ? [...new Set(weekendTimes)].sort()
                    : ['9am', '10am', '11am', '12pm', '1pm', '2pm'];
                  applyToDays(WEEKENDS, mostCommonTimes);
                }}
                className="px-3 py-1.5 text-sm bg-purple-50 text-purple-700 border border-purple-300 rounded-lg hover:bg-purple-100 transition-colors"
              >
                Apply to Weekends
              </button>
              <button
                type="button"
                onClick={() => clearDays(DAYS)}
                className="px-3 py-1.5 text-sm bg-red-50 text-red-700 border border-red-300 rounded-lg hover:bg-red-100 transition-colors"
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
              <div className="flex gap-1 bg-[var(--surface-2)] p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setDayViewTab('all')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    dayViewTab === 'all'
                      ? 'bg-[var(--surface)] text-[var(--text)] shadow-sm'
                      : 'text-[var(--text-2)] hover:text-[var(--text)]'
                  }`}
                >
                  All Days
                </button>
                <button
                  type="button"
                  onClick={() => setDayViewTab('weekdays')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    dayViewTab === 'weekdays'
                      ? 'bg-[var(--surface)] text-[var(--text)] shadow-sm'
                      : 'text-[var(--text-2)] hover:text-[var(--text)]'
                  }`}
                >
                  Weekdays
                </button>
                <button
                  type="button"
                  onClick={() => setDayViewTab('weekends')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    dayViewTab === 'weekends'
                      ? 'bg-[var(--surface)] text-[var(--text)] shadow-sm'
                      : 'text-[var(--text-2)] hover:text-[var(--text)]'
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
                  <div key={day} className="border-2 rounded-lg p-4 bg-[var(--surface)] transition-all hover:border-green-400">
                    <div className="flex items-center justify-between mb-3 pb-2 border-b">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold">{DAY_LABELS[day]}</h3>
                        {selectedCount > 0 && (
                          <span className="px-2 py-0.5 bg-[var(--green)]/10 text-[var(--green)] rounded-full text-xs font-medium">
                            {selectedCount}
                          </span>
                        )}
                      </div>
                      {selectedCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setDayTimes(prev => ({ ...prev, [day]: [] }))}
                          className="text-xs text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      <button
                        type="button"
                        onClick={() => selectTimeRange(day, '6pm', '10pm')}
                        className="px-2 py-1 text-xs border border-[var(--border)] rounded hover:bg-[var(--surface)] transition-colors"
                      >
                        + Evening
                      </button>
                      <button
                        type="button"
                        onClick={() => selectTimeRange(day, '7am', '12pm')}
                        className="px-2 py-1 text-xs border border-[var(--border)] rounded hover:bg-[var(--surface)] transition-colors"
                      >
                        + Morning
                      </button>
                      <button
                        type="button"
                        onClick={() => selectTimeRange(day, '12pm', '5pm')}
                        className="px-2 py-1 text-xs border border-[var(--border)] rounded hover:bg-[var(--surface)] transition-colors"
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
                              ? "bg-[var(--green)] text-black border-[var(--green)] shadow-sm"
                              : "bg-[var(--surface)] border-[var(--border)] hover:bg-[var(--green-dim)] hover:border-[var(--green-border)]"
                          }`}
                        >
                          {time}
                        </button>
                      ))}
                    </div>
                    
                    {dayTimes[day].length > 0 && (
                      <p className="mt-2 text-xs text-[var(--text-2)] line-clamp-1">
                        <span className="font-medium">Selected:</span> {dayTimes[day].join(", ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex gap-3 justify-end pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 border-2 border-[var(--border)] rounded-lg hover:bg-[var(--surface)] font-medium transition-colors"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 bg-[var(--green)] text-black rounded-lg hover:bg-green-400 disabled:opacity-50 font-medium shadow-md hover:shadow-lg transition-all disabled:cursor-not-allowed"
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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--surface-2)] rounded-xl max-w-md w-full">
        <div className="p-6 border-b border-[var(--border)]">
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
              className="w-full p-2 border rounded-lg bg-[var(--surface)]"
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
              className="w-full p-2 border rounded-lg bg-[var(--surface)]"
              required
            />
            {type === "telegram" && (
              <div className="mt-2 space-y-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs font-medium text-blue-900 mb-2">
                  How to get your Telegram Chat ID:
                </p>
                <ol className="text-xs text-blue-800 space-y-1.5 list-decimal list-inside">
                  <li>
                    <a
                      href="https://t.me/MvgMonitorBot"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline font-medium"
                    >
                      Click here to open @MvgMonitorBot
                    </a>
                  </li>
                  <li>Send any message (like &quot;/start&quot; or &quot;Hello&quot;)</li>
                  <li>The bot will automatically reply with your Chat ID</li>
                  <li>Copy the number and paste it in the field above</li>
                </ol>
                <a
                  href="https://t.me/MvgMonitorBot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-2 px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-700 transition-colors font-medium"
                >
                  Open @MvgMonitorBot
                </a>
              </div>
            )}
          </div>

          {/* Form Actions */}
          <div className="flex gap-3 justify-end pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-[var(--border)] rounded-lg hover:bg-[var(--surface)]"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-[var(--green)] text-black rounded-lg hover:bg-green-400 disabled:opacity-50"
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
function AdminOverview({ setAdminSubTab, router }: { setAdminSubTab: (tab: "overview" | "users" | "requests" | "system" | "database") => void; router: ReturnType<typeof useRouter> }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [recentNotifications, setRecentNotifications] = useState<AdminNotification[]>([]);
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
    return <div className="p-4 text-center text-[var(--text-2)]">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <button
          onClick={() => navigateTo("users")}
          className="bg-[var(--surface)] rounded-lg border p-4 hover:shadow-lg transition-shadow text-left cursor-pointer"
        >
          <div className="text-2xl font-bold mb-1">{stats?.totalUsers || 0}</div>
          <div className="text-sm text-[var(--text-2)]">Total Users</div>
          <div className="text-xs text-[var(--text-2)] mt-1">{stats?.allowedUsers || 0} allowed</div>
        </button>
        <div className="bg-[var(--surface)] rounded-lg border p-4">
          <div className="text-2xl font-bold mb-1">{stats?.activeWatches || 0}</div>
          <div className="text-sm text-[var(--text-2)]">Active Watches</div>
          <div className="text-xs text-[var(--text-2)] mt-1">{stats?.totalWatches || 0} total</div>
        </div>
        <button
          onClick={() => navigateTo("requests")}
          className="bg-[var(--surface)] rounded-lg border p-4 hover:shadow-lg transition-shadow text-left cursor-pointer"
        >
          <div className="text-2xl font-bold mb-1">{stats?.pendingRequests || 0}</div>
          <div className="text-sm text-[var(--text-2)]">Pending Requests</div>
          <div className="text-xs text-[var(--text-2)] mt-1">Awaiting approval</div>
        </button>
        <div className="bg-[var(--surface)] rounded-lg border p-4">
          <div className="text-2xl font-bold mb-1">{stats?.totalChannels || 0}</div>
          <div className="text-sm text-[var(--text-2)]">Notification Channels</div>
          <div className="text-xs text-[var(--text-2)] mt-1">Active channels</div>
        </div>
        <button
          onClick={() => navigateTo("system")}
          className="bg-[var(--surface)] rounded-lg border p-4 hover:shadow-lg transition-shadow text-left cursor-pointer"
        >
          <div className="text-2xl font-bold mb-1">{stats?.totalSlots || 0}</div>
          <div className="text-sm text-[var(--text-2)]">Total Slots</div>
          <div className="text-xs text-[var(--text-2)] mt-1">{stats?.totalVenues || 0} venues</div>
        </button>
        <div className="bg-[var(--surface)] rounded-lg border p-4">
          <div className="text-2xl font-bold mb-1">{stats?.totalNotifications || 0}</div>
          <div className="text-sm text-[var(--text-2)]">Notifications Sent</div>
          <div className="text-xs text-[var(--text-2)] mt-1">All time</div>
        </div>
      </div>

      {/* Recent Notifications */}
      <div className="bg-[var(--surface)] rounded-lg border p-6">
        <h2 className="text-lg font-semibold mb-4">Recent Notifications</h2>
        {recentNotifications.length > 0 ? (
          <div className="space-y-2">
            {recentNotifications.map((notification) => (
              <div
                key={notification.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <span className="text-sm">{notification.slotKey}</span>
                <span className="text-xs text-[var(--text-2)]">
                  {new Date(notification.sentAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[var(--text-2)] text-sm">No recent notifications</p>
        )}
      </div>
    </div>
  );
}

function AdminUsers({ showMessage }: { showMessage: (type: "success" | "error", text: string) => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const [userDetails, setUserDetails] = useState<AdminUserDetails | null>(null);
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
    } catch (error) {
      showMessage("error", getErrorMessage(error));
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
    } catch {
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
    } catch {
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
    } catch {
      showMessage("error", "Failed to delete user");
    }
  };

  const filteredUsers = users.filter(
    (user) =>
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return <div className="p-4 text-center text-[var(--text-2)]">Loading...</div>;
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
          className="flex-1 p-3 border border-[var(--border)] rounded-lg bg-[var(--surface)] mr-4"
        />
        <button
          onClick={() => setShowAddUserForm(true)}
          className="px-4 py-3 bg-[var(--green)] text-black rounded-lg font-semibold hover:bg-green-400 transition-colors whitespace-nowrap"
        >
          + Add User
        </button>
      </div>

      {/* Users Table */}
      <div className="bg-[var(--surface)] rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-2)] uppercase">
                  User
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-2)] uppercase">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-2)] uppercase">
                  Watches
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-2)] uppercase">
                  Channels
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-2)] uppercase">
                  Created
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[var(--text-2)] uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredUsers.map((user) => (
                <Fragment key={user.id}>
                  <tr className="hover:bg-[var(--surface)]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleUserExpand(user.id)}
                          className="text-[var(--text-2)] hover:text-[var(--text)]"
                        >
                          {expandedUserId === user.id ? "▼" : "▶"}
                        </button>
                        <div className="flex flex-col">
                          <span className="font-medium text-sm">{user.email}</span>
                          {user.name && (
                            <span className="text-xs text-[var(--text-2)]">{user.name}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-block px-2 py-0.5 text-xs rounded w-fit ${
                            user.isAllowed
                              ? "bg-[var(--green)]/10 text-[var(--green)]"
                              : "bg-red-500/10 text-red-400"
                          }`}
                        >
                          {user.isAllowed ? "Allowed" : "Not Allowed"}
                        </span>
                        {user.isAdmin === 1 && (
                          <span className="inline-block px-2 py-0.5 text-xs rounded w-fit bg-purple-500/15 text-purple-300 border border-purple-500/30">
                            Admin
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">{user.watchCount}</td>
                    <td className="px-4 py-3 text-sm">{user.channelCount}</td>
                    <td className="px-4 py-3 text-sm text-[var(--text-2)]">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => handleToggleAllowed(user.id, user.isAllowed)}
                          className={`px-2 py-1 text-xs rounded border transition-colors ${
                            user.isAllowed
                              ? "bg-[var(--red)]/10 hover:bg-[var(--red)]/20 text-[var(--red)] border-[var(--red)]/25"
                              : "bg-[var(--green)]/10 hover:bg-[var(--green)]/20 text-[var(--green)] border-[var(--green)]/25"
                          }`}
                        >
                          {user.isAllowed ? "Revoke" : "Allow"}
                        </button>
                        <button
                          onClick={() => handleToggleAdmin(user.id, user.isAdmin)}
                          className="px-2 py-1 text-xs rounded border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--surface-3)] transition-colors"
                        >
                          {user.isAdmin ? "Remove Admin" : "Make Admin"}
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user.id, user.email)}
                          className="px-2 py-1 text-xs rounded border transition-colors bg-[var(--red)]/10 hover:bg-[var(--red)]/20 text-[var(--red)] border-[var(--red)]/25"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedUserId === user.id && (
                    <tr key={`${user.id}-details`}>
                      <td colSpan={6} className="px-4 py-4 bg-[var(--surface)]">
                        {loadingDetails ? (
                          <div className="text-center text-[var(--text-2)] text-sm">Loading details...</div>
                        ) : userDetails ? (
                          <div className="space-y-4">
                            {/* Watches Section */}
                            <div>
                              <h4 className="font-semibold text-sm mb-2">Watches ({userDetails.watches.length})</h4>
                              {userDetails.watches.length > 0 ? (
                                <div className="space-y-2">
                                  {userDetails.watches.map((watch) => (
                                    <div key={watch.id} className="bg-[var(--surface)] rounded p-3 text-sm">
                                      <div className="flex justify-between items-start">
                                        <div className="flex-1">
                                          <p className="font-medium">{watch.venueName || "All Venues"}</p>
                                          <div className="mt-2 space-y-1">
                                            {watch.dayTimes && Object.entries(watch.dayTimes)
                                              .filter(([, times]: [string, string[]]) => times?.length > 0)
                                              .map(([day, times]: [string, string[]]) => (
                                                <p key={day} className="text-xs text-[var(--text-2)]">
                                                  <span className="capitalize font-medium">{day}:</span> {times.join(", ")}
                                                </p>
                                              ))}
                                            {watch.dayTimes && Object.values(watch.dayTimes).every((times: string[]) => !times || times.length === 0) && (
                                              <p className="text-xs text-[var(--text-2)] italic">No times set</p>
                                            )}
                                          </div>
                                        </div>
                                        <span className={`px-2 py-0.5 text-xs rounded ${watch.active ? "bg-[var(--green)]/10 text-[var(--green)]" : "bg-[var(--surface-2)] text-[var(--text)]"}`}>
                                          {watch.active ? "Active" : "Paused"}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-[var(--text-2)]">No watches configured</p>
                              )}
                            </div>

                            {/* Channels Section */}
                            <div>
                              <h4 className="font-semibold text-sm mb-2">Notification Channels ({userDetails.channels.length})</h4>
                              {userDetails.channels.length > 0 ? (
                                <div className="space-y-2">
                                  {userDetails.channels.map((channel) => (
                                    <div key={channel.id} className="bg-[var(--surface)] rounded p-3 text-sm">
                                      <div className="flex justify-between items-center">
                                        <div>
                                          <p className="font-medium capitalize">{channel.type}</p>
                                          <p className="text-xs text-[var(--text-2)]">{channel.destination}</p>
                                        </div>
                                        <span className={`px-2 py-0.5 text-xs rounded ${channel.active ? "bg-[var(--green)]/10 text-[var(--green)]" : "bg-[var(--surface-2)] text-[var(--text)]"}`}>
                                          {channel.active ? "Active" : "Paused"}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-[var(--text-2)]">No notification channels configured</p>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="text-center text-[var(--text-2)] text-sm">Failed to load details</div>
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
          <div className="p-8 text-center text-[var(--text-2)] text-sm">
            No users found matching your search.
          </div>
        )}
      </div>

      <div className="text-sm text-[var(--text-2)]">
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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--surface-2)] rounded-xl max-w-md w-full">
        <div className="p-6 border-b border-[var(--border)]">
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
              className="w-full p-2 border rounded-lg bg-[var(--surface)]"
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
              className="w-full p-2 border rounded-lg bg-[var(--surface)]"
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

          <div className="flex gap-3 justify-end pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-[var(--border)] rounded-lg hover:bg-[var(--surface)]"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-[var(--green)] text-black rounded-lg hover:bg-green-400 disabled:opacity-50"
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
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
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
    } catch {
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
    } catch {
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
    } catch {
      showMessage("error", "Failed to delete request");
    }
  };

  const filteredRequests = requests.filter((req) =>
    filter === "all" ? true : req.status === filter
  );

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  if (loading) {
    return <div className="p-4 text-center text-[var(--text-2)]">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Filter Tabs */}
      <div className="flex gap-2 border-b">
        {(["all", "pending", "approved", "rejected"] as const).map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 -mb-px capitalize cursor-pointer ${
              filter === status
                ? "border-[var(--green)] text-[var(--green)]"
                : "border-transparent text-[var(--text-3)] hover:text-[var(--text-2)]"
            }`}
          >
            {status}
            {status === "pending" && pendingCount > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-yellow-100 text-amber-400 rounded-full text-xs">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Requests List */}
      <div className="space-y-3">
        {filteredRequests.length === 0 ? (
          <div className="bg-[var(--surface)] rounded-lg border p-6 text-center text-[var(--text-2)] text-sm">
            No {filter !== "all" ? filter : ""} requests found
          </div>
        ) : (
          filteredRequests.map((request) => (
            <div
              key={request.id}
              className="bg-[var(--surface)] rounded-lg border p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold">{request.email}</h3>
                    <span
                      className={`px-2 py-0.5 text-xs rounded ${
                        request.status === "pending"
                          ? "bg-yellow-100 text-yellow-700"
                          : request.status === "approved"
                            ? "bg-[var(--green)]/10 text-[var(--green)]"
                            : "bg-red-500/10 text-red-400"
                      }`}
                    >
                      {request.status}
                    </span>
                  </div>
                  {request.name && (
                    <p className="text-sm text-[var(--text-2)] mb-1">
                      Name: {request.name}
                    </p>
                  )}
                  <p className="text-xs text-[var(--text-2)] mb-2">
                    Submitted: {new Date(request.createdAt).toLocaleString()}
                  </p>
                  {request.reason && (
                    <div className="mt-2 p-2 bg-[var(--surface)] rounded">
                      <p className="text-xs font-medium mb-1">Reason:</p>
                      <p className="text-xs text-[var(--text)]">{request.reason}</p>
                    </div>
                  )}
                  {request.reviewedAt && (
                    <p className="text-xs text-[var(--text-2)] mt-2">
                      Reviewed: {new Date(request.reviewedAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  {request.status === "pending" && (
                    <>
                      <button
                        onClick={() => handleApprove(request.id, request.email)}
                        className="px-3 py-1 bg-[var(--green)] text-black rounded hover:bg-green-400 text-sm"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(request.id, request.email)}
                        className="px-3 py-1 bg-red-500/80 text-white rounded hover:bg-red-700 text-sm"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleDelete(request.id, request.email)}
                    className="px-3 py-1 bg-[var(--surface-3)] text-white rounded hover:bg-[var(--surface-3)] text-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="text-sm text-[var(--text-2)]">
        Showing {filteredRequests.length} of {requests.length} requests
      </div>
    </div>
  );
}

function AdminSystem({ showMessage }: { showMessage: (type: "success" | "error", text: string) => void }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [cleanupDays, setCleanupDays] = useState(7);
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [showVenueForm, setShowVenueForm] = useState(false);
  const [venues, setVenues] = useState<AdminVenue[]>([]);

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

  const handleAddVenue = async (venueData: VenueFormData) => {
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
    } catch (error) {
      showMessage("error", getErrorMessage(error));
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
    } catch {
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
    } catch {
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
    } catch {
      showMessage("error", "Failed to run cleanup");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Scraper Section */}
      <div className="bg-[var(--surface)] rounded-lg border p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold mb-2">Manual Scrape</h2>
          <p className="text-sm text-[var(--text-2)]">
            Trigger a manual scrape of all venues for the next 9 days. This will also notify
            users of any newly available slots.
          </p>
        </div>
        <button
          onClick={handleRunScrape}
          disabled={loading === "scrape"}
          className="px-6 py-2 bg-[var(--green)] text-black rounded-lg font-semibold hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading === "scrape" ? "Starting..." : "Run Scrape Now"}
        </button>
        <p className="mt-3 text-xs text-[var(--text-2)]">
          Note: The scrape runs automatically on a schedule. Only use this if you need immediate
          results.
        </p>
      </div>

      {/* Cleanup Section */}
      <div className="bg-[var(--surface)] rounded-lg border p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold mb-2">Database Cleanup</h2>
          <p className="text-sm text-[var(--text-2)] mb-4">
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
              className="w-20 p-2 border border-[var(--border)] rounded bg-[var(--surface)]"
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
        <p className="mt-3 text-xs text-[var(--text-2)]">
          Warning: This will permanently delete old data. Make sure to export data first if needed.
        </p>
      </div>

      {/* Environment Info */}
      <div className="bg-[var(--surface)] rounded-lg border p-6">
        <h2 className="text-lg font-semibold mb-4">System Information</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b">
            <span className="text-sm font-medium text-[var(--text-2)]">Node Environment</span>
            <span className="text-sm">{process.env.NODE_ENV || "production"}</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b">
            <span className="text-sm font-medium text-[var(--text-2)]">Auto Cleanup</span>
            <span className="text-sm">After each scrape (keeps last 7 days by default)</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-medium text-[var(--text-2)]">Cron Schedule</span>
            <span className="text-sm">Configured in hosting platform (Railway/cron-job.org)</span>
          </div>
        </div>
      </div>

      {/* Venue Management */}
      <div className="bg-[var(--surface)] rounded-lg border p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Venue Management</h2>
          <button
            onClick={() => setShowVenueForm(true)}
            className="px-4 py-2 bg-[var(--green)] text-black rounded-lg font-semibold hover:bg-green-400 text-sm"
          >
            + Add Venue
          </button>
        </div>
        <div className="space-y-2">
          {venues.map((venue) => (
            <div key={venue.id} className="flex justify-between items-center p-3 bg-[var(--surface)] rounded">
              <div>
                <p className="font-medium text-sm">{venue.name}</p>
                <p className="text-xs text-[var(--text-2)]">{venue.slug} • {venue.type}</p>
              </div>
              <button
                onClick={() => handleDeleteVenue(venue.id, venue.name)}
                className="px-3 py-1 text-xs bg-red-100 hover:bg-red-200 rounded"
              >
                Delete
              </button>
            </div>
          ))}
          {venues.length === 0 && (
            <p className="text-sm text-[var(--text-2)] text-center py-4">No venues configured</p>
          )}
        </div>
      </div>

      {/* System Logs */}
      <div className="bg-[var(--surface)] rounded-lg border p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Recent System Logs</h2>
          <button
            onClick={fetchLogs}
            className="px-3 py-1 text-sm bg-[var(--surface-2)] hover:bg-[var(--surface-3)] rounded"
          >
            Refresh
          </button>
        </div>
        {loadingLogs ? (
          <div className="text-center text-[var(--text-2)] text-sm py-4">Loading logs...</div>
        ) : logs.length > 0 ? (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {logs.map((log) => (
              <div key={log.id} className="text-xs p-2 bg-[var(--surface)] rounded font-mono">
                <div className="flex items-start gap-2">
                  <span className="text-[var(--text-2)]">{new Date(log.timestamp).toLocaleString()}</span>
                  <span className={`px-1 rounded ${
                    log.level === "error" ? "bg-red-500/10 text-red-400" :
                    log.level === "warn" ? "bg-yellow-100 text-yellow-700" :
                    "bg-blue-100 text-blue-700"
                  }`}>{log.level}</span>
                  <span className="flex-1">{log.message}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--text-2)] text-center py-4">No recent logs</p>
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
  onSubmit: (venueData: VenueFormData) => void;
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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--surface-2)] rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-[var(--border)]">
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
              className="w-full p-2 border rounded-lg bg-[var(--surface)]"
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
              className="w-full p-2 border rounded-lg bg-[var(--surface)]"
              required
            />
            <p className="text-xs text-[var(--text-2)] mt-1">URL-friendly identifier (e.g., victoria-park)</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Type *</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full p-2 border rounded-lg bg-[var(--surface)]"
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
                  className="w-full p-2 border rounded-lg bg-[var(--surface)]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">ClubSpark ID</label>
                <input
                  type="text"
                  value={clubsparkId}
                  onChange={(e) => setClubsparkId(e.target.value)}
                  placeholder="12345"
                  className="w-full p-2 border rounded-lg bg-[var(--surface)]"
                />
              </div>
            </>
          )}

          <div className="flex gap-3 justify-end pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-[var(--border)] rounded-lg hover:bg-[var(--surface)]"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-[var(--green)] text-black rounded-lg hover:bg-green-400 disabled:opacity-50"
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
  const [dbStats, setDbStats] = useState<DbStats | null>(null);
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
    } catch {
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
    } catch {
      showMessage("error", "Failed to vacuum database");
    }
  };

  if (loading) {
    return <div className="p-4 text-center text-[var(--text-2)]">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Database Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--surface)] rounded-lg border p-4">
          <div className="text-2xl font-bold mb-1">{dbStats?.tables?.users || 0}</div>
          <div className="text-sm text-[var(--text-2)]">Total Users</div>
        </div>
        <div className="bg-[var(--surface)] rounded-lg border p-4">
          <div className="text-2xl font-bold mb-1">{dbStats?.tables?.watches || 0}</div>
          <div className="text-sm text-[var(--text-2)]">Total Watches</div>
        </div>
        <div className="bg-[var(--surface)] rounded-lg border p-4">
          <div className="text-2xl font-bold mb-1">{dbStats?.tables?.slots || 0}</div>
          <div className="text-sm text-[var(--text-2)]">Total Slots</div>
        </div>
        <div className="bg-[var(--surface)] rounded-lg border p-4">
          <div className="text-2xl font-bold mb-1">{dbStats?.tables?.notificationLog || 0}</div>
          <div className="text-sm text-[var(--text-2)]">Notification Logs</div>
        </div>
      </div>

      {/* Database Operations */}
      <div className="bg-[var(--surface)] rounded-lg border p-6">
        <h2 className="text-lg font-semibold mb-4">Database Operations</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border rounded-lg p-4">
            <h3 className="font-semibold mb-2">Export Database</h3>
            <p className="text-sm text-[var(--text-2)] mb-3">
              Download a complete JSON backup of the database
            </p>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
            >
              {exporting ? "Exporting..." : "Export to JSON"}
            </button>
          </div>

          <div className="border rounded-lg p-4">
            <h3 className="font-semibold mb-2">Vacuum Database</h3>
            <p className="text-sm text-[var(--text-2)] mb-3">
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
      <div className="bg-[var(--surface)] rounded-lg border p-6">
        <h2 className="text-lg font-semibold mb-4">Database Information</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b">
            <span className="text-sm font-medium text-[var(--text-2)]">Database Type</span>
            <span className="text-sm">SQLite</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b">
            <span className="text-sm font-medium text-[var(--text-2)]">ORM</span>
            <span className="text-sm">Drizzle ORM</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b">
            <span className="text-sm font-medium text-[var(--text-2)]">Database File</span>
            <span className="text-sm font-mono text-xs">sqlite.db</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-medium text-[var(--text-2)]">Last Backup</span>
            <span className="text-sm text-[var(--text-2)]">Export to create backup</span>
          </div>
        </div>
      </div>

      {/* Table Details */}
      <div className="bg-[var(--surface)] rounded-lg border p-6">
        <h2 className="text-lg font-semibold mb-4">Table Details</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface)]">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Table Name</th>
                <th className="px-4 py-2 text-right font-medium">Row Count</th>
              </tr>
            </thead>
            <tbody className="divide-y">
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
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-[var(--text-2)]">Loading...</div>
    </div>
  );
}

export default function Dashboard() {
  return (
    <Suspense fallback={<SuspenseFallback />}>
      <DashboardContent />
    </Suspense>
  );
}
