"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const result = await signIn("resend", {
        email,
        redirect: false,
        callbackUrl: "/dashboard",
      });

      if (result?.error) {
        setError("Unable to send login link. Please check your email is on the allowlist.");
      } else if (result?.ok) {
        window.location.href = "/login/check-email";
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4 py-12">
      {/* Subtle background glow */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-green-600/5 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--text-2)] hover:text-[var(--text)] transition-colors mb-8 group"
        >
          <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform duration-150" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Time for Tennis
        </Link>

        {/* Card */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8">
          {/* Logo icon */}
          <div className="flex justify-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-[var(--green-dim)] border border-[var(--green-border)] flex items-center justify-center">
              <svg className="w-6 h-6 text-[var(--green)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" strokeWidth="2"/>
                <path strokeLinecap="round" strokeWidth="2" d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z"/>
                <path strokeLinecap="round" strokeWidth="1.5" d="M2 12h20M12 2c-3 4-3 12 0 20M12 2c3 4 3 12 0 20"/>
              </svg>
            </div>
          </div>

          <h1 className="font-[family-name:var(--font-bricolage)] text-2xl font-bold text-[var(--text)] text-center mb-1">
            Sign in
          </h1>
          <p className="text-sm text-[var(--text-2)] text-center mb-6">
            We&apos;ll send a magic link to your email
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Error state */}
            {error && (
              <div className="space-y-3">
                <div className="bg-red-500/10 border border-red-500/20 text-[var(--red)] px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
                <Link
                  href="/register"
                  className="flex items-center justify-between w-full px-4 py-3 bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text)] hover:border-[var(--text-3)] rounded-lg text-sm transition-all duration-150"
                >
                  <span>Request access</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            )}

            <div>
              <label htmlFor="email" className="sr-only">Email address</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] rounded-lg px-3 py-2.5 focus:outline-none focus:border-[var(--green)] focus:ring-1 focus:ring-[var(--green-border)] placeholder:text-[var(--text-3)] transition-all duration-150 text-sm"
                placeholder="your@email.com"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full px-4 py-2.5 bg-[var(--green)] hover:bg-green-400 text-black rounded-lg font-semibold text-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-[0_0_16px_rgba(34,197,94,0.15)]"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block w-4 h-4 rounded-full border-2 border-black border-t-transparent animate-spin" />
                  Sending...
                </span>
              ) : (
                "Send magic link"
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-[var(--text-3)] mt-4">
          Need access?{" "}
          <Link href="/register" className="text-[var(--text-2)] hover:text-[var(--text)] transition-colors">
            Request it
          </Link>
        </p>
      </div>
    </div>
  );
}
