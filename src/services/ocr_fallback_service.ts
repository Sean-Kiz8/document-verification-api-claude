/**
 * OCR Fallback Service
 * Provides fallback mechanisms for unsupported formats and processing failures
 */

import { log } from "@/deps.ts";
import type {
  ConfidenceScore,
  OcrRequest,
  OcrResult,
  PaymentDocumentFields,
  SupportedFormat,
} from "@models/ocr.ts";
import { DEFAULT_OCR_CONFIG } from "@config/llama_parse.ts";

export type FallbackReason =
  | "unsupported_format"
  | "file_too_large"
  | "api_unavailable"
  | "processing_timeout"
  | "authentication_failed"
  | "quota_exceeded";

export interface FallbackResult {
  success: boolean;
  reason: FallbackReason;
  message: string;
  extractedFields: PaymentDocumentFields;
  confidenceScore: ConfidenceScore;
}

class OcrFallbackService {
  private logger = log.getLogger();

  /**
   * Handle fallback processing for failed OCR requests
   */
  async processFallback(
    request: OcrRequest,
    originalError: Error,
    reason: FallbackReason,
  ): Promise<OcrResult> {
    const startTime = Date.now();

    this.logger.warn(
      `Initiating OCR fallback for document: ${request.documentId}, reason: ${reason}`,
    );

    try {
      // Determine best fallback strategy
      const strategy = this.selectFallbackStrategy(reason, request);

      // Execute fallback strategy
      const fallbackResult = await this.executeFallbackStrategy(strategy, request);

      const processingTime = Date.now() - startTime;

      this.logger.info(
        `OCR fallback completed for document: ${request.documentId} using ${strategy} strategy`,
      );

      return {
        success: fallbackResult.success,
        documentId: request.documentId,
        format: this.detectFormat(request.fileName, request.mimeType),
        processingTime,
        retryCount: 0,
        preset: "fallback",
        extractedFields: fallbackResult.extractedFields,
        confidenceScore: fallbackResult.confidenceScore,
        rawMarkdown: fallbackResult.success
          ? `# Fallback Processing Result\n\nDocument processed using ${strategy} fallback strategy.\n\n${
            this.formatExtractedData(fallbackResult.extractedFields)
          }`
          : "",
        rawText: fallbackResult.extractedFields.rawText,
        pageCount: 1,
        error: fallbackResult.success ? undefined : {
          code: "FALLBACK_PROCESSING_FAILED",
          message: fallbackResult.message,
          details: { reason, originalError: originalError.message },
        },
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      this.logger.error(`OCR fallback failed for document: ${request.documentId}`, error);

      return {
        success: false,
        documentId: request.documentId,
        format: this.detectFormat(request.fileName, request.mimeType),
        processingTime,
        retryCount: 0,
        preset: "fallback",
        extractedFields: this.getEmptyFields(),
        confidenceScore: this.getZeroConfidence(),
        rawMarkdown: "",
        rawText: "",
        pageCount: 0,
        error: {
          code: "FALLBACK_SERVICE_ERROR",
          message: `Fallback processing failed: ${errorMessage}`,
          details: { reason, originalError: originalError.message },
        },
      };
    }
  }

  /**
   * Select appropriate fallback strategy based on failure reason
   */
  private selectFallbackStrategy(reason: FallbackReason, request: OcrRequest): string {
    switch (reason) {
      case "unsupported_format":
        return this.canConvertFormat(request) ? "format_conversion" : "manual_extraction";

      case "file_too_large":
        return this.canCompressFile(request) ? "file_compression" : "chunked_processing";

      case "api_unavailable":
      case "authentication_failed":
      case "quota_exceeded":
        return "offline_processing";

      case "processing_timeout":
        return "simplified_extraction";

      default:
        return "basic_text_extraction";
    }
  }

  /**
   * Execute selected fallback strategy
   */
  private async executeFallbackStrategy(
    strategy: string,
    request: OcrRequest,
  ): Promise<FallbackResult> {
    switch (strategy) {
      case "format_conversion":
        return await this.formatConversionFallback(request);

      case "file_compression":
        return await this.fileCompressionFallback(request);

      case "chunked_processing":
        return await this.chunkedProcessingFallback(request);

      case "offline_processing":
        return await this.offlineProcessingFallback(request);

      case "simplified_extraction":
        return await this.simplifiedExtractionFallback(request);

      case "manual_extraction":
        return await this.manualExtractionFallback(request);

      default:
        return await this.basicTextExtractionFallback(request);
    }
  }

  /**
   * Format conversion fallback (convert to supported format)
   */
  private async formatConversionFallback(request: OcrRequest): Promise<FallbackResult> {
    this.logger.info(`Attempting format conversion for document: ${request.documentId}`);

    try {
      // For now, return a graceful failure with user guidance
      // In a full implementation, this would convert formats (e.g., WEBP to PNG)

      return {
        success: false,
        reason: "unsupported_format",
        message:
          "Document format is not supported. Please convert to PDF, PNG, or JPEG format and try again.",
        extractedFields: this.getEmptyFields(),
        confidenceScore: this.getZeroConfidence(),
      };
    } catch (error) {
      return this.createFailedResult("unsupported_format", `Format conversion failed: ${error}`);
    }
  }

  /**
   * File compression fallback (reduce file size)
   */
  private async fileCompressionFallback(request: OcrRequest): Promise<FallbackResult> {
    this.logger.info(`Attempting file compression for document: ${request.documentId}`);

    try {
      // For now, return a graceful failure with user guidance
      // In a full implementation, this would compress images/PDFs

      return {
        success: false,
        reason: "file_too_large",
        message:
          "File is too large for processing. Please reduce file size to under 50MB and try again.",
        extractedFields: this.getEmptyFields(),
        confidenceScore: this.getZeroConfidence(),
      };
    } catch (error) {
      return this.createFailedResult("file_too_large", `File compression failed: ${error}`);
    }
  }

  /**
   * Chunked processing fallback (split large files)
   */
  private async chunkedProcessingFallback(request: OcrRequest): Promise<FallbackResult> {
    this.logger.info(`Attempting chunked processing for document: ${request.documentId}`);

    try {
      // For now, return a graceful failure with user guidance
      // In a full implementation, this would split files into smaller chunks

      return {
        success: false,
        reason: "file_too_large",
        message:
          "File is too large for single processing. Please split the document into smaller files.",
        extractedFields: this.getEmptyFields(),
        confidenceScore: this.getZeroConfidence(),
      };
    } catch (error) {
      return this.createFailedResult("file_too_large", `Chunked processing failed: ${error}`);
    }
  }

  /**
   * Offline processing fallback (basic text extraction without API)
   */
  private async offlineProcessingFallback(request: OcrRequest): Promise<FallbackResult> {
    this.logger.info(`Attempting offline processing for document: ${request.documentId}`);

    try {
      // Basic filename and metadata analysis
      const extractedFields = this.extractFromFilename(request.fileName);
      const confidenceScore = this.calculateBasicConfidence(extractedFields);

      return {
        success: true,
        reason: "api_unavailable",
        message: "OCR API unavailable. Basic information extracted from filename and metadata.",
        extractedFields,
        confidenceScore,
      };
    } catch (error) {
      return this.createFailedResult("api_unavailable", `Offline processing failed: ${error}`);
    }
  }

  /**
   * Simplified extraction fallback (quick basic extraction)
   */
  private async simplifiedExtractionFallback(request: OcrRequest): Promise<FallbackResult> {
    this.logger.info(`Attempting simplified extraction for document: ${request.documentId}`);

    try {
      // Extract basic info from filename and metadata
      const extractedFields = this.extractFromFilename(request.fileName);
      const confidenceScore = this.calculateBasicConfidence(extractedFields);

      return {
        success: true,
        reason: "processing_timeout",
        message: "Processing timeout occurred. Basic information extracted.",
        extractedFields,
        confidenceScore,
      };
    } catch (error) {
      return this.createFailedResult(
        "processing_timeout",
        `Simplified extraction failed: ${error}`,
      );
    }
  }

  /**
   * Manual extraction guidance fallback
   */
  private async manualExtractionFallback(request: OcrRequest): Promise<FallbackResult> {
    this.logger.info(`Providing manual extraction guidance for document: ${request.documentId}`);

    return {
      success: false,
      reason: "unsupported_format",
      message:
        "Automatic processing not available for this format. Please manually enter the document information or convert to a supported format (PDF, PNG, JPEG).",
      extractedFields: this.getEmptyFields(),
      confidenceScore: this.getZeroConfidence(),
    };
  }

  /**
   * Basic text extraction fallback
   */
  private async basicTextExtractionFallback(request: OcrRequest): Promise<FallbackResult> {
    this.logger.info(`Attempting basic text extraction for document: ${request.documentId}`);

    try {
      const extractedFields = this.extractFromFilename(request.fileName);
      const confidenceScore = this.calculateBasicConfidence(extractedFields);

      return {
        success: true,
        reason: "unsupported_format",
        message: "Basic text extraction completed. Limited information available.",
        extractedFields,
        confidenceScore,
      };
    } catch (error) {
      return this.createFailedResult("unsupported_format", `Basic extraction failed: ${error}`);
    }
  }

  /**
   * Extract basic information from filename
   */
  private extractFromFilename(fileName: string): PaymentDocumentFields {
    const fields: PaymentDocumentFields = {
      amounts: [],
      dates: [],
      transactionIds: [],
      parties: [],
      rawText: `Filename: ${fileName}`,
      structuredData: { filename: fileName },
    };

    // Extract date from filename
    const dateMatch = fileName.match(
      /(\d{4})-?(\d{2})-?(\d{2})|(\d{2})[\.\/\-](\d{2})[\.\/\-](\d{2,4})/,
    );
    if (dateMatch) {
      try {
        let date: Date | null = null;
        if (dateMatch[1] && dateMatch[2] && dateMatch[3]) {
          // YYYY-MM-DD format
          date = new Date(
            parseInt(dateMatch[1]),
            parseInt(dateMatch[2]) - 1,
            parseInt(dateMatch[3]),
          );
        } else if (dateMatch[4] && dateMatch[5] && dateMatch[6]) {
          // DD/MM/YY format
          const year = parseInt(dateMatch[6]) < 50
            ? 2000 + parseInt(dateMatch[6])
            : 1900 + parseInt(dateMatch[6]);
          date = new Date(year, parseInt(dateMatch[5]) - 1, parseInt(dateMatch[4]));
        }

        if (date && !isNaN(date.getTime())) {
          fields.dates.push({
            value: date,
            confidence: 0.3,
            type: "other",
          });
        }
      } catch {
        // Ignore date parsing errors
      }
    }

    // Extract potential amounts from filename
    const amountMatch = fileName.match(/(\d+[\.,]?\d*)/g);
    if (amountMatch) {
      for (const match of amountMatch) {
        const value = parseFloat(match.replace(",", "."));
        if (!isNaN(value) && value > 0 && value < 1000000) {
          fields.amounts.push({
            value,
            currency: "USD",
            confidence: 0.2,
            type: "other",
          });
        }
      }
    }

    return fields;
  }

  /**
   * Calculate basic confidence score
   */
  private calculateBasicConfidence(fields: PaymentDocumentFields): ConfidenceScore {
    const hasAmounts = fields.amounts.length > 0;
    const hasDates = fields.dates.length > 0;
    const hasText = fields.rawText.length > 10;

    const textClarity = hasText ? 0.3 : 0.0;
    const fieldCompleteness = (hasAmounts ? 0.2 : 0.0) + (hasDates ? 0.2 : 0.0);
    const patternMatching = 0.2; // Basic pattern matching from filename
    const overall = (textClarity + fieldCompleteness + patternMatching) / 3;

    return {
      overall: Math.round(overall * 100) / 100,
      textClarity: Math.round(textClarity * 100) / 100,
      fieldCompleteness: Math.round(fieldCompleteness * 100) / 100,
      patternMatching: Math.round(patternMatching * 100) / 100,
    };
  }

  /**
   * Check if format can be converted
   */
  private canConvertFormat(request: OcrRequest): boolean {
    // Check if we can convert this format to a supported one
    const unsupportedFormats = ["bmp", "tiff", "webp", "svg"];
    const extension = request.fileName.toLowerCase().split(".").pop();
    return unsupportedFormats.includes(extension || "");
  }

  /**
   * Check if file can be compressed
   */
  private canCompressFile(request: OcrRequest): boolean {
    // Check if this is a format that can be compressed
    const compressibleFormats = ["png", "jpg", "jpeg", "pdf"];
    const extension = request.fileName.toLowerCase().split(".").pop();
    return compressibleFormats.includes(extension || "");
  }

  /**
   * Detect document format
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

    return "pdf"; // Default fallback
  }

  /**
   * Format extracted data for markdown output
   */
  private formatExtractedData(fields: PaymentDocumentFields): string {
    let markdown = "";

    if (fields.amounts.length > 0) {
      markdown += "## Amounts\n";
      for (const amount of fields.amounts) {
        markdown += `- ${amount.value} ${amount.currency} (confidence: ${amount.confidence})\n`;
      }
      markdown += "\n";
    }

    if (fields.dates.length > 0) {
      markdown += "## Dates\n";
      for (const date of fields.dates) {
        markdown += `- ${
          date.value.toISOString().split("T")[0]
        } (confidence: ${date.confidence})\n`;
      }
      markdown += "\n";
    }

    if (fields.transactionIds.length > 0) {
      markdown += "## Transaction IDs\n";
      for (const id of fields.transactionIds) {
        markdown += `- ${id.value} (confidence: ${id.confidence})\n`;
      }
      markdown += "\n";
    }

    if (fields.parties.length > 0) {
      markdown += "## Parties\n";
      for (const party of fields.parties) {
        markdown += `- ${party.name} (${party.type}, confidence: ${party.confidence})\n`;
      }
      markdown += "\n";
    }

    return markdown;
  }

  /**
   * Create failed result
   */
  private createFailedResult(reason: FallbackReason, message: string): FallbackResult {
    return {
      success: false,
      reason,
      message,
      extractedFields: this.getEmptyFields(),
      confidenceScore: this.getZeroConfidence(),
    };
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
}

export const ocrFallbackService = new OcrFallbackService();
