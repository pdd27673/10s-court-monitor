import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { db } from "@/lib/db";
import { venues, slots, notificationLog } from "@/lib/schema";
import { count } from "drizzle-orm";
import { VENUES } from "@/lib/constants";

async function getPublicStats() {
  try {
    const [venueCount] = await db.select({ count: count() }).from(venues);
    const [slotCount] = await db.select({ count: count() }).from(slots);
    const [alertCount] = await db.select({ count: count() }).from(notificationLog);
    return {
      venues: venueCount.count,
      courtsTracked: slotCount.count,
      alertsSent: alertCount.count,
    };
  } catch {
    return { venues: VENUES.length, courtsTracked: 0, alertsSent: 0 };
  }
}

function formatStat(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k+`;
  return n.toString();
}

export default async function Home() {
  const stats = await getPublicStats();

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] overflow-x-hidden">

      {/* ─── Nav bar ─── */}
      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <BrandMark className="w-7 h-7 group-hover:opacity-90 transition-opacity" />
            <span className="font-[family-name:var(--font-bricolage)] font-bold text-sm tracking-tight">Time for Tennis</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard?guest=true"
              className="px-3 py-1.5 text-sm text-[var(--text-2)] hover:text-[var(--text)] transition-colors"
            >
              Browse courts
            </Link>
            <Link
              href="/login"
              className="px-3 py-1.5 bg-[var(--green)] text-black rounded-lg text-sm font-semibold hover:bg-green-400 transition-all duration-150"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      {/* ─── Hero ─── */}
      <section className="relative flex flex-col items-center justify-center min-h-[calc(100vh-56px)] px-6 text-center">
        {/* Court-grid SVG background */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.06]">
          <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="court-grid" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
                <path d="M 80 0 L 0 0 0 80" fill="none" stroke="white" strokeWidth="1"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#court-grid)" />
          </svg>
        </div>
        {/* Radial green glow */}
        <div aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-green-600/10 blur-[120px]" />

        <div className="relative z-10 max-w-3xl mx-auto">
          {/* Monitoring badge with animated pulse */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-8 rounded-full border border-[var(--green-border)] bg-[var(--green-dim)] text-[var(--green)] text-xs font-medium tracking-wide">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse" />
            Monitoring every 10 minutes
          </div>

          <h1 className="font-[family-name:var(--font-bricolage)] text-5xl sm:text-7xl font-extrabold tracking-tight mb-6 leading-none">
            <span className="text-[var(--text)]">Time for </span>
            <span className="text-[var(--green)]">Tennis</span>
          </h1>

          <p className="text-lg sm:text-xl text-[var(--text-2)] max-w-xl mx-auto mb-10 leading-relaxed">
            London tennis courts fill up fast. We scrape booking systems across the city and ping you the moment a slot opens — so you never miss a game.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/login"
              className="px-8 py-3.5 bg-[var(--green)] hover:bg-green-400 text-black rounded-xl font-semibold transition-all duration-150 text-center shadow-[0_0_20px_rgba(34,197,94,0.2)]"
            >
              Get notified — it&apos;s free
            </Link>
            <Link
              href="/dashboard?guest=true"
              className="px-8 py-3.5 border border-[var(--border)] hover:border-[var(--text-3)] hover:bg-[var(--surface)] text-[var(--text-2)] hover:text-[var(--text)] rounded-xl font-semibold transition-all duration-150 text-center"
            >
              Browse courts
            </Link>
          </div>
        </div>

        {/* Scroll indicator */}
        <div aria-hidden className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 opacity-30">
          <span className="text-xs text-[var(--text-3)] tracking-widest uppercase">Scroll</span>
          <svg className="w-4 h-4 text-[var(--text-3)] animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </section>

      {/* ─── Stats bar ─── */}
      <section className="border-y border-[var(--border)] bg-[var(--surface)]">
        <div className="max-w-4xl mx-auto px-6 py-12 grid grid-cols-2 sm:grid-cols-4 gap-8 text-center">
          {[
            { value: String(stats.venues), label: "Venues monitored" },
            { value: formatStat(stats.courtsTracked), label: "Court slots tracked" },
            { value: formatStat(stats.alertsSent), label: "Alerts sent" },
            { value: "10 min", label: "Scrape interval" },
          ].map((stat) => (
            <div key={stat.label}>
              <div className="font-[family-name:var(--font-mono)] text-3xl sm:text-4xl font-bold text-[var(--text)] tabular-nums">{stat.value}</div>
              <div className="text-sm text-[var(--text-3)] mt-2">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── How it works ─── */}
      <section className="max-w-4xl mx-auto px-6 py-24">
        <h2 className="font-[family-name:var(--font-bricolage)] text-3xl sm:text-4xl font-bold text-center mb-4 text-[var(--text)]">How it works</h2>
        <p className="text-[var(--text-2)] text-center mb-16 max-w-md mx-auto">
          Set your preferences once, then let us do the watching.
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            {
              step: "01",
              title: "Set your preferences",
              body: "Tell us which venues, days, and time slots matter to you. Mix and match across east London parks.",
              icon: (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              ),
            },
            {
              step: "02",
              title: "We watch constantly",
              body: "Our scrapers hit every booking system every 10 minutes, 24/7. The moment a slot appears, we know about it.",
              icon: (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              ),
            },
            {
              step: "03",
              title: "Get notified instantly",
              body: "An alert lands in your inbox or Telegram the second a matching slot becomes available. Click, book, play.",
              icon: (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              ),
            },
          ].map((item) => (
            <div
              key={item.step}
              className="relative rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 hover:bg-[var(--surface-2)] hover:border-[var(--text-3)]/40 transition-all duration-150"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--green-dim)] border border-[var(--green-border)] text-[var(--green)]">
                  {item.icon}
                </div>
                <span className="font-[family-name:var(--font-mono)] text-xs font-bold text-[var(--green)]/50 tracking-widest">{item.step}</span>
              </div>
              <h3 className="font-semibold text-[var(--text)] mb-2">{item.title}</h3>
              <p className="text-sm text-[var(--text-2)] leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Venues ─── */}
      <section className="border-t border-[var(--border)] bg-[var(--surface)]">
        <div className="max-w-4xl mx-auto px-6 py-24">
          <h2 className="font-[family-name:var(--font-bricolage)] text-3xl sm:text-4xl font-bold text-center mb-4 text-[var(--text)]">Covered venues</h2>
          <p className="text-[var(--text-2)] text-center mb-12 max-w-sm mx-auto">
            East London parks, monitored around the clock.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {VENUES.map((venue) => (
              <Link
                key={venue.slug}
                href="/dashboard?guest=true"
                className="group flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 hover:border-[var(--green-border)] hover:bg-[var(--green-dim)] transition-all duration-150"
              >
                <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-[var(--green-dim)] border border-[var(--green-border)] flex items-center justify-center text-[var(--green)]">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-[var(--text-2)] group-hover:text-[var(--text)] transition-colors leading-tight">{venue.name}</span>
              </Link>
            ))}
          </div>
          <p className="text-center text-xs text-[var(--text-3)] mt-6">More venues coming soon.</p>
        </div>
      </section>

      {/* ─── Notification channels ─── */}
      <section className="max-w-4xl mx-auto px-6 py-24">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 sm:p-12 text-center">
          <h2 className="font-[family-name:var(--font-bricolage)] text-3xl font-bold mb-4 text-[var(--text)]">Alerts your way</h2>
          <p className="text-[var(--text-2)] max-w-sm mx-auto mb-10">
            Choose how you want to hear about new slots — straight to your inbox or Telegram.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-10">
            {[
              {
                name: "Email",
                desc: "Instant email alerts",
                icon: (
                  <svg className="w-5 h-5 text-[var(--green)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                ),
              },
              {
                name: "Telegram",
                desc: "Push to your phone",
                icon: (
                  <svg className="w-5 h-5 text-[var(--blue)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                ),
              },
            ].map((ch) => (
              <div key={ch.name} className="flex items-center gap-3 px-5 py-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] min-w-[160px]">
                <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-[var(--surface-3)] border border-[var(--border)] flex items-center justify-center">
                  {ch.icon}
                </div>
                <div className="text-left">
                  <div className="font-semibold text-sm text-[var(--text)]">{ch.name}</div>
                  <div className="text-xs text-[var(--text-2)]">{ch.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/login"
              className="px-8 py-3.5 bg-[var(--green)] hover:bg-green-400 text-black rounded-xl font-semibold transition-all duration-150 shadow-[0_0_20px_rgba(34,197,94,0.2)]"
            >
              Start getting alerts
            </Link>
            <Link
              href="/register"
              className="px-8 py-3.5 border border-[var(--border)] hover:border-[var(--text-3)] hover:bg-[var(--surface-2)] text-[var(--text-2)] hover:text-[var(--text)] rounded-xl font-semibold transition-all duration-150"
            >
              Request access
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-[var(--border)] py-8 px-6 text-center">
        <p className="text-sm text-[var(--text-3)]">Time for Tennis &mdash; London court availability, monitored 24/7.</p>
        <p className="mt-1 text-xs text-[var(--text-3)]/60">Scrapers run every 10 minutes. Notifications via Email &amp; Telegram.</p>
      </footer>
    </div>
  );
}
