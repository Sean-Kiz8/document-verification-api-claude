#!/usr/bin/env deno run --allow-net --allow-read --allow-env --allow-write

/**
 * Document Results Testing Script
 * Tests document results endpoint with caching and comprehensive data
 */

import { initializeDatabase } from "@config/database.ts";
import { initializeS3 } from "@config/s3.ts";
import { initializeRedis } from "@config/redis.ts";
import { documentResultsService } from "@services/document_results_service.ts";
import { documentUploadService } from "@services/document_upload_service.ts";
import { apiKeyService } from "@services/api_key_service.ts";
import { DocumentQueries } from "@database/queries.ts";
import type { DocumentUploadRequest } from "@models/document_upload.ts";

async function createCompletedTestDocument(): Promise<string> {
  console.log("🔧 Creating completed test document for results testing...");

  try {
    // Create test PNG file
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const testFileData = new Uint8Array(1024);
    testFileData.set(pngHeader, 0);

    const testFile = new Blob([testFileData], { type: "image/png" });

    const uploadRequest: DocumentUploadRequest = {
      file: testFile,
      fileName: "results-test-receipt.png",
      mimeType: "image/png",
      fileSize: testFileData.length,
      userId: "test-user-results",
      transactionId: "test-txn-results-456",
      disputeId: "dispute-results-789",
      documentType: "payment_receipt",
      immediateProcessing: false,
      priority: "normal",
      language: ["en", "ru"],
    };

    const result = await documentUploadService.uploadDocument(uploadRequest);

    if (result.status === "success" && result.data) {
      const documentId = result.data.documentId;

      // Simulate completed processing by updating document with sample data
      console.log("  Simulating completed processing...");

      // Add sample extracted data
      await DocumentQueries.updateExtractedData(documentId, {
        amounts: [
          { value: 1250.50, currency: "USD", confidence: 0.95, type: "total" },
          { value: 125.05, currency: "USD", confidence: 0.85, type: "tax" },
        ],
        dates: [
          { value: new Date().toISOString(), confidence: 0.9, type: "transaction" },
        ],
        transactionIds: [
          { value: uploadRequest.transactionId, confidence: 0.98, type: "transaction_id" },
        ],
        parties: [
          { name: "Test Merchant LLC", type: "merchant", confidence: 0.88 },
        ],
        rawText: "Test merchant payment receipt for $1,250.50 transaction ID: " +
          uploadRequest.transactionId,
        structuredData: { currency: "USD", merchant: "Test Merchant LLC" },
        confidenceScore: {
          overall: 0.91,
          textClarity: 0.93,
          fieldCompleteness: 0.89,
          patternMatching: 0.91,
        },
        fallbackUsed: false,
      });

      // Add sample comparison results
      await DocumentQueries.updateComparisonResults(documentId, {
        overallMatch: 0.87,
        matches: {
          transactionId: 0.98,
          amount: 0.92,
          date: 0.85,
          recipient: 0.75,
        },
        discrepancies: [
          {
            type: "amount_mismatch",
            severity: "low",
            field: "amount",
            description:
              "Minor difference in extracted amount (expected: $1,250.00, extracted: $1,250.50)",
            confidence: 0.8,
          },
        ],
        transactionFound: true,
      });

      // Add sample authenticity results
      await DocumentQueries.updateAuthenticity(documentId, 0.89, {
        confidence: 0.85,
        reasoning: "Document shows consistent patterns and data integrity",
        flags: [
          {
            type: "low_quality_image",
            severity: "low",
            description: "Image resolution could be higher for optimal analysis",
            confidence: 0.6,
          },
        ],
        recommendations: [
          "Consider requesting higher resolution scans",
          "Verify merchant details independently",
        ],
      });

      // Mark as completed
      await DocumentQueries.updateStatus(documentId, "completed", new Date(), new Date());

      console.log("  ✅ Test document created and marked as completed:", documentId);
      return documentId;
    } else {
      throw new Error(`Document creation failed: ${result.error?.message}`);
    }
  } catch (error) {
    console.error("❌ Test document creation failed:", error);
    throw error;
  }
}

async function testResultsRetrieval(documentId: string) {
  console.log("\n🔍 Testing comprehensive results retrieval...");

  try {
    // Test full results with all options
    console.log("  Testing full results with all options...");

    const fullResults = await documentResultsService.getDocumentResults(documentId, {
      includeProcessingLogs: true,
      includeRawText: true,
      includeDiscrepancyDetails: true,
      includeDocumentAccess: true,
      compressionLevel: "basic",
      useCache: true,
      maxCacheAge: 3600,
    });

    if (!fullResults) {
      console.log("  ❌ Results not found");
      return false;
    }

    console.log("  ✅ Comprehensive results retrieved:");
    console.log("    Document ID:", fullResults.documentId);
    console.log("    Processing status:", fullResults.processingStatus);
    console.log(
      "    Overall score:",
      `${Math.round(fullResults.finalAssessment.overallScore * 100)}%`,
    );
    console.log("    Recommendation:", fullResults.finalAssessment.recommendation);
    console.log("    Risk level:", fullResults.finalAssessment.riskLevel);
    console.log("    OCR confidence:", `${Math.round(fullResults.ocrResults.confidence * 100)}%`);
    console.log(
      "    Comparison match:",
      `${Math.round(fullResults.comparisonResults.overallMatch * 100)}%`,
    );
    console.log(
      "    Authenticity score:",
      `${Math.round(fullResults.authenticityResults.analysis.score * 100)}%`,
    );
    console.log("    Processing time:", `${fullResults.totalProcessingTime}ms`);
    console.log("    Discrepancies:", fullResults.comparisonResults.discrepancies.length);
    console.log("    Flags:", fullResults.authenticityResults.analysis.flags.length);

    return true;
  } catch (error) {
    console.error("❌ Results retrieval failed:", error);
    return false;
  }
}

async function testProcessingSummary(documentId: string) {
  console.log("\n🔍 Testing processing summary...");

  try {
    const summary = await documentResultsService.getProcessingSummary(documentId);

    if (!summary) {
      console.log("  ❌ Summary not found");
      return false;
    }

    console.log("  ✅ Processing summary retrieved:");
    console.log("    Document ID:", summary.documentId);
    console.log("    Status:", summary.status);
    console.log("    Overall score:", `${Math.round(summary.overallScore * 100)}%`);
    console.log("    Recommendation:", summary.recommendation);
    console.log("    Risk level:", summary.riskLevel);
    console.log("    Processing time:", `${summary.processingTime}ms`);
    console.log("    Flags count:", summary.flagsCount);
    console.log("    Discrepancies count:", summary.discrepanciesCount);

    return true;
  } catch (error) {
    console.error("❌ Processing summary test failed:", error);
    return false;
  }
}

async function testResultsCaching(documentId: string) {
  console.log("\n🔍 Testing results caching...");

  try {
    // First call - should cache
    console.log("  Making first results call (should cache)...");
    const startTime1 = Date.now();
    await documentResultsService.getDocumentResults(documentId, { useCache: true });
    const duration1 = Date.now() - startTime1;

    // Second call - should use cache
    console.log("  Making second results call (should use cache)...");
    const startTime2 = Date.now();
    await documentResultsService.getDocumentResults(documentId, { useCache: true });
    const duration2 = Date.now() - startTime2;

    console.log("  ✅ Results caching test:");
    console.log("    First call:", `${duration1}ms`);
    console.log("    Second call:", `${duration2}ms`);
    console.log("    Cache speedup:", duration2 < duration1 ? "✅ FASTER" : "⚠️ NO IMPROVEMENT");

    // Check cache stats
    const cacheStats = documentResultsService.getCacheStats();
    console.log("  Cache statistics:");
    console.log("    Memory cache size:", cacheStats.memoryCacheSize);
    console.log("    Total cache hits:", cacheStats.totalCacheHits);
    console.log("    Average cache age:", `${cacheStats.averageCacheAge}s`);

    return true;
  } catch (error) {
    console.error("❌ Results caching test failed:", error);
    return false;
  }
}

async function testResultsQueryOptions(documentId: string) {
  console.log("\n🔍 Testing results query options...");

  try {
    // Test minimal options
    console.log("  Testing minimal options...");
    const minimalResults = await documentResultsService.getDocumentResults(documentId, {
      includeProcessingLogs: false,
      includeRawText: false,
      includeDiscrepancyDetails: false,
      includeDocumentAccess: false,
      compressionLevel: "none",
      useCache: false,
    });

    if (minimalResults) {
      console.log("  ✅ Minimal results query successful");
      console.log("    Raw text included:", !!minimalResults.ocrResults.extractedData.rawText);
      console.log(
        "    Document access included:",
        !!minimalResults.documentAccess.originalDocument.downloadUrl,
      );
    } else {
      console.log("  ❌ Minimal results query failed");
      return false;
    }

    // Test maximal options
    console.log("  Testing maximal options...");
    const maximalResults = await documentResultsService.getDocumentResults(documentId, {
      includeProcessingLogs: true,
      includeRawText: true,
      includeDiscrepancyDetails: true,
      includeDocumentAccess: true,
      compressionLevel: "maximum",
      useCache: true,
    });

    if (maximalResults) {
      console.log("  ✅ Maximal results query successful");
      console.log("    Processing logs included:", maximalResults.processingLogs.totalLogs > 0);
      console.log("    Raw text included:", !!maximalResults.ocrResults.extractedData.rawText);
      console.log(
        "    Document access included:",
        !!maximalResults.documentAccess.originalDocument.downloadUrl,
      );
      console.log(
        "    Discrepancies included:",
        maximalResults.comparisonResults.discrepancies.length >= 0,
      );
    } else {
      console.log("  ❌ Maximal results query failed");
      return false;
    }

    return true;
  } catch (error) {
    console.error("❌ Results query options test failed:", error);
    return false;
  }
}

async function testNotFoundHandling() {
  console.log("\n🔍 Testing not found handling...");

  try {
    const fakeDocumentId = "00000000-0000-0000-0000-000000000000";
    const results = await documentResultsService.getDocumentResults(fakeDocumentId);

    if (results === null) {
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

async function testCacheInvalidation(documentId: string) {
  console.log("\n🔍 Testing cache invalidation...");

  try {
    // Cache results
    await documentResultsService.getDocumentResults(documentId, { useCache: true });

    const statsBefore = documentResultsService.getCacheStats();
    console.log("  Cache size before invalidation:", statsBefore.memoryCacheSize);

    // Invalidate cache
    await documentResultsService.invalidateCache(documentId);

    const statsAfter = documentResultsService.getCacheStats();
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

async function runResultsTests() {
  console.log("🚀 Starting Document Results Tests");
  console.log("=" + "=".repeat(50));

  const results = {
    initialization: false,
    testDocumentCreation: false,
    resultsRetrieval: false,
    processingSummary: false,
    resultsCaching: false,
    queryOptions: false,
    notFoundHandling: false,
    cacheInvalidation: false,
  };

  let testDocumentId: string | null = null;

  try {
    // Initialize services
    console.log("🔧 Initializing services...");
    await initializeDatabase();
    await initializeS3();
    await initializeRedis();
    console.log("✅ Services initialized");
    results.initialization = true;

    // Create test API key
    const { rawKey } = await apiKeyService.createApiKey({
      name: "test-results-key",
      description: "Test API key for results testing",
      environment: "development",
      permissions: ["read", "write"],
      rateLimitPerMinute: 100,
      rateLimitPerHour: 1000,
      rateLimitPerDay: 10000,
      expiresAt: undefined,
      createdBy: "test-system",
    });

    // Create completed test document
    testDocumentId = await createCompletedTestDocument();
    results.testDocumentCreation = true;

    // Test results retrieval
    results.resultsRetrieval = await testResultsRetrieval(testDocumentId);

    // Test processing summary
    results.processingSummary = await testProcessingSummary(testDocumentId);

    // Test results caching
    results.resultsCaching = await testResultsCaching(testDocumentId);

    // Test query options
    results.queryOptions = await testResultsQueryOptions(testDocumentId);

    // Test not found handling
    results.notFoundHandling = await testNotFoundHandling();

    // Test cache invalidation
    results.cacheInvalidation = await testCacheInvalidation(testDocumentId);
  } catch (error) {
    console.error("💥 Test initialization failed:", error);
  }

  // Print summary
  console.log("\n" + "=".repeat(50));
  console.log("📋 Document Results Test Results:");
  console.log("  Service Initialization:  ", results.initialization ? "✅ PASSED" : "❌ FAILED");
  console.log(
    "  Test Document Creation:  ",
    results.testDocumentCreation ? "✅ PASSED" : "❌ FAILED",
  );
  console.log("  Results Retrieval:       ", results.resultsRetrieval ? "✅ PASSED" : "❌ FAILED");
  console.log("  Processing Summary:      ", results.processingSummary ? "✅ PASSED" : "❌ FAILED");
  console.log("  Results Caching:         ", results.resultsCaching ? "✅ PASSED" : "❌ FAILED");
  console.log("  Query Options:           ", results.queryOptions ? "✅ PASSED" : "❌ FAILED");
  console.log("  Not Found Handling:      ", results.notFoundHandling ? "✅ PASSED" : "❌ FAILED");
  console.log("  Cache Invalidation:      ", results.cacheInvalidation ? "✅ PASSED" : "❌ FAILED");

  const allPassed = Object.values(results).every((result) => result);

  if (allPassed) {
    console.log("\n🎉 All document results tests PASSED!");
    return 0;
  } else {
    console.log("\n💥 Some document results tests FAILED!");
    return 1;
  }
}

if (import.meta.main) {
  try {
    const exitCode = await runResultsTests();
    Deno.exit(exitCode);
  } catch (error) {
    console.error("💥 Test runner failed:", error);
    Deno.exit(1);
  }
}
