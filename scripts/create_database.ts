#!/usr/bin/env deno run --allow-net --allow-read --allow-env --allow-run

/**
 * Database Creation Script
 * Creates the database and runs initial setup
 */

async function createDatabase() {
  console.log("🗄️  Creating document_verification database...");

  try {
    // Create database using psql
    const createDbCommand = new Deno.Command("createdb", {
      args: ["document_verification"],
      stdout: "inherit",
      stderr: "inherit",
    });

    const result = await createDbCommand.output();

    if (result.code === 0) {
      console.log("✅ Database 'document_verification' created successfully");
    } else {
      console.log("ℹ️  Database may already exist (this is okay)");
    }

    // Test database connection
    console.log("🔍 Testing database connection...");

    const testCommand = new Deno.Command("psql", {
      args: ["-d", "document_verification", "-c", "SELECT version();"],
      stdout: "inherit",
      stderr: "inherit",
    });

    const testResult = await testCommand.output();

    if (testResult.code === 0) {
      console.log("✅ Database connection test successful");
      return true;
    } else {
      console.log("❌ Database connection test failed");
      return false;
    }
  } catch (error) {
    console.error("❌ Database creation failed:", error);
    console.log("\n🛠️  Manual setup instructions:");
    console.log("  1. Start PostgreSQL: brew services start postgresql@14");
    console.log("  2. Create database: createdb document_verification");
    console.log("  3. Test connection: psql -d document_verification -c 'SELECT version();'");
    return false;
  }
}

async function runMigrations() {
  console.log("\n📊 Running database migrations...");

  try {
    // Import and run migrations
    const { runMigrations } = await import("./migrate.ts");
    await runMigrations();
    console.log("✅ Database migrations completed");
    return true;
  } catch (error) {
    console.error("❌ Database migrations failed:", error);
    console.log("  You may need to run: deno run --allow-all scripts/migrate.ts");
    return false;
  }
}

async function setupDatabase() {
  console.log("🚀 Database Setup for Document Verification API");
  console.log("=" + "=".repeat(50));

  // Create database
  const dbCreated = await createDatabase();
  if (!dbCreated) {
    console.log("\n💥 Database setup failed!");
    return 1;
  }

  // Run migrations
  const migrationsRun = await runMigrations();
  if (!migrationsRun) {
    console.log("\n💥 Migrations failed!");
    return 1;
  }

  console.log("\n🎉 Database setup completed successfully!");
  console.log("\n📚 Next Steps:");
  console.log("  1. Run development setup: deno run --allow-all scripts/setup_dev.ts");
  console.log("  2. Start the server: deno task dev");
  console.log("  3. Test database: deno run --allow-all scripts/test_database.ts");

  return 0;
}

if (import.meta.main) {
  try {
    const exitCode = await setupDatabase();
    Deno.exit(exitCode);
  } catch (error) {
    console.error("💥 Database setup failed:", error);
    Deno.exit(1);
  }
}
