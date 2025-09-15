"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function RedirectToDashboard() {
  const router = useRouter();
  
  useEffect(() => {
    router.push("/dashboard");
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-bold">Redirecting to dashboard...</h1>
        <p className="text-muted-foreground">You&apos;ll be redirected automatically.</p>
      </div>
    </div>
  );
}
