import { PreferencesForm } from "@/components/preferences-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function PreferencesPage() {
  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Preferences</h1>
          <p className="text-muted-foreground">
            Manage your court monitoring and notification preferences.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Court Monitoring Preferences</CardTitle>
            <CardDescription>
              Set your preferred venues, days, times, and price limits for court monitoring.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PreferencesForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}