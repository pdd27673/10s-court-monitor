import { pgTable, varchar, timestamp, decimal, text } from 'drizzle-orm/pg-core';
import { users } from './users';
import { courtSlots } from './venues';

export const notificationsSent = pgTable('notifications_sent', {
  id: varchar('id', { length: 32 }).primaryKey(),
  userId: varchar('user_id', { length: 32 }).references(() => users.id).notNull(),
  courtSlotId: varchar('court_slot_id', { length: 32 }).references(() => courtSlots.id).notNull(),
  notificationType: varchar('notification_type', { length: 20 }).notNull(), // 'email' or 'sms'
  provider: varchar('provider', { length: 50 }).notNull(), // 'resend', 'telnyx', etc.
  status: varchar('status', { length: 20 }).notNull(), // 'sent', 'failed', 'pending'
  cost: decimal('cost', { precision: 8, scale: 4 }), // Cost in GBP
  errorMessage: text('error_message'),
  providerMessageId: varchar('provider_message_id', { length: 255 }),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Relations will be defined in a separate relations file to avoid circular imports
