/**
 * Database Migration Script
 *
 * Handles schema migrations with support for both safe and destructive changes.
 *
 * Usage:
 *   npx tsx scripts/db-migrate.ts           # Generate migration files
 *   npx tsx scripts/db-migrate.ts --apply   # Apply pending migrations
 *   npx tsx scripts/db-migrate.ts --push    # Push schema directly (dev only, accepts data loss)
 *   npx tsx scripts/db-migrate.ts --status  # Show migration status
 */

import { execSync } from "child_process";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const push = args.includes("--push");
const status = args.includes("--status");

function run(cmd: string, options: { input?: string } = {}): string {
  console.log(`\n$ ${cmd}`);
  try {
    const result = execSync(cmd, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: options.input ? ["pipe", "pipe", "pipe"] : "inherit",
      input: options.input,
    });
    return result || "";
  } catch (error) {
    const execError = error as { status?: number; stdout?: string; stderr?: string };
    if (execError.status !== undefined) {
      console.error("Command failed with exit code:", execError.status);
      if (execError.stderr) console.error(execError.stderr);
    }
    throw error;
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("DATABASE MIGRATION TOOL");
  console.log("=".repeat(60));

  if (status) {
    // Show current migration status
    console.log("\n📊 Checking migration status...");
    run("npx drizzle-kit check");
    return;
  }

  if (push) {
    // Direct schema push (development only, accepts data loss)
    console.log("\n⚠️  PUSH MODE: This will sync schema directly with potential data loss");
    console.log("This is intended for development only.\n");
    run("npx drizzle-kit push --force");
    console.log("\n✅ Schema pushed successfully");
    return;
  }

  if (apply) {
    // Apply pending migrations
    console.log("\n📥 Applying pending migrations...");
    run("npx drizzle-kit migrate");
    console.log("\n✅ Migrations applied");
    return;
  }

  // Default: generate migration files
  console.log("\n📝 Generating migration files...");
  run("npx drizzle-kit generate");
  console.log("\n✅ Migration files generated in ./drizzle/");
  console.log("\nNext steps:");
  console.log("  1. Review the generated SQL in ./drizzle/");
  console.log("  2. Run: npx tsx scripts/db-migrate.ts --apply");
  console.log("\nOr for development (accepts data loss):");
  console.log("  npx tsx scripts/db-migrate.ts --push");
}

main().catch(console.error);
