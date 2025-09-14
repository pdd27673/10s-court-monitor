"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Plus, Trash2, AlertCircle } from "lucide-react";

const formSchema = z.object({
  notificationPreferences: z.object({
    emailEnabled: z.boolean(),
    smsEnabled: z.boolean(),
    quietHoursStart: z.number().min(0).max(23),
    quietHoursEnd: z.number().min(0).max(23),
    maxNotificationsPerDay: z.number().min(1).max(100),
    notificationCooldownMinutes: z.number().min(1).max(1440),
  }),
  venuePreferences: z.array(
    z.object({
      venueId: z.string().min(1, "Please select a venue"),
      preferredDays: z.array(z.number().min(1).max(7)).min(1, "Select at least one day"),
      preferredTimeStart: z.number().min(0).max(23),
      preferredTimeEnd: z.number().min(0).max(23),
      maxPricePerHour: z.number().optional(),
    })
  ).refine((venues) => {
    // Check for duplicate venues
    const venueIds = venues.map(v => v.venueId);
    return new Set(venueIds).size === venueIds.length;
  }, "Each venue can only be selected once").refine((venues) => {
    // Check time ranges
    return venues.every(v => v.preferredTimeStart < v.preferredTimeEnd);
  }, "Start time must be before end time"),
});

type FormData = z.infer<typeof formSchema>;

const DAYS_OF_WEEK = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
];

export function PreferencesForm() {
  const queryClient = useQueryClient();

  // Fetch preferences data
  const { data, isLoading, error } = useQuery({
    queryKey: ["preferences"],
    queryFn: async () => {
      const response = await fetch("/api/preferences");
      if (!response.ok) {
        throw new Error("Failed to fetch preferences");
      }
      return response.json();
    },
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      notificationPreferences: {
        emailEnabled: true,
        smsEnabled: false,
        quietHoursStart: 22,
        quietHoursEnd: 7,
        maxNotificationsPerDay: 10,
        notificationCooldownMinutes: 30,
      },
      venuePreferences: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "venuePreferences",
  });

  // Track if we've already initialized the form
  const [hasInitialized, setHasInitialized] = useState(false);

  // Update form when data is loaded
  useEffect(() => {
    if (data && !hasInitialized) {
      form.reset({
        notificationPreferences: data.notificationPreferences,
        venuePreferences: data.venuePreferences.map((pref: any) => ({
          ...pref,
          maxPricePerHour: pref.maxPricePerHour ? parseFloat(pref.maxPricePerHour) : undefined,
        })),
      });
      setHasInitialized(true);
    }
  }, [data, hasInitialized]);

  const saveMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const response = await fetch("/api/preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save preferences");
      }

      return response.json();
    },
    onSuccess: () => {
      toast.success("Preferences saved successfully!");
      queryClient.invalidateQueries({ queryKey: ["preferences"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const onSubmit = (data: FormData) => {
    // Additional client-side validation
    for (const venuePref of data.venuePreferences) {
      if (venuePref.preferredTimeStart >= venuePref.preferredTimeEnd) {
        toast.error("Start time must be before end time for all venues");
        return;
      }
      if (venuePref.preferredDays.length === 0) {
        toast.error("Please select at least one day for each venue");
        return;
      }
    }

    // Check for duplicate venues
    const venueIds = data.venuePreferences.map(v => v.venueId);
    const uniqueVenueIds = new Set(venueIds);
    if (uniqueVenueIds.size !== venueIds.length) {
      toast.error("Each venue can only be selected once");
      return;
    }

    saveMutation.mutate(data);
  };

  const addVenuePreference = () => {
    append({
      venueId: "",
      preferredDays: [1, 2, 3, 4, 5, 6, 7],
      preferredTimeStart: 6,
      preferredTimeEnd: 22,
      maxPricePerHour: undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="ml-2">Loading preferences...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-destructive">
        Failed to load preferences. Please try again.
      </div>
    );
  }

  // Show form validation errors
  const formErrors = form.formState.errors;
  const hasFormErrors = Object.keys(formErrors).length > 0;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      {hasFormErrors && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please fix the following errors before saving:
            <ul className="mt-2 list-disc list-inside">
              {formErrors.venuePreferences?.message && (
                <li>{formErrors.venuePreferences.message}</li>
              )}
              {formErrors.venuePreferences?.root?.message && (
                <li>{formErrors.venuePreferences.root.message}</li>
              )}
              {Array.isArray(formErrors.venuePreferences) &&
                formErrors.venuePreferences.map((error, index) => (
                  error && (
                    <li key={index}>
                      Venue {index + 1}: {error.venueId?.message || error.preferredDays?.message || "Invalid configuration"}
                    </li>
                  )
                ))
              }
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {/* Notification Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Notification Settings</CardTitle>
          <CardDescription>
            Configure how and when you receive notifications.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Email Notifications</Label>
              <div className="text-sm text-muted-foreground">
                Receive court availability notifications via email
              </div>
            </div>
            <Switch
              checked={form.watch("notificationPreferences.emailEnabled")}
              onCheckedChange={(checked) =>
                form.setValue("notificationPreferences.emailEnabled", checked)
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>SMS Notifications</Label>
              <div className="text-sm text-muted-foreground">
                Receive court availability notifications via SMS
              </div>
            </div>
            <Switch
              checked={form.watch("notificationPreferences.smsEnabled")}
              onCheckedChange={(checked) =>
                form.setValue("notificationPreferences.smsEnabled", checked)
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quietStart">Quiet Hours Start</Label>
              <Select
                value={form.watch("notificationPreferences.quietHoursStart").toString()}
                onValueChange={(value) =>
                  form.setValue("notificationPreferences.quietHoursStart", parseInt(value))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, i) => (
                    <SelectItem key={i} value={i.toString()}>
                      {i.toString().padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quietEnd">Quiet Hours End</Label>
              <Select
                value={form.watch("notificationPreferences.quietHoursEnd").toString()}
                onValueChange={(value) =>
                  form.setValue("notificationPreferences.quietHoursEnd", parseInt(value))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, i) => (
                    <SelectItem key={i} value={i.toString()}>
                      {i.toString().padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="maxNotifications">Max Notifications Per Day</Label>
              <Input
                id="maxNotifications"
                type="number"
                min="1"
                max="100"
                {...form.register("notificationPreferences.maxNotificationsPerDay", {
                  valueAsNumber: true,
                })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cooldown">Cooldown (minutes)</Label>
              <Input
                id="cooldown"
                type="number"
                min="1"
                max="1440"
                {...form.register("notificationPreferences.notificationCooldownMinutes", {
                  valueAsNumber: true,
                })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Venue Preferences */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Venue Preferences</CardTitle>
              <CardDescription>
                Set monitoring preferences for each venue you're interested in.
              </CardDescription>
            </div>
            <Button type="button" variant="outline" onClick={addVenuePreference}>
              <Plus className="h-4 w-4 mr-2" />
              Add Venue
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {fields.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No venue preferences set. Click "Add Venue" to get started.
            </div>
          ) : (
            <div className="space-y-6">
              {fields.map((field, index) => (
                <Card key={field.id} className="border-l-4 border-l-blue-500">
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between mb-4">
                      <h4 className="font-medium">Venue {index + 1}</h4>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid gap-4">
                      <div className="space-y-2">
                        <Label>Select Venue</Label>
                        <Select
                          value={form.watch(`venuePreferences.${index}.venueId`)}
                          onValueChange={(value) =>
                            form.setValue(`venuePreferences.${index}.venueId`, value)
                          }
                        >
                          <SelectTrigger className={formErrors.venuePreferences?.[index]?.venueId ? "border-destructive" : ""}>
                            <SelectValue placeholder="Choose a venue" />
                          </SelectTrigger>
                          <SelectContent>
                            {data?.availableVenues?.map((venue: any) => (
                              <SelectItem key={venue.id} value={venue.id}>
                                {venue.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {formErrors.venuePreferences?.[index]?.venueId && (
                          <p className="text-sm text-destructive">
                            {formErrors.venuePreferences[index]?.venueId?.message}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>Preferred Days</Label>
                        <div className="grid grid-cols-4 gap-2">
                          {DAYS_OF_WEEK.map((day) => (
                            <div key={day.value} className="flex items-center space-x-2">
                              <Checkbox
                                id={`day-${index}-${day.value}`}
                                checked={form
                                  .watch(`venuePreferences.${index}.preferredDays`)
                                  .includes(day.value)}
                                onCheckedChange={(checked) => {
                                  const currentDays = form.watch(
                                    `venuePreferences.${index}.preferredDays`
                                  );
                                  if (checked) {
                                    form.setValue(
                                      `venuePreferences.${index}.preferredDays`,
                                      [...currentDays, day.value]
                                    );
                                  } else {
                                    form.setValue(
                                      `venuePreferences.${index}.preferredDays`,
                                      currentDays.filter((d) => d !== day.value)
                                    );
                                  }
                                }}
                              />
                              <Label
                                htmlFor={`day-${index}-${day.value}`}
                                className="text-sm font-normal"
                              >
                                {day.label.slice(0, 3)}
                              </Label>
                            </div>
                          ))}
                        </div>
                        {formErrors.venuePreferences?.[index]?.preferredDays && (
                          <p className="text-sm text-destructive">
                            {formErrors.venuePreferences[index]?.preferredDays?.message}
                          </p>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Earliest Time</Label>
                          <Select
                            value={form
                              .watch(`venuePreferences.${index}.preferredTimeStart`)
                              .toString()}
                            onValueChange={(value) =>
                              form.setValue(
                                `venuePreferences.${index}.preferredTimeStart`,
                                parseInt(value)
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 24 }, (_, i) => (
                                <SelectItem key={i} value={i.toString()}>
                                  {i.toString().padStart(2, "0")}:00
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label>Latest Time</Label>
                          <Select
                            value={form
                              .watch(`venuePreferences.${index}.preferredTimeEnd`)
                              .toString()}
                            onValueChange={(value) =>
                              form.setValue(
                                `venuePreferences.${index}.preferredTimeEnd`,
                                parseInt(value)
                              )
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 24 }, (_, i) => (
                                <SelectItem key={i} value={i.toString()}>
                                  {i.toString().padStart(2, "0")}:00
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`price-${index}`}>Max Price Per Hour (optional)</Label>
                        <Input
                          id={`price-${index}`}
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="e.g. 15.00"
                          {...form.register(`venuePreferences.${index}.maxPricePerHour`, {
                            valueAsNumber: true,
                          })}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={saveMutation.isPending}>
          {saveMutation.isPending && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Save Preferences
        </Button>
      </div>
    </form>
  );
}