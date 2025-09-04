/**
 * Document Status Models and Types
 * Enhanced data structures for document processing status tracking
 */

/**
 * Processing stage with detailed information
 */
export interface DetailedProcessingStage {
  stage: string;
  status: "pending" | "started" | "completed" | "failed" | "skipped";
  startedAt: Date | undefined;
  completedAt: Date | undefined;
  durationMs: number | undefined;
  progressPercentage: number | undefined;
  message: string | undefined;
  errorDetails: unknown | undefined;
  metadata: Record<string, unknown> | undefined;
}

/**
 * Comprehensive document status response
 */
export interface DocumentStatusResponse {
  documentId: string;
  fileName: string;
  fileSize: number;
  documentType: string;
  uploadedAt: string;

  // Current processing information
  processingStatus: "queued" | "processing" | "completed" | "failed" | "cancelled";
  currentStage: string | undefined;
  progressPercentage: number;

  // Queue information
  queuePosition: number | undefined;
  estimatedCompletion: string | undefined;

  // Processing stages
  stagesCompleted: string[];
  allStages: DetailedProcessingStage[];

  // Processing logs summary
  logsSummary: {
    totalLogs: number;
    errorCount: number;
    warningCount: number;
    lastLogAt: string | undefined;
  };

  // Timing information
  processingStartedAt: string | undefined;
  processingCompletedAt: string | undefined;
  totalProcessingTime: number | undefined;

  // Results (if available)
  hasResults: boolean;
  resultsSummary: {
    ocrCompleted: boolean;
    comparisonCompleted: boolean;
    authenticityVerified: boolean;
    confidenceScore: number | undefined;
  } | undefined;

  // Metadata
  metadata: {
    userId: string;
    transactionId: string;
    disputeId: string | undefined;
    priority: string | undefined;
    retryCount: number;
  };
}

/**
 * Status cache entry
 */
export interface StatusCacheEntry {
  documentId: string;
  status: DocumentStatusResponse;
  cachedAt: Date;
  expiresAt: Date;
  cacheHits: number;
}

/**
 * Processing stage template
 */
export interface StageTemplate {
  name: string;
  displayName: string;
  order: number;
  estimatedDuration: number; // in milliseconds
  description: string;
  dependencies: string[];
}

/**
 * Status query options
 */
export interface StatusQueryOptions {
  includeProcessingLogs?: boolean;
  includeStageTiming?: boolean;
  includeMetadata?: boolean;
  useCache?: boolean;
  maxCacheAge?: number; // in seconds
}

/**
 * Progress calculation weights
 */
export interface ProgressWeights {
  uploadValidation: number;
  s3Upload: number;
  databaseCreation: number;
  ocrProcessing: number;
  dataComparison: number;
  aiVerification: number;
  completion: number;
}
