/**
 * Document Status Service
 * Enhanced status tracking with caching and detailed progress information
 */

import { log } from "@/deps.ts";
import { redis } from "@config/redis.ts";
import { DocumentQueries, ProcessingLogQueries } from "@database/queries.ts";
import type {
  DetailedProcessingStage,
  DocumentStatusResponse,
  ProgressWeights,
  StageTemplate,
  StatusCacheEntry,
  StatusQueryOptions,
} from "@models/document_status.ts";
import type { Document, ProcessingLog } from "@database/queries.ts";

class DocumentStatusService {
  private logger = log.getLogger();
  private statusCache: Map<string, StatusCacheEntry> = new Map();

  // Cache TTL in seconds (5 minutes)
  private readonly CACHE_TTL = 300;

  // Processing stage templates
  private readonly STAGE_TEMPLATES: StageTemplate[] = [
    {
      name: "upload_validation",
      displayName: "Upload Validation",
      order: 1,
      estimatedDuration: 500,
      description: "Validating file format and metadata",
      dependencies: [],
    },
    {
      name: "s3_upload",
      displayName: "File Upload",
      order: 2,
      estimatedDuration: 2000,
      description: "Uploading file to secure storage",
      dependencies: ["upload_validation"],
    },
    {
      name: "database_creation",
      displayName: "Database Record",
      order: 3,
      estimatedDuration: 300,
      description: "Creating document record in database",
      dependencies: ["s3_upload"],
    },
    {
      name: "ocr_queued",
      displayName: "OCR Queue",
      order: 4,
      estimatedDuration: 100,
      description: "Queuing document for OCR processing",
      dependencies: ["database_creation"],
    },
    {
      name: "ocr_processing",
      displayName: "OCR Processing",
      order: 5,
      estimatedDuration: 15000,
      description: "Extracting text and data from document",
      dependencies: ["ocr_queued"],
    },
    {
      name: "ocr_completed",
      displayName: "OCR Completed",
      order: 6,
      estimatedDuration: 500,
      description: "OCR processing completed successfully",
      dependencies: ["ocr_processing"],
    },
    {
      name: "comparison_processing",
      displayName: "Data Comparison",
      order: 7,
      estimatedDuration: 3000,
      description: "Comparing extracted data with database records",
      dependencies: ["ocr_completed"],
    },
    {
      name: "ai_verification",
      displayName: "AI Verification",
      order: 8,
      estimatedDuration: 5000,
      description: "AI-powered authenticity verification",
      dependencies: ["comparison_processing"],
    },
    {
      name: "completed",
      displayName: "Processing Complete",
      order: 9,
      estimatedDuration: 200,
      description: "Document processing completed successfully",
      dependencies: ["ai_verification"],
    },
  ];

  // Progress calculation weights
  private readonly PROGRESS_WEIGHTS: ProgressWeights = {
    uploadValidation: 0.05,
    s3Upload: 0.10,
    databaseCreation: 0.05,
    ocrProcessing: 0.50,
    dataComparison: 0.15,
    aiVerification: 0.10,
    completion: 0.05,
  };

  /**
   * Get comprehensive document status
   */
  async getDocumentStatus(
    documentId: string,
    options: StatusQueryOptions = {},
  ): Promise<DocumentStatusResponse | null> {
    try {
      this.logger.debug(`Getting status for document: ${documentId}`);

      // Check cache first if enabled
      if (options.useCache !== false) {
        const cached = await this.getCachedStatus(documentId);
        if (cached) {
          this.logger.debug(`Status cache hit for document: ${documentId}`);
          return cached.status;
        }
      }

      // Get document from database
      const document = await DocumentQueries.getById(documentId);
      if (!document) {
        return null;
      }

      // Get processing logs if requested
      const processingLogs = options.includeProcessingLogs !== false
        ? await ProcessingLogQueries.getByDocumentId(documentId)
        : [];

      // Build comprehensive status response
      const status = await this.buildStatusResponse(document, processingLogs, options);

      // Cache the result
      if (options.useCache !== false) {
        await this.cacheStatus(documentId, status);
      }

      return status;
    } catch (error) {
      this.logger.error(`Failed to get status for document ${documentId}:`, error);
      throw error;
    }
  }

  /**
   * Build comprehensive status response
   */
  private async buildStatusResponse(
    document: Document,
    processingLogs: ProcessingLog[],
    options: StatusQueryOptions,
  ): Promise<DocumentStatusResponse> {
    // Calculate progress and current stage
    const { progressPercentage, currentStage } = this.calculateProgress(document, processingLogs);

    // Build detailed processing stages
    const allStages = await this.buildDetailedStages(document, processingLogs);
    const stagesCompleted = allStages
      .filter((stage) => stage.status === "completed")
      .map((stage) => stage.stage);

    // Calculate processing times
    const processingTimes = this.calculateProcessingTimes(document, processingLogs);

    // Build logs summary
    const logsSummary = this.buildLogsSummary(processingLogs);

    // Build results summary
    const resultsSummary = this.buildResultsSummary(document);

    return {
      documentId: document.id,
      fileName: document.file_name,
      fileSize: document.file_size,
      documentType: document.document_type,
      uploadedAt: document.upload_timestamp.toISOString(),

      processingStatus: document.processing_status,
      currentStage,
      progressPercentage,

      queuePosition: undefined, // Would be calculated from actual queue
      estimatedCompletion: this.estimateCompletion(document, progressPercentage),

      stagesCompleted,
      allStages,

      logsSummary,

      processingStartedAt: document.started_processing_at?.toISOString(),
      processingCompletedAt: document.completed_processing_at?.toISOString(),
      totalProcessingTime: processingTimes.total,

      hasResults: this.hasProcessingResults(document),
      resultsSummary,

      metadata: {
        userId: document.user_id,
        transactionId: document.transaction_id,
        disputeId: document.dispute_id,
        priority: "normal", // Default priority
        retryCount: this.getRetryCount(processingLogs),
      },
    };
  }

  /**
   * Calculate progress percentage and current stage
   */
  private calculateProgress(
    document: Document,
    processingLogs: ProcessingLog[],
  ): { progressPercentage: number; currentStage: string | undefined } {
    const completedStages = new Set(
      processingLogs
        .filter((log) => log.status === "completed")
        .map((log) => log.stage),
    );

    const failedStages = new Set(
      processingLogs
        .filter((log) => log.status === "failed")
        .map((log) => log.stage),
    );

    // If document is failed, progress depends on where it failed
    if (document.processing_status === "failed") {
      const lastCompletedStage = this.getLastCompletedStage(processingLogs);
      const template = this.STAGE_TEMPLATES.find((t) => t.name === lastCompletedStage);
      return {
        progressPercentage: template ? (template.order / this.STAGE_TEMPLATES.length) * 100 : 0,
        currentStage: lastCompletedStage,
      };
    }

    // Calculate progress based on completed stages
    let totalProgress = 0;
    let currentStage: string | undefined;

    for (const template of this.STAGE_TEMPLATES) {
      if (completedStages.has(template.name)) {
        totalProgress += this.getStageWeight(template.name);
      } else if (!failedStages.has(template.name)) {
        currentStage = template.name;
        break;
      }
    }

    // If document is completed, progress is 100%
    if (document.processing_status === "completed") {
      totalProgress = 1.0;
      currentStage = "completed";
    }

    return {
      progressPercentage: Math.round(totalProgress * 100),
      currentStage,
    };
  }

  /**
   * Get stage weight for progress calculation
   */
  private getStageWeight(stageName: string): number {
    const weights: Record<string, number> = {
      upload_validation: this.PROGRESS_WEIGHTS.uploadValidation,
      s3_upload: this.PROGRESS_WEIGHTS.s3Upload,
      database_creation: this.PROGRESS_WEIGHTS.databaseCreation,
      ocr_processing: this.PROGRESS_WEIGHTS.ocrProcessing,
      comparison_processing: this.PROGRESS_WEIGHTS.dataComparison,
      ai_verification: this.PROGRESS_WEIGHTS.aiVerification,
      completed: this.PROGRESS_WEIGHTS.completion,
    };

    return weights[stageName] || 0.1;
  }

  /**
   * Build detailed processing stages
   */
  private async buildDetailedStages(
    document: Document,
    processingLogs: ProcessingLog[],
  ): Promise<DetailedProcessingStage[]> {
    const stages: DetailedProcessingStage[] = [];

    // Group logs by stage
    const logsByStage = new Map<string, ProcessingLog[]>();
    for (const log of processingLogs) {
      if (!logsByStage.has(log.stage)) {
        logsByStage.set(log.stage, []);
      }
      logsByStage.get(log.stage)!.push(log);
    }

    for (const template of this.STAGE_TEMPLATES) {
      const stageLogs = logsByStage.get(template.name) || [];
      const stage = this.buildStageFromLogs(template, stageLogs, document);
      stages.push(stage);
    }

    return stages;
  }

  /**
   * Build stage from processing logs
   */
  private buildStageFromLogs(
    template: StageTemplate,
    logs: ProcessingLog[],
    document: Document,
  ): DetailedProcessingStage {
    if (logs.length === 0) {
      // Stage not started yet
      return {
        stage: template.name,
        status: "pending",
        startedAt: undefined,
        completedAt: undefined,
        durationMs: undefined,
        progressPercentage: 0,
        message: undefined,
        errorDetails: undefined,
        metadata: { displayName: template.displayName, description: template.description },
      };
    }

    const startedLog = logs.find((log) => log.status === "started");
    const completedLog = logs.find((log) => log.status === "completed");
    const failedLog = logs.find((log) => log.status === "failed");

    let status: "pending" | "started" | "completed" | "failed" | "skipped" = "started";
    let progressPercentage = 50; // Default for started

    if (completedLog) {
      status = "completed";
      progressPercentage = 100;
    } else if (failedLog) {
      status = "failed";
      progressPercentage = 0;
    }

    return {
      stage: template.name,
      status,
      startedAt: startedLog?.started_at,
      completedAt: completedLog?.completed_at,
      durationMs: completedLog?.duration_ms,
      progressPercentage,
      message: completedLog?.message || failedLog?.message,
      errorDetails: failedLog?.error_details,
      metadata: {
        displayName: template.displayName,
        description: template.description,
        logCount: logs.length,
      },
    };
  }

  /**
   * Calculate processing times
   */
  private calculateProcessingTimes(
    document: Document,
    processingLogs: ProcessingLog[],
  ): { total: number | undefined; byStage: Record<string, number> } {
    const byStage: Record<string, number> = {};

    for (const log of processingLogs) {
      if (log.duration_ms) {
        byStage[log.stage] = (byStage[log.stage] || 0) + log.duration_ms;
      }
    }

    let total: number | undefined;
    if (document.started_processing_at && document.completed_processing_at) {
      total = document.completed_processing_at.getTime() - document.started_processing_at.getTime();
    }

    return { total, byStage };
  }

  /**
   * Build logs summary
   */
  private buildLogsSummary(processingLogs: ProcessingLog[]): {
    totalLogs: number;
    errorCount: number;
    warningCount: number;
    lastLogAt: string | undefined;
  } {
    const errorCount = processingLogs.filter((log) => log.log_level === "ERROR").length;
    const warningCount = processingLogs.filter((log) => log.log_level === "WARN").length;

    const lastLog = processingLogs
      .sort((a, b) => b.started_at.getTime() - a.started_at.getTime())[0];

    return {
      totalLogs: processingLogs.length,
      errorCount,
      warningCount,
      lastLogAt: lastLog?.started_at.toISOString(),
    };
  }

  /**
   * Build results summary
   */
  private buildResultsSummary(document: Document) {
    if (!this.hasProcessingResults(document)) {
      return undefined;
    }

    return {
      ocrCompleted: !!document.extracted_data,
      comparisonCompleted: !!document.comparison_results,
      authenticityVerified: document.authenticity_score !== undefined,
      confidenceScore: document.authenticity_score,
    };
  }

  /**
   * Check if document has processing results
   */
  private hasProcessingResults(document: Document): boolean {
    return !!(document.extracted_data ||
      document.comparison_results ||
      document.authenticity_score !== undefined);
  }

  /**
   * Estimate completion time
   */
  private estimateCompletion(document: Document, progressPercentage: number): string | undefined {
    if (document.processing_status === "completed" || document.processing_status === "failed") {
      return undefined;
    }

    if (progressPercentage === 0) {
      // Not started, estimate based on queue position (would need queue service)
      const estimatedMinutes = 5; // Base estimate
      return new Date(Date.now() + estimatedMinutes * 60 * 1000).toISOString();
    }

    // Estimate based on current progress
    const remainingProgress = (100 - progressPercentage) / 100;
    const estimatedRemainingMinutes = remainingProgress * 10; // 10 minutes max processing

    return new Date(Date.now() + estimatedRemainingMinutes * 60 * 1000).toISOString();
  }

  /**
   * Get last completed stage
   */
  private getLastCompletedStage(processingLogs: ProcessingLog[]): string | undefined {
    const completedLogs = processingLogs
      .filter((log) => log.status === "completed")
      .sort((a, b) => b.started_at.getTime() - a.started_at.getTime());

    return completedLogs[0]?.stage;
  }

  /**
   * Get retry count from logs
   */
  private getRetryCount(processingLogs: ProcessingLog[]): number {
    return processingLogs.filter((log) => log.message?.includes("retry")).length;
  }

  /**
   * Cache status response
   */
  private async cacheStatus(documentId: string, status: DocumentStatusResponse): Promise<void> {
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.CACHE_TTL * 1000);

      const cacheEntry: StatusCacheEntry = {
        documentId,
        status,
        cachedAt: now,
        expiresAt,
        cacheHits: 0,
      };

      // Store in memory cache
      this.statusCache.set(documentId, cacheEntry);

      // Store in Redis cache
      const redisClient = redis.getClient();
      const cacheKey = `doc_status:${documentId}`;

      await redisClient.setex(
        cacheKey,
        this.CACHE_TTL,
        JSON.stringify({
          status,
          cachedAt: now.toISOString(),
        }),
      );

      this.logger.debug(
        `Status cached for document: ${documentId}, expires at: ${expiresAt.toISOString()}`,
      );
    } catch (error) {
      this.logger.warn(`Failed to cache status for document ${documentId}:`, error);
      // Don't throw error - caching failure shouldn't break the request
    }
  }

  /**
   * Get cached status
   */
  private async getCachedStatus(documentId: string): Promise<StatusCacheEntry | null> {
    try {
      // Check memory cache first
      const memoryCached = this.statusCache.get(documentId);
      if (memoryCached && memoryCached.expiresAt > new Date()) {
        memoryCached.cacheHits++;
        return memoryCached;
      }

      // Check Redis cache
      const redisClient = redis.getClient();
      const cacheKey = `doc_status:${documentId}`;
      const cached = await redisClient.get(cacheKey);

      if (cached) {
        const { status, cachedAt } = JSON.parse(cached);

        // Reconstruct cache entry
        const cacheEntry: StatusCacheEntry = {
          documentId,
          status: {
            ...status,
            // Ensure dates are properly parsed
            uploadedAt: status.uploadedAt,
            processingStartedAt: status.processingStartedAt,
            processingCompletedAt: status.processingCompletedAt,
            logsSummary: {
              ...status.logsSummary,
              lastLogAt: status.logsSummary.lastLogAt,
            },
            allStages: status.allStages.map((stage: any) => ({
              ...stage,
              startedAt: stage.startedAt ? new Date(stage.startedAt) : undefined,
              completedAt: stage.completedAt ? new Date(stage.completedAt) : undefined,
            })),
          },
          cachedAt: new Date(cachedAt),
          expiresAt: new Date(new Date(cachedAt).getTime() + this.CACHE_TTL * 1000),
          cacheHits: 1,
        };

        // Update memory cache
        this.statusCache.set(documentId, cacheEntry);

        return cacheEntry;
      }

      return null;
    } catch (error) {
      this.logger.warn(`Failed to get cached status for document ${documentId}:`, error);
      return null;
    }
  }

  /**
   * Invalidate cache for document
   */
  async invalidateCache(documentId: string): Promise<void> {
    try {
      // Remove from memory cache
      this.statusCache.delete(documentId);

      // Remove from Redis cache
      const redisClient = redis.getClient();
      const cacheKey = `doc_status:${documentId}`;
      await redisClient.del(cacheKey);

      this.logger.debug(`Cache invalidated for document: ${documentId}`);
    } catch (error) {
      this.logger.warn(`Failed to invalidate cache for document ${documentId}:`, error);
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
    const entries = Array.from(this.statusCache.values());
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

  /**
   * Clean expired cache entries
   */
  cleanExpiredCache(): void {
    const now = new Date();
    let cleanedCount = 0;

    for (const [documentId, entry] of this.statusCache.entries()) {
      if (entry.expiresAt <= now) {
        this.statusCache.delete(documentId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`Cleaned ${cleanedCount} expired cache entries`);
    }
  }
}

export const documentStatusService = new DocumentStatusService();

// Start cache cleanup timer (run every 5 minutes)
setInterval(() => {
  documentStatusService.cleanExpiredCache();
}, 5 * 60 * 1000);
