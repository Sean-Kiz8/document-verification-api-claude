#!/usr/bin/env deno run --allow-net --allow-read --allow-env --allow-write

/**
 * Development Environment Setup Script
 * Helps set up the development environment for Document Verification API
 */

import { getDatabaseHealth, initializeDatabase } from "@config/database.ts";
import { getRedisHealth, initializeRedis } from "@config/redis.ts";
import { apiKeyService } from "@services/api_key_service.ts";

async function checkPrerequisites() {
  console.log("🔍 Checking prerequisites...");

  try {
    // Check database connection
    console.log("  Testing database connection...");
    const dbHealth = await getDatabaseHealth();

    if (dbHealth.status === "healthy") {
      console.log("  ✅ Database connection: OK");
      console.log(`    Latency: ${dbHealth.latency}ms`);
      console.log(`    Connections: ${dbHealth.connections}`);
    } else {
      console.log("  ❌ Database connection: FAILED");
      console.log("    Make sure PostgreSQL is running:");
      console.log("    brew install postgresql@14");
      console.log("    brew services start postgresql@14");
      console.log("    createdb document_verification");
      return false;
    }

    // Check Redis connection
    console.log("  Testing Redis connection...");
    const redisHealth = await getRedisHealth();

    if (redisHealth.status === "healthy") {
      console.log("  ✅ Redis connection: OK");
      console.log(`    Latency: ${redisHealth.latency}ms`);
    } else {
      console.log("  ❌ Redis connection: FAILED");
      console.log("    Make sure Redis is running:");
      console.log("    brew install redis");
      console.log("    brew services start redis");
      return false;
    }

    return true;
  } catch (error) {
    console.error("❌ Prerequisites check failed:", error);
    return false;
  }
}

async function createAdminApiKey() {
  console.log("\n🔑 Creating development admin API key...");

  try {
    const adminKey = await apiKeyService.createApiKey({
      name: "development-admin-key",
      description: "Development admin API key for testing",
      environment: "development",
      permissions: ["read", "write", "admin"],
      rateLimitPerMinute: 200,
      rateLimitPerHour: 2000,
      rateLimitPerDay: 20000,
      expiresAt: undefined,
      createdBy: "development-setup",
    });

    console.log("  ✅ Admin API key created successfully!");
    console.log("  🔐 SAVE THIS KEY SECURELY:");
    console.log(`      ${adminKey.rawKey}`);
    console.log("  📋 Key Details:");
    console.log(`    Key ID: ${adminKey.apiKey.id}`);
    console.log(`    Prefix: ${adminKey.apiKey.keyPrefix}***`);
    console.log(`    Environment: ${adminKey.apiKey.environment}`);
    console.log(`    Permissions: ${adminKey.apiKey.permissions.join(", ")}`);
    console.log(
      `    Rate limits: ${adminKey.apiKey.rateLimitPerMinute}/min, ${adminKey.apiKey.rateLimitPerHour}/hour`,
    );

    console.log("\n  💡 Usage Instructions:");
    console.log("    1. Save this API key in a secure location");
    console.log("    2. Use in Authorization header: Bearer <api_key>");
    console.log(
      "    3. Test with: curl -H 'Authorization: Bearer <api_key>' http://localhost:8000/api/v1",
    );

    return adminKey.rawKey;
  } catch (error) {
    console.error("❌ Admin API key creation failed:", error);
    return null;
  }
}

async function testApiEndpoints(apiKey: string) {
  console.log("\n🌐 Testing API endpoints...");

  try {
    const baseUrl = "http://localhost:8000";
    const headers = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    // Test health endpoint
    console.log("  Testing health endpoint...");
    const healthResponse = await fetch(`${baseUrl}/health`);
    if (healthResponse.ok) {
      console.log("  ✅ Health endpoint: OK");
    } else {
      console.log("  ❌ Health endpoint: FAILED");
      return false;
    }

    // Test API info endpoint
    console.log("  Testing API info endpoint...");
    const infoResponse = await fetch(`${baseUrl}/api/v1`);
    if (infoResponse.ok) {
      const info = await infoResponse.json();
      console.log("  ✅ API info endpoint: OK");
      console.log(`    Status: ${info.status}`);
      console.log(`    Endpoints: ${info.endpoints?.length || 0} available`);
    } else {
      console.log("  ❌ API info endpoint: FAILED");
      return false;
    }

    // Test API key listing
    console.log("  Testing API key listing...");
    const keysResponse = await fetch(`${baseUrl}/api/v1/admin/api-keys`, { headers });
    if (keysResponse.ok) {
      const keys = await keysResponse.json();
      console.log("  ✅ API keys endpoint: OK");
      console.log(`    API keys count: ${keys.data?.total || 0}`);
    } else {
      console.log("  ❌ API keys endpoint: FAILED");
      console.log(`    Status: ${keysResponse.status}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error("❌ API endpoints test failed:", error);
    return false;
  }
}

async function runDevelopmentSetup() {
  console.log("🚀 Document Verification API - Development Setup");
  console.log("=" + "=".repeat(50));

  console.log("\n📋 Setup Checklist:");
  console.log("  1. Prerequisites check");
  console.log("  2. Initialize services");
  console.log("  3. Create admin API key");
  console.log("  4. Test API endpoints");

  // Check prerequisites
  const prerequisitesOk = await checkPrerequisites();
  if (!prerequisitesOk) {
    console.log("\n💥 Prerequisites check failed!");
    console.log("Please fix the issues above and run setup again.");
    return 1;
  }

  // Initialize services
  console.log("\n🔧 Initializing services...");
  try {
    await initializeDatabase();
    await initializeRedis();
    console.log("  ✅ Services initialized successfully");
  } catch (error) {
    console.error("❌ Service initialization failed:", error);
    return 1;
  }

  // Create admin API key
  const adminKey = await createAdminApiKey();
  if (!adminKey) {
    console.log("\n💥 Admin API key creation failed!");
    return 1;
  }

  // Test endpoints (only if server is running)
  console.log("\n📡 To test API endpoints:");
  console.log("  1. Start the server: deno run --allow-all src/main.ts");
  console.log("  2. Run endpoint tests: deno run --allow-net scripts/test_endpoints.ts");

  console.log("\n🎉 Development environment setup completed successfully!");
  console.log("\n📚 Next Steps:");
  console.log("  1. Start the server: deno task dev");
  console.log("  2. Visit health check: http://localhost:8000/health");
  console.log("  3. Test API with your admin key");
  console.log("  4. Upload test documents for verification");

  return 0;
}

if (import.meta.main) {
  try {
    const exitCode = await runDevelopmentSetup();
    Deno.exit(exitCode);
  } catch (error) {
    console.error("💥 Development setup failed:", error);
    Deno.exit(1);
  }
}
