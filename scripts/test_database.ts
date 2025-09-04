#!/usr/bin/env deno run --allow-net --allow-read --allow-env

import { getDatabaseHealth, initializeDatabase } from "@config/database.ts";
import { DocumentQueries, ProcessingLogQueries } from "@database/queries.ts";

/**
 * Database Testing Script
 * Tests database connectivity and basic operations
 */

async function testDatabaseConnection() {
  console.log("🔍 Testing database connection...");

  try {
    await initializeDatabase();
    console.log("✅ Database connection successful");

    const health = await getDatabaseHealth();
    console.log("📊 Database health:", {
      status: health.status,
      latency: health.latency ? `${health.latency}ms` : "N/A",
      lastCheck: health.lastCheck,
    });

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("❌ Database connection failed:", errorMessage);
    return false;
  }
}

async function testDocumentOperations() {
  console.log("\n🔍 Testing document operations...");

  try {
    // Test document creation
    const testDocument = {
      transaction_id: "test_txn_123",
      dispute_id: "test_dispute_456",
      user_id: "test_user_789",
      file_name: "test_receipt.pdf",
      file_size: 1024000, // 1MB
      mime_type: "application/pdf" as const,
      document_type: "payment_receipt" as const,
      s3_key: "documents/test/test_receipt.pdf",
      s3_bucket: "test-bucket",
      upload_timestamp: new Date(),
      processing_status: "queued" as const,
    };

    console.log("  Creating test document...");
    const createdDoc = await DocumentQueries.create(testDocument);
    console.log("  ✅ Document created with ID:", createdDoc.id);

    // Test document retrieval
    console.log("  Retrieving document by ID...");
    const retrievedDoc = await DocumentQueries.getById(createdDoc.id);
    if (retrievedDoc) {
      console.log("  ✅ Document retrieved successfully");
    } else {
      console.log("  ❌ Document retrieval failed");
      return false;
    }

    // Test status update
    console.log("  Updating document status...");
    const startTime = new Date();
    const updatedDoc = await DocumentQueries.updateStatus(
      createdDoc.id,
      "processing",
      startTime,
    );

    if (updatedDoc?.processing_status === "processing") {
      console.log("  ✅ Document status updated successfully");
    } else {
      console.log("  ❌ Document status update failed");
      return false;
    }

    // Test extracted data update
    console.log("  Adding extracted data...");
    const extractedData = {
      amount: "150.00",
      currency: "RUB",
      date: "2025-09-04",
      recipient: "Test User",
      confidence: 0.95,
    };

    const docWithData = await DocumentQueries.updateExtractedData(
      createdDoc.id,
      extractedData,
    );

    if (docWithData?.extracted_data) {
      console.log("  ✅ Extracted data updated successfully");
    } else {
      console.log("  ❌ Extracted data update failed");
      return false;
    }

    // Test document statistics
    console.log("  Getting document statistics...");
    const stats = await DocumentQueries.getStats();
    console.log("  📊 Document stats:", {
      total: stats.total,
      recent_24h: stats.recent_24h,
      queued: stats.by_status.queued,
      processing: stats.by_status.processing,
    });

    // Clean up test document
    console.log("  Cleaning up test document...");
    await DocumentQueries.delete(createdDoc.id);
    console.log("  ✅ Test document cleaned up");

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("❌ Document operations test failed:", errorMessage);
    return false;
  }
}

async function testProcessingLogs() {
  console.log("\n🔍 Testing processing logs...");

  try {
    // Create a test document first
    const testDocument = {
      transaction_id: "test_txn_logs",
      user_id: "test_user_logs",
      file_name: "test_log.pdf",
      file_size: 512000,
      mime_type: "application/pdf" as const,
      document_type: "payment_receipt" as const,
      s3_key: "documents/test/test_log.pdf",
      s3_bucket: "test-bucket",
      upload_timestamp: new Date(),
      processing_status: "queued" as const,
    };

    const doc = await DocumentQueries.create(testDocument);
    console.log("  Created test document for logs");

    // Create processing log
    const logEntry = {
      document_id: doc.id,
      stage: "ocr_extraction",
      status: "started",
      started_at: new Date(),
      log_level: "INFO" as const,
      message: "Starting OCR extraction process",
      metadata: { version: "1.0", model: "test" },
    };

    console.log("  Creating processing log...");
    const createdLog = await ProcessingLogQueries.create(logEntry);
    console.log("  ✅ Processing log created");

    // Retrieve logs for document
    console.log("  Retrieving logs for document...");
    const logs = await ProcessingLogQueries.getByDocumentId(doc.id);

    if (logs.length > 0) {
      console.log("  ✅ Processing logs retrieved:", logs.length, "entries");
    } else {
      console.log("  ❌ No processing logs found");
      return false;
    }

    // Clean up
    await DocumentQueries.delete(doc.id);
    console.log("  ✅ Test data cleaned up");

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("❌ Processing logs test failed:", errorMessage);
    return false;
  }
}

async function runDatabaseTests() {
  console.log("🚀 Starting Database Tests");
  console.log("=".repeat(50));

  const results = {
    connection: false,
    documents: false,
    logs: false,
  };

  // Test database connection
  results.connection = await testDatabaseConnection();

  if (results.connection) {
    // Test document operations
    results.documents = await testDocumentOperations();

    // Test processing logs
    results.logs = await testProcessingLogs();
  }

  // Print summary
  console.log("\n" + "=".repeat(50));
  console.log("📋 Test Results Summary:");
  console.log("  Database Connection:", results.connection ? "✅ PASSED" : "❌ FAILED");
  console.log("  Document Operations:", results.documents ? "✅ PASSED" : "❌ FAILED");
  console.log("  Processing Logs:    ", results.logs ? "✅ PASSED" : "❌ FAILED");

  const allPassed = Object.values(results).every((result) => result);

  if (allPassed) {
    console.log("\n🎉 All database tests PASSED!");
    return 0;
  } else {
    console.log("\n💥 Some database tests FAILED!");
    return 1;
  }
}

if (import.meta.main) {
  try {
    const exitCode = await runDatabaseTests();
    Deno.exit(exitCode);
  } catch (error) {
    console.error("💥 Test runner failed:", error);
    Deno.exit(1);
  }
}
