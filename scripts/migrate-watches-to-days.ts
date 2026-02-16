#!/usr/bin/env tsx
/**
 * Migration script to convert watches from weekday/weekend format to individual days
 * 
 * This script:
 * 1. Adds the day_times column to watches table if it doesn't exist
 * 2. Migrates existing weekday_times and weekend_times to day_times format
 * 3. Keeps old columns for backward compatibility
 * 
 * Usage: npm run tsx scripts/migrate-watches-to-days.ts
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'tennis.db');

interface Watch {
  id: number;
  weekday_times: string | null;
  weekend_times: string | null;
  day_times: string | null;
}

function migrateWatches() {
  const db = new Database(DB_PATH);
  
  try {
    console.log('Starting watch migration...');
    
    // Check if day_times column exists, add it if not
    const columns = db.prepare("PRAGMA table_info(watches)").all() as any[];
    const hasDayTimes = columns.some(col => col.name === 'day_times');
    
    if (!hasDayTimes) {
      console.log('Adding day_times column...');
      db.prepare('ALTER TABLE watches ADD COLUMN day_times TEXT').run();
      console.log('✓ day_times column added');
    } else {
      console.log('✓ day_times column already exists');
    }
    
    // Get all watches that need migration (have old format but no new format)
    const watches = db.prepare(`
      SELECT id, weekday_times, weekend_times, day_times
      FROM watches
      WHERE (weekday_times IS NOT NULL OR weekend_times IS NOT NULL)
        AND day_times IS NULL
    `).all() as Watch[];
    
    console.log(`\nFound ${watches.length} watches to migrate`);
    
    if (watches.length === 0) {
      console.log('No watches need migration. All done!');
      db.close();
      return;
    }
    
    let migratedCount = 0;
    let errorCount = 0;
    
    const updateStmt = db.prepare('UPDATE watches SET day_times = ? WHERE id = ?');
    
    for (const watch of watches) {
      try {
        // Parse old times
        const weekdayTimes = watch.weekday_times 
          ? JSON.parse(watch.weekday_times) 
          : [];
        const weekendTimes = watch.weekend_times 
          ? JSON.parse(watch.weekend_times) 
          : [];
        
        // Create new day-specific format
        const dayTimes = {
          monday: weekdayTimes,
          tuesday: weekdayTimes,
          wednesday: weekdayTimes,
          thursday: weekdayTimes,
          friday: weekdayTimes,
          saturday: weekendTimes,
          sunday: weekendTimes,
        };
        
        // Update the watch
        updateStmt.run(JSON.stringify(dayTimes), watch.id);
        migratedCount++;
        
        console.log(`✓ Migrated watch ${watch.id}`);
      } catch (error) {
        errorCount++;
        console.error(`✗ Failed to migrate watch ${watch.id}:`, error);
      }
    }
    
    console.log('\n=== Migration Summary ===');
    console.log(`Total watches: ${watches.length}`);
    console.log(`Successfully migrated: ${migratedCount}`);
    console.log(`Errors: ${errorCount}`);
    
    if (migratedCount > 0) {
      console.log('\n✓ Migration completed successfully!');
      console.log('\nNote: Old weekday_times and weekend_times columns are kept for backward compatibility.');
      console.log('They can be safely removed in a future migration once you verify everything works.');
    }
    
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    db.close();
  }
}

// Run the migration
migrateWatches();
