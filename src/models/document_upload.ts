/**
 * Document Upload Models and Types
 * Data structures for document upload API endpoint
 */

/**
 * Document upload request validation
 */
export interface DocumentUploadRequest {
  // File data
  file: File | Blob;
  fileName: string;
  mimeType: string;
  fileSize: number;

  // Required metadata
  userId: string;
  transactionId: string;

  // Optional metadata
  disputeId: string | undefined;
  documentType?: "payment_receipt" | "bank_statement" | "invoice" | "other";

  // Processing options
  immediateProcessing?: boolean;
  priority?: "low" | "normal" | "high";
  language: string[] | undefined;
}

/**
 * Document upload response
 */
export interface DocumentUploadResponse {
  status: "success" | "error";
  data?: {
    documentId: string;
    fileName: string;
    fileSize: number;
    documentType: string;
    processingStatus: string;
    estimatedCompletionTime: string;
    s3Key: string;
    uploadedAt: string;
    metadata: {
      userId: string;
      transactionId: string;
      disputeId: string | undefined;
    };
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta: {
    requestId: string;
    timestamp: string;
    version: string;
  };
}

/**
 * Upload validation result
 */
export interface UploadValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  fileInfo?: {
    name: string;
    size: number;
    type: string;
    extension: string;
    isSupported: boolean;
  };
}

/**
 * Processing queue entry
 */
export interface ProcessingQueueEntry {
  documentId: string;
  priority: "low" | "normal" | "high";
  queuedAt: Date;
  estimatedCompletionTime: Date;
  retryCount: number;
  maxRetries: number;
}

/**
 * Document processing stages
 */
export type ProcessingStage =
  | "upload_validation"
  | "s3_upload"
  | "database_creation"
  | "ocr_queued"
  | "ocr_processing"
  | "ocr_completed"
  | "comparison_processing"
  | "ai_verification"
  | "completed"
  | "failed";

/**
 * Processing stage result
 */
export interface ProcessingStageResult {
  stage: ProcessingStage;
  status: "started" | "completed" | "failed";
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}
