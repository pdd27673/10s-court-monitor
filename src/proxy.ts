import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

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
  '/.well-known/acme-challenge', // Block ACME challenge attempts
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

export default auth((req) => {
  const { pathname } = req.nextUrl
  const userAgent = req.headers.get('user-agent')?.toLowerCase() || ''

  // Block suspicious paths
  for (const blockedPath of BLOCKED_PATHS) {
    if (pathname.toLowerCase().includes(blockedPath.toLowerCase())) {
      console.log(`🚫 Blocked suspicious request: ${pathname}`)
      return new NextResponse('Not Found', { status: 404 })
    }
  }

  // Block suspicious user agents
  for (const blockedAgent of BLOCKED_USER_AGENTS) {
    if (userAgent.includes(blockedAgent.toLowerCase())) {
      console.log(`🚫 Blocked suspicious user agent: ${userAgent}`)
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
