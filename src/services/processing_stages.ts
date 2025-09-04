/**
 * Processing Stages
 * Defines and implements the five processing stages for async pipeline
 */

import { log } from "@/deps.ts";
import { DocumentQueries, ProcessingLogQueries } from "@database/queries.ts";
import { storageService } from "@services/storage_service.ts";
import { ocrService } from "@services/ocr_service.ts";
import type { ProcessingResult, ProcessingStageType, QueueMessage } from "@models/queue.ts";
import type { Document } from "@database/queries.ts";

/**
 * Abstract base class for processing stages
 */
export abstract class ProcessingStage {
  protected logger = log.getLogger();
  protected stageName: ProcessingStageType;
  protected timeout: number;

  constructor(stageName: ProcessingStageType, timeout: number = 300000) { // 5 minutes default
    this.stageName = stageName;
    this.timeout = timeout;
  }

  /**
   * Execute the processing stage
   */
  abstract execute(message: QueueMessage): Promise<ProcessingResult>;

  /**
   * Validate input message
   */
  protected async validateMessage(message: QueueMessage): Promise<void> {
    if (!message.documentId) {
      throw new Error("Document ID is required");
    }

    if (message.stage !== this.stageName) {
      throw new Error(`Invalid stage: expected ${this.stageName}, got ${message.stage}`);
    }

    // Check if document exists
    const document = await DocumentQueries.getById(message.documentId);
    if (!document) {
      throw new Error(`Document ${message.documentId} not found`);
    }
  }

  /**
   * Create processing result
   */
  protected createResult(
    message: QueueMessage,
    success: boolean,
    startTime: Date,
    data?: unknown,
    error?: { code: string; message: string; details?: unknown; retryable?: boolean },
  ): ProcessingResult {
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startTime.getTime();

    return {
      success,
      stage: this.stageName,
      documentId: message.documentId,
      startedAt: startTime,
      completedAt,
      durationMs,
      data,
      error,
      nextStage: success ? this.getNextStage() : undefined,
      requiresManualReview: this.requiresManualReview(success, error),
    };
  }

  /**
   * Get next stage in pipeline
   */
  protected getNextStage(): ProcessingStageType | undefined {
    const stageOrder: ProcessingStageType[] = [
      "document_validation",
      "s3_upload",
      "ocr_extraction",
      "data_comparison",
      "ai_verification",
    ];

    const currentIndex = stageOrder.indexOf(this.stageName);
    return currentIndex >= 0 && currentIndex < stageOrder.length - 1
      ? stageOrder[currentIndex + 1]
      : undefined;
  }

  /**
   * Check if processing requires manual review
   */
  protected requiresManualReview(
    success: boolean,
    error?: { code: string; message: string; details?: unknown; retryable?: boolean },
  ): boolean {
    if (!success && error && !error.retryable) {
      return true;
    }
    return false;
  }
}

/**
 * Document Validation Stage
 */
export class DocumentValidationStage extends ProcessingStage {
  constructor() {
    super("document_validation", 10000); // 10 seconds
  }

  async execute(message: QueueMessage): Promise<ProcessingResult> {
    const startTime = new Date();

    try {
      await this.validateMessage(message);

      this.logger.info(`Starting document validation for: ${message.documentId}`);

      const document = await DocumentQueries.getById(message.documentId);
      if (!document) {
        throw new Error("Document not found");
      }

      // Validate file exists in S3
      const fileExists = await storageService.getDocumentInfo(document.s3_key);
      if (!fileExists.exists) {
        throw new Error("Document file not found in storage");
      }

      // Validate file size and type
      if (fileExists.size && fileExists.size > 50 * 1024 * 1024) { // 50MB
        throw new Error("File too large for processing");
      }

      if (
        !fileExists.contentType ||
        !["image/png", "image/jpeg", "application/pdf"].includes(fileExists.contentType)
      ) {
        throw new Error(`Unsupported file type: ${fileExists.contentType}`);
      }

      // Update document status
      await DocumentQueries.updateStatus(message.documentId, "processing", new Date());

      this.logger.info(`Document validation completed for: ${message.documentId}`);

      return this.createResult(message, true, startTime, {
        validatedFile: {
          size: fileExists.size,
          contentType: fileExists.contentType,
        },
      });
    } catch (error) {
      this.logger.error(`Document validation failed for: ${message.documentId}`, error);

      return this.createResult(message, false, startTime, undefined, {
        code: "VALIDATION_FAILED",
        message: error instanceof Error ? error.message : "Unknown validation error",
        details: error,
        retryable: false,
      });
    }
  }
}

/**
 * S3 Upload Stage (already handled in upload endpoint, but included for completeness)
 */
export class S3UploadStage extends ProcessingStage {
  constructor() {
    super("s3_upload", 30000); // 30 seconds
  }

  async execute(message: QueueMessage): Promise<ProcessingResult> {
    const startTime = new Date();

    try {
      await this.validateMessage(message);

      this.logger.info(`S3 upload stage for: ${message.documentId}`);

      // This stage is typically already completed during upload
      // But we can verify the file is accessible
      const document = await DocumentQueries.getById(message.documentId);
      if (!document) {
        throw new Error("Document not found");
      }

      const fileInfo = await storageService.getDocumentInfo(document.s3_key);
      if (!fileInfo.exists) {
        throw new Error("File not found in S3");
      }

      this.logger.info(`S3 upload verification completed for: ${message.documentId}`);

      return this.createResult(message, true, startTime, {
        s3Key: document.s3_key,
        fileSize: fileInfo.size,
      });
    } catch (error) {
      this.logger.error(`S3 upload stage failed for: ${message.documentId}`, error);

      return this.createResult(message, false, startTime, undefined, {
        code: "S3_UPLOAD_FAILED",
        message: error instanceof Error ? error.message : "S3 upload error",
        details: error,
        retryable: true,
      });
    }
  }
}

/**
 * OCR Extraction Stage
 */
export class OcrExtractionStage extends ProcessingStage {
  constructor() {
    super("ocr_extraction", 60000); // 60 seconds
  }

  async execute(message: QueueMessage): Promise<ProcessingResult> {
    const startTime = new Date();

    try {
      await this.validateMessage(message);

      this.logger.info(`Starting OCR extraction for: ${message.documentId}`);

      const document = await DocumentQueries.getById(message.documentId);
      if (!document) {
        throw new Error("Document not found");
      }

      // Download file from S3
      const fileInfo = await storageService.getDocumentInfo(document.s3_key);
      if (!fileInfo.exists) {
        throw new Error("File not found in S3");
      }

      // This is a simplified version - in real implementation,
      // we would download the file and process it with OCR
      const ocrRequest = {
        documentId: message.documentId,
        fileBuffer: new Uint8Array(1024), // Would be actual file data
        fileName: document.file_name,
        mimeType: document.mime_type,
        config: {
          language: message.config?.language || ["en", "ru"],
          timeout: this.timeout,
          retryAttempts: 2,
          preset: "agentic" as const,
          numWorkers: 4,
          verbose: true,
        },
        metadata: {
          userId: document.user_id,
          transactionId: document.transaction_id,
          disputeId: document.dispute_id,
        },
      };

      // For now, simulate OCR processing
      // In real implementation: const ocrResult = await ocrService.processDocument(ocrRequest);
      const simulatedOcrResult = {
        success: true,
        extractedFields: {
          amounts: [{ value: 1000, currency: "USD", confidence: 0.9, type: "total" as const }],
          dates: [{ value: new Date(), confidence: 0.8, type: "transaction" as const }],
          transactionIds: [{
            value: message.metadata.transactionId,
            confidence: 0.9,
            type: "transaction_id" as const,
          }],
          parties: [],
          rawText: "Sample extracted text",
          structuredData: {},
        },
        confidenceScore: {
          overall: 0.85,
          textClarity: 0.9,
          fieldCompleteness: 0.8,
          patternMatching: 0.85,
        },
      };

      // Store OCR results in database
      await DocumentQueries.updateExtractedData(message.documentId, simulatedOcrResult);

      this.logger.info(`OCR extraction completed for: ${message.documentId}`);

      return this.createResult(message, true, startTime, simulatedOcrResult);
    } catch (error) {
      this.logger.error(`OCR extraction failed for: ${message.documentId}`, error);

      return this.createResult(message, false, startTime, undefined, {
        code: "OCR_EXTRACTION_FAILED",
        message: error instanceof Error ? error.message : "OCR extraction error",
        details: error,
        retryable: true,
      });
    }
  }
}

/**
 * Data Comparison Stage
 */
export class DataComparisonStage extends ProcessingStage {
  constructor() {
    super("data_comparison", 30000); // 30 seconds
  }

  async execute(message: QueueMessage): Promise<ProcessingResult> {
    const startTime = new Date();

    try {
      await this.validateMessage(message);

      this.logger.info(`Starting data comparison for: ${message.documentId}`);

      const document = await DocumentQueries.getById(message.documentId);
      if (!document) {
        throw new Error("Document not found");
      }

      if (!document.extracted_data) {
        throw new Error("No extracted data available for comparison");
      }

      // Simulate data comparison with database records
      // In real implementation, this would compare with transaction database
      const comparisonResult = {
        matches: {
          transactionId: 0.95,
          amount: 0.9,
          date: 0.8,
          recipient: 0.75,
        },
        overallMatch: 0.85,
        discrepancies: [],
        confidence: 0.85,
      };

      // Store comparison results
      await DocumentQueries.updateComparisonResults(message.documentId, comparisonResult);

      this.logger.info(`Data comparison completed for: ${message.documentId}`);

      return this.createResult(message, true, startTime, comparisonResult);
    } catch (error) {
      this.logger.error(`Data comparison failed for: ${message.documentId}`, error);

      return this.createResult(message, false, startTime, undefined, {
        code: "DATA_COMPARISON_FAILED",
        message: error instanceof Error ? error.message : "Data comparison error",
        details: error,
        retryable: true,
      });
    }
  }
}

/**
 * AI Verification Stage
 */
export class AiVerificationStage extends ProcessingStage {
  constructor() {
    super("ai_verification", 45000); // 45 seconds
  }

  async execute(message: QueueMessage): Promise<ProcessingResult> {
    const startTime = new Date();

    try {
      await this.validateMessage(message);

      this.logger.info(`Starting AI verification for: ${message.documentId}`);

      const document = await DocumentQueries.getById(message.documentId);
      if (!document) {
        throw new Error("Document not found");
      }

      if (!document.extracted_data || !document.comparison_results) {
        throw new Error("Missing data for AI verification");
      }

      // Simulate AI verification
      // In real implementation, this would call OpenAI API
      const verificationResult = {
        authenticityScore: 0.92,
        confidence: 0.88,
        flags: [],
        reasoning: "Document appears authentic based on text patterns and data consistency",
      };

      // Store AI verification results
      await DocumentQueries.updateAuthenticity(
        message.documentId,
        verificationResult.authenticityScore,
        verificationResult,
      );

      // Mark document as completed
      await DocumentQueries.updateStatus(message.documentId, "completed", undefined, new Date());

      this.logger.info(`AI verification completed for: ${message.documentId}`);

      return this.createResult(message, true, startTime, verificationResult);
    } catch (error) {
      this.logger.error(`AI verification failed for: ${message.documentId}`, error);

      return this.createResult(message, false, startTime, undefined, {
        code: "AI_VERIFICATION_FAILED",
        message: error instanceof Error ? error.message : "AI verification error",
        details: error,
        retryable: true,
      });
    }
  }
}

/**
 * Stage factory
 */
export class StageFactory {
  private static stages: Map<ProcessingStageType, ProcessingStage> = new Map([
    ["document_validation", new DocumentValidationStage()],
    ["s3_upload", new S3UploadStage()],
    ["ocr_extraction", new OcrExtractionStage()],
    ["data_comparison", new DataComparisonStage()],
    ["ai_verification", new AiVerificationStage()],
  ]);

  /**
   * Get stage instance by type
   */
  static getStage(stageType: ProcessingStageType): ProcessingStage {
    const stage = this.stages.get(stageType);
    if (!stage) {
      throw new Error(`Unknown stage type: ${stageType}`);
    }
    return stage;
  }

  /**
   * Get all available stages
   */
  static getAllStages(): ProcessingStageType[] {
    return Array.from(this.stages.keys());
  }

  /**
   * Check if stage exists
   */
  static hasStage(stageType: string): stageType is ProcessingStageType {
    return this.stages.has(stageType as ProcessingStageType);
  }
}

// Export stage classes (already exported above)
