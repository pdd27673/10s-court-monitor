"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    email: "",
    name: "",
    reason: "",
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to submit registration request");
      }

      setMessage({
        type: "success",
        text: data.message || "Your request has been submitted successfully!",
      });
      setSubmitted(true);
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "An error occurred. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4 py-12">
        <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-green-600/5 blur-[120px]" />
        </div>

        <div className="relative z-10 w-full max-w-sm text-center">
          {/* Back link */}
          <button
            onClick={() => router.push("/")}
            className="inline-flex items-center gap-1.5 text-sm text-[var(--text-2)] hover:text-[var(--text)] transition-colors mb-8 group cursor-pointer"
          >
            <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform duration-150" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to home
          </button>

          {/* Checkmark icon */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-[var(--green-dim)] border border-[var(--green-border)] flex items-center justify-center">
              <svg className="w-8 h-8 text-[var(--green)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>

          <h1 className="font-[family-name:var(--font-bricolage)] text-2xl font-bold text-[var(--text)] mb-3">
            Request submitted
          </h1>
          <p className="text-[var(--text-2)] text-sm mb-8 leading-relaxed">
            Your registration request is under review. We&apos;ll email you once it&apos;s been approved.
          </p>

          <div className="flex flex-col gap-3">
            <Link
              href="/"
              className="w-full px-4 py-2.5 bg-[var(--green)] hover:bg-green-400 text-black rounded-lg font-semibold text-sm transition-all duration-150 text-center"
            >
              Back to homepage
            </Link>
            <Link
              href="/login"
              className="w-full px-4 py-2.5 border border-[var(--border)] hover:border-[var(--text-3)] text-[var(--text-2)] hover:text-[var(--text)] rounded-lg font-semibold text-sm transition-all duration-150 text-center"
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4 py-12">
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-green-600/5 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        {/* Back link */}
        <button
          onClick={() => router.push("/")}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--text-2)] hover:text-[var(--text)] transition-colors mb-8 group cursor-pointer"
        >
          <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform duration-150" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Time for Tennis
        </button>

        {/* Card */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8">
          <h1 className="font-[family-name:var(--font-bricolage)] text-2xl font-bold text-[var(--text)] mb-1">
            Request access
          </h1>
          <p className="text-sm text-[var(--text-2)] mb-6">
            Get notified when London tennis courts become available.
          </p>

          {message && (
            <div
              className={`mb-5 px-4 py-3 rounded-lg text-sm ${
                message.type === "success"
                  ? "bg-[var(--green-dim)] border border-[var(--green-border)] text-[var(--green)]"
                  : "bg-red-500/10 border border-red-500/20 text-[var(--red)]"
              }`}
            >
              {message.text}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-[var(--text-2)] mb-1.5">
                Email address <span className="text-[var(--red)]">*</span>
              </label>
              <input
                type="email"
                id="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--green)] focus:ring-1 focus:ring-[var(--green-border)] placeholder:text-[var(--text-3)] transition-all duration-150"
                placeholder="your@email.com"
              />
            </div>

            <div>
              <label htmlFor="name" className="block text-xs font-medium text-[var(--text-2)] mb-1.5">
                Name <span className="text-[var(--text-3)]">(optional)</span>
              </label>
              <input
                type="text"
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--green)] focus:ring-1 focus:ring-[var(--green-border)] placeholder:text-[var(--text-3)] transition-all duration-150"
                placeholder="Your name"
              />
            </div>

            <div>
              <label htmlFor="reason" className="block text-xs font-medium text-[var(--text-2)] mb-1.5">
                Why do you want access? <span className="text-[var(--red)]">*</span>
              </label>
              <textarea
                id="reason"
                required
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                className="w-full bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--green)] focus:ring-1 focus:ring-[var(--green-border)] placeholder:text-[var(--text-3)] transition-all duration-150 resize-none min-h-[80px]"
                placeholder="Tell us why you'd like to use Time for Tennis"
                minLength={10}
              />
              <p className={`text-xs mt-1 tabular-nums font-[family-name:var(--font-mono)] ${
                formData.reason.length >= 10 ? "text-[var(--green)]" : "text-[var(--text-3)]"
              }`}>
                {formData.reason.length}/10 min characters
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2.5 bg-[var(--green)] hover:bg-green-400 text-black rounded-lg font-semibold text-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-[0_0_16px_rgba(34,197,94,0.15)] mt-1"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="inline-block w-4 h-4 rounded-full border-2 border-black border-t-transparent animate-spin" />
                  Submitting...
                </span>
              ) : (
                "Submit request"
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-[var(--text-3)] mt-4">
          Already approved?{" "}
          <Link href="/login" className="text-[var(--text-2)] hover:text-[var(--text)] transition-colors">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
