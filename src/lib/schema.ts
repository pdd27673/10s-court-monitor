import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const venues = sqliteTable("venues", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const slots = sqliteTable("slots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  venueId: integer("venue_id").references(() => venues.id),
  date: text("date").notNull(),
  time: text("time").notNull(),
  court: text("court").notNull(),
  status: text("status").notNull(), // 'available', 'booked', 'closed'
  price: text("price"),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const watches = sqliteTable("watches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id),
  venueId: integer("venue_id").references(() => venues.id), // null = all venues
  preferredTimes: text("preferred_times"), // JSON array like ["17:00","18:00"]
  weekdaysOnly: integer("weekdays_only").default(0),
  weekendsOnly: integer("weekends_only").default(0),
  active: integer("active").default(1),
});

export const notificationChannels = sqliteTable("notification_channels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id),
  type: text("type").notNull(), // 'telegram', 'whatsapp', 'email'
  destination: text("destination").notNull(), // chat_id, phone, or email
  active: integer("active").default(1),
});

export const notificationLog = sqliteTable("notification_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id),
  channelId: integer("channel_id").references(() => notificationChannels.id),
  slotKey: text("slot_key").notNull(), // "venue:date:time:court"
  sentAt: text("sent_at").default(sql`CURRENT_TIMESTAMP`),
});

// Type exports
export type User = typeof users.$inferSelect;
export type Venue = typeof venues.$inferSelect;
export type Slot = typeof slots.$inferSelect;
export type Watch = typeof watches.$inferSelect;
export type NotificationChannel = typeof notificationChannels.$inferSelect;
export type NotificationLogEntry = typeof notificationLog.$inferSelect;
