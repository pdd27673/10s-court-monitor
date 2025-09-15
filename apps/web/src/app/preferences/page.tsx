import { PreferencesForm } from "@/components/preferences-form";
import { Settings } from "lucide-react";

export default function PreferencesPage() {
  return (
    <div className="min-h-screen bg-background -mx-4 sm:-mx-6 lg:-mx-8">
      <div className="w-full">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <div className="space-y-8">
          {/* Header Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center">
                <Settings className="h-6 w-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-4xl font-bold tracking-tight">Preferences</h1>
                <p className="text-xl text-muted-foreground">
                  Manage your court monitoring and notification preferences
                </p>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="w-full max-w-4xl mx-auto bg-card rounded-2xl border shadow-sm">
            <div className="p-8">
              <PreferencesForm />
            </div>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}