/**
 * Queue Models and Types
 * Data structures for Redis-based async processing pipeline
 */

/**
 * Queue priority levels
 */
export type QueuePriority = "high" | "medium" | "low";

/**
 * Processing stage types
 */
export type ProcessingStageType =
  | "document_validation"
  | "s3_upload"
  | "ocr_extraction"
  | "data_comparison"
  | "ai_verification";

/**
 * Queue message structure
 */
export interface QueueMessage {
  // Message identification
  id: string;
  documentId: string;

  // Processing information
  stage: ProcessingStageType;
  priority: QueuePriority;

  // Timing information
  enqueuedAt: Date;
  scheduledAt?: Date;
  startedAt?: Date;
  completedAt?: Date;

  // Retry information
  retryCount: number;
  maxRetries: number;
  lastError: string | undefined;

  // Message metadata
  metadata: {
    userId: string;
    transactionId: string;
    disputeId?: string;
    originalFileName: string;
    fileSize: number;
    contentType: string;
  };

  // Processing configuration
  config?: {
    timeout: number;
    language?: string[];
    immediateProcessing?: boolean;
  };
}

/**
 * Queue statistics
 */
export interface QueueStats {
  queueName: string;
  totalMessages: number;
  messagesByPriority: Record<QueuePriority, number>;
  messagesByStage: Record<ProcessingStageType, number>;
  oldestMessage?: Date;
  newestMessage?: Date;
  averageWaitTime: number;
  throughputPerHour: number;
}

/**
 * Worker process information
 */
export interface WorkerInfo {
  workerId: string;
  stage: ProcessingStageType;
  status: "idle" | "processing" | "error" | "stopped" | "starting";
  currentMessage: string | undefined;
  startedAt: Date;
  lastHeartbeat: Date;
  processedCount: number;
  errorCount: number;
  averageProcessingTime: number;
}

/**
 * Dead letter queue entry
 */
export interface DeadLetterEntry {
  originalMessage: QueueMessage;
  failureReason: string;
  failedAt: Date;
  retryAttempts: number;
  lastError: string;
  canRetry: boolean;
}

/**
 * Pipeline configuration
 */
export interface PipelineConfig {
  // Queue settings
  maxQueueSize: number;
  messageRetention: number; // in seconds

  // Worker settings
  maxWorkers: number;
  workerTimeout: number;
  heartbeatInterval: number;

  // Retry settings
  maxRetries: number;
  retryBackoffBase: number;
  retryBackoffMax: number;

  // Performance settings
  batchSize: number;
  prefetchCount: number;

  // Monitoring settings
  metricsInterval: number;
  healthCheckInterval: number;
}

/**
 * Processing result
 */
export interface ProcessingResult {
  success: boolean;
  stage: ProcessingStageType;
  documentId: string;

  // Timing information
  startedAt: Date;
  completedAt: Date;
  durationMs: number;

  // Result data
  data?: unknown;

  // Error information
  error: {
    code: string;
    message: string;
    details: unknown | undefined;
    retryable: boolean;
  } | undefined;

  // Next stage information
  nextStage?: ProcessingStageType;
  requiresManualReview?: boolean;
}

/**
 * Queue operation result
 */
export interface QueueOperationResult {
  success: boolean;
  messageId?: string;
  queuePosition?: number;
  estimatedProcessingTime?: number;
  error?: string;
}
