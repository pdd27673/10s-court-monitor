"use client";

import { useEffect, useMemo } from "react";

// Custom scheme registered by the Expo app (app.json "scheme").
const APP_SCHEME = "10smobile";

/**
 * Hands the one-time sign-in token off to the mobile app. The backend emails an
 * https link to this page (works in every mail client); the page then opens the
 * app via its custom scheme. Universal Links can replace this later by adding
 * the domain to the app's associatedDomains.
 */
export function MobileAuthRedirect({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const deepLink = useMemo(
    () =>
      `${APP_SCHEME}://auth?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`,
    [token, email]
  );

  useEffect(() => {
    if (token && email) {
      window.location.href = deepLink;
    }
  }, [deepLink, token, email]);

  const valid = Boolean(token && email);

  return (
    <div
      style={{
        fontFamily: "sans-serif",
        maxWidth: 480,
        margin: "0 auto",
        padding: "48px 24px",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 24 }}>🎾 Time for Tennis</h1>
      {valid ? (
        <>
          <p style={{ color: "#555" }}>Opening the app to sign you in…</p>
          <a
            href={deepLink}
            style={{
              display: "inline-block",
              background: "#22c55e",
              color: "white",
              padding: "12px 24px",
              textDecoration: "none",
              borderRadius: 6,
              marginTop: 16,
            }}
          >
            Open the app
          </a>
          <p style={{ color: "#999", fontSize: 13, marginTop: 24 }}>
            If nothing happens, make sure the app is installed on this device,
            then tap the button above.
          </p>
        </>
      ) : (
        <p style={{ color: "#b91c1c" }}>
          This sign-in link is invalid or incomplete. Please request a new one
          from the app.
        </p>
      )}
    </div>
  );
}
