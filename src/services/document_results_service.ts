/**
 * Document Results Service
 * Handles retrieval and caching of document processing results
 */

import { log } from "@/deps.ts";
import { redis } from "@config/redis.ts";
import { DocumentQueries, ProcessingLogQueries } from "@database/queries.ts";
import { storageService } from "@services/storage_service.ts";
import type {
  AuthenticityAnalysis,
  DocumentResults,
  FieldComparison,
  ProcessingDiscrepancy,
  ProcessingSummary,
  ResultsCacheEntry,
  ResultsQueryOptions,
} from "@models/document_results.ts";
import type { Document, ProcessingLog } from "@database/queries.ts";

class DocumentResultsService {
  private logger = log.getLogger();
  private resultsCache: Map<string, ResultsCacheEntry> = new Map();

  // Cache TTL in seconds (1 hour)
  private readonly CACHE_TTL = 3600;

  /**
   * Get comprehensive document results
   */
  async getDocumentResults(
    documentId: string,
    options: ResultsQueryOptions = {},
  ): Promise<DocumentResults | null> {
    try {
      this.logger.info(`Getting results for document: ${documentId}`);

      // Check cache first if enabled
      if (options.useCache !== false) {
        const cached = await this.getCachedResults(documentId);
        if (cached) {
          this.logger.debug(`Results cache hit for document: ${documentId}`);
          return cached.results;
        }
      }

      // Get document from database
      const document = await DocumentQueries.getById(documentId);
      if (!document) {
        return null;
      }

      // Check if processing is completed
      if (!this.isProcessingComplete(document)) {
        throw new Error("Document processing not yet completed");
      }

      // Get processing logs if requested
      const processingLogs = options.includeProcessingLogs !== false
        ? await ProcessingLogQueries.getByDocumentId(documentId)
        : [];

      // Build comprehensive results response
      const results = await this.buildResultsResponse(document, processingLogs, options);

      // Cache the result for completed documents
      if (options.useCache !== false && document.processing_status === "completed") {
        await this.cacheResults(documentId, results);
      }

      return results;
    } catch (error) {
      this.logger.error(`Failed to get results for document ${documentId}:`, error);
      throw error;
    }
  }

  /**
   * Get processing summary (lightweight version)
   */
  async getProcessingSummary(documentId: string): Promise<ProcessingSummary | null> {
    try {
      const document = await DocumentQueries.getById(documentId);
      if (!document) {
        return null;
      }

      if (!this.isProcessingComplete(document)) {
        return null;
      }

      const processingTime = this.calculateTotalProcessingTime(document);
      const overallScore = document.authenticity_score || 0;

      // Count flags and discrepancies from stored results
      const authenticityDetails = document.authenticity_details || {};
      const comparisonResults = document.comparison_results || {};

      const flagsCount = authenticityDetails.flags?.length || 0;
      const discrepanciesCount = comparisonResults.discrepancies?.length || 0;

      const recommendation = this.calculateRecommendation(
        overallScore,
        flagsCount,
        discrepanciesCount,
      );
      const riskLevel = this.calculateRiskLevel(overallScore, flagsCount, discrepanciesCount);

      return {
        documentId: document.id,
        status: document.processing_status as "completed" | "failed" | "partial",
        overallScore,
        recommendation,
        riskLevel,
        processedAt: document.completed_processing_at?.toISOString() || new Date().toISOString(),
        processingTime,
        flagsCount,
        discrepanciesCount,
      };
    } catch (error) {
      this.logger.error(`Failed to get processing summary for document ${documentId}:`, error);
      throw error;
    }
  }

  /**
   * Build comprehensive results response
   */
  private async buildResultsResponse(
    document: Document,
    processingLogs: ProcessingLog[],
    options: ResultsQueryOptions,
  ): Promise<DocumentResults> {
    // Generate document access URLs
    const documentAccess = await this.generateDocumentAccessUrls(document);

    // Parse stored results
    const extractedData = document.extracted_data || {};
    const comparisonResults = document.comparison_results || {};
    const authenticityDetails = document.authenticity_details || {};

    // Build field comparisons
    const fieldComparisons = this.buildFieldComparisons(extractedData, comparisonResults);

    // Build discrepancies
    const discrepancies = this.buildDiscrepancies(comparisonResults);

    // Build authenticity analysis
    const authenticityAnalysis = this.buildAuthenticityAnalysis(
      authenticityDetails,
      document.authenticity_score,
    );

    // Calculate processing times
    const processingTime = this.calculateTotalProcessingTime(document);

    // Build processing logs summary
    const logsAggregation = this.aggregateProcessingLogs(processingLogs);

    // Generate final assessment
    const finalAssessment = this.generateFinalAssessment(
      document.authenticity_score || 0,
      fieldComparisons,
      discrepancies,
      authenticityAnalysis,
    );

    return {
      documentId: document.id,
      fileName: document.file_name,
      fileSize: document.file_size,
      documentType: document.document_type,
      uploadedAt: document.upload_timestamp.toISOString(),

      processingStatus: document.processing_status as "completed" | "failed" | "partial",
      processedAt: document.completed_processing_at?.toISOString() || new Date().toISOString(),
      totalProcessingTime: processingTime,

      ocrResults: {
        success: !!document.extracted_data,
        confidence: extractedData.confidenceScore?.overall || 0,
        extractedData: {
          amounts: extractedData.amounts || [],
          dates: extractedData.dates || [],
          transactionIds: extractedData.transactionIds || [],
          parties: extractedData.parties || [],
          rawText: options.includeRawText !== false ? (extractedData.rawText || "") : "",
          structuredData: extractedData.structuredData || {},
        },
        processingTime: this.getStageProcessingTime(processingLogs, "ocr_extraction"),
        fallbackUsed: extractedData.fallbackUsed || false,
      },

      comparisonResults: {
        success: !!document.comparison_results,
        overallMatch: comparisonResults.overallMatch || 0,
        fieldComparisons,
        discrepancies,
        transactionFound: comparisonResults.transactionFound || false,
        processingTime: this.getStageProcessingTime(processingLogs, "data_comparison"),
      },

      authenticityResults: {
        success: document.authenticity_score !== undefined,
        analysis: authenticityAnalysis,
        processingTime: this.getStageProcessingTime(processingLogs, "ai_verification"),
      },

      processingLogs: logsAggregation,

      documentAccess,

      finalAssessment,

      metadata: {
        userId: document.user_id,
        transactionId: document.transaction_id,
        disputeId: document.dispute_id,
        apiVersion: "v1",
        resultFormat: "comprehensive",
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Generate signed URLs for document access
   */
  private async generateDocumentAccessUrls(
    document: Document,
  ): Promise<DocumentResults["documentAccess"]> {
    try {
      // Generate download URL for original document (24 hours)
      const downloadResult = await storageService.generateDownloadUrl(
        document.s3_key,
        24 * 60 * 60,
      );

      const documentAccess: DocumentResults["documentAccess"] = {
        originalDocument: {
          downloadUrl: downloadResult.downloadUrl,
          expiresAt: downloadResult.expiresAt.toISOString(),
        },
      };

      // TODO: Add processed data URLs (markdown, JSON) if available
      // This would be implemented when we have processed data storage

      return documentAccess;
    } catch (error) {
      this.logger.warn(`Failed to generate document access URLs for ${document.id}:`, error);

      return {
        originalDocument: {
          downloadUrl: "",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      };
    }
  }

  /**
   * Build field comparisons from stored results
   */
  private buildFieldComparisons(extractedData: any, comparisonResults: any): FieldComparison[] {
    const comparisons: FieldComparison[] = [];
    const matches = comparisonResults.matches || {};

    // Amount comparisons
    if (extractedData.amounts && matches.amount !== undefined) {
      comparisons.push({
        field: "amount",
        extractedValue: extractedData.amounts[0]?.value,
        databaseValue: "Expected from database",
        matchScore: matches.amount || 0,
        status: matches.amount > 0.9
          ? "exact_match"
          : matches.amount > 0.7
          ? "partial_match"
          : "no_match",
        confidence: extractedData.amounts[0]?.confidence || 0,
      });
    }

    // Transaction ID comparisons
    if (extractedData.transactionIds && matches.transactionId !== undefined) {
      comparisons.push({
        field: "transactionId",
        extractedValue: extractedData.transactionIds[0]?.value,
        databaseValue: "Expected from database",
        matchScore: matches.transactionId || 0,
        status: matches.transactionId > 0.9 ? "exact_match" : "no_match",
        confidence: extractedData.transactionIds[0]?.confidence || 0,
      });
    }

    return comparisons;
  }

  /**
   * Build discrepancies from comparison results
   */
  private buildDiscrepancies(comparisonResults: any): ProcessingDiscrepancy[] {
    const discrepancies: ProcessingDiscrepancy[] = [];
    const storedDiscrepancies = comparisonResults.discrepancies || [];

    for (const [index, discrepancy] of storedDiscrepancies.entries()) {
      discrepancies.push({
        id: `disc_${index}`,
        type: discrepancy.type || "other",
        severity: discrepancy.severity || "medium",
        field: discrepancy.field || "unknown",
        description: discrepancy.description || "Data discrepancy detected",
        extractedValue: discrepancy.extractedValue,
        expectedValue: discrepancy.expectedValue,
        confidence: discrepancy.confidence || 0.5,
        impact: this.calculateImpact(discrepancy.severity),
      });
    }

    return discrepancies;
  }

  /**
   * Build authenticity analysis
   */
  private buildAuthenticityAnalysis(
    authenticityDetails: any,
    score?: number,
  ): AuthenticityAnalysis {
    return {
      score: score || 0,
      confidence: authenticityDetails.confidence || 0,
      reasoning: authenticityDetails.reasoning || "No authenticity analysis available",
      flags: authenticityDetails.flags || [],
      recommendations: authenticityDetails.recommendations || [],
    };
  }

  /**
   * Calculate final assessment and recommendation
   */
  private generateFinalAssessment(
    authenticityScore: number,
    fieldComparisons: FieldComparison[],
    discrepancies: ProcessingDiscrepancy[],
    authenticityAnalysis: AuthenticityAnalysis,
  ): DocumentResults["finalAssessment"] {
    // Calculate overall score (weighted average)
    const comparisonScore = fieldComparisons.length > 0
      ? fieldComparisons.reduce((sum, comp) => sum + comp.matchScore, 0) / fieldComparisons.length
      : 0;

    const overallScore = (authenticityScore * 0.6) + (comparisonScore * 0.4);

    // Determine recommendation
    const highSeverityDiscrepancies = discrepancies.filter((d) => d.severity === "high").length;
    const criticalFlags = authenticityAnalysis.flags.filter((f) => f.severity === "high").length;

    let recommendation: "approve" | "review" | "reject";
    let requiresManualReview = false;

    if (overallScore >= 0.9 && highSeverityDiscrepancies === 0 && criticalFlags === 0) {
      recommendation = "approve";
    } else if (overallScore < 0.5 || highSeverityDiscrepancies > 2 || criticalFlags > 0) {
      recommendation = "reject";
      requiresManualReview = true;
    } else {
      recommendation = "review";
      requiresManualReview = true;
    }

    const riskLevel = this.calculateRiskLevel(
      overallScore,
      criticalFlags,
      highSeverityDiscrepancies,
    );

    const summary = this.generateAssessmentSummary(
      overallScore,
      recommendation,
      riskLevel,
      discrepancies.length,
      authenticityAnalysis.flags.length,
    );

    return {
      overallScore: Math.round(overallScore * 100) / 100,
      recommendation,
      riskLevel,
      summary,
      requiresManualReview,
    };
  }

  /**
   * Check if document processing is complete
   */
  private isProcessingComplete(document: Document): boolean {
    return document.processing_status === "completed" ||
      document.processing_status === "failed" ||
      (document.processing_status === "cancelled" && document.extracted_data);
  }

  /**
   * Calculate total processing time
   */
  private calculateTotalProcessingTime(document: Document): number {
    if (document.started_processing_at && document.completed_processing_at) {
      return document.completed_processing_at.getTime() - document.started_processing_at.getTime();
    }
    return 0;
  }

  /**
   * Get processing time for specific stage
   */
  private getStageProcessingTime(processingLogs: ProcessingLog[], stage: string): number {
    const stageLogs = processingLogs.filter((log) => log.stage === stage);
    const completedLog = stageLogs.find((log) => log.status === "completed");
    return completedLog?.duration_ms || 0;
  }

  /**
   * Aggregate processing logs
   */
  private aggregateProcessingLogs(
    processingLogs: ProcessingLog[],
  ): DocumentResults["processingLogs"] {
    const errorCount = processingLogs.filter((log) => log.log_level === "ERROR").length;
    const warningCount = processingLogs.filter((log) => log.log_level === "WARN").length;

    // Group by stage
    const stageGroups = new Map<string, ProcessingLog[]>();
    for (const log of processingLogs) {
      if (!stageGroups.has(log.stage)) {
        stageGroups.set(log.stage, []);
      }
      stageGroups.get(log.stage)!.push(log);
    }

    const stages = Array.from(stageGroups.entries()).map(([stage, logs]) => {
      const completedLog = logs.find((log) => log.status === "completed");
      const failedLog = logs.find((log) => log.status === "failed");

      return {
        stage,
        status: completedLog ? "completed" : failedLog ? "failed" : "unknown",
        duration: completedLog?.duration_ms || failedLog?.duration_ms || 0,
        logCount: logs.length,
      };
    });

    return {
      totalLogs: processingLogs.length,
      errorCount,
      warningCount,
      stages,
    };
  }

  /**
   * Calculate impact level from severity
   */
  private calculateImpact(severity: string): "minor" | "moderate" | "critical" {
    switch (severity) {
      case "high":
        return "critical";
      case "medium":
        return "moderate";
      case "low":
        return "minor";
      default:
        return "moderate";
    }
  }

  /**
   * Calculate recommendation
   */
  private calculateRecommendation(
    score: number,
    flagsCount: number,
    discrepanciesCount: number,
  ): "approve" | "review" | "reject" {
    if (score >= 0.9 && flagsCount === 0 && discrepanciesCount <= 1) {
      return "approve";
    }

    if (score < 0.5 || flagsCount > 2 || discrepanciesCount > 3) {
      return "reject";
    }

    return "review";
  }

  /**
   * Calculate risk level
   */
  private calculateRiskLevel(
    score: number,
    flagsCount: number,
    discrepanciesCount: number,
  ): "low" | "medium" | "high" | "critical" {
    if (score >= 0.95 && flagsCount === 0 && discrepanciesCount === 0) {
      return "low";
    }

    if (score >= 0.8 && flagsCount <= 1 && discrepanciesCount <= 2) {
      return "medium";
    }

    if (score >= 0.5 && flagsCount <= 3 && discrepanciesCount <= 5) {
      return "high";
    }

    return "critical";
  }

  /**
   * Generate assessment summary text
   */
  private generateAssessmentSummary(
    score: number,
    recommendation: string,
    riskLevel: string,
    discrepanciesCount: number,
    flagsCount: number,
  ): string {
    const scorePercentage = Math.round(score * 100);

    let summary = `Document authenticity score: ${scorePercentage}%. `;

    if (recommendation === "approve") {
      summary +=
        "Document appears authentic with high confidence. No significant discrepancies detected.";
    } else if (recommendation === "reject") {
      summary +=
        `Document shows significant authenticity concerns. ${flagsCount} flags raised, ${discrepanciesCount} discrepancies found.`;
    } else {
      summary +=
        `Document requires manual review. ${flagsCount} flags and ${discrepanciesCount} discrepancies detected.`;
    }

    summary += ` Risk level: ${riskLevel}.`;

    return summary;
  }

  /**
   * Cache results response
   */
  private async cacheResults(documentId: string, results: DocumentResults): Promise<void> {
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.CACHE_TTL * 1000);

      const cacheEntry: ResultsCacheEntry = {
        documentId,
        results,
        cachedAt: now,
        expiresAt,
        cacheHits: 0,
        compressed: false,
      };

      // Store in memory cache
      this.resultsCache.set(documentId, cacheEntry);

      // Store in Redis cache
      const redisClient = redis.getClient();
      const cacheKey = `doc_results:${documentId}`;

      await redisClient.setex(
        cacheKey,
        this.CACHE_TTL,
        JSON.stringify({
          results,
          cachedAt: now.toISOString(),
        }),
      );

      this.logger.debug(
        `Results cached for document: ${documentId}, expires at: ${expiresAt.toISOString()}`,
      );
    } catch (error) {
      this.logger.warn(`Failed to cache results for document ${documentId}:`, error);
    }
  }

  /**
   * Get cached results
   */
  private async getCachedResults(documentId: string): Promise<ResultsCacheEntry | null> {
    try {
      // Check memory cache first
      const memoryCached = this.resultsCache.get(documentId);
      if (memoryCached && memoryCached.expiresAt > new Date()) {
        memoryCached.cacheHits++;
        return memoryCached;
      }

      // Check Redis cache
      const redisClient = redis.getClient();
      const cacheKey = `doc_results:${documentId}`;
      const cached = await redisClient.get(cacheKey);

      if (cached) {
        const { results, cachedAt } = JSON.parse(cached);

        const cacheEntry: ResultsCacheEntry = {
          documentId,
          results,
          cachedAt: new Date(cachedAt),
          expiresAt: new Date(new Date(cachedAt).getTime() + this.CACHE_TTL * 1000),
          cacheHits: 1,
          compressed: false,
        };

        // Update memory cache
        this.resultsCache.set(documentId, cacheEntry);

        return cacheEntry;
      }

      return null;
    } catch (error) {
      this.logger.warn(`Failed to get cached results for document ${documentId}:`, error);
      return null;
    }
  }

  /**
   * Invalidate results cache
   */
  async invalidateCache(documentId: string): Promise<void> {
    try {
      // Remove from memory cache
      this.resultsCache.delete(documentId);

      // Remove from Redis cache
      const redisClient = redis.getClient();
      const cacheKey = `doc_results:${documentId}`;
      await redisClient.del(cacheKey);

      this.logger.debug(`Results cache invalidated for document: ${documentId}`);
    } catch (error) {
      this.logger.warn(`Failed to invalidate results cache for document ${documentId}:`, error);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    memoryCacheSize: number;
    totalCacheHits: number;
    averageCacheAge: number;
  } {
    const entries = Array.from(this.resultsCache.values());
    const totalHits = entries.reduce((sum, entry) => sum + entry.cacheHits, 0);

    const now = new Date();
    const totalAge = entries.reduce((sum, entry) => {
      return sum + (now.getTime() - entry.cachedAt.getTime());
    }, 0);

    const averageAge = entries.length > 0 ? totalAge / entries.length : 0;

    return {
      memoryCacheSize: entries.length,
      totalCacheHits: totalHits,
      averageCacheAge: Math.round(averageAge / 1000), // in seconds
    };
  }
}

export const documentResultsService = new DocumentResultsService();
