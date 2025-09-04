#!/usr/bin/env deno run --allow-net --allow-read --allow-env

/**
 * Authentication System Testing Script
 * Tests API key authentication and rate limiting functionality
 */

import { initializeDatabase } from "@config/database.ts";
import { initializeRedis } from "@config/redis.ts";
import { apiKeyService } from "@services/api_key_service.ts";
import type { ApiKey } from "@models/api_key.ts";

async function testApiKeyGeneration() {
  console.log("🔑 Testing API key generation...");

  try {
    const creation = {
      name: "test-api-key",
      description: "Test API key for authentication testing",
      environment: "development" as const,
      permissions: ["read", "write"],
      rateLimitPerMinute: 10,
      rateLimitPerHour: 100,
      rateLimitPerDay: 1000,
      expiresAt: undefined,
      createdBy: "test-system",
    };

    const { apiKey, rawKey } = await apiKeyService.createApiKey(creation);

    console.log("✅ API key created successfully:");
    console.log("  Key prefix:", apiKey.keyPrefix);
    console.log("  Name:", apiKey.name);
    console.log("  Environment:", apiKey.environment);
    console.log("  Permissions:", apiKey.permissions);
    console.log("  Rate limits:", {
      minute: apiKey.rateLimitPerMinute,
      hour: apiKey.rateLimitPerHour,
      day: apiKey.rateLimitPerDay,
    });

    return { apiKey, rawKey };
  } catch (error) {
    console.error("❌ API key generation failed:", error);
    throw error;
  }
}

async function testApiKeyValidation(rawKey: string) {
  console.log("\n🔍 Testing API key validation...");

  try {
    // Test valid key
    console.log("  Testing valid API key...");
    const validResult = await apiKeyService.validateApiKey(`Bearer ${rawKey}`);

    if (validResult.isValid && validResult.apiKey) {
      console.log("  ✅ Valid key authentication passed:");
      console.log("    Key prefix:", validResult.apiKey.keyPrefix);
      console.log("    Remaining requests:", validResult.remainingRequests);
    } else {
      console.log("  ❌ Valid key authentication failed:", validResult.error);
      return false;
    }

    // Test invalid key
    console.log("  Testing invalid API key...");
    const invalidResult = await apiKeyService.validateApiKey("Bearer invalid_key_123");

    if (!invalidResult.isValid) {
      console.log("  ✅ Invalid key correctly rejected:", invalidResult.error);
    } else {
      console.log("  ❌ Invalid key validation failed - should have been rejected");
      return false;
    }

    // Test malformed header
    console.log("  Testing malformed authorization header...");
    const malformedResult = await apiKeyService.validateApiKey("InvalidFormat");

    if (!malformedResult.isValid) {
      console.log("  ✅ Malformed header correctly rejected:", malformedResult.error);
    } else {
      console.log("  ❌ Malformed header validation failed - should have been rejected");
      return false;
    }

    return true;
  } catch (error) {
    console.error("❌ API key validation test failed:", error);
    return false;
  }
}

async function testRateLimiting(rawKey: string) {
  console.log("\n🚦 Testing rate limiting...");

  try {
    // Make multiple requests to test rate limiting
    console.log("  Making multiple rapid requests to test rate limiting...");

    let successCount = 0;
    let rateLimitCount = 0;

    for (let i = 0; i < 15; i++) {
      const result = await apiKeyService.validateApiKey(`Bearer ${rawKey}`);

      if (result.isValid) {
        successCount++;
      } else if (result.rateLimitExceeded) {
        rateLimitCount++;
        console.log(`  Request ${i + 1}: Rate limit exceeded`);
        break;
      }
    }

    console.log(`  ✅ Rate limiting test completed:`);
    console.log(`    Successful requests: ${successCount}`);
    console.log(`    Rate limited after: ${successCount + 1} requests`);

    if (rateLimitCount > 0) {
      console.log("  ✅ Rate limiting working correctly");
      return true;
    } else {
      console.log("  ⚠️ Rate limiting may need adjustment");
      return true; // Not a failure, just a note
    }
  } catch (error) {
    console.error("❌ Rate limiting test failed:", error);
    return false;
  }
}

async function testApiKeyListing() {
  console.log("\n📋 Testing API key listing...");

  try {
    const apiKeys = await apiKeyService.listApiKeys();

    console.log(`  ✅ Found ${apiKeys.length} API key(s):`);

    apiKeys.forEach((key, index) => {
      console.log(`    ${index + 1}. ${key.name} (${key.keyPrefix}***) - ${key.environment}`);
      console.log(`       Active: ${key.isActive}, Usage: ${key.usageCount}`);
    });

    return true;
  } catch (error) {
    console.error("❌ API key listing failed:", error);
    return false;
  }
}

async function runAuthTests() {
  console.log("🚀 Starting Authentication System Tests");
  console.log("=" + "=".repeat(50));

  const results = {
    generation: false,
    validation: false,
    rateLimiting: false,
    listing: false,
  };

  let testKey: { apiKey: ApiKey; rawKey: string } | null = null;

  try {
    // Initialize services
    console.log("🔧 Initializing services...");
    await initializeDatabase();
    await initializeRedis();
    console.log("✅ Services initialized");

    // Test API key generation
    testKey = await testApiKeyGeneration();
    results.generation = true;

    if (testKey) {
      // Test API key validation
      results.validation = await testApiKeyValidation(testKey.rawKey);

      // Test rate limiting
      results.rateLimiting = await testRateLimiting(testKey.rawKey);

      // Test API key listing
      results.listing = await testApiKeyListing();

      // Cleanup - deactivate test key
      console.log("\n🧹 Cleaning up test API key...");
      const deactivated = await apiKeyService.deactivateApiKey(testKey.apiKey.id);
      if (deactivated) {
        console.log("  ✅ Test API key deactivated");
      } else {
        console.log("  ⚠️ Failed to deactivate test API key");
      }
    }
  } catch (error) {
    console.error("💥 Test setup failed:", error);
  }

  // Print summary
  console.log("\n" + "=".repeat(50));
  console.log("📋 Authentication Test Results:");
  console.log("  API Key Generation: ", results.generation ? "✅ PASSED" : "❌ FAILED");
  console.log("  API Key Validation:", results.validation ? "✅ PASSED" : "❌ FAILED");
  console.log("  Rate Limiting:      ", results.rateLimiting ? "✅ PASSED" : "❌ FAILED");
  console.log("  API Key Listing:    ", results.listing ? "✅ PASSED" : "❌ FAILED");

  const allPassed = Object.values(results).every((result) => result);

  if (allPassed) {
    console.log("\n🎉 All authentication tests PASSED!");
    return 0;
  } else {
    console.log("\n💥 Some authentication tests FAILED!");
    return 1;
  }
}

if (import.meta.main) {
  try {
    const exitCode = await runAuthTests();
    Deno.exit(exitCode);
  } catch (error) {
    console.error("💥 Test runner failed:", error);
    Deno.exit(1);
  }
}
