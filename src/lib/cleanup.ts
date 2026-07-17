import { db } from "@/lib/db";
import { slots, notificationLog } from "@/lib/schema";
import { lt } from "drizzle-orm";

export type CleanupResult = {
  cutoff: string;
  deletedSlots: number;
  deletedLogs: number;
};

/**
 * Delete slots and notification logs older than `days` days.
 *
 * Does not run VACUUM — on Postgres that is a heavy, non-transactional
 * maintenance operation (and Railway's managed PG already autovacuums).
 * Use the explicit admin vacuum endpoint when an operator wants ANALYZE.
 */
export async function cleanupOldData(days: number): Promise<CleanupResult> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoff = cutoffDate.toISOString().split("T")[0];

  const deletedSlots = await db.delete(slots).where(lt(slots.date, cutoff)).returning();
  const deletedLogs = await db
    .delete(notificationLog)
    .where(lt(notificationLog.sentAt, cutoff))
    .returning();

  return {
    cutoff,
    deletedSlots: deletedSlots.length,
    deletedLogs: deletedLogs.length,
  };
}
