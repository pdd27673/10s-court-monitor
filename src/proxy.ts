import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isOnDashboard = req.nextUrl.pathname.startsWith("/dashboard");
  const isOnLogin = req.nextUrl.pathname.startsWith("/login");

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
  matcher: ["/dashboard/:path*", "/login/:path*"],
};
