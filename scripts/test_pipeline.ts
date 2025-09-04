#!/usr/bin/env deno run --allow-net --allow-read --allow-env --allow-write

/**
 * Async Processing Pipeline Testing Script
 * Tests the complete async processing pipeline with queues and workers
 */

import { initializeDatabase } from "@config/database.ts";
import { initializeRedis } from "@config/redis.ts";
import { pipelineService, queueService } from "@services/worker_service.ts";
import { documentUploadService } from "@services/document_upload_service.ts";
import { apiKeyService } from "@services/api_key_service.ts";
import { StageFactory } from "@services/processing_stages.ts";
import type { DocumentUploadRequest } from "@models/document_upload.ts";
import type { ProcessingStageType, QueueMessage } from "@models/queue.ts";

async function testQueueOperations() {
  console.log("🔍 Testing queue operations...");

  try {
    // Test enqueue
    console.log("  Testing message enqueue...");

    const testMessage: QueueMessage = {
      id: crypto.randomUUID(),
      documentId: crypto.randomUUID(),
      stage: "document_validation",
      priority: "high",
      enqueuedAt: new Date(),
      retryCount: 0,
      maxRetries: 3,
      metadata: {
        userId: "test-user",
        transactionId: "test-txn",
        originalFileName: "test.png",
        fileSize: 1024,
        contentType: "image/png",
      },
      config: {
        timeout: 30000,
        language: ["en", "ru"],
      },
    };

    const enqueueResult = await queueService.enqueue("document_validation", testMessage, "high");

    if (enqueueResult.success) {
      console.log("  ✅ Message enqueued successfully:");
      console.log("    Message ID:", enqueueResult.messageId);
      console.log("    Queue position:", enqueueResult.queuePosition);
      console.log(
        "    Estimated processing time:",
        enqueueResult.estimatedProcessingTime,
        "seconds",
      );
    } else {
      console.log("  ❌ Message enqueue failed:", enqueueResult.error);
      return false;
    }

    // Test peek
    console.log("  Testing queue peek...");
    const peekedMessage = await queueService.peek("document_validation", "high");

    if (peekedMessage && peekedMessage.id === testMessage.id) {
      console.log("  ✅ Queue peek successful - found enqueued message");
    } else {
      console.log("  ❌ Queue peek failed - message not found");
      return false;
    }

    // Test dequeue
    console.log("  Testing message dequeue...");
    const dequeuedMessage = await queueService.dequeue("document_validation");

    if (dequeuedMessage && dequeuedMessage.id === testMessage.id) {
      console.log("  ✅ Message dequeued successfully");
    } else {
      console.log("  ❌ Message dequeue failed");
      return false;
    }

    return true;
  } catch (error) {
    console.error("❌ Queue operations test failed:", error);
    return false;
  }
}

async function testQueueStats() {
  console.log("\n🔍 Testing queue statistics...");

  try {
    const stats = await queueService.getQueueStats();

    console.log("  ✅ Queue statistics retrieved:");
    for (const stat of stats) {
      console.log(`    ${stat.queueName}: ${stat.totalMessages} messages`);
      console.log(
        `      By priority: high=${stat.messagesByPriority.high}, medium=${stat.messagesByPriority.medium}, low=${stat.messagesByPriority.low}`,
      );
      console.log(`      Average wait: ${stat.averageWaitTime}ms`);
      console.log(`      Throughput: ${stat.throughputPerHour}/hour`);
    }

    return true;
  } catch (error) {
    console.error("❌ Queue statistics test failed:", error);
    return false;
  }
}

async function testStageProcessors() {
  console.log("\n🔍 Testing stage processors...");

  try {
    const stages: ProcessingStageType[] = ["document_validation", "s3_upload", "ocr_extraction"];

    for (const stageType of stages) {
      console.log(`  Testing ${stageType} stage...`);

      const stage = StageFactory.getStage(stageType);
      if (stage) {
        console.log(`  ✅ ${stageType} stage processor available`);
      } else {
        console.log(`  ❌ ${stageType} stage processor not found`);
        return false;
      }
    }

    console.log("  ✅ All stage processors available");
    return true;
  } catch (error) {
    console.error("❌ Stage processors test failed:", error);
    return false;
  }
}

async function testPipelineHealth() {
  console.log("\n🔍 Testing pipeline health checks...");

  try {
    const queueHealth = await queueService.healthCheck();

    console.log("  ✅ Queue health check results:");
    console.log("    Status:", queueHealth.status);
    console.log(
      "    Redis connection:",
      queueHealth.details.redisConnection ? "✅ OK" : "❌ FAILED",
    );
    console.log("    Total queued messages:", queueHealth.details.totalQueuedMessages);

    if (queueHealth.details.oldestMessageAge) {
      console.log(
        "    Oldest message age:",
        Math.round(queueHealth.details.oldestMessageAge / 1000),
        "seconds",
      );
    }

    return queueHealth.status !== "unhealthy";
  } catch (error) {
    console.error("❌ Pipeline health test failed:", error);
    return false;
  }
}

async function testPipelineIntegration() {
  console.log("\n🔍 Testing pipeline integration...");

  try {
    // Create a test document
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const testFileData = new Uint8Array(1024);
    testFileData.set(pngHeader, 0);

    const testFile = new Blob([testFileData], { type: "image/png" });

    const uploadRequest: DocumentUploadRequest = {
      file: testFile,
      fileName: "pipeline-test-receipt.png",
      mimeType: "image/png",
      fileSize: testFileData.length,
      userId: "test-user-pipeline",
      transactionId: "test-txn-pipeline-999",
      disputeId: "dispute-pipeline-111",
      documentType: "payment_receipt",
      immediateProcessing: true,
      priority: "high",
      language: ["en", "ru"],
    };

    console.log("  Creating test document for pipeline...");
    const uploadResult = await documentUploadService.uploadDocument(uploadRequest);

    if (uploadResult.status === "success" && uploadResult.data) {
      console.log("  ✅ Test document created for pipeline test");

      // Start pipeline processing
      const pipelineResult = await pipelineService.startDocumentProcessing(
        uploadResult.data.documentId,
        {
          userId: uploadRequest.userId,
          transactionId: uploadRequest.transactionId,
          disputeId: uploadRequest.disputeId,
          originalFileName: uploadRequest.fileName,
          fileSize: uploadRequest.fileSize,
          contentType: uploadRequest.mimeType,
        },
        "high",
      );

      if (pipelineResult.success) {
        console.log("  ✅ Pipeline processing initiated");
        console.log("    Message ID:", pipelineResult.messageId);
        console.log("    Queue position:", pipelineResult.queuePosition);
        return true;
      } else {
        console.log("  ❌ Pipeline processing failed:", pipelineResult.error);
        return false;
      }
    } else {
      console.log("  ❌ Test document creation failed:", uploadResult.error?.message);
      return false;
    }
  } catch (error) {
    console.error("❌ Pipeline integration test failed:", error);
    return false;
  }
}

async function testQueueClearance() {
  console.log("\n🔧 Testing queue clearance (cleanup)...");

  try {
    await queueService.clearAllQueues();
    console.log("  ✅ All queues cleared successfully");
    return true;
  } catch (error) {
    console.error("❌ Queue clearance failed:", error);
    return false;
  }
}

async function runPipelineTests() {
  console.log("🚀 Starting Async Processing Pipeline Tests");
  console.log("=" + "=".repeat(50));

  const results = {
    initialization: false,
    queueOperations: false,
    queueStats: false,
    stageProcessors: false,
    pipelineHealth: false,
    pipelineIntegration: false,
    queueClearance: false,
  };

  try {
    // Initialize services
    console.log("🔧 Initializing services...");
    await initializeDatabase();
    await initializeRedis();
    console.log("✅ Services initialized");
    results.initialization = true;

    // Create test API key
    const { rawKey } = await apiKeyService.createApiKey({
      name: "test-pipeline-key",
      description: "Test API key for pipeline testing",
      environment: "development",
      permissions: ["read", "write"],
      rateLimitPerMinute: 200,
      rateLimitPerHour: 2000,
      rateLimitPerDay: 20000,
      expiresAt: undefined,
      createdBy: "test-system",
    });

    // Clear any existing queue data
    results.queueClearance = await testQueueClearance();

    // Test queue operations
    results.queueOperations = await testQueueOperations();

    // Test queue statistics
    results.queueStats = await testQueueStats();

    // Test stage processors
    results.stageProcessors = await testStageProcessors();

    // Test pipeline health
    results.pipelineHealth = await testPipelineHealth();

    // Test pipeline integration (creates actual documents)
    results.pipelineIntegration = await testPipelineIntegration();
  } catch (error) {
    console.error("💥 Test initialization failed:", error);
  }

  // Print summary
  console.log("\n" + "=".repeat(50));
  console.log("📋 Async Processing Pipeline Test Results:");
  console.log("  Service Initialization:", results.initialization ? "✅ PASSED" : "❌ FAILED");
  console.log("  Queue Operations:      ", results.queueOperations ? "✅ PASSED" : "❌ FAILED");
  console.log("  Queue Statistics:      ", results.queueStats ? "✅ PASSED" : "❌ FAILED");
  console.log("  Stage Processors:      ", results.stageProcessors ? "✅ PASSED" : "❌ FAILED");
  console.log("  Pipeline Health:       ", results.pipelineHealth ? "✅ PASSED" : "❌ FAILED");
  console.log("  Pipeline Integration:  ", results.pipelineIntegration ? "✅ PASSED" : "❌ FAILED");
  console.log("  Queue Clearance:       ", results.queueClearance ? "✅ PASSED" : "❌ FAILED");

  const allPassed = Object.values(results).every((result) => result);

  if (allPassed) {
    console.log("\n🎉 All async processing pipeline tests PASSED!");
    return 0;
  } else {
    console.log("\n💥 Some async processing pipeline tests FAILED!");
    return 1;
  }
}

if (import.meta.main) {
  try {
    const exitCode = await runPipelineTests();
    Deno.exit(exitCode);
  } catch (error) {
    console.error("💥 Test runner failed:", error);
    Deno.exit(1);
  }
}
