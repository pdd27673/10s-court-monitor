"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  const errorMessages: Record<string, string> = {
    Configuration: "There is a problem with the server configuration.",
    AccessDenied: "Your email is not on the allowlist. Contact the admin for access.",
    Verification: "The login link has expired or has already been used.",
    Default: "Something went wrong. Please try again.",
  };

  const message = errorMessages[error || ""] || errorMessages.Default;
  const isAccessDenied = error === "AccessDenied";

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4 py-12">
      {/* Subtle background glow — red tint for error */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-red-600/5 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm text-center">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--text-2)] hover:text-[var(--text)] transition-colors mb-8 group"
        >
          <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform duration-150" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to home
        </Link>

        {/* Warning icon */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-[var(--red)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
        </div>

        <h1 className="font-[family-name:var(--font-bricolage)] text-2xl font-bold text-[var(--text)] mb-3">
          Sign in failed
        </h1>
        <p className="text-[var(--text-2)] text-sm mb-8">
          {message}
        </p>

        <div className="flex flex-col gap-3">
          <Link
            href="/login"
            className="w-full px-4 py-2.5 bg-[var(--green)] hover:bg-green-400 text-black rounded-lg font-semibold text-sm transition-all duration-150 text-center"
          >
            Try again
          </Link>
          {isAccessDenied && (
            <Link
              href="/register"
              className="w-full px-4 py-2.5 border border-[var(--border)] hover:border-[var(--text-3)] text-[var(--text-2)] hover:text-[var(--text)] rounded-lg font-semibold text-sm transition-all duration-150 text-center"
            >
              Request access
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
          <div className="w-6 h-6 rounded-full border-2 border-[var(--green)] border-t-transparent animate-spin" />
        </div>
      }
    >
      <ErrorContent />
    </Suspense>
  );
}
