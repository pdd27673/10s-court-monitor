import { relations } from 'drizzle-orm';
import { users, userNotificationPreferences } from './users';
import { venues, userVenuePreferences, courtSlots } from './venues';
import { notificationsSent } from './notifications';
import { scrapingLogs } from './logs';

// User relations
export const usersRelations = relations(users, ({ one, many }) => ({
  notificationPreferences: one(userNotificationPreferences),
  venuePreferences: many(userVenuePreferences),
  notificationsSent: many(notificationsSent),
}));

export const userNotificationPreferencesRelations = relations(userNotificationPreferences, ({ one }) => ({
  user: one(users, {
    fields: [userNotificationPreferences.userId],
    references: [users.id],
  }),
}));

// Venue relations
export const venuesRelations = relations(venues, ({ many }) => ({
  userPreferences: many(userVenuePreferences),
  courtSlots: many(courtSlots),
  scrapingLogs: many(scrapingLogs),
}));

export const userVenuePreferencesRelations = relations(userVenuePreferences, ({ one }) => ({
  user: one(users, {
    fields: [userVenuePreferences.userId],
    references: [users.id],
  }),
  venue: one(venues, {
    fields: [userVenuePreferences.venueId],
    references: [venues.id],
  }),
}));

export const courtSlotsRelations = relations(courtSlots, ({ one, many }) => ({
  venue: one(venues, {
    fields: [courtSlots.venueId],
    references: [venues.id],
  }),
  notificationsSent: many(notificationsSent),
}));

// Notification relations
export const notificationsSentRelations = relations(notificationsSent, ({ one }) => ({
  user: one(users, {
    fields: [notificationsSent.userId],
    references: [users.id],
  }),
  courtSlot: one(courtSlots, {
    fields: [notificationsSent.courtSlotId],
    references: [courtSlots.id],
  }),
}));

// Log relations
export const scrapingLogsRelations = relations(scrapingLogs, ({ one }) => ({
  venue: one(venues, {
    fields: [scrapingLogs.venueId],
    references: [venues.id],
  }),
}));

