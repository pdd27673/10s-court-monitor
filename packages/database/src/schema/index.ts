// Export all tables
export * from './users';
export * from './venues';
export * from './notifications';
export * from './logs';
export * from './relations';

// Re-export for convenience
import { users, userNotificationPreferences } from './users';
import { venues, userVenuePreferences, courtSlots } from './venues';
import { notificationsSent } from './notifications';
import { scrapingLogs } from './logs';
import {
  usersRelations,
  userNotificationPreferencesRelations,
  venuesRelations,
  userVenuePreferencesRelations,
  courtSlotsRelations,
  notificationsSentRelations,
  scrapingLogsRelations,
} from './relations';

export const schema = {
  // User tables
  users,
  userNotificationPreferences,
  
  // Venue tables
  venues,
  userVenuePreferences,
  courtSlots,
  
  // Notification tables
  notificationsSent,
  
  // Log tables
  scrapingLogs,
  
  // Relations
  usersRelations,
  userNotificationPreferencesRelations,
  venuesRelations,
  userVenuePreferencesRelations,
  courtSlotsRelations,
  notificationsSentRelations,
  scrapingLogsRelations,
};
