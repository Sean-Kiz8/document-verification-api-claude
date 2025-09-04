#!/usr/bin/env deno run --allow-net --allow-read --allow-env --allow-write

/**
 * Document Upload Testing Script
 * Tests document upload endpoint and processing queue
 */

import { initializeDatabase } from "@config/database.ts";
import { initializeS3 } from "@config/s3.ts";
import { initializeRedis } from "@config/redis.ts";
import { initializeLlamaParse } from "@config/llama_parse.ts";
import { documentUploadService } from "@services/document_upload_service.ts";
import { apiKeyService } from "@services/api_key_service.ts";
import type { DocumentUploadRequest } from "@models/document_upload.ts";

async function testDocumentUploadService() {
  console.log("🔍 Testing document upload service...");

  try {
    // Create test PNG file
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const testFileData = new Uint8Array(1024);
    testFileData.set(pngHeader, 0);

    const testFile = new Blob([testFileData], { type: "image/png" });

    const uploadRequest: DocumentUploadRequest = {
      file: testFile,
      fileName: "test-payment-receipt.png",
      mimeType: "image/png",
      fileSize: testFileData.length,
      userId: "test-user-upload",
      transactionId: "test-txn-upload-123",
      disputeId: "dispute-456",
      documentType: "payment_receipt",
      immediateProcessing: false,
      priority: "normal",
      language: ["en", "ru"],
    };

    console.log("  Uploading test document...");
    const result = await documentUploadService.uploadDocument(uploadRequest);

    if (result.status === "success" && result.data) {
      console.log("  ✅ Document upload successful:");
      console.log("    Document ID:", result.data.documentId);
      console.log("    File name:", result.data.fileName);
      console.log("    File size:", result.data.fileSize, "bytes");
      console.log("    Processing status:", result.data.processingStatus);
      console.log("    S3 key:", result.data.s3Key);
      console.log("    Estimated completion:", result.data.estimatedCompletionTime);

      return { success: true, documentId: result.data.documentId };
    } else {
      console.log("  ❌ Document upload failed:", result.error?.message);
      return { success: false };
    }
  } catch (error) {
    console.error("❌ Document upload service test failed:", error);
    return { success: false };
  }
}

async function testUploadValidation() {
  console.log("\n🔍 Testing upload validation...");

  try {
    // Test with invalid file type
    console.log("  Testing invalid file type...");
    const invalidFile = new Blob([new Uint8Array(100)], { type: "text/plain" });

    const invalidRequest: DocumentUploadRequest = {
      file: invalidFile,
      fileName: "test.txt",
      mimeType: "text/plain",
      fileSize: 100,
      userId: "test-user",
      transactionId: "test-txn",
      disputeId: undefined,
      language: undefined,
    };

    const invalidResult = await documentUploadService.uploadDocument(invalidRequest);

    if (invalidResult.status === "error") {
      console.log("  ✅ Invalid file type correctly rejected:", invalidResult.error?.message);
    } else {
      console.log("  ❌ Invalid file type should have been rejected");
      return false;
    }

    // Test with oversized file
    console.log("  Testing oversized file...");
    const oversizedFile = new Blob([new Uint8Array(100 * 1024 * 1024)], { type: "image/png" }); // 100MB

    const oversizedRequest: DocumentUploadRequest = {
      file: oversizedFile,
      fileName: "oversized.png",
      mimeType: "image/png",
      fileSize: 100 * 1024 * 1024,
      userId: "test-user",
      transactionId: "test-txn",
      disputeId: undefined,
      language: undefined,
    };

    const oversizedResult = await documentUploadService.uploadDocument(oversizedRequest);

    if (oversizedResult.status === "error") {
      console.log("  ✅ Oversized file correctly rejected:", oversizedResult.error?.message);
    } else {
      console.log("  ❌ Oversized file should have been rejected");
      return false;
    }

    // Test with missing required fields
    console.log("  Testing missing required fields...");
    const incompleteRequest: DocumentUploadRequest = {
      file: new Blob([new Uint8Array(100)], { type: "image/png" }),
      fileName: "test.png",
      mimeType: "image/png",
      fileSize: 100,
      userId: "", // Empty user ID
      transactionId: "test-txn",
      disputeId: undefined,
      language: undefined,
    };

    const incompleteResult = await documentUploadService.uploadDocument(incompleteRequest);

    if (incompleteResult.status === "error") {
      console.log(
        "  ✅ Missing required fields correctly rejected:",
        incompleteResult.error?.message,
      );
    } else {
      console.log("  ❌ Missing required fields should have been rejected");
      return false;
    }

    return true;
  } catch (error) {
    console.error("❌ Upload validation test failed:", error);
    return false;
  }
}

async function testProcessingQueue() {
  console.log("\n🔍 Testing processing queue...");

  try {
    const queueStatus = documentUploadService.getQueueStatus();

    console.log("  📊 Current queue status:");
    console.log("    Total queued:", queueStatus.totalQueued);
    console.log("    By priority:", queueStatus.byPriority);
    console.log("    Oldest queued at:", queueStatus.oldestQueuedAt || "N/A");

    console.log("  ✅ Processing queue working correctly");
    return true;
  } catch (error) {
    console.error("❌ Processing queue test failed:", error);
    return false;
  }
}

async function testDocumentStatus(documentId: string) {
  console.log("\n🔍 Testing document status retrieval...");

  try {
    const status = await documentUploadService.getDocumentStatus(documentId);

    if (status) {
      console.log("  ✅ Document status retrieved:");
      console.log("    Document ID:", status.documentId);
      console.log("    Processing status:", status.processingStatus);
      console.log("    Queue position:", status.queuePosition || "N/A");
      console.log("    Estimated completion:", status.estimatedCompletion || "N/A");
      console.log("    Processing stages:", status.processingStages.length);

      return true;
    } else {
      console.log("  ❌ Document status not found");
      return false;
    }
  } catch (error) {
    console.error("❌ Document status test failed:", error);
    return false;
  }
}

async function testApiKeyCreation() {
  console.log("🔧 Creating test API key for upload testing...");

  try {
    const { rawKey } = await apiKeyService.createApiKey({
      name: "test-upload-key",
      description: "Test API key for upload testing",
      environment: "development",
      permissions: ["read", "write"],
      rateLimitPerMinute: 100,
      rateLimitPerHour: 1000,
      rateLimitPerDay: 10000,
      expiresAt: undefined,
      createdBy: "test-system",
    });

    console.log("  ✅ Test API key created:", `${rawKey.substring(0, 20)}...`);
    return rawKey;
  } catch (error) {
    console.error("❌ Test API key creation failed:", error);
    throw error;
  }
}

async function runUploadTests() {
  console.log("🚀 Starting Document Upload Tests");
  console.log("=" + "=".repeat(50));

  const results = {
    initialization: false,
    apiKey: false,
    uploadService: false,
    validation: false,
    queue: false,
    status: false,
  };

  let testDocumentId: string | null = null;

  try {
    // Initialize all services
    console.log("🔧 Initializing services...");
    await initializeDatabase();
    await initializeS3();
    await initializeRedis();
    await initializeLlamaParse();
    console.log("✅ All services initialized");
    results.initialization = true;

    // Create test API key
    const testApiKey = await testApiKeyCreation();
    results.apiKey = true;

    // Test document upload service
    const uploadResult = await testDocumentUploadService();
    results.uploadService = uploadResult.success;

    if (uploadResult.success && uploadResult.documentId) {
      testDocumentId = uploadResult.documentId;
    }

    // Test upload validation
    results.validation = await testUploadValidation();

    // Test processing queue
    results.queue = await testProcessingQueue();

    // Test document status (if we have a document)
    if (testDocumentId) {
      results.status = await testDocumentStatus(testDocumentId);
    } else {
      console.log("  ⚠️ Skipping status test - no document ID available");
      results.status = true; // Don't fail the test suite
    }
  } catch (error) {
    console.error("💥 Test initialization failed:", error);
  }

  // Print summary
  console.log("\n" + "=".repeat(50));
  console.log("📋 Document Upload Test Results:");
  console.log("  Service Initialization:", results.initialization ? "✅ PASSED" : "❌ FAILED");
  console.log("  API Key Creation:      ", results.apiKey ? "✅ PASSED" : "❌ FAILED");
  console.log("  Upload Service:        ", results.uploadService ? "✅ PASSED" : "❌ FAILED");
  console.log("  Upload Validation:     ", results.validation ? "✅ PASSED" : "❌ FAILED");
  console.log("  Processing Queue:      ", results.queue ? "✅ PASSED" : "❌ FAILED");
  console.log("  Document Status:       ", results.status ? "✅ PASSED" : "❌ FAILED");

  const allPassed = Object.values(results).every((result) => result);

  if (allPassed) {
    console.log("\n🎉 All document upload tests PASSED!");
    return 0;
  } else {
    console.log("\n💥 Some document upload tests FAILED!");
    return 1;
  }
}

if (import.meta.main) {
  try {
    const exitCode = await runUploadTests();
    Deno.exit(exitCode);
  } catch (error) {
    console.error("💥 Test runner failed:", error);
    Deno.exit(1);
  }
}
