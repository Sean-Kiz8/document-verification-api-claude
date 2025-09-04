/**
 * Document Results Models and Types
 * Data structures for document processing results API endpoint
 */

/**
 * Field comparison result
 */
export interface FieldComparison {
  field: string;
  extractedValue: unknown;
  databaseValue: unknown;
  matchScore: number; // 0.0 - 1.0
  status: "exact_match" | "partial_match" | "no_match" | "missing_data";
  confidence: number;
  discrepancy?: {
    type: "value_mismatch" | "format_difference" | "missing_field" | "extra_field";
    severity: "low" | "medium" | "high";
    description: string;
  };
}

/**
 * Processing discrepancy
 */
export interface ProcessingDiscrepancy {
  id: string;
  type: "amount_mismatch" | "date_inconsistency" | "recipient_mismatch" | "id_conflict" | "other";
  severity: "low" | "medium" | "high";
  field: string;
  description: string;
  extractedValue: unknown;
  expectedValue: unknown;
  confidence: number;
  impact: "minor" | "moderate" | "critical";
}

/**
 * Document authenticity analysis
 */
export interface AuthenticityAnalysis {
  score: number; // 0.0 - 1.0
  confidence: number;
  reasoning: string;
  flags: Array<{
    type:
      | "suspicious_pattern"
      | "inconsistent_data"
      | "low_quality_image"
      | "missing_fields"
      | "other";
    severity: "low" | "medium" | "high";
    description: string;
    confidence: number;
  }>;
  recommendations: string[];
}

/**
 * Comprehensive document results response
 */
export interface DocumentResults {
  // Document information
  documentId: string;
  fileName: string;
  fileSize: number;
  documentType: string;
  uploadedAt: string;

  // Processing status
  processingStatus: "completed" | "failed" | "partial";
  processedAt: string;
  totalProcessingTime: number; // in milliseconds

  // OCR extraction results
  ocrResults: {
    success: boolean;
    confidence: number;
    extractedData: {
      amounts: Array<{
        value: number;
        currency: string;
        confidence: number;
        type: string;
        position?: { x: number; y: number; width: number; height: number };
      }>;
      dates: Array<{
        value: string;
        confidence: number;
        type: string;
        format: string;
      }>;
      transactionIds: Array<{
        value: string;
        confidence: number;
        type: string;
      }>;
      parties: Array<{
        name: string;
        type: string;
        confidence: number;
        details: Record<string, unknown>;
      }>;
      rawText: string;
      structuredData: Record<string, unknown>;
    };
    processingTime: number;
    fallbackUsed: boolean;
  };

  // Database comparison results
  comparisonResults: {
    success: boolean;
    overallMatch: number; // 0.0 - 1.0
    fieldComparisons: FieldComparison[];
    discrepancies: ProcessingDiscrepancy[];
    transactionFound: boolean;
    processingTime: number;
  };

  // AI authenticity verification
  authenticityResults: {
    success: boolean;
    analysis: AuthenticityAnalysis;
    processingTime: number;
  };

  // Processing logs summary
  processingLogs: {
    totalLogs: number;
    errorCount: number;
    warningCount: number;
    stages: Array<{
      stage: string;
      status: string;
      duration: number;
      logCount: number;
    }>;
  };

  // Document access
  documentAccess: {
    originalDocument: {
      downloadUrl: string;
      expiresAt: string;
    };
    processedData?: {
      markdownUrl?: string;
      jsonUrl?: string;
      expiresAt: string;
    };
  };

  // Final assessment
  finalAssessment: {
    overallScore: number; // 0.0 - 1.0
    recommendation: "approve" | "review" | "reject";
    riskLevel: "low" | "medium" | "high" | "critical";
    summary: string;
    requiresManualReview: boolean;
  };

  // Metadata
  metadata: {
    userId: string;
    transactionId: string;
    disputeId: string | undefined;
    apiVersion: string;
    resultFormat: string;
    generatedAt: string;
  };
}

/**
 * Results cache entry
 */
export interface ResultsCacheEntry {
  documentId: string;
  results: DocumentResults;
  cachedAt: Date;
  expiresAt: Date;
  cacheHits: number;
  compressed: boolean;
}

/**
 * Results query options
 */
export interface ResultsQueryOptions {
  includeProcessingLogs?: boolean;
  includeRawText?: boolean;
  includeDiscrepancyDetails?: boolean;
  includeDocumentAccess?: boolean;
  compressionLevel?: "none" | "basic" | "maximum";
  useCache?: boolean;
  maxCacheAge?: number; // in seconds
}

/**
 * Processing summary for quick overview
 */
export interface ProcessingSummary {
  documentId: string;
  status: "completed" | "failed" | "partial";
  overallScore: number;
  recommendation: "approve" | "review" | "reject";
  riskLevel: "low" | "medium" | "high" | "critical";
  processedAt: string;
  processingTime: number;
  flagsCount: number;
  discrepanciesCount: number;
}
