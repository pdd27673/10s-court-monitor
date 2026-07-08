import { MobileAuthRedirect } from "./redirect";

// Bridge page for the mobile magic-link flow. The email link points here
// (https, universally clickable); this then deep-links into the Expo app.
export default async function MobileAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const email = typeof sp.email === "string" ? sp.email : "";
  return <MobileAuthRedirect token={token} email={email} />;
}
