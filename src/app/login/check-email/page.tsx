import Link from "next/link";

export default function CheckEmailPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4 py-12">
      {/* Subtle background glow */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-green-600/5 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-sm text-center">
        {/* Envelope icon */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-[var(--green-dim)] border border-[var(--green-border)] flex items-center justify-center">
            <svg className="w-8 h-8 text-[var(--green)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
        </div>

        <h1 className="font-[family-name:var(--font-bricolage)] text-2xl font-bold text-[var(--text)] mb-3">
          Check your email
        </h1>
        <p className="text-[var(--text-2)] text-sm mb-2">
          We sent a magic link to your inbox.
        </p>
        <p className="text-[var(--text-2)] text-sm mb-8">
          Click it to access your dashboard.
        </p>

        {/* Spam tip */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3 mb-8">
          <p className="text-xs text-[var(--text-2)]">
            <span className="text-[var(--amber)] font-medium">Tip</span> — Check your spam folder if you don&apos;t see it within a minute.
          </p>
        </div>

        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--text-2)] hover:text-[var(--text)] transition-colors group"
        >
          <svg className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform duration-150" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
