import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles } from "lucide-react";
import { TextGenerateEffect } from "@/components/ui/text-generate-effect";
import { HoverEffect } from "@/components/ui/card-hover-effect";

const dashboardItems = [
  {
    title: "Preferences",
    description: "Manage your venue and notification preferences with our intuitive interface",
    link: "/preferences",
  },
  {
    title: "Available Courts",
    description: "View currently available tennis courts in real-time",
    link: "/courts", 
  },
  {
    title: "Notifications",
    description: "Track your notification history and manage alert settings",
    link: "#",
  },
];

export default async function DashboardPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/");
  }

  const user = await currentUser();
  const displayName = user?.firstName || user?.emailAddresses[0]?.emailAddress?.split('@')[0] || 'there';

  return (
    <div className="min-h-screen bg-background -mx-4 sm:-mx-6 lg:-mx-8">
      <div className="w-full">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <div className="space-y-12">
          <div className="space-y-4 text-center">
            <TextGenerateEffect
              words={`Hello ${displayName}`}
              className="text-5xl font-bold tracking-tight"
            />
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Monitor your tennis court preferences and view available courts.
            </p>
          </div>

          <div className="w-full max-w-5xl mx-auto">
            <HoverEffect items={dashboardItems} />
          </div>

          <Card className="w-full max-w-4xl mx-auto border-l-4 border-l-primary shadow-lg">
            <CardHeader>
              <CardTitle className="text-2xl flex items-center gap-2">
                <Sparkles className="h-6 w-6 text-primary" />
                Quick Start Guide
              </CardTitle>
              <CardDescription className="text-base">
                Get started with monitoring tennis courts in just a few steps
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-6">
                <li className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-bold mt-0.5 shadow-lg">
                    1
                  </div>
                  <div>
                    <Link href="/preferences" className="text-primary hover:underline font-semibold text-lg">
                      Set your preferences
                    </Link>
                    <p className="text-muted-foreground mt-1">Choose venues, days, times, and price limits</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-bold mt-0.5 shadow-lg">
                    2
                  </div>
                  <div>
                    <p className="font-semibold text-lg">Automatic monitoring</p>
                    <p className="text-muted-foreground mt-1">We&apos;ll monitor court availability every 10 minutes automatically</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-bold mt-0.5 shadow-lg">
                    3
                  </div>
                  <div>
                    <p className="font-semibold text-lg">Get notified</p>
                    <p className="text-muted-foreground mt-1">Receive instant notifications when courts become available</p>
                  </div>
                </li>
                <li className="flex items-start gap-4">
                  <div className="w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-bold mt-0.5 shadow-lg">
                    4
                  </div>
                  <div>
                    <Link href="/courts" className="text-primary hover:underline font-semibold text-lg">
                      View available courts
                    </Link>
                    <p className="text-muted-foreground mt-1">Check court availability anytime on the courts page</p>
                  </div>
                </li>
              </ol>
            </CardContent>
          </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
