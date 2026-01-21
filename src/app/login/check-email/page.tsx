export default function CheckEmailPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 text-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">📧 Check your email</h1>
          <p className="mt-4 text-lg text-gray-600">
            We&apos;ve sent you a magic link to sign in.
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Click the link in the email to access your dashboard.
          </p>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm text-yellow-800">
            <strong>Tip:</strong> Check your spam folder if you don&apos;t see the email.
          </p>
        </div>

        <a
          href="/login"
          className="inline-block text-green-600 hover:text-green-700 text-sm font-medium"
        >
          ← Back to login
        </a>
      </div>
    </div>
  );
}
