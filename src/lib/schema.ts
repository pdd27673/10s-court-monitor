import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ============================================
// App-specific tables
// ============================================

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name"),
  emailVerified: text("email_verified"), // Required by NextAuth
  image: text("image"), // Required by NextAuth
  isAllowed: integer("is_allowed").default(0), // Allowlist: 1 = can log in
  isAdmin: integer("is_admin").default(0), // Admin: 1 = can access admin dashboard
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
  status: text("status").notNull(), // 'available', 'booked', 'closed', 'coaching'
  price: text("price"),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const watches = sqliteTable("watches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id),
  venueId: integer("venue_id").references(() => venues.id), // null = all venues
  weekdayTimes: text("weekday_times"), // JSON array like ["16:00","17:00","18:00"]
  weekendTimes: text("weekend_times"), // JSON array like ["11:00","12:00","13:00"]
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

export const registrationRequests = sqliteTable("registration_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  name: text("name"),
  reason: text("reason"), // Why they want access
  status: text("status").default("pending"), // pending | approved | rejected
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  reviewedAt: text("reviewed_at"),
  reviewedBy: integer("reviewed_by").references(() => users.id), // Admin user ID who reviewed
});

// ============================================
// NextAuth tables (JWT sessions - no sessions table needed)
// ============================================

export const verificationTokens = sqliteTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(), // email address
    token: text("token").notNull(),
    expires: text("expires").notNull(), // ISO string for Date compatibility
  },
  (table) => ({
    compositePk: primaryKey({ columns: [table.identifier, table.token] }),
  })
);

// ============================================
// Type exports
// ============================================

export type User = typeof users.$inferSelect;
export type Venue = typeof venues.$inferSelect;
export type Slot = typeof slots.$inferSelect;
export type Watch = typeof watches.$inferSelect;
export type NotificationChannel = typeof notificationChannels.$inferSelect;
export type NotificationLogEntry = typeof notificationLog.$inferSelect;
export type VerificationToken = typeof verificationTokens.$inferSelect;
export type RegistrationRequest = typeof registrationRequests.$inferSelect;
