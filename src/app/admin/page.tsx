"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Stats {
  totalUsers: number;
  allowedUsers: number;
  totalVenues: number;
  totalSlots: number;
  totalWatches: number;
  activeWatches: number;
  totalChannels: number;
  totalNotifications: number;
  pendingRequests: number;
}

interface RecentNotification {
  id: number;
  slotKey: string;
  sentAt: string;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentNotifications, setRecentNotifications] = useState<RecentNotification[]>([]);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin"></div>
          <div className="text-gray-600 dark:text-gray-400">Loading dashboard...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2 text-gray-900 dark:text-white">Admin Dashboard</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Overview of your Time for Tennis system
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <StatCard
          title="Total Users"
          value={stats?.totalUsers || 0}
          subtitle={`${stats?.allowedUsers || 0} allowed`}
          icon="👥"
          color="blue"
        />
        <StatCard
          title="Active Watches"
          value={stats?.activeWatches || 0}
          subtitle={`${stats?.totalWatches || 0} total`}
          icon="👀"
          color="green"
        />
        <StatCard
          title="Pending Requests"
          value={stats?.pendingRequests || 0}
          subtitle="Awaiting approval"
          icon="📝"
          color="yellow"
          link="/admin/requests"
        />
        <StatCard
          title="Notification Channels"
          value={stats?.totalChannels || 0}
          subtitle="Active channels"
          icon="📢"
          color="purple"
        />
        <StatCard
          title="Total Slots"
          value={stats?.totalSlots || 0}
          subtitle={`${stats?.totalVenues || 0} venues`}
          icon="🎾"
          color="indigo"
        />
        <StatCard
          title="Notifications Sent"
          value={stats?.totalNotifications || 0}
          subtitle="All time"
          icon="📨"
          color="pink"
        />
      </div>

      {/* Recent Activity */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow">
        <div className="p-6 border-b dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Recent Notifications</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Latest notification activity</p>
        </div>
        <div className="p-6">
          {recentNotifications.length > 0 ? (
            <div className="space-y-3">
              {recentNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className="flex items-center justify-between py-3 px-4 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors border-b dark:border-gray-700 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{notification.slotKey}</span>
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {new Date(notification.sentAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="text-4xl mb-2">📭</div>
              <p className="text-gray-500 dark:text-gray-400">No recent notifications</p>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <QuickActionCard
          title="Manage Users"
          description="View and manage user accounts"
          icon="👥"
          link="/admin/users"
        />
        <QuickActionCard
          title="Review Requests"
          description="Approve or reject registration requests"
          icon="📝"
          link="/admin/requests"
          badge={stats?.pendingRequests}
        />
        <QuickActionCard
          title="System Management"
          description="Run scrapes, cleanup, and view logs"
          icon="⚙️"
          link="/admin/system"
        />
        <QuickActionCard
          title="User Dashboard"
          description="View the public dashboard"
          icon="🏠"
          link="/dashboard"
        />
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  icon,
  color,
  link,
}: {
  title: string;
  value: number;
  subtitle: string;
  icon: string;
  color: string;
  link?: string;
}) {
  const colorClasses = {
    blue: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    green: "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800",
    yellow: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800",
    purple: "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800",
    indigo: "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800",
    pink: "bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400 border-pink-200 dark:border-pink-800",
  };

  const content = (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className={`w-14 h-14 rounded-xl ${colorClasses[color as keyof typeof colorClasses]} flex items-center justify-center text-2xl border-2 transition-transform group-hover:scale-110`}>
          {icon}
        </div>
        {link && (
          <svg className="w-5 h-5 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </div>
      <div className="text-4xl font-bold mb-1 text-gray-900 dark:text-white">{value.toLocaleString()}</div>
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{subtitle}</div>
    </>
  );

  if (link) {
    return (
      <Link href={link} className="group bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6 hover:shadow-lg hover:border-green-300 dark:hover:border-green-700 transition-all duration-200 block">
        {content}
      </Link>
    );
  }

  return (
    <div className="group bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6 hover:shadow-md transition-all duration-200">
      {content}
    </div>
  );
}

function QuickActionCard({
  title,
  description,
  icon,
  link,
  badge,
}: {
  title: string;
  description: string;
  icon: string;
  link: string;
  badge?: number;
}) {
  return (
    <Link
      href={link}
      className="group bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6 hover:shadow-lg hover:border-green-300 dark:hover:border-green-700 transition-all duration-200 block"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4 flex-1">
          <div className="text-4xl transition-transform group-hover:scale-110">{icon}</div>
          <div className="flex-1">
            <h3 className="font-semibold mb-1 text-gray-900 dark:text-white group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors">{title}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {badge !== undefined && badge > 0 && (
            <span className="px-2.5 py-1 bg-red-500 text-white text-xs font-semibold rounded-full animate-pulse">
              {badge}
            </span>
          )}
          <svg className="w-5 h-5 text-gray-400 group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
}
