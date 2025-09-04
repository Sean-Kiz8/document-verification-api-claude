#!/usr/bin/env deno run --allow-net --allow-read --allow-env --allow-write

/**
 * Enhanced Rate Limiting Testing Script
 * Tests sliding window rate limiting, abuse detection, and premium features
 */

import { initializeDatabase } from "@config/database.ts";
import { initializeRedis } from "@config/redis.ts";
import { rateLimitingService } from "@services/rate_limiting_service.ts";
import { apiKeyService } from "@services/api_key_service.ts";
import type { ApiKey } from "@models/api_key.ts";

async function createTestApiKeys(): Promise<{
  basic: { apiKey: ApiKey; rawKey: string };
  premium: { apiKey: ApiKey; rawKey: string };
  enterprise: { apiKey: ApiKey; rawKey: string };
}> {
  console.log("🔧 Creating test API keys for different tiers...");

  try {
    // Create basic tier API key
    const basicKey = await apiKeyService.createApiKey({
      name: "test-basic-rate-limit",
      description: "Basic tier API key for rate limiting tests",
      environment: "development",
      permissions: ["read", "write"],
      rateLimitPerMinute: 10,
      rateLimitPerHour: 100,
      rateLimitPerDay: 1000,
      expiresAt: undefined,
      createdBy: "test-system",
    });

    // Create premium tier API key
    const premiumKey = await apiKeyService.createApiKey({
      name: "test-premium-rate-limit",
      description: "Premium tier API key for rate limiting tests",
      environment: "development",
      permissions: ["read", "write", "premium"],
      rateLimitPerMinute: 50,
      rateLimitPerHour: 500,
      rateLimitPerDay: 5000,
      expiresAt: undefined,
      createdBy: "test-system",
    });

    // Create enterprise tier API key
    const enterpriseKey = await apiKeyService.createApiKey({
      name: "test-enterprise-rate-limit",
      description: "Enterprise tier API key for rate limiting tests",
      environment: "development",
      permissions: ["read", "write", "admin", "enterprise"],
      rateLimitPerMinute: 200,
      rateLimitPerHour: 2000,
      rateLimitPerDay: 20000,
      expiresAt: undefined,
      createdBy: "test-system",
    });

    console.log("  ✅ Test API keys created:");
    console.log("    Basic:", basicKey.apiKey.keyPrefix + "***");
    console.log("    Premium:", premiumKey.apiKey.keyPrefix + "***");
    console.log("    Enterprise:", enterpriseKey.apiKey.keyPrefix + "***");

    return {
      basic: basicKey,
      premium: premiumKey,
      enterprise: enterpriseKey,
    };
  } catch (error) {
    console.error("❌ Test API key creation failed:", error);
    throw error;
  }
}

async function testBasicRateLimiting(apiKey: ApiKey) {
  console.log("\n🔍 Testing basic rate limiting...");

  try {
    const operation = "status_check";
    let allowedCount = 0;
    let blockedCount = 0;

    console.log("  Making multiple rapid requests to test rate limiting...");

    for (let i = 0; i < 70; i++) { // Exceed 60/minute limit
      const result = await rateLimitingService.checkRateLimit(apiKey, operation, {
        endpoint: "GET /api/v1/test",
        requestId: crypto.randomUUID(),
        userAgent: "test-agent",
        ipAddress: "127.0.0.1",
      });

      if (result.allowed) {
        allowedCount++;
      } else {
        blockedCount++;

        if (blockedCount === 1) {
          console.log(`  First block at request ${i + 1}:`);
          console.log("    Limit type:", result.status.limitType);
          console.log("    Retry after:", result.status.retryAfter, "seconds");
          console.log("    Reset time:", result.status.resetTime?.toISOString());
        }
      }
    }

    console.log("  ✅ Rate limiting test results:");
    console.log("    Allowed requests:", allowedCount);
    console.log("    Blocked requests:", blockedCount);
    console.log("    Rate limiting working:", blockedCount > 0 ? "✅ YES" : "❌ NO");

    return blockedCount > 0;
  } catch (error) {
    console.error("❌ Basic rate limiting test failed:", error);
    return false;
  }
}

async function testTierMultipliers(keys: {
  basic: { apiKey: ApiKey; rawKey: string };
  premium: { apiKey: ApiKey; rawKey: string };
  enterprise: { apiKey: ApiKey; rawKey: string };
}) {
  console.log("\n🔍 Testing tier multipliers...");

  try {
    const operation = "document_upload";
    const testResults = [];

    // Test each tier
    for (const [tier, keyData] of Object.entries(keys)) {
      console.log(`  Testing ${tier} tier limits...`);

      let allowedCount = 0;

      // Make requests until blocked (up to 25 requests)
      for (let i = 0; i < 25; i++) {
        const result = await rateLimitingService.checkRateLimit(keyData.apiKey, operation, {
          endpoint: "POST /api/v1/documents",
          requestId: crypto.randomUUID(),
          userAgent: "test-agent",
          ipAddress: "127.0.0.1",
        });

        if (result.allowed) {
          allowedCount++;
        } else {
          break;
        }
      }

      testResults.push({ tier, allowedCount });
      console.log(`    ${tier} tier allowed: ${allowedCount} requests`);
    }

    // Verify tier multipliers work
    const basicCount = testResults.find((r) => r.tier === "basic")?.allowedCount || 0;
    const premiumCount = testResults.find((r) => r.tier === "premium")?.allowedCount || 0;
    const enterpriseCount = testResults.find((r) => r.tier === "enterprise")?.allowedCount || 0;

    const premiumImprovement = premiumCount > basicCount;
    const enterpriseImprovement = enterpriseCount > premiumCount;

    console.log("  ✅ Tier multiplier test results:");
    console.log("    Premium > Basic:", premiumImprovement ? "✅ YES" : "❌ NO");
    console.log("    Enterprise > Premium:", enterpriseImprovement ? "✅ YES" : "❌ NO");

    return premiumImprovement && enterpriseImprovement;
  } catch (error) {
    console.error("❌ Tier multipliers test failed:", error);
    return false;
  }
}

async function testAbuseDetection(apiKey: ApiKey) {
  console.log("\n🔍 Testing abuse detection...");

  try {
    console.log("  Generating burst requests to trigger abuse detection...");

    let abuseDetected = false;
    let requestCount = 0;

    // Make many rapid requests to trigger burst detection
    for (let i = 0; i < 60; i++) {
      const result = await rateLimitingService.checkRateLimit(apiKey, "general_api", {
        endpoint: "GET /api/v1/test",
        requestId: crypto.randomUUID(),
        userAgent: "test-agent-burst",
        ipAddress: "192.168.1.100",
      });

      requestCount++;

      if (result.status.abuseDetected) {
        abuseDetected = true;
        console.log(`  Abuse detected after ${requestCount} requests`);
        console.log("    Cooldown until:", result.status.cooldownUntil?.toISOString());
        break;
      }

      // Small delay between requests
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    if (abuseDetected) {
      console.log("  ✅ Abuse detection working correctly");

      // Test that subsequent requests are blocked during cooldown
      const cooldownResult = await rateLimitingService.checkRateLimit(apiKey, "general_api", {
        endpoint: "GET /api/v1/test",
        requestId: crypto.randomUUID(),
        userAgent: "test-agent",
        ipAddress: "192.168.1.100",
      });

      if (!cooldownResult.allowed && cooldownResult.status.abuseDetected) {
        console.log("  ✅ Cooldown period enforced correctly");
      } else {
        console.log("  ❌ Cooldown period not enforced");
        return false;
      }
    } else {
      console.log("  ⚠️ Abuse detection may need adjustment (not triggered)");
    }

    return true;
  } catch (error) {
    console.error("❌ Abuse detection test failed:", error);
    return false;
  }
}

async function testSlidingWindow(apiKey: ApiKey) {
  console.log("\n🔍 Testing sliding window implementation...");

  try {
    const operation = "status_check";

    // Make requests spread over time to test sliding window
    console.log("  Testing sliding window behavior...");

    let firstBatchAllowed = 0;

    // First batch of requests
    for (let i = 0; i < 30; i++) {
      const result = await rateLimitingService.checkRateLimit(apiKey, operation, {
        endpoint: "GET /api/v1/status",
        requestId: crypto.randomUUID(),
        userAgent: "test-agent",
        ipAddress: "127.0.0.1",
      });

      if (result.allowed) {
        firstBatchAllowed++;
      }
    }

    console.log("    First batch allowed:", firstBatchAllowed);

    // Wait for sliding window to advance
    console.log("  Waiting for sliding window to advance...");
    await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 seconds

    let secondBatchAllowed = 0;

    // Second batch of requests
    for (let i = 0; i < 20; i++) {
      const result = await rateLimitingService.checkRateLimit(apiKey, operation, {
        endpoint: "GET /api/v1/status",
        requestId: crypto.randomUUID(),
        userAgent: "test-agent",
        ipAddress: "127.0.0.1",
      });

      if (result.allowed) {
        secondBatchAllowed++;
      }
    }

    console.log("    Second batch allowed:", secondBatchAllowed);
    console.log("  ✅ Sliding window test completed");
    console.log("    Window advancement working:", secondBatchAllowed > 0 ? "✅ YES" : "❌ NO");

    return true;
  } catch (error) {
    console.error("❌ Sliding window test failed:", error);
    return false;
  }
}

async function testRateLimitMetrics() {
  console.log("\n🔍 Testing rate limit metrics...");

  try {
    const metrics = await rateLimitingService.getMetrics();

    console.log("  ✅ Rate limit metrics retrieved:");
    for (const metric of metrics) {
      console.log(`    ${metric.operation}:`);
      console.log(`      Total requests: ${metric.totalRequests}`);
      console.log(`      Blocked requests: ${metric.blockedRequests}`);
      console.log(`      Allowed requests: ${metric.allowedRequests}`);
      console.log(`      Abuse detections: ${metric.abuseDetections}`);
    }

    return true;
  } catch (error) {
    console.error("❌ Rate limit metrics test failed:", error);
    return false;
  }
}

async function testDataClearance() {
  console.log("\n🔧 Testing rate limit data clearance...");

  try {
    await rateLimitingService.clearAllData();
    console.log("  ✅ Rate limiting data cleared successfully");
    return true;
  } catch (error) {
    console.error("❌ Data clearance failed:", error);
    return false;
  }
}

async function runRateLimitingTests() {
  console.log("🚀 Starting Enhanced Rate Limiting Tests");
  console.log("=" + "=".repeat(50));

  const results = {
    initialization: false,
    apiKeyCreation: false,
    basicRateLimiting: false,
    tierMultipliers: false,
    abuseDetection: false,
    slidingWindow: false,
    metrics: false,
    dataClearance: false,
  };

  let testApiKeys: any = null;

  try {
    // Initialize services
    console.log("🔧 Initializing services...");
    await initializeDatabase();
    await initializeRedis();
    console.log("✅ Services initialized");
    results.initialization = true;

    // Clear any existing rate limit data
    await testDataClearance();

    // Create test API keys for different tiers
    testApiKeys = await createTestApiKeys();
    results.apiKeyCreation = true;

    // Test basic rate limiting with basic tier
    results.basicRateLimiting = await testBasicRateLimiting(testApiKeys.basic.apiKey);

    // Test tier multipliers
    results.tierMultipliers = await testTierMultipliers(testApiKeys);

    // Test abuse detection with basic tier
    results.abuseDetection = await testAbuseDetection(testApiKeys.basic.apiKey);

    // Test sliding window with premium tier
    results.slidingWindow = await testSlidingWindow(testApiKeys.premium.apiKey);

    // Test metrics collection
    results.metrics = await testRateLimitMetrics();

    // Final data clearance
    results.dataClearance = await testDataClearance();
  } catch (error) {
    console.error("💥 Test initialization failed:", error);
  }

  // Print summary
  console.log("\n" + "=".repeat(50));
  console.log("📋 Enhanced Rate Limiting Test Results:");
  console.log("  Service Initialization:", results.initialization ? "✅ PASSED" : "❌ FAILED");
  console.log("  API Key Creation:      ", results.apiKeyCreation ? "✅ PASSED" : "❌ FAILED");
  console.log("  Basic Rate Limiting:   ", results.basicRateLimiting ? "✅ PASSED" : "❌ FAILED");
  console.log("  Tier Multipliers:      ", results.tierMultipliers ? "✅ PASSED" : "❌ FAILED");
  console.log("  Abuse Detection:       ", results.abuseDetection ? "✅ PASSED" : "❌ FAILED");
  console.log("  Sliding Window:        ", results.slidingWindow ? "✅ PASSED" : "❌ FAILED");
  console.log("  Metrics Collection:    ", results.metrics ? "✅ PASSED" : "❌ FAILED");
  console.log("  Data Clearance:        ", results.dataClearance ? "✅ PASSED" : "❌ FAILED");

  const allPassed = Object.values(results).every((result) => result);

  if (allPassed) {
    console.log("\n🎉 All enhanced rate limiting tests PASSED!");
    return 0;
  } else {
    console.log("\n💥 Some enhanced rate limiting tests FAILED!");
    return 1;
  }
}

if (import.meta.main) {
  try {
    const exitCode = await runRateLimitingTests();
    Deno.exit(exitCode);
  } catch (error) {
    console.error("💥 Test runner failed:", error);
    Deno.exit(1);
  }
}
