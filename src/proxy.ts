import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { createBlockLogger } from "@/lib/block-log";

// List of suspicious paths that bots commonly probe for
const BLOCKED_PATHS = [
  '/wp-admin',
  '/wp-content',
  '/wp-includes',
  '/wordpress',
  '/wp-',
  '.php',
  '/cgi-bin',
  '/admin.php',
  '/adminfuns.php',
  '/alfa.php',
  '/about.php',
  '/info.php',
  '/file.php',
  '/xmlrpc.php',
  '/.env',
  '/.git',
  '/phpmyadmin',
  // NOTE: /.well-known/acme-challenge must NOT be listed here. It is not an
  // attack surface — it is how Let's Encrypt proves domain ownership to issue
  // and renew a TLS certificate. Railway terminates TLS at its edge today, so
  // blocking it broke nothing, but it would silently fail cert renewal the
  // moment a custom certificate is introduced.
]

// Malicious/scanning user agents to block
const BLOCKED_USER_AGENTS = [
  'sqlmap',
  'nikto',
  'masscan',
  'nmap',
  'zgrab',
  'shodan',
  'censys',
  'scanning',
  'vulnerability',
  'exploit',
  'hack',
]

// Scanner probes are constant background traffic on any public host, and one
// log line each buries everything else. Railway's retention is finite, so a
// steady drip of these evicts the logs you actually need — during the
// 2026-07-28 Courtside outage the ingest logs were competing with hundreds of
// blocked-probe lines per hour. Aggregate instead: same signal, ~1 line per
// window. See src/lib/block-log.ts for the windowing and the bounds on the
// attacker-controlled key.
const blockLogger = createBlockLogger()

export default auth((req) => {
  const { pathname } = req.nextUrl
  const userAgent = req.headers.get('user-agent')?.toLowerCase() || ''

  // Block suspicious paths
  for (const blockedPath of BLOCKED_PATHS) {
    if (pathname.toLowerCase().includes(blockedPath.toLowerCase())) {
      blockLogger.record(pathname)
      return new NextResponse('Not Found', { status: 404 })
    }
  }

  // Block suspicious user agents
  for (const blockedAgent of BLOCKED_USER_AGENTS) {
    if (userAgent.includes(blockedAgent.toLowerCase())) {
      blockLogger.record(`ua:${blockedAgent}`)
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  // Auth logic
  const isLoggedIn = !!req.auth;
  const isOnDashboard = pathname.startsWith("/dashboard");
  const isOnLogin = pathname.startsWith("/login");
  const isGuestMode = req.nextUrl.searchParams.get("guest") === "true";

  // Allow guest access to dashboard
  if (isOnDashboard && isGuestMode) {
    return NextResponse.next();
  }

  // Redirect unauthenticated users from dashboard to login
  if (isOnDashboard && !isLoggedIn) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // Redirect authenticated users from login to dashboard
  if (isOnLogin && isLoggedIn) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)',
  ],
};
