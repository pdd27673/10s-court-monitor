import { pgTable, varchar, timestamp, boolean, integer } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: varchar('id', { length: 32 }).primaryKey(),
  clerkId: varchar('clerk_id', { length: 255 }).unique().notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 20 }),
  status: varchar('status', { length: 20 }).default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userNotificationPreferences = pgTable('user_notification_preferences', {
  userId: varchar('user_id', { length: 32 }).primaryKey().references(() => users.id),
  emailEnabled: boolean('email_enabled').default(true).notNull(),
  smsEnabled: boolean('sms_enabled').default(false).notNull(),
  quietHoursStart: integer('quiet_hours_start').default(22), // 22:00 (10 PM)
  quietHoursEnd: integer('quiet_hours_end').default(7),      // 07:00 (7 AM)
  maxNotificationsPerDay: integer('max_notifications_per_day').default(10).notNull(),
  notificationCooldownMinutes: integer('notification_cooldown_minutes').default(30).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Relations will be defined in a separate relations file to avoid circular imports
