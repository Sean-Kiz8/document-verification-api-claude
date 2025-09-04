/**
 * Document Upload Service
 * Handles file uploads, validation, and processing initiation
 */

import { log } from "@/deps.ts";
import { getConfig } from "@config/env.ts";
import { DocumentQueries } from "@database/queries.ts";
import { storageService } from "@services/storage_service.ts";
import { ocrService } from "@services/ocr_service.ts";
import type {
  DocumentUploadRequest,
  DocumentUploadResponse,
  ProcessingQueueEntry,
  ProcessingStage,
  ProcessingStageResult,
  UploadValidation,
} from "@models/document_upload.ts";
import type { Document } from "@database/queries.ts";

class DocumentUploadService {
  private logger = log.getLogger();
  private processingQueue: Map<string, ProcessingQueueEntry> = new Map();

  /**
   * Process document upload request
   */
  async uploadDocument(request: DocumentUploadRequest): Promise<DocumentUploadResponse> {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();

    try {
      this.logger.info(`Starting document upload processing (request: ${requestId})`);

      // Stage 1: Validate upload request
      await this.logProcessingStage(requestId, "upload_validation", "started");
      const validation = await this.validateUploadRequest(request);

      if (!validation.isValid) {
        await this.logProcessingStage(requestId, "upload_validation", "failed", {
          errors: validation.errors,
        });

        return this.createErrorResponse(
          requestId,
          "VALIDATION_FAILED",
          validation.errors.join("; "),
        );
      }

      await this.logProcessingStage(requestId, "upload_validation", "completed");

      // Generate document ID
      const documentId = crypto.randomUUID();

      // Stage 2: Upload file to S3
      await this.logProcessingStage(documentId, "s3_upload", "started");

      const fileBuffer = await this.extractFileBuffer(request.file);
      const s3Result = await storageService.uploadDocument(fileBuffer, {
        contentType: request.mimeType,
        originalFileName: request.fileName,
        userId: request.userId,
        transactionId: request.transactionId,
        disputeId: request.disputeId,
      });

      await this.logProcessingStage(documentId, "s3_upload", "completed", {
        s3Key: s3Result.key,
        fileSize: s3Result.size,
      });

      // Stage 3: Create database record
      await this.logProcessingStage(documentId, "database_creation", "started");

      const documentRecord: Omit<Document, "id" | "created_at" | "updated_at"> = {
        transaction_id: request.transactionId,
        dispute_id: request.disputeId || undefined,
        user_id: request.userId,
        file_name: request.fileName,
        file_size: request.fileSize,
        mime_type: request.mimeType,
        document_type: request.documentType || "payment_receipt",
        s3_key: s3Result.key,
        s3_bucket: s3Result.bucket || "",
        upload_timestamp: new Date(),
        processing_status: "queued",
        started_processing_at: undefined,
        completed_processing_at: undefined,
        extracted_data: undefined,
        comparison_results: undefined,
        authenticity_score: undefined,
        authenticity_details: undefined,
      };

      const document = await DocumentQueries.create(documentRecord);

      await this.logProcessingStage(documentId, "database_creation", "completed", {
        documentId: document.id,
      });

      // Stage 4: Queue for processing
      await this.logProcessingStage(documentId, "ocr_queued", "started");

      const queueEntry = await this.queueDocumentProcessing(document, request);

      await this.logProcessingStage(documentId, "ocr_queued", "completed", {
        estimatedCompletion: queueEntry.estimatedCompletionTime.toISOString(),
        priority: queueEntry.priority,
      });

      // Optionally start immediate processing
      if (request.immediateProcessing) {
        this.startDocumentProcessing(document.id).catch((error) => {
          this.logger.error(`Failed to start immediate processing for ${document.id}:`, error);
        });
      }

      const processingTime = Date.now() - startTime;
      this.logger.info(
        `Document upload completed in ${processingTime}ms (request: ${requestId}, document: ${document.id})`,
      );

      return this.createSuccessResponse(requestId, document, queueEntry);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Document upload failed (request: ${requestId}):`, error);

      return this.createErrorResponse(requestId, "UPLOAD_FAILED", errorMessage, error);
    }
  }

  /**
   * Validate upload request
   */
  private async validateUploadRequest(request: DocumentUploadRequest): Promise<UploadValidation> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate required fields
    if (
      !request.userId || typeof request.userId !== "string" || request.userId.trim().length === 0
    ) {
      errors.push("user_id is required and must be a non-empty string");
    }

    if (
      !request.transactionId || typeof request.transactionId !== "string" ||
      request.transactionId.trim().length === 0
    ) {
      errors.push("transaction_id is required and must be a non-empty string");
    }

    if (
      !request.fileName || typeof request.fileName !== "string" ||
      request.fileName.trim().length === 0
    ) {
      errors.push("file_name is required and must be a non-empty string");
    }

    // Validate file
    if (!request.file) {
      errors.push("file is required");
    } else {
      // Get file info
      const fileInfo = {
        name: request.fileName,
        size: request.fileSize,
        type: request.mimeType,
        extension: request.fileName.toLowerCase().split(".").pop() || "",
        isSupported: false,
      };

      // Validate file size
      const config = await getConfig();
      if (request.fileSize <= 0) {
        errors.push("file size must be greater than 0");
      } else if (request.fileSize > config.maxFileSize) {
        errors.push(
          `file size ${request.fileSize} bytes exceeds maximum ${config.maxFileSize} bytes`,
        );
      }

      // Validate file type
      const supportedTypes = config.allowedFileTypes;
      if (!supportedTypes.includes(request.mimeType)) {
        errors.push(
          `file type ${request.mimeType} is not supported. Supported types: ${
            supportedTypes.join(", ")
          }`,
        );
      } else {
        fileInfo.isSupported = true;
      }

      // Validate file extension matches MIME type
      const expectedExtensions: Record<string, string[]> = {
        "application/pdf": ["pdf"],
        "image/png": ["png"],
        "image/jpeg": ["jpg", "jpeg"],
      };

      const expectedExts = expectedExtensions[request.mimeType] || [];
      if (expectedExts.length > 0 && !expectedExts.includes(fileInfo.extension)) {
        errors.push(
          `file extension ${fileInfo.extension} does not match MIME type ${request.mimeType}`,
        );
      }

      // Validate transaction ID format (should be alphanumeric with dashes/underscores)
      if (request.transactionId && !/^[A-Za-z0-9\-_]{3,50}$/.test(request.transactionId)) {
        errors.push(
          "transaction_id must be 3-50 characters and contain only letters, numbers, dashes, and underscores",
        );
      }

      // Validate dispute ID format if provided
      if (request.disputeId && !/^[A-Za-z0-9\-_]{3,50}$/.test(request.disputeId)) {
        errors.push(
          "dispute_id must be 3-50 characters and contain only letters, numbers, dashes, and underscores",
        );
      }

      // File size warnings
      if (request.fileSize > 10 * 1024 * 1024) { // 10MB
        warnings.push("Large file detected. Processing may take longer than usual.");
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        fileInfo,
      };
    }

    return {
      isValid: false,
      errors,
      warnings,
    };
  }

  /**
   * Extract file buffer from File/Blob
   */
  private async extractFileBuffer(file: File | Blob): Promise<Uint8Array> {
    const arrayBuffer = await file.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  /**
   * Queue document for processing
   */
  private async queueDocumentProcessing(
    document: Document,
    request: DocumentUploadRequest,
  ): Promise<ProcessingQueueEntry> {
    const priority = request.priority || "normal";
    const now = new Date();

    // Estimate completion time based on queue length and priority
    const estimatedMinutes = this.estimateProcessingTime(priority);
    const estimatedCompletion = new Date(now.getTime() + estimatedMinutes * 60 * 1000);

    const queueEntry: ProcessingQueueEntry = {
      documentId: document.id,
      priority,
      queuedAt: now,
      estimatedCompletionTime: estimatedCompletion,
      retryCount: 0,
      maxRetries: 3,
    };

    // Add to in-memory queue
    this.processingQueue.set(document.id, queueEntry);

    this.logger.info(`Document ${document.id} queued for processing with ${priority} priority`);

    return queueEntry;
  }

  /**
   * Estimate processing time based on priority and queue
   */
  private estimateProcessingTime(priority: "low" | "normal" | "high"): number {
    const baseTime = 5; // 5 minutes base processing time
    const queueLength = this.processingQueue.size;

    // Priority multipliers
    const priorityMultiplier = {
      high: 0.5,
      normal: 1.0,
      low: 1.5,
    };

    return baseTime * priorityMultiplier[priority] + (queueLength * 2); // +2 min per queued doc
  }

  /**
   * Start document processing asynchronously
   */
  private async startDocumentProcessing(documentId: string): Promise<void> {
    try {
      this.logger.info(`Starting async processing for document: ${documentId}`);

      // Update document status to processing
      await DocumentQueries.updateStatus(documentId, "processing", new Date());

      // Remove from queue
      this.processingQueue.delete(documentId);

      // Get document and file data
      const document = await DocumentQueries.getById(documentId);
      if (!document) {
        throw new Error(`Document ${documentId} not found`);
      }

      // Download file from S3 for processing
      const fileInfo = await storageService.getDocumentInfo(document.s3_key);
      if (!fileInfo.exists) {
        throw new Error(`File ${document.s3_key} not found in S3`);
      }

      // This would typically involve downloading the file and processing with OCR
      // For now, we'll simulate the processing
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Simulate 2s processing

      // Update status to completed (in real implementation, this would be done after OCR)
      await DocumentQueries.updateStatus(documentId, "completed", undefined, new Date());

      this.logger.info(`Document processing completed for: ${documentId}`);
    } catch (error) {
      this.logger.error(`Document processing failed for ${documentId}:`, error);

      try {
        await DocumentQueries.updateStatus(documentId, "failed");
      } catch (updateError) {
        this.logger.error(`Failed to update status for ${documentId}:`, updateError);
      }
    }
  }

  /**
   * Log processing stage
   */
  private async logProcessingStage(
    documentId: string,
    stage: ProcessingStage,
    status: "started" | "completed" | "failed",
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      // This would log to processing_logs table in a full implementation
      this.logger.info(`Document ${documentId}: ${stage} - ${status}`, metadata);
    } catch (error) {
      this.logger.warn(`Failed to log processing stage for ${documentId}:`, error);
    }
  }

  /**
   * Create success response
   */
  private createSuccessResponse(
    requestId: string,
    document: Document,
    queueEntry: ProcessingQueueEntry,
  ): DocumentUploadResponse {
    return {
      status: "success",
      data: {
        documentId: document.id,
        fileName: document.file_name,
        fileSize: document.file_size,
        documentType: document.document_type,
        processingStatus: document.processing_status,
        estimatedCompletionTime: queueEntry.estimatedCompletionTime.toISOString(),
        s3Key: document.s3_key,
        uploadedAt: document.upload_timestamp.toISOString(),
        metadata: {
          userId: document.user_id,
          transactionId: document.transaction_id,
          disputeId: document.dispute_id,
        },
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        version: "v1",
      },
    };
  }

  /**
   * Create error response
   */
  private createErrorResponse(
    requestId: string,
    code: string,
    message: string,
    details?: unknown,
  ): DocumentUploadResponse {
    return {
      status: "error",
      error: {
        code,
        message,
        details,
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        version: "v1",
      },
    };
  }

  /**
   * Get processing queue status
   */
  getQueueStatus(): {
    totalQueued: number;
    byPriority: Record<string, number>;
    oldestQueuedAt: string | undefined;
  } {
    const entries = Array.from(this.processingQueue.values());

    const byPriority = {
      high: entries.filter((e) => e.priority === "high").length,
      normal: entries.filter((e) => e.priority === "normal").length,
      low: entries.filter((e) => e.priority === "low").length,
    };

    const oldestEntry = entries.sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime())[0];

    return {
      totalQueued: entries.length,
      byPriority,
      oldestQueuedAt: oldestEntry?.queuedAt.toISOString(),
    };
  }

  /**
   * Get document processing status
   */
  async getDocumentStatus(documentId: string): Promise<
    {
      documentId: string;
      processingStatus: string;
      queuePosition: number | undefined;
      estimatedCompletion: string | undefined;
      processingStages: ProcessingStageResult[];
    } | null
  > {
    try {
      const document = await DocumentQueries.getById(documentId);
      if (!document) {
        return null;
      }

      const queueEntry = this.processingQueue.get(documentId);
      const queuePosition = queueEntry ? this.getQueuePosition(documentId) : undefined;

      // In a full implementation, this would fetch actual processing stages from processing_logs table
      const processingStages: ProcessingStageResult[] = [
        {
          stage: "upload_validation",
          status: "completed",
          startedAt: document.created_at,
          completedAt: document.created_at,
          durationMs: 100,
        },
        {
          stage: "s3_upload",
          status: "completed",
          startedAt: document.upload_timestamp,
          completedAt: document.upload_timestamp,
          durationMs: 500,
        },
        {
          stage: "database_creation",
          status: "completed",
          startedAt: document.created_at,
          completedAt: document.created_at,
          durationMs: 50,
        },
      ];

      return {
        documentId: document.id,
        processingStatus: document.processing_status,
        queuePosition,
        estimatedCompletion: queueEntry?.estimatedCompletionTime.toISOString(),
        processingStages,
      };
    } catch (error) {
      this.logger.error(`Failed to get status for document ${documentId}:`, error);
      throw error;
    }
  }

  /**
   * Get position in processing queue
   */
  private getQueuePosition(documentId: string): number {
    const entries = Array.from(this.processingQueue.entries())
      .sort((a, b) => {
        // Sort by priority (high first), then by queue time
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        const aPriority = priorityOrder[a[1].priority];
        const bPriority = priorityOrder[b[1].priority];

        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }

        return a[1].queuedAt.getTime() - b[1].queuedAt.getTime();
      });

    const position = entries.findIndex(([id]) => id === documentId);
    return position >= 0 ? position + 1 : -1;
  }
}

export const documentUploadService = new DocumentUploadService();
