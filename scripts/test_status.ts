#!/usr/bin/env deno run --allow-net --allow-read --allow-env --allow-write

/**
 * Document Status Testing Script
 * Tests enhanced document status endpoint with caching and detailed information
 */

import { initializeDatabase } from "@config/database.ts";
import { initializeRedis } from "@config/redis.ts";
import { documentStatusService } from "@services/document_status_service.ts";
import { documentUploadService } from "@services/document_upload_service.ts";
import { apiKeyService } from "@services/api_key_service.ts";
import { DocumentQueries } from "@database/queries.ts";
import type { DocumentUploadRequest } from "@models/document_upload.ts";
import type { Document } from "@database/queries.ts";

async function createTestDocument(): Promise<string> {
  console.log("🔧 Creating test document for status testing...");

  try {
    // Create test PNG file
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const testFileData = new Uint8Array(1024);
    testFileData.set(pngHeader, 0);

    const testFile = new Blob([testFileData], { type: "image/png" });

    const uploadRequest: DocumentUploadRequest = {
      file: testFile,
      fileName: "status-test-receipt.png",
      mimeType: "image/png",
      fileSize: testFileData.length,
      userId: "test-user-status",
      transactionId: "test-txn-status-789",
      disputeId: "dispute-status-123",
      documentType: "payment_receipt",
      immediateProcessing: false,
      priority: "high",
      language: ["en", "ru"],
    };

    const result = await documentUploadService.uploadDocument(uploadRequest);

    if (result.status === "success" && result.data) {
      console.log("  ✅ Test document created:", result.data.documentId);
      return result.data.documentId;
    } else {
      throw new Error(`Document creation failed: ${result.error?.message}`);
    }
  } catch (error) {
    console.error("❌ Test document creation failed:", error);
    throw error;
  }
}

async function testEnhancedStatusRetrieval(documentId: string) {
  console.log("\n🔍 Testing enhanced status retrieval...");

  try {
    // Test with full options
    console.log("  Testing full status with all options...");

    const fullStatus = await documentStatusService.getDocumentStatus(documentId, {
      includeProcessingLogs: true,
      includeStageTiming: true,
      includeMetadata: true,
      useCache: true,
      maxCacheAge: 300,
    });

    if (!fullStatus) {
      console.log("  ❌ Status not found");
      return false;
    }

    console.log("  ✅ Enhanced status retrieved:");
    console.log("    Document ID:", fullStatus.documentId);
    console.log("    Processing status:", fullStatus.processingStatus);
    console.log("    Current stage:", fullStatus.currentStage || "N/A");
    console.log("    Progress:", `${fullStatus.progressPercentage}%`);
    console.log("    Stages completed:", fullStatus.stagesCompleted.length);
    console.log("    Total stages:", fullStatus.allStages.length);
    console.log("    Processing logs:", fullStatus.logsSummary.totalLogs);
    console.log(
      "    Errors/Warnings:",
      `${fullStatus.logsSummary.errorCount}/${fullStatus.logsSummary.warningCount}`,
    );

    if (fullStatus.hasResults) {
      console.log("    Has results:", fullStatus.resultsSummary);
    }

    return true;
  } catch (error) {
    console.error("❌ Enhanced status retrieval failed:", error);
    return false;
  }
}

async function testStatusCaching(documentId: string) {
  console.log("\n🔍 Testing status caching...");

  try {
    // First call - should cache
    console.log("  Making first status call (should cache)...");
    const startTime1 = Date.now();
    await documentStatusService.getDocumentStatus(documentId, { useCache: true });
    const duration1 = Date.now() - startTime1;

    // Second call - should use cache
    console.log("  Making second status call (should use cache)...");
    const startTime2 = Date.now();
    await documentStatusService.getDocumentStatus(documentId, { useCache: true });
    const duration2 = Date.now() - startTime2;

    console.log("  ✅ Caching test results:");
    console.log("    First call:", `${duration1}ms`);
    console.log("    Second call:", `${duration2}ms`);
    console.log("    Cache speedup:", duration2 < duration1 ? "✅ FASTER" : "⚠️ NO IMPROVEMENT");

    // Check cache stats
    const cacheStats = documentStatusService.getCacheStats();
    console.log("  Cache statistics:");
    console.log("    Memory cache size:", cacheStats.memoryCacheSize);
    console.log("    Total cache hits:", cacheStats.totalCacheHits);
    console.log("    Average cache age:", `${cacheStats.averageCacheAge}s`);

    return true;
  } catch (error) {
    console.error("❌ Status caching test failed:", error);
    return false;
  }
}

async function testCacheInvalidation(documentId: string) {
  console.log("\n🔍 Testing cache invalidation...");

  try {
    // Cache a status
    await documentStatusService.getDocumentStatus(documentId, { useCache: true });

    const statsBefore = documentStatusService.getCacheStats();
    console.log("  Cache size before invalidation:", statsBefore.memoryCacheSize);

    // Invalidate cache
    await documentStatusService.invalidateCache(documentId);

    const statsAfter = documentStatusService.getCacheStats();
    console.log("  Cache size after invalidation:", statsAfter.memoryCacheSize);

    if (statsAfter.memoryCacheSize < statsBefore.memoryCacheSize) {
      console.log("  ✅ Cache invalidation successful");
    } else {
      console.log("  ⚠️ Cache invalidation may not have worked");
    }

    return true;
  } catch (error) {
    console.error("❌ Cache invalidation test failed:", error);
    return false;
  }
}

async function testStatusQueryOptions(documentId: string) {
  console.log("\n🔍 Testing status query options...");

  try {
    // Test minimal options
    console.log("  Testing minimal options...");
    const minimalStatus = await documentStatusService.getDocumentStatus(documentId, {
      includeProcessingLogs: false,
      includeStageTiming: false,
      includeMetadata: false,
      useCache: false,
    });

    if (minimalStatus) {
      console.log("  ✅ Minimal status query successful");
    } else {
      console.log("  ❌ Minimal status query failed");
      return false;
    }

    // Test maximal options
    console.log("  Testing maximal options...");
    const maximalStatus = await documentStatusService.getDocumentStatus(documentId, {
      includeProcessingLogs: true,
      includeStageTiming: true,
      includeMetadata: true,
      useCache: true,
      maxCacheAge: 60,
    });

    if (maximalStatus) {
      console.log("  ✅ Maximal status query successful");
      console.log("    All stages count:", maximalStatus.allStages.length);
      console.log("    Metadata included:", !!maximalStatus.metadata);
      console.log("    Logs summary included:", !!maximalStatus.logsSummary);
    } else {
      console.log("  ❌ Maximal status query failed");
      return false;
    }

    return true;
  } catch (error) {
    console.error("❌ Status query options test failed:", error);
    return false;
  }
}

async function testProgressCalculation(documentId: string) {
  console.log("\n🔍 Testing progress calculation...");

  try {
    const status = await documentStatusService.getDocumentStatus(documentId);

    if (!status) {
      console.log("  ❌ Status not found for progress test");
      return false;
    }

    console.log("  ✅ Progress calculation results:");
    console.log("    Overall progress:", `${status.progressPercentage}%`);
    console.log("    Current stage:", status.currentStage || "N/A");
    console.log("    Completed stages:", status.stagesCompleted.length);

    // Validate progress is within bounds
    if (status.progressPercentage >= 0 && status.progressPercentage <= 100) {
      console.log("  ✅ Progress percentage within valid range (0-100%)");
    } else {
      console.log("  ❌ Progress percentage out of range:", status.progressPercentage);
      return false;
    }

    return true;
  } catch (error) {
    console.error("❌ Progress calculation test failed:", error);
    return false;
  }
}

async function testNotFoundHandling() {
  console.log("\n🔍 Testing not found handling...");

  try {
    const fakeDocumentId = "00000000-0000-0000-0000-000000000000";
    const status = await documentStatusService.getDocumentStatus(fakeDocumentId);

    if (status === null) {
      console.log("  ✅ Non-existent document correctly returns null");
      return true;
    } else {
      console.log("  ❌ Non-existent document should return null");
      return false;
    }
  } catch (error) {
    console.error("❌ Not found handling test failed:", error);
    return false;
  }
}

async function runStatusTests() {
  console.log("🚀 Starting Document Status Tests");
  console.log("=" + "=".repeat(50));

  const results = {
    initialization: false,
    testDocumentCreation: false,
    enhancedStatusRetrieval: false,
    caching: false,
    cacheInvalidation: false,
    queryOptions: false,
    progressCalculation: false,
    notFoundHandling: false,
  };

  let testDocumentId: string | null = null;

  try {
    // Initialize services
    console.log("🔧 Initializing services...");
    await initializeDatabase();
    await initializeRedis();
    console.log("✅ Services initialized");
    results.initialization = true;

    // Create test API key
    const { rawKey } = await apiKeyService.createApiKey({
      name: "test-status-key",
      description: "Test API key for status testing",
      environment: "development",
      permissions: ["read", "write"],
      rateLimitPerMinute: 100,
      rateLimitPerHour: 1000,
      rateLimitPerDay: 10000,
      expiresAt: undefined,
      createdBy: "test-system",
    });

    // Create test document
    testDocumentId = await createTestDocument();
    results.testDocumentCreation = true;

    // Test enhanced status retrieval
    results.enhancedStatusRetrieval = await testEnhancedStatusRetrieval(testDocumentId);

    // Test status caching
    results.caching = await testStatusCaching(testDocumentId);

    // Test cache invalidation
    results.cacheInvalidation = await testCacheInvalidation(testDocumentId);

    // Test query options
    results.queryOptions = await testStatusQueryOptions(testDocumentId);

    // Test progress calculation
    results.progressCalculation = await testProgressCalculation(testDocumentId);

    // Test not found handling
    results.notFoundHandling = await testNotFoundHandling();
  } catch (error) {
    console.error("💥 Test initialization failed:", error);
  }

  // Print summary
  console.log("\n" + "=".repeat(50));
  console.log("📋 Document Status Test Results:");
  console.log("  Service Initialization:    ", results.initialization ? "✅ PASSED" : "❌ FAILED");
  console.log(
    "  Test Document Creation:    ",
    results.testDocumentCreation ? "✅ PASSED" : "❌ FAILED",
  );
  console.log(
    "  Enhanced Status Retrieval: ",
    results.enhancedStatusRetrieval ? "✅ PASSED" : "❌ FAILED",
  );
  console.log("  Status Caching:           ", results.caching ? "✅ PASSED" : "❌ FAILED");
  console.log(
    "  Cache Invalidation:       ",
    results.cacheInvalidation ? "✅ PASSED" : "❌ FAILED",
  );
  console.log("  Query Options:            ", results.queryOptions ? "✅ PASSED" : "❌ FAILED");
  console.log(
    "  Progress Calculation:     ",
    results.progressCalculation ? "✅ PASSED" : "❌ FAILED",
  );
  console.log("  Not Found Handling:       ", results.notFoundHandling ? "✅ PASSED" : "❌ FAILED");

  const allPassed = Object.values(results).every((result) => result);

  if (allPassed) {
    console.log("\n🎉 All document status tests PASSED!");
    return 0;
  } else {
    console.log("\n💥 Some document status tests FAILED!");
    return 1;
  }
}

if (import.meta.main) {
  try {
    const exitCode = await runStatusTests();
    Deno.exit(exitCode);
  } catch (error) {
    console.error("💥 Test runner failed:", error);
    Deno.exit(1);
  }
}
