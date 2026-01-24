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
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Admin Dashboard</h1>
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
      <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6">
        <h2 className="text-xl font-semibold mb-4">Recent Notifications</h2>
        {recentNotifications.length > 0 ? (
          <div className="space-y-2">
            {recentNotifications.map((notification) => (
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
          <p className="text-gray-500">No recent notifications</p>
        )}
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
    blue: "bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400",
    green: "bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400",
    yellow: "bg-yellow-100 dark:bg-yellow-900 text-yellow-600 dark:text-yellow-400",
    purple: "bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-400",
    indigo: "bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400",
    pink: "bg-pink-100 dark:bg-pink-900 text-pink-600 dark:text-pink-400",
  };

  const content = (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className={`w-12 h-12 rounded-lg ${colorClasses[color as keyof typeof colorClasses]} flex items-center justify-center text-2xl`}>
          {icon}
        </div>
      </div>
      <div className="text-3xl font-bold mb-1">{value}</div>
      <div className="text-sm text-gray-600 dark:text-gray-400">{title}</div>
      <div className="text-xs text-gray-500 mt-1">{subtitle}</div>
    </>
  );

  if (link) {
    return (
      <Link href={link} className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6 hover:shadow-lg transition-shadow">
        {content}
      </Link>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6">
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
      className="bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-6 hover:shadow-lg transition-shadow"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className="text-3xl">{icon}</div>
          <div>
            <h3 className="font-semibold mb-1">{title}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">{description}</p>
          </div>
        </div>
        {badge !== undefined && badge > 0 && (
          <span className="px-2 py-1 bg-red-500 text-white text-xs rounded-full">
            {badge}
          </span>
        )}
      </div>
    </Link>
  );
}
