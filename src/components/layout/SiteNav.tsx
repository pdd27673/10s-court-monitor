"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";

interface SiteNavProps {
  userEmail?: string | null;
  isAdmin?: boolean;
  activeTab?: "courts" | "alerts" | "settings" | "admin";
  onTabChange?: (tab: "courts" | "alerts" | "settings" | "admin") => void;
  isGuest?: boolean;
}

export function SiteNav({ userEmail, isAdmin, activeTab, onTabChange, isGuest }: SiteNavProps) {
  const pathname = usePathname();
  const isDashboard = pathname === "/dashboard";
  const [mobileOpen, setMobileOpen] = useState(false);

  const truncateEmail = (email: string) => {
    if (email.length <= 22) return email;
    const [user, domain] = email.split("@");
    if (!domain) return email.slice(0, 20) + "...";
    const truncUser = user.length > 10 ? user.slice(0, 10) + "…" : user;
    return `${truncUser}@${domain}`;
  };

  const navTabs = [
    { id: "courts" as const, label: "Courts" },
    { id: "alerts" as const, label: "Alerts" },
    { id: "settings" as const, label: "Settings" },
    ...(isAdmin ? [{ id: "admin" as const, label: "Admin" }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 shrink-0 group"
        >
          <div className="w-7 h-7 rounded-lg bg-[var(--green-dim)] border border-[var(--green-border)] flex items-center justify-center group-hover:bg-[var(--green)]/20 transition-all duration-150">
            <svg className="w-4 h-4 text-[var(--green)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3" strokeWidth="2"/>
              <path strokeLinecap="round" strokeWidth="2" d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z"/>
              <path strokeLinecap="round" strokeWidth="1.5" d="M2 12h20M12 2c-3 4-3 12 0 20M12 2c3 4 3 12 0 20"/>
            </svg>
          </div>
          <span className="font-[family-name:var(--font-bricolage)] font-bold text-sm tracking-tight text-[var(--text)]">TFT</span>
        </Link>

        {/* Center nav — only on dashboard for authenticated */}
        {isDashboard && !isGuest && userEmail && (
          <nav className="hidden sm:flex items-center gap-1 flex-1 justify-center">
            {navTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onTabChange?.(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer ${
                  activeTab === tab.id
                    ? "bg-[var(--surface-3)] text-[var(--text)] shadow-[0_0_0_1px_var(--border)]"
                    : "text-[var(--text-2)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        )}

        {/* Right side */}
        <div className="flex items-center gap-2 shrink-0">
          {isGuest ? (
            <Link
              href="/login"
              className="px-3 py-1.5 bg-[var(--green)] text-black rounded-lg text-sm font-semibold hover:bg-green-400 transition-all duration-150"
            >
              Sign in
            </Link>
          ) : userEmail ? (
            <>
              <span className="hidden sm:block text-xs text-[var(--text-3)] font-[family-name:var(--font-mono)]">
                {truncateEmail(userEmail)}
              </span>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="px-3 py-1.5 border border-[var(--border)] text-[var(--text-2)] rounded-lg text-sm hover:border-[var(--text-3)] hover:text-[var(--text)] transition-all duration-150 cursor-pointer"
              >
                Sign out
              </button>
              {/* Mobile menu toggle */}
              {isDashboard && (
                <button
                  onClick={() => setMobileOpen(!mobileOpen)}
                  className="sm:hidden p-1.5 text-[var(--text-2)] hover:text-[var(--text)] transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {mobileOpen ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    )}
                  </svg>
                </button>
              )}
            </>
          ) : (
            <Link
              href="/login"
              className="px-3 py-1.5 bg-[var(--green)] text-black rounded-lg text-sm font-semibold hover:bg-green-400 transition-all duration-150"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>

      {/* Mobile nav dropdown */}
      {mobileOpen && isDashboard && !isGuest && userEmail && (
        <div className="sm:hidden border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 flex gap-2 flex-wrap">
          {navTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                onTabChange?.(tab.id);
                setMobileOpen(false);
              }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer ${
                activeTab === tab.id
                  ? "bg-[var(--surface-3)] text-[var(--text)] shadow-[0_0_0_1px_var(--border)]"
                  : "text-[var(--text-2)] hover:text-[var(--text)]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
