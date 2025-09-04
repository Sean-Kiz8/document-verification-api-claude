/**
 * OCR Models and Types
 * Data structures for OCR processing with Llama Parse API
 */

/**
 * Supported document formats for OCR processing
 */
export type SupportedFormat = "pdf" | "png" | "jpg" | "jpeg";

/**
 * OCR processing configuration
 */
export interface OcrConfig {
  language: string[];
  timeout: number;
  retryAttempts: number;
  preset: "cost_effective" | "agentic" | "agentic_plus" | "use_case_oriented";
  numWorkers: number;
  verbose: boolean;
}

/**
 * Confidence score for OCR extracted data (0.0 - 1.0)
 */
export interface ConfidenceScore {
  overall: number;
  textClarity: number;
  fieldCompleteness: number;
  patternMatching: number;
}

/**
 * Extracted payment document fields
 */
export interface PaymentDocumentFields {
  // Monetary information
  amounts: Array<{
    value: number;
    currency: string;
    confidence: number;
    type: "total" | "subtotal" | "tax" | "discount" | "fee" | "other";
  }>;

  // Date information
  dates: Array<{
    value: Date;
    confidence: number;
    type: "transaction" | "due" | "issued" | "processed" | "other";
  }>;

  // Transaction identifiers
  transactionIds: Array<{
    value: string;
    confidence: number;
    type: "receipt_number" | "transaction_id" | "reference" | "invoice_number" | "other";
  }>;

  // Recipient/sender information
  parties: Array<{
    name: string;
    confidence: number;
    type: "recipient" | "sender" | "merchant" | "bank" | "other";
    details?: {
      address?: string;
      phone?: string;
      email?: string;
      account?: string;
    };
  }>;

  // Additional extracted text
  rawText: string;
  structuredData: Record<string, unknown>;
}

/**
 * OCR processing result
 */
export interface OcrResult {
  success: boolean;
  documentId: string;
  format: SupportedFormat;

  // Processing metadata
  processingTime: number;
  retryCount: number;
  preset: string;

  // Extracted data
  extractedFields: PaymentDocumentFields;
  confidenceScore: ConfidenceScore;

  // Raw API response data
  rawMarkdown: string;
  rawText: string;
  pageCount: number;

  // Error information
  error: {
    code: string;
    message: string;
    details?: unknown;
  } | undefined;
}

/**
 * OCR processing request
 */
export interface OcrRequest {
  documentId: string;
  fileBuffer: Uint8Array;
  fileName: string;
  mimeType: string;
  config?: Partial<OcrConfig>;
  metadata?: {
    userId: string;
    transactionId?: string;
    disputeId?: string;
  };
}

/**
 * Llama Parse API job status
 */
export interface LlamaParseJobStatus {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  progress?: number;
  createdAt: Date;
  updatedAt: Date;
  error?: string;
}

/**
 * Llama Parse API response
 */
export interface LlamaParseResponse {
  jobId: string;
  status: LlamaParseJobStatus;
  pages?: Array<{
    number: number;
    markdown: string;
    text: string;
    images?: Array<{
      url: string;
      caption?: string;
    }>;
  }>;
}
