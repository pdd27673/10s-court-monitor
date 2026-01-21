"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 text-center">
        <div>
          <h1 className="text-3xl font-bold text-red-600">⚠️ Sign in failed</h1>
          <p className="mt-4 text-lg text-gray-600">{message}</p>
        </div>

        <a
          href="/login"
          className="inline-block bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700"
        >
          Try again
        </a>
      </div>
    </div>
  );
}

export default function ErrorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <ErrorContent />
    </Suspense>
  );
}
