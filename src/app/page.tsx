import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold mb-4">🎾 Time for Tennis</h1>
      <p className="text-gray-600 dark:text-gray-400 mb-8 text-center max-w-md">
        Get notified when tennis courts become available across London.
        Never miss a slot again.
      </p>

      <div className="flex flex-col sm:flex-row gap-4">
        <Link
          href="/login"
          className="px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors text-center"
        >
          Sign In
        </Link>
        <Link
          href="/dashboard?guest=true"
          className="px-6 py-3 border border-gray-300 dark:border-gray-700 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-center"
        >
          View as Guest
        </Link>
        <Link
          href="/register"
          className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors text-center"
        >
          Request Access
        </Link>
      </div>

      <div className="mt-16 text-center text-sm text-gray-500 dark:text-gray-400">
        <p>Monitors London Tennisvenues every 10 minutes</p>
        <p className="mt-1">Notifications via Telegram or Email</p>
      </div>
    </main>
  );
}
