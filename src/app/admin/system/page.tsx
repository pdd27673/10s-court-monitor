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
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2 text-gray-900 dark:text-white">System Management</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Manage system operations and maintenance tasks
        </p>
      </div>

      {message && (
        <div
          className={`p-4 rounded-lg border shadow-sm ${
            message.type === "success"
              ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200"
              : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {message.type === "success" ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            <p className="text-sm font-medium">{message.text}</p>
          </div>
        </div>
      )}

      {/* Scraper Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6 shadow-sm hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between mb-6">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center text-xl">
                🔍
              </div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Manual Scrape</h2>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Trigger a manual scrape of all venues for the next 7 days. This will also notify
              users of any newly available slots.
            </p>
          </div>
        </div>
        <button
          onClick={handleRunScrape}
          disabled={loading === "scrape"}
          className="px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md flex items-center gap-2"
        >
          {loading === "scrape" ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              Starting...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Run Scrape Now
            </>
          )}
        </button>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Note: The scrape runs automatically on a schedule. Only use this if you need immediate
          results.
        </p>
      </div>

      {/* Cleanup Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6 shadow-sm hover:shadow-md transition-shadow">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center text-xl">
              🗑️
            </div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Database Cleanup</h2>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Remove old slot data and notification logs to keep the database lean. This runs
            automatically after each scrape.
          </p>
          <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Delete data older than:</label>
            <input
              type="number"
              min="1"
              max="90"
              value={cleanupDays}
              onChange={(e) => setCleanupDays(parseInt(e.target.value, 10) || 7)}
              className="w-20 p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">days</span>
          </div>
        </div>
        <button
          onClick={handleRunCleanup}
          disabled={loading === "cleanup"}
          className="px-6 py-3 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md flex items-center gap-2"
        >
          {loading === "cleanup" ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              Running...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Run Cleanup Now
            </>
          )}
        </button>
        <p className="mt-3 text-xs text-orange-600 dark:text-orange-400 font-medium">
          ⚠️ Warning: This will permanently delete old data. Make sure to export data first if needed.
        </p>
      </div>

      {/* Environment Info */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center text-xl">
            ℹ️
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">System Information</h2>
        </div>
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
    <div className="flex items-center justify-between py-3 px-4 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 last:mb-0">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
      <span className="text-sm text-gray-900 dark:text-white font-medium">{value}</span>
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
    <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start gap-4 mb-4">
        <div className="text-3xl">{icon}</div>
        <div className="flex-1">
          <h3 className="font-semibold mb-1 text-gray-900 dark:text-white">{title}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>
        </div>
      </div>
      <button
        onClick={action}
        disabled={disabled}
        className="w-full px-4 py-2.5 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md font-medium"
      >
        {buttonText}
      </button>
    </div>
  );
}
