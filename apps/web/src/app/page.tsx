import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings, Eye, Bell } from "lucide-react";

export default function Home() {
  return (
    <div className="container mx-auto py-8">
      <SignedOut>
        <div className="flex flex-col items-center justify-center min-h-[80vh] text-center space-y-6">
          <div className="space-y-4">
            <h1 className="text-4xl font-bold tracking-tight">10s Court Monitor</h1>
            <p className="text-xl text-muted-foreground max-w-2xl">
              Never miss a tennis court booking again. Get instant notifications when your preferred courts become available.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl">
            <Card>
              <CardHeader>
                <Settings className="h-8 w-8 text-primary" />
                <CardTitle>Set Preferences</CardTitle>
                <CardDescription>
                  Choose your preferred venues, days, times, and price limits
                </CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <Eye className="h-8 w-8 text-primary" />
                <CardTitle>Monitor Courts</CardTitle>
                <CardDescription>
                  We check court availability every 10 minutes automatically
                </CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <Bell className="h-8 w-8 text-primary" />
                <CardTitle>Get Notified</CardTitle>
                <CardDescription>
                  Receive instant email and SMS alerts when courts are available
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </SignedOut>

      <SignedIn>
        <div className="space-y-8">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground">
              Welcome back! Monitor your tennis court preferences and view available courts.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Preferences
                </CardTitle>
                <CardDescription>
                  Manage your venue and notification preferences
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/preferences">
                  <Button className="w-full">
                    Configure Settings
                  </Button>
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Eye className="h-5 w-5" />
                  Available Courts
                </CardTitle>
                <CardDescription>
                  View currently available tennis courts
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/courts">
                  <Button className="w-full" variant="outline">
                    View Courts
                  </Button>
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5" />
                  Notifications
                </CardTitle>
                <CardDescription>
                  Track your notification history and settings
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" variant="secondary" disabled>
                  Coming Soon
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Quick Start</CardTitle>
              <CardDescription>
                Get started with monitoring tennis courts in just a few steps
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal list-inside space-y-2 text-sm">
                <li>
                  <Link href="/preferences" className="text-primary hover:underline">
                    Set your preferences
                  </Link> - Choose venues, days, times, and price limits
                </li>
                <li>We'll monitor court availability every 10 minutes</li>
                <li>Get instant notifications when courts become available</li>
                <li>
                  <Link href="/courts" className="text-primary hover:underline">
                    View available courts
                  </Link> anytime on the courts page
                </li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </SignedIn>
    </div>
  );
}
