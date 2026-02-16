"use client";

import { useState } from "react";

export default function SystemManagement() {
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [cleanupDays, setCleanupDays] = useState(7);

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
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
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">System Management</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Manage system operations and maintenance tasks
        </p>
      </div>

      {message && (
        <div
          className={`p-4 rounded-lg ${
            message.type === "success"
              ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-200"
              : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200"
          }`}
        >
          <p className="text-sm">{message.text}</p>
        </div>
      )}

      {/* Scraper Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold mb-2">Manual Scrape</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Trigger a manual scrape of all venues for the next 7 days. This will also notify
              users of any newly available slots.
            </p>
          </div>
        </div>
        <button
          onClick={handleRunScrape}
          disabled={loading === "scrape"}
          className="px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
          <h2 className="text-xl font-semibold mb-2">Database Cleanup</h2>
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
          className="px-6 py-3 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading === "cleanup" ? "Running..." : "Run Cleanup Now"}
        </button>
        <p className="mt-3 text-xs text-gray-500">
          Warning: This will permanently delete old data. Make sure to export data first if needed.
        </p>
      </div>

      {/* Environment Info */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6">
        <h2 className="text-xl font-semibold mb-4">System Information</h2>
        <div className="space-y-3">
          <InfoRow label="Node Environment" value={process.env.NODE_ENV || "production"} />
          <InfoRow
            label="Auto Cleanup"
            value="After each scrape (keeps last 7 days by default)"
          />
          <InfoRow
            label="Cron Schedule"
            value="Configured in hosting platform (Railway/cron-job.org)"
          />
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ActionCard
          title="View Logs"
          description="Check notification logs and system activity"
          icon="📋"
          action={() => showMessage("success", "Logs view coming soon")}
          buttonText="View Logs"
          disabled
        />
        <ActionCard
          title="Export Data"
          description="Download database backup as JSON"
          icon="💾"
          action={() => showMessage("success", "Export feature coming soon")}
          buttonText="Export Data"
          disabled
        />
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b dark:border-gray-700 last:border-0">
      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function ActionCard({
  title,
  description,
  icon,
  action,
  buttonText,
  disabled,
}: {
  title: string;
  description: string;
  icon: string;
  action: () => void;
  buttonText: string;
  disabled?: boolean;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6">
      <div className="flex items-start gap-4 mb-4">
        <div className="text-3xl">{icon}</div>
        <div>
          <h3 className="font-semibold mb-1">{title}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>
        </div>
      </div>
      <button
        onClick={action}
        disabled={disabled}
        className="w-full px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {buttonText}
      </button>
    </div>
  );
}
