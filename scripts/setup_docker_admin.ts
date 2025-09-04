#!/usr/bin/env deno run --allow-net --allow-read --allow-env --allow-write

/**
 * Docker Admin API Key Setup Script
 * Creates admin API key in Docker environment
 */

import { initializeDatabase } from "@config/database.ts";
import { initializeRedis } from "@config/redis.ts";
import { apiKeyService } from "@services/api_key_service.ts";

async function createDockerAdminKey() {
  console.log("🚀 Docker Admin API Key Setup");
  console.log("=" + "=".repeat(30));

  try {
    // Initialize services
    console.log("🔧 Initializing services...");
    await initializeDatabase();
    await initializeRedis();
    console.log("✅ Services initialized");

    // Create admin API key
    console.log("🔑 Creating admin API key...");
    
    const adminKey = await apiKeyService.createApiKey({
      name: "docker-development-admin",
      description: "Docker development admin API key",
      environment: "development",
      permissions: ["read", "write", "admin"],
      rateLimitPerMinute: 200,
      rateLimitPerHour: 2000,
      rateLimitPerDay: 20000,
      expiresAt: undefined,
      createdBy: "docker-setup",
    });

    console.log("\n🎉 Admin API key created successfully!");
    console.log("🔐 SAVE THIS KEY:");
    console.log(`    ${adminKey.rawKey}`);
    console.log("\n📋 Key Details:");
    console.log(`  ID: ${adminKey.apiKey.id}`);
    console.log(`  Prefix: ${adminKey.apiKey.keyPrefix}***`);
    console.log(`  Permissions: ${adminKey.apiKey.permissions.join(", ")}`);
    console.log(`  Rate Limits: ${adminKey.apiKey.rateLimitPerMinute}/min`);

    console.log("\n🧪 Test Commands:");
    console.log(`  # Health check`);
    console.log(`  curl http://localhost:8000/health`);
    console.log(`  `);
    console.log(`  # API info`);
    console.log(`  curl http://localhost:8000/api/v1`);
    console.log(`  `);
    console.log(`  # List API keys (with auth)`);
    console.log(`  curl -H "Authorization: Bearer ${adminKey.rawKey}" http://localhost:8000/api/v1/admin/api-keys`);
    console.log(`  `);
    console.log(`  # Get queue status`);
    console.log(`  curl -H "Authorization: Bearer ${adminKey.rawKey}" http://localhost:8000/api/v1/queue/status`);

    return 0;
    
  } catch (error) {
    console.error("❌ Setup failed:", error);
    return 1;
  }
}

if (import.meta.main) {
  try {
    const exitCode = await createDockerAdminKey();
    Deno.exit(exitCode);
  } catch (error) {
    console.error("💥 Setup failed:", error);
    Deno.exit(1);
  }
}