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
    <aside className="fixed left-0 top-0 h-full w-64 bg-gray-900 text-white flex flex-col shadow-xl">
      <div className="p-6 border-b border-gray-800">
        <h1 className="text-xl font-bold text-white">Admin Panel</h1>
        <p className="text-sm text-gray-400 mt-1">Time for Tennis</p>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center justify-between px-4 py-3 rounded-lg transition-all duration-200 ${
                isActive && !item.isExternal
                  ? "bg-green-600 text-white shadow-lg shadow-green-600/20"
                  : "hover:bg-gray-800 text-gray-300 hover:text-white"
              }`}
            >
              <span className="flex items-center gap-3">
                <span className="text-lg transition-transform group-hover:scale-110">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </span>
              {item.badge !== undefined && item.badge > 0 && (
                <span className={`px-2 py-0.5 text-white text-xs font-semibold rounded-full ${
                  isActive && !item.isExternal ? "bg-red-500" : "bg-red-600"
                } animate-pulse`}>
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
          className="w-full px-4 py-3 bg-gray-800 hover:bg-gray-700 hover:bg-red-600/20 rounded-lg transition-all duration-200 text-left group"
        >
          <span className="flex items-center gap-3">
            <span className="text-lg transition-transform group-hover:scale-110">🚪</span>
            <span className="font-medium">Sign Out</span>
          </span>
        </button>
      </div>
    </aside>
  );
}
