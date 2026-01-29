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
    } catch (error: any) {
      setMessage({
        type: "error",
        text: error.message || "An error occurred. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-black rounded-lg shadow-lg p-8">
          <button
            onClick={() => router.push("/")}
            className="mb-4 text-gray-400 hover:text-white transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Home
          </button>
          <div className="text-center">
            <div className="mb-4">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mx-auto">
                <svg
                  className="w-8 h-8 text-green-600 dark:text-green-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
            </div>
            <h1 className="text-2xl font-bold mb-4 text-white">Request Submitted!</h1>
            <p className="text-gray-300 mb-6">
              Your registration request has been submitted for approval. We&apos;ll review your
              request and send you an email once it&apos;s been processed.
            </p>
            <div className="space-y-3">
              <Link
                href="/"
                className="block w-full px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
              >
                Go to Homepage
              </Link>
              <Link
                href="/login"
                className="block w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md w-full bg-black rounded-lg shadow-lg p-8">
        <button
          onClick={() => router.push("/")}
          className="mb-4 text-gray-400 hover:text-white transition-colors flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Home
        </button>
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold mb-2 text-white">Request Access</h1>
          <p className="text-gray-300">
            Sign up for Time for Tennis court notifications
          </p>
        </div>

        {message && (
          <div
            className={`mb-6 p-4 rounded-lg ${
              message.type === "success"
                ? "bg-green-900/30 border border-green-700 text-green-200"
                : "bg-red-900/30 border border-red-700 text-red-200"
            }`}
          >
            <p className="text-sm">{message.text}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-2 text-white">
              Email Address *
            </label>
            <input
              type="email"
              id="email"
              required
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full p-3 border border-gray-600 rounded-lg bg-[#0a0a0a] text-white placeholder-gray-400"
              placeholder="your@email.com"
            />
          </div>

          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-2 text-white">
              Name (optional)
            </label>
            <input
              type="text"
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full p-3 border border-gray-600 rounded-lg bg-[#0a0a0a] text-white placeholder-gray-400"
              placeholder="Your name"
            />
          </div>

          <div>
            <label htmlFor="reason" className="block text-sm font-medium mb-2 text-white">
              Why do you want access? *
            </label>
            <textarea
              id="reason"
              required
              value={formData.reason}
              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
              className="w-full p-3 border border-gray-600 rounded-lg bg-[#0a0a0a] text-white placeholder-gray-400 min-h-[100px]"
              placeholder="Tell us why you'd like to use Time for Tennis (minimum 10 characters)"
              minLength={10}
            />
            <p className="text-xs text-gray-400 mt-1">
              {formData.reason.length}/10 characters minimum
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Submitting..." : "Submit Request"}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-300">
          Already approved?{" "}
          <Link href="/login" className="text-green-400 hover:underline font-medium">
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
