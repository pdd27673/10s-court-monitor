"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

interface AdminSidebarProps {
  pendingRequestsCount: number;
}

export default function AdminSidebar({ pendingRequestsCount }: AdminSidebarProps) {
  const pathname = usePathname();

  const navItems = [
    { href: "/admin", label: "Dashboard", icon: "📊" },
    { href: "/admin/users", label: "Users", icon: "👥" },
    { href: "/admin/requests", label: "Registration Requests", icon: "📝", badge: pendingRequestsCount },
    { href: "/admin/system", label: "System", icon: "⚙️" },
    { href: "/dashboard", label: "← Back to Dashboard", icon: "🏠", isExternal: true },
  ];

  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-gray-900 text-white flex flex-col">
      <div className="p-6 border-b border-gray-800">
        <h1 className="text-xl font-bold">Admin Panel</h1>
        <p className="text-sm text-gray-400 mt-1">Time for Tennis</p>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center justify-between px-4 py-3 rounded-lg transition-colors ${
                isActive && !item.isExternal
                  ? "bg-green-600 text-white"
                  : "hover:bg-gray-800 text-gray-300"
              }`}
            >
              <span className="flex items-center gap-3">
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </span>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-gray-800">
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="w-full px-4 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors text-left"
        >
          <span className="flex items-center gap-3">
            <span>🚪</span>
            <span>Sign Out</span>
          </span>
        </button>
      </div>
    </aside>
  );
}
