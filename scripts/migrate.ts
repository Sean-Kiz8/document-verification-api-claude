#!/usr/bin/env deno run --allow-net --allow-read --allow-env

import { PostgresClient } from "@/deps.ts";
import { getConfig } from "@config/env.ts";
import { exists } from "https://deno.land/std@0.224.0/fs/mod.ts";

/**
 * Database Migration Runner
 * Applies database schema migrations in order
 */

interface Migration {
  version: string;
  description: string;
  filename: string;
  content: string;
}

class MigrationRunner {
  private client: PostgresClient;

  constructor(client: PostgresClient) {
    this.client = client;
  }

  /**
   * Get list of applied migrations from database
   */
  async getAppliedMigrations(): Promise<Set<string>> {
    try {
      const result = await this.client.queryObject<{ version: string }>(
        "SELECT version FROM schema_migrations ORDER BY version",
      );
      return new Set(result.rows.map((row) => row.version));
    } catch (error) {
      // Table doesn't exist yet, return empty set
      console.log("Migrations table doesn't exist yet, will be created");
      return new Set();
    }
  }

  /**
   * Load migration files from the migrations directory
   */
  async loadMigrations(): Promise<Migration[]> {
    const migrations: Migration[] = [];
    const migrationsDir = "src/database/migrations";

    // Check if migrations directory exists
    if (!await exists(migrationsDir)) {
      throw new Error(`Migrations directory not found: ${migrationsDir}`);
    }

    // Read migration files
    for await (const dirEntry of Deno.readDir(migrationsDir)) {
      if (dirEntry.isFile && dirEntry.name.endsWith(".sql")) {
        const filename = dirEntry.name;
        const versionMatch = filename.split("_")[0];

        if (!versionMatch) {
          console.warn(`Skipping migration file with invalid name format: ${filename}`);
          continue;
        }

        const version = versionMatch;
        const content = await Deno.readTextFile(`${migrationsDir}/${filename}`);

        // Extract description from filename or file content
        const description = filename
          .replace(/^\d+_/, "")
          .replace(/\.sql$/, "")
          .replace(/_/g, " ");

        migrations.push({
          version,
          description,
          filename,
          content,
        });
      }
    }

    // Sort by version
    migrations.sort((a, b) => a.version.localeCompare(b.version));
    return migrations;
  }

  /**
   * Execute a single migration
   */
  async executeMigration(migration: Migration): Promise<void> {
    const startTime = Date.now();

    console.log(`Applying migration ${migration.version}: ${migration.description}`);

    try {
      // Execute migration in a transaction
      await this.client.queryObject("BEGIN");

      // Execute the migration SQL
      await this.client.queryObject(migration.content);

      // Record the migration (if not already recorded)
      await this.client.queryObject(
        `INSERT INTO schema_migrations (version, description, applied_at, execution_time_ms) 
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (version) DO UPDATE SET 
           applied_at = NOW(),
           execution_time_ms = $3`,
        [migration.version, migration.description, Date.now() - startTime],
      );

      await this.client.queryObject("COMMIT");

      console.log(
        `✅ Migration ${migration.version} applied successfully (${Date.now() - startTime}ms)`,
      );
    } catch (error) {
      await this.client.queryObject("ROLLBACK");
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`❌ Migration ${migration.version} failed:`, errorMessage);
      throw error;
    }
  }

  /**
   * Run all pending migrations
   */
  async runMigrations(): Promise<void> {
    console.log("🔄 Starting database migrations...");

    const migrations = await this.loadMigrations();
    const appliedMigrations = await this.getAppliedMigrations();

    const pendingMigrations = migrations.filter(
      (migration) => !appliedMigrations.has(migration.version),
    );

    if (pendingMigrations.length === 0) {
      console.log("✅ No pending migrations. Database is up to date.");
      return;
    }

    console.log(`📋 Found ${pendingMigrations.length} pending migrations:`);
    for (const migration of pendingMigrations) {
      console.log(`  - ${migration.version}: ${migration.description}`);
    }

    // Execute migrations in order
    for (const migration of pendingMigrations) {
      await this.executeMigration(migration);
    }

    console.log(`🎉 Successfully applied ${pendingMigrations.length} migrations!`);
  }

  /**
   * Show migration status
   */
  async showStatus(): Promise<void> {
    console.log("📊 Migration Status:");

    const migrations = await this.loadMigrations();
    const appliedMigrations = await this.getAppliedMigrations();

    if (migrations.length === 0) {
      console.log("  No migrations found.");
      return;
    }

    for (const migration of migrations) {
      const isApplied = appliedMigrations.has(migration.version);
      const status = isApplied ? "✅ Applied" : "⏳ Pending";
      console.log(`  ${migration.version}: ${migration.description} - ${status}`);
    }

    const appliedCount = migrations.filter((m) => appliedMigrations.has(m.version)).length;
    console.log(`\nTotal: ${appliedCount}/${migrations.length} migrations applied`);
  }
}

/**
 * Main migration script
 */
async function main() {
  const args = Deno.args;
  const command = args[0] || "migrate";

  try {
    // Load configuration
    const config = await getConfig();

    // Connect to database
    const client = new PostgresClient(config.databaseUrl);
    await client.connect();

    console.log(`🔗 Connected to database: ${new URL(config.databaseUrl).host}`);

    const runner = new MigrationRunner(client);

    switch (command) {
      case "migrate":
      case "up":
        await runner.runMigrations();
        break;

      case "status":
        await runner.showStatus();
        break;

      default:
        console.log(
          "Usage: deno run --allow-net --allow-read --allow-env scripts/migrate.ts [command]",
        );
        console.log("Commands:");
        console.log("  migrate, up  - Apply pending migrations");
        console.log("  status       - Show migration status");
        Deno.exit(1);
    }

    await client.end();
    console.log("🔌 Database connection closed");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("💥 Migration failed:", errorMessage);

    if (Deno.env.get("ENVIRONMENT") === "development") {
      console.error("Full error:", error);
    }

    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
