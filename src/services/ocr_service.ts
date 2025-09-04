/**
 * OCR Service
 * Handles document text extraction using Llama Parse API
 */

import { log } from "@/deps.ts";
import { DEFAULT_OCR_CONFIG, llamaParse } from "@config/llama_parse.ts";
import { ocrFallbackService } from "@services/ocr_fallback_service.ts";
import type { FallbackReason } from "@services/ocr_fallback_service.ts";
import type {
  ConfidenceScore,
  LlamaParseJobStatus,
  LlamaParseResponse,
  OcrConfig,
  OcrRequest,
  OcrResult,
  PaymentDocumentFields,
  SupportedFormat,
} from "@models/ocr.ts";

class OcrService {
  private logger = log.getLogger();

  /**
   * Process document with OCR using Llama Parse API
   */
  async processDocument(request: OcrRequest): Promise<OcrResult> {
    const startTime = Date.now();
    let retryCount = 0;

    try {
      this.logger.info(`Starting OCR processing for document: ${request.documentId}`);

      // Validate request
      this.validateRequest(request);

      // Merge configuration with defaults
      const config: OcrConfig = { ...DEFAULT_OCR_CONFIG, ...request.config };

      // Detect and validate document format
      const format = this.detectFormat(request.fileName, request.mimeType);

      let lastError: Error | null = null;

      // Retry logic
      for (retryCount = 0; retryCount <= config.retryAttempts; retryCount++) {
        try {
          if (retryCount > 0) {
            this.logger.info(`OCR retry attempt ${retryCount} for document: ${request.documentId}`);
            // Exponential backoff: 1s, 2s, 4s...
            await this.sleep(Math.pow(2, retryCount - 1) * 1000);
          }

          // Upload document and start processing
          const jobId = await this.uploadDocument(request, config);

          // Poll for completion
          const response = await this.waitForCompletion(jobId, config.timeout);

          // Process and extract structured data
          const extractedFields = await this.extractPaymentFields(response);

          // Calculate confidence scores
          const confidenceScore = this.calculateConfidence(extractedFields, response);

          const processingTime = Date.now() - startTime;

          this.logger.info(
            `OCR processing completed for document: ${request.documentId} in ${processingTime}ms`,
          );

          return {
            success: true,
            documentId: request.documentId,
            format,
            processingTime,
            retryCount,
            preset: config.preset,
            extractedFields,
            confidenceScore,
            rawMarkdown: response.pages?.map((p) => p.markdown).join("\n") || "",
            rawText: response.pages?.map((p) => p.text).join("\n") || "",
            pageCount: response.pages?.length || 0,
            error: undefined,
          };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("Unknown error");
          this.logger.warn(
            `OCR attempt ${retryCount + 1} failed for document: ${request.documentId}`,
            error,
          );

          // Don't retry on certain errors
          if (this.isNonRetryableError(error)) {
            break;
          }
        }
      }

      // All retries failed - try fallback processing
      this.logger.warn(`OCR processing failed after ${retryCount} attempts, attempting fallback`);

      const fallbackReason = this.determineFallbackReason(lastError);
      return await ocrFallbackService.processFallback(request, lastError!, fallbackReason);
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      this.logger.error(`OCR processing error for document: ${request.documentId}`, error);

      return {
        success: false,
        documentId: request.documentId,
        format: this.detectFormat(request.fileName, request.mimeType),
        processingTime,
        retryCount,
        preset: DEFAULT_OCR_CONFIG.preset,
        extractedFields: this.getEmptyFields(),
        confidenceScore: this.getZeroConfidence(),
        rawMarkdown: "",
        rawText: "",
        pageCount: 0,
        error: {
          code: "OCR_SERVICE_ERROR",
          message: errorMessage,
          details: error,
        },
      };
    }
  }

  /**
   * Upload document to Llama Parse API
   */
  private async uploadDocument(request: OcrRequest, config: OcrConfig): Promise<string> {
    const llamaConfig = llamaParse.getConfig();
    const uploadUrl = llamaParse.getEndpoint("/parsing/upload");

    // Create form data
    const formData = new FormData();

    // Add file
    const blob = new Blob([request.fileBuffer], { type: request.mimeType });
    formData.append("file", blob, request.fileName);

    // Add parsing parameters
    formData.append("parsing_instruction", this.getParsingInstructions(config));
    formData.append("language", config.language.join(","));
    formData.append("preset", config.preset);
    formData.append("num_workers", config.numWorkers.toString());
    formData.append("verbose", config.verbose.toString());

    // Add metadata if available
    if (request.metadata) {
      formData.append("metadata", JSON.stringify(request.metadata));
    }

    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: llamaParse.createFormHeaders(),
      body: formData,
      signal: AbortSignal.timeout(config.timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Llama Parse upload failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const result = await response.json();

    if (!result.id) {
      throw new Error("Invalid response from Llama Parse API: missing job ID");
    }

    this.logger.info(`Document uploaded to Llama Parse, job ID: ${result.id}`);
    return result.id;
  }

  /**
   * Wait for job completion with polling
   */
  private async waitForCompletion(jobId: string, timeout: number): Promise<LlamaParseResponse> {
    const startTime = Date.now();
    const statusUrl = llamaParse.getEndpoint(`/parsing/job/${jobId}`);
    const resultUrl = llamaParse.getEndpoint(`/parsing/job/${jobId}/result/markdown`);
    const pollInterval = 2000; // 2 seconds

    while (Date.now() - startTime < timeout) {
      // Check job status
      const statusResponse = await fetch(statusUrl, {
        method: "GET",
        headers: llamaParse.createHeaders(),
      });

      if (!statusResponse.ok) {
        throw new Error(
          `Failed to check job status: ${statusResponse.status} ${statusResponse.statusText}`,
        );
      }

      const status: LlamaParseJobStatus = await statusResponse.json();

      this.logger.debug(`Job ${jobId} status: ${status.status} (${status.progress || 0}%)`);

      if (status.status === "completed") {
        // Fetch results
        const resultResponse = await fetch(resultUrl, {
          method: "GET",
          headers: llamaParse.createHeaders(),
        });

        if (!resultResponse.ok) {
          throw new Error(
            `Failed to fetch results: ${resultResponse.status} ${resultResponse.statusText}`,
          );
        }

        const pages = await resultResponse.json();

        return {
          jobId,
          status,
          pages,
        };
      }

      if (status.status === "failed" || status.status === "cancelled") {
        throw new Error(`Job ${status.status}: ${status.error || "Unknown error"}`);
      }

      // Wait before next poll
      await this.sleep(pollInterval);
    }

    throw new Error(`OCR processing timeout after ${timeout}ms`);
  }

  /**
   * Extract payment-specific fields from OCR results
   */
  private async extractPaymentFields(response: LlamaParseResponse): Promise<PaymentDocumentFields> {
    const rawText = response.pages?.map((p) => p.text).join("\n") || "";
    const rawMarkdown = response.pages?.map((p) => p.markdown).join("\n") || "";

    // Initialize empty fields
    const fields: PaymentDocumentFields = {
      amounts: [],
      dates: [],
      transactionIds: [],
      parties: [],
      rawText,
      structuredData: {},
    };

    // Extract monetary amounts (with Russian and English currencies)
    const amountPatterns = [
      // English patterns
      /(?:[\$€£¥]|USD|EUR|GBP|RUB)\s*[\d,]+\.?\d*/gi,
      /[\d,]+\.?\d*\s*(?:USD|EUR|GBP|RUB|dollars?|euros?|pounds?|rubles?)/gi,
      // Russian patterns
      /[\d\s,]+\.?\d*\s*(?:руб|рублей?|копеек?)/gi,
      /[\d\s,]+\.?\d*\s*₽/gi,
    ];

    for (const pattern of amountPatterns) {
      const matches = rawText.match(pattern);
      if (matches) {
        for (const match of matches) {
          const amount = this.parseAmount(match);
          if (amount) {
            fields.amounts.push(amount);
          }
        }
      }
    }

    // Extract dates
    const datePatterns = [
      // International formats
      /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/g,
      /\d{2,4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/g,
      // Russian date formats
      /\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{2,4}/gi,
    ];

    for (const pattern of datePatterns) {
      const matches = rawText.match(pattern);
      if (matches) {
        for (const match of matches) {
          const date = this.parseDate(match);
          if (date) {
            fields.dates.push(date);
          }
        }
      }
    }

    // Extract transaction IDs
    const idPatterns = [
      /(?:№|#|ID|REF|TXN)\s*:?\s*([A-Z0-9\-]{6,20})/gi,
      /(?:receipt|чек|квитанция)\s*:?\s*([A-Z0-9\-]{6,20})/gi,
    ];

    for (const pattern of idPatterns) {
      const matches = [...rawText.matchAll(pattern)];
      for (const match of matches) {
        if (match[1]) {
          fields.transactionIds.push({
            value: match[1],
            confidence: 0.8,
            type: "transaction_id",
          });
        }
      }
    }

    // Extract party information (names, addresses)
    const partyPatterns = [
      // Organization names
      /(?:ООО|ИП|ОАО|ЗАО|Company|Corp|Inc|Ltd)\s+[А-ЯЁA-Z][А-ЯЁа-яёA-Za-z\s]{2,50}/g,
    ];

    for (const pattern of partyPatterns) {
      const matches = rawText.match(pattern);
      if (matches) {
        for (const match of matches) {
          fields.parties.push({
            name: match.trim(),
            confidence: 0.7,
            type: "merchant",
          });
        }
      }
    }

    return fields;
  }

  /**
   * Calculate confidence scores for extracted data
   */
  private calculateConfidence(
    fields: PaymentDocumentFields,
    response: LlamaParseResponse,
  ): ConfidenceScore {
    const hasAmounts = fields.amounts.length > 0;
    const hasDates = fields.dates.length > 0;
    const hasTransactionIds = fields.transactionIds.length > 0;
    const hasParties = fields.parties.length > 0;
    const hasText = fields.rawText.length > 50;

    // Text clarity based on text length and structure
    const textClarity = Math.min(1.0, fields.rawText.length / 500) * (hasText ? 1.0 : 0.0);

    // Field completeness based on extracted fields
    const fieldCount = [hasAmounts, hasDates, hasTransactionIds, hasParties].filter(Boolean).length;
    const fieldCompleteness = fieldCount / 4.0;

    // Pattern matching based on successful extractions
    const avgAmountConfidence = fields.amounts.reduce((sum, a) => sum + a.confidence, 0) /
      Math.max(fields.amounts.length, 1);
    const avgDateConfidence = fields.dates.reduce((sum, d) => sum + d.confidence, 0) /
      Math.max(fields.dates.length, 1);
    const patternMatching = (avgAmountConfidence + avgDateConfidence) / 2;

    // Overall confidence
    const overall = (textClarity + fieldCompleteness + patternMatching) / 3;

    return {
      overall: Math.round(overall * 100) / 100,
      textClarity: Math.round(textClarity * 100) / 100,
      fieldCompleteness: Math.round(fieldCompleteness * 100) / 100,
      patternMatching: Math.round(patternMatching * 100) / 100,
    };
  }

  /**
   * Parse monetary amount from text
   */
  private parseAmount(
    text: string,
  ): {
    value: number;
    currency: string;
    confidence: number;
    type: "total" | "subtotal" | "tax" | "discount" | "fee" | "other";
  } | null {
    const cleanText = text.replace(/[,\s]/g, "");

    // Extract currency
    let currency = "USD";
    if (/(?:₽|руб|рублей?)/i.test(text)) currency = "RUB";
    else if (/(?:€|EUR|euros?)/i.test(text)) currency = "EUR";
    else if (/(?:£|GBP|pounds?)/i.test(text)) currency = "GBP";

    // Extract numeric value
    const numMatch = cleanText.match(/[\d]+\.?\d*/);
    if (!numMatch) return null;

    const value = parseFloat(numMatch[0]);
    if (isNaN(value) || value <= 0) return null;

    return {
      value,
      currency,
      confidence: 0.8,
      type: "total",
    };
  }

  /**
   * Parse date from text
   */
  private parseDate(
    text: string,
  ): {
    value: Date;
    confidence: number;
    type: "transaction" | "due" | "issued" | "processed" | "other";
  } | null {
    try {
      // Try different date parsing approaches
      let date: Date | null = null;

      // Standard formats
      if (text.match(/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/)) {
        date = new Date(text);
      }

      // Russian month names
      if (!date || isNaN(date.getTime())) {
        const russianMonths = {
          "января": 0,
          "февраля": 1,
          "марта": 2,
          "апреля": 3,
          "мая": 4,
          "июня": 5,
          "июля": 6,
          "августа": 7,
          "сентября": 8,
          "октября": 9,
          "ноября": 10,
          "декабря": 11,
        };

        for (const [month, index] of Object.entries(russianMonths)) {
          if (text.toLowerCase().includes(month)) {
            const dayMatch = text.match(/(\d{1,2})/);
            const yearMatch = text.match(/(\d{4})/);
            if (dayMatch && dayMatch[1] && yearMatch && yearMatch[1]) {
              date = new Date(parseInt(yearMatch[1]), index, parseInt(dayMatch[1]));
              break;
            }
          }
        }
      }

      if (!date || isNaN(date.getTime())) return null;

      return {
        value: date,
        confidence: 0.8,
        type: "transaction",
      };
    } catch {
      return null;
    }
  }

  /**
   * Get parsing instructions for payment documents
   */
  private getParsingInstructions(config: OcrConfig): string {
    return `Parse this payment document carefully. Extract:
1. Monetary amounts with currencies (USD, EUR, RUB, etc.)
2. Transaction dates and reference numbers
3. Merchant/recipient information
4. Payment details and descriptions

Pay special attention to:
- Russian language content (Cyrillic text)
- Table structures with financial data
- Receipt numbers and transaction IDs
- Currency symbols and amount formatting

Return structured data with confidence scores for each extracted field.`;
  }

  /**
   * Validate OCR request
   */
  private validateRequest(request: OcrRequest): void {
    if (!request.documentId) {
      throw new Error("Document ID is required");
    }

    if (!request.fileBuffer || request.fileBuffer.length === 0) {
      throw new Error("File buffer is required and cannot be empty");
    }

    if (!request.fileName) {
      throw new Error("File name is required");
    }

    if (!request.mimeType) {
      throw new Error("MIME type is required");
    }

    // Check file size
    const config = llamaParse.getConfig();
    if (!llamaParse.isFileSizeValid(request.fileBuffer.length)) {
      throw new Error(
        `File size ${request.fileBuffer.length} bytes exceeds maximum ${config.maxFileSize} bytes`,
      );
    }
  }

  /**
   * Detect document format from filename and MIME type
   */
  private detectFormat(fileName: string, mimeType: string): SupportedFormat {
    const extension = fileName.toLowerCase().split(".").pop();

    if (mimeType === "application/pdf" || extension === "pdf") {
      return "pdf";
    }

    if (mimeType === "image/png" || extension === "png") {
      return "png";
    }

    if (mimeType === "image/jpeg" || ["jpg", "jpeg"].includes(extension || "")) {
      return "jpg";
    }

    // Default fallback
    return "pdf";
  }

  /**
   * Check if error should not be retried
   */
  private isNonRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes("invalid") ||
        message.includes("unauthorized") ||
        message.includes("forbidden") ||
        message.includes("not supported") ||
        message.includes("too large");
    }
    return false;
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get empty payment fields structure
   */
  private getEmptyFields(): PaymentDocumentFields {
    return {
      amounts: [],
      dates: [],
      transactionIds: [],
      parties: [],
      rawText: "",
      structuredData: {},
    };
  }

  /**
   * Get zero confidence scores
   */
  private getZeroConfidence(): ConfidenceScore {
    return {
      overall: 0.0,
      textClarity: 0.0,
      fieldCompleteness: 0.0,
      patternMatching: 0.0,
    };
  }

  /**
   * Determine fallback reason from error
   */
  private determineFallbackReason(error: Error | null): FallbackReason {
    if (!error) return "api_unavailable";

    const message = error.message.toLowerCase();

    if (message.includes("timeout")) {
      return "processing_timeout";
    }

    if (message.includes("too large") || message.includes("exceeds maximum")) {
      return "file_too_large";
    }

    if (
      message.includes("unauthorized") || message.includes("forbidden") ||
      message.includes("invalid") && message.includes("key")
    ) {
      return "authentication_failed";
    }

    if (message.includes("quota") || message.includes("limit")) {
      return "quota_exceeded";
    }

    if (message.includes("not supported") || message.includes("unsupported")) {
      return "unsupported_format";
    }

    return "api_unavailable";
  }
}

export const ocrService = new OcrService();
