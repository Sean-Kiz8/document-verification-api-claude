/**
 * Worker Service
 * Manages worker processes for async processing pipeline stages
 */

import { log } from "@/deps.ts";
import { queueService } from "@services/queue_service.ts";
import { StageFactory } from "@services/processing_stages.ts";
import { ProcessingLogQueries } from "@database/queries.ts";
import type {
  PipelineConfig,
  ProcessingResult,
  ProcessingStageType,
  QueueMessage,
  QueueOperationResult,
  QueuePriority,
  WorkerInfo,
} from "@models/queue.ts";
import { DocumentQueries } from "@database/queries.ts";

export type WorkerStatus = "idle" | "processing" | "error" | "stopped" | "starting";

class Worker {
  private workerId: string;
  private stage: ProcessingStageType;
  private status: WorkerStatus = "idle";
  private currentMessage: QueueMessage | undefined;
  private startedAt: Date;
  private lastHeartbeat: Date;
  private processedCount = 0;
  private errorCount = 0;
  private totalProcessingTime = 0;
  private logger = log.getLogger();
  private isRunning = false;
  private processingPromise?: Promise<void>;

  constructor(stage: ProcessingStageType) {
    this.workerId = `worker-${stage}-${crypto.randomUUID()}`;
    this.stage = stage;
    this.startedAt = new Date();
    this.lastHeartbeat = new Date();
  }

  /**
   * Start worker process
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error("Worker already running");
    }

    this.isRunning = true;
    this.status = "starting";
    this.logger.info(`Starting worker: ${this.workerId} for stage: ${this.stage}`);

    // Start processing loop
    this.processingPromise = this.processLoop();
    this.status = "idle";
  }

  /**
   * Stop worker process
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    this.status = "stopped";

    if (this.processingPromise) {
      await this.processingPromise;
    }

    this.logger.info(`Worker stopped: ${this.workerId}`);
  }

  /**
   * Main processing loop
   */
  private async processLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        // Update heartbeat
        this.lastHeartbeat = new Date();

        // Try to get next message
        const message = await queueService.dequeue(this.stage);

        if (!message) {
          // No messages available, wait before trying again
          await this.sleep(1000); // 1 second
          continue;
        }

        // Process the message
        await this.processMessage(message);
      } catch (error) {
        this.logger.error(`Worker ${this.workerId} processing error:`, error);
        this.errorCount++;
        this.status = "error";

        // Wait before retrying to avoid rapid error loops
        await this.sleep(5000); // 5 seconds
        this.status = "idle";
      }
    }
  }

  /**
   * Process a single message
   */
  private async processMessage(message: QueueMessage): Promise<void> {
    this.status = "processing";
    this.currentMessage = message;
    const startTime = Date.now();

    try {
      this.logger.info(`Worker ${this.workerId} processing message: ${message.id}`);

      // Log processing start
      await this.logProcessingStart(message);

      // Get stage processor
      const stageProcessor = StageFactory.getStage(this.stage);

      // Execute stage processing
      const result = await stageProcessor.execute(message);

      // Log processing completion
      await this.logProcessingCompletion(message, result);

      // Handle result
      if (result.success) {
        // Move to next stage if available
        if (result.nextStage) {
          const nextMessage: QueueMessage = {
            ...message,
            stage: result.nextStage,
            enqueuedAt: new Date(),
            retryCount: 0,
            lastError: undefined,
          };

          await queueService.enqueue(result.nextStage, nextMessage, message.priority);
        }

        this.processedCount++;
      } else {
        // Handle processing failure
        await this.handleProcessingFailure(message, result);
      }

      const processingTime = Date.now() - startTime;
      this.totalProcessingTime += processingTime;
    } catch (error) {
      this.logger.error(`Message processing failed: ${message.id}`, error);

      // Log processing error
      await this.logProcessingError(message, error);

      // Handle processing failure
      await this.handleProcessingFailure(message, {
        success: false,
        stage: this.stage,
        documentId: message.documentId,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        durationMs: Date.now() - startTime,
        error: {
          code: "WORKER_PROCESSING_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
          details: error,
          retryable: true,
        },
      });

      this.errorCount++;
    } finally {
      this.status = "idle";
      this.currentMessage = undefined;
    }
  }

  /**
   * Handle processing failure
   */
  private async handleProcessingFailure(
    message: QueueMessage,
    result: ProcessingResult,
  ): Promise<void> {
    try {
      const canRetry = result.error?.retryable !== false && message.retryCount < message.maxRetries;

      if (canRetry) {
        // Increment retry count and re-queue
        const retryMessage: QueueMessage = {
          ...message,
          retryCount: message.retryCount + 1,
          lastError: result.error?.message,
          enqueuedAt: new Date(),
        };

        // Calculate retry delay (exponential backoff)
        const delay = Math.min(
          1000 * Math.pow(2, message.retryCount), // 1s, 2s, 4s, 8s...
          60000, // Max 1 minute
        );

        // Schedule retry
        setTimeout(async () => {
          await queueService.enqueue(this.stage, retryMessage, message.priority);
        }, delay);

        this.logger.info(
          `Message scheduled for retry: ${message.id} (attempt ${
            message.retryCount + 1
          }/${message.maxRetries})`,
        );
      } else {
        // Move to dead letter queue
        await queueService.moveToDeadLetter(
          message,
          result.error?.message || "Max retries exceeded",
        );

        // Mark document as failed
        await DocumentQueries.updateStatus(message.documentId, "failed");

        this.logger.warn(`Message moved to dead letter queue: ${message.id}`);
      }
    } catch (error) {
      this.logger.error(`Failed to handle processing failure for message: ${message.id}`, error);
    }
  }

  /**
   * Log processing stage start
   */
  private async logProcessingStart(message: QueueMessage): Promise<void> {
    try {
      await ProcessingLogQueries.create({
        document_id: message.documentId,
        stage: this.stage,
        status: "started",
        started_at: new Date(),
        completed_at: undefined,
        duration_ms: undefined,
        log_level: "INFO",
        message: `${this.stage} processing started by worker ${this.workerId}`,
        error_details: undefined,
        metadata: {
          workerId: this.workerId,
          messageId: message.id,
          retryCount: message.retryCount,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to log processing start for ${message.id}:`, error);
    }
  }

  /**
   * Log processing completion
   */
  private async logProcessingCompletion(
    message: QueueMessage,
    result: ProcessingResult,
  ): Promise<void> {
    try {
      await ProcessingLogQueries.create({
        document_id: message.documentId,
        stage: this.stage,
        status: result.success ? "completed" : "failed",
        started_at: result.startedAt,
        completed_at: result.completedAt,
        duration_ms: result.durationMs,
        log_level: result.success ? "INFO" : "ERROR",
        message: result.success
          ? `${this.stage} processing completed successfully`
          : `${this.stage} processing failed: ${result.error?.message}`,
        error_details: result.error,
        metadata: {
          workerId: this.workerId,
          messageId: message.id,
          retryCount: message.retryCount,
          nextStage: result.nextStage,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to log processing completion for ${message.id}:`, error);
    }
  }

  /**
   * Log processing error
   */
  private async logProcessingError(message: QueueMessage, error: unknown): Promise<void> {
    try {
      await ProcessingLogQueries.create({
        document_id: message.documentId,
        stage: this.stage,
        status: "failed",
        started_at: new Date(),
        completed_at: new Date(),
        duration_ms: 0,
        log_level: "ERROR",
        message: `Worker processing error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        error_details: error,
        metadata: {
          workerId: this.workerId,
          messageId: message.id,
          retryCount: message.retryCount,
        },
      });
    } catch (logError) {
      this.logger.warn(`Failed to log processing error for ${message.id}:`, logError);
    }
  }

  /**
   * Get worker information
   */
  getInfo(): WorkerInfo {
    return {
      workerId: this.workerId,
      stage: this.stage,
      status: this.status,
      currentMessage: this.currentMessage?.id,
      startedAt: this.startedAt,
      lastHeartbeat: this.lastHeartbeat,
      processedCount: this.processedCount,
      errorCount: this.errorCount,
      averageProcessingTime: this.processedCount > 0
        ? Math.round(this.totalProcessingTime / this.processedCount)
        : 0,
    };
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Worker Pool Manager
 */
class WorkerPoolService {
  private logger = log.getLogger();
  private workers: Map<string, Worker> = new Map();
  private config: PipelineConfig;

  constructor(config: PipelineConfig) {
    this.config = config;
  }

  /**
   * Start workers for all stages
   */
  async startWorkers(): Promise<void> {
    try {
      const stages = StageFactory.getAllStages();

      for (const stage of stages) {
        await this.startWorkersForStage(stage, 2); // 2 workers per stage by default
      }

      this.logger.info(`Started workers for ${stages.length} stages`);
    } catch (error) {
      this.logger.error("Failed to start workers:", error);
      throw error;
    }
  }

  /**
   * Start workers for specific stage
   */
  async startWorkersForStage(stage: ProcessingStageType, count: number = 1): Promise<void> {
    try {
      for (let i = 0; i < count; i++) {
        const worker = new Worker(stage);
        this.workers.set(worker.getInfo().workerId, worker);
        await worker.start();

        this.logger.info(`Started worker ${worker.getInfo().workerId} for stage ${stage}`);
      }
    } catch (error) {
      this.logger.error(`Failed to start workers for stage ${stage}:`, error);
      throw error;
    }
  }

  /**
   * Stop all workers
   */
  async stopAllWorkers(): Promise<void> {
    try {
      const stopPromises = Array.from(this.workers.values()).map((worker) => worker.stop());
      await Promise.all(stopPromises);

      this.workers.clear();
      this.logger.info("All workers stopped");
    } catch (error) {
      this.logger.error("Failed to stop workers:", error);
      throw error;
    }
  }

  /**
   * Get worker statistics
   */
  getWorkerStats(): WorkerInfo[] {
    return Array.from(this.workers.values()).map((worker) => worker.getInfo());
  }

  /**
   * Get workers by stage
   */
  getWorkersByStage(stage: ProcessingStageType): WorkerInfo[] {
    return this.getWorkerStats().filter((worker) => worker.stage === stage);
  }

  /**
   * Scale workers based on queue depth
   */
  async scaleWorkers(): Promise<void> {
    try {
      const stats = await queueService.getQueueStats();

      for (const stageStat of stats) {
        const stage = stageStat.queueName as ProcessingStageType;
        const currentWorkers = this.getWorkersByStage(stage).length;
        const queueDepth = stageStat.totalMessages;

        // Simple scaling logic: 1 worker per 10 messages, max 5 workers per stage
        const desiredWorkers = Math.min(Math.max(1, Math.ceil(queueDepth / 10)), 5);

        if (desiredWorkers > currentWorkers) {
          const workersToStart = desiredWorkers - currentWorkers;
          await this.startWorkersForStage(stage, workersToStart);
          this.logger.info(
            `Scaled up ${stage}: started ${workersToStart} workers (total: ${desiredWorkers})`,
          );
        }
        // Note: We don't scale down automatically to avoid disrupting active processing
      }
    } catch (error) {
      this.logger.error("Failed to scale workers:", error);
    }
  }

  /**
   * Health check for worker pool
   */
  async healthCheck(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    totalWorkers: number;
    activeWorkers: number;
    idleWorkers: number;
    errorWorkers: number;
    stagesCovered: number;
  }> {
    try {
      const workers = this.getWorkerStats();
      const totalWorkers = workers.length;
      const activeWorkers = workers.filter((w) => w.status === "processing").length;
      const idleWorkers = workers.filter((w) => w.status === "idle").length;
      const errorWorkers = workers.filter((w) => w.status === "error").length;

      const stagesCovered = new Set(workers.map((w) => w.stage)).size;
      const totalStages = StageFactory.getAllStages().length;

      let status: "healthy" | "degraded" | "unhealthy" = "healthy";

      if (errorWorkers > totalWorkers * 0.2 || stagesCovered < totalStages) {
        status = "degraded";
      }

      if (errorWorkers > totalWorkers * 0.5 || stagesCovered < totalStages * 0.5) {
        status = "unhealthy";
      }

      return {
        status,
        totalWorkers,
        activeWorkers,
        idleWorkers,
        errorWorkers,
        stagesCovered,
      };
    } catch (error) {
      this.logger.error("Worker pool health check failed:", error);
      return {
        status: "unhealthy",
        totalWorkers: 0,
        activeWorkers: 0,
        idleWorkers: 0,
        errorWorkers: 0,
        stagesCovered: 0,
      };
    }
  }
}

/**
 * Pipeline Processing Service
 * Orchestrates the entire async processing pipeline
 */
class PipelineService {
  private logger = log.getLogger();
  private workerPool: WorkerPoolService;
  private isRunning = false;

  constructor(config: PipelineConfig = queueService.getConfig()) {
    this.workerPool = new WorkerPoolService(config);
  }

  /**
   * Start the processing pipeline
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error("Pipeline already running");
    }

    try {
      this.logger.info("Starting processing pipeline...");

      // Start worker pool
      await this.workerPool.startWorkers();

      // Start monitoring
      this.startMonitoring();

      this.isRunning = true;
      this.logger.info("Processing pipeline started successfully");
    } catch (error) {
      this.logger.error("Failed to start processing pipeline:", error);
      throw error;
    }
  }

  /**
   * Stop the processing pipeline
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      this.logger.info("Stopping processing pipeline...");

      // Stop worker pool
      await this.workerPool.stopAllWorkers();

      this.isRunning = false;
      this.logger.info("Processing pipeline stopped");
    } catch (error) {
      this.logger.error("Failed to stop processing pipeline:", error);
      throw error;
    }
  }

  /**
   * Start document processing by adding to first stage queue
   */
  async startDocumentProcessing(
    documentId: string,
    metadata: QueueMessage["metadata"],
    priority: QueuePriority = "medium",
  ): Promise<QueueOperationResult> {
    try {
      const message: QueueMessage = {
        id: crypto.randomUUID(),
        documentId,
        stage: "document_validation", // Start with first stage
        priority,
        enqueuedAt: new Date(),
        retryCount: 0,
        maxRetries: 3,
        metadata,
        config: {
          timeout: 300000, // 5 minutes
        },
      };

      return await queueService.enqueue("document_validation", message, priority);
    } catch (error) {
      this.logger.error(`Failed to start document processing for ${documentId}:`, error);
      throw error;
    }
  }

  /**
   * Get pipeline health status
   */
  async getHealthStatus(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    pipeline: boolean;
    workers: object;
    queues: object;
  }> {
    try {
      const workerHealth = await this.workerPool.healthCheck();
      const queueHealth = await queueService.healthCheck();

      const overallHealthy = workerHealth.status === "healthy" && queueHealth.status === "healthy";
      const status = overallHealthy
        ? "healthy"
        : (workerHealth.status === "unhealthy" || queueHealth.status === "unhealthy")
        ? "unhealthy"
        : "degraded";

      return {
        status,
        pipeline: this.isRunning,
        workers: workerHealth,
        queues: queueHealth,
      };
    } catch (error) {
      this.logger.error("Pipeline health check failed:", error);
      return {
        status: "unhealthy",
        pipeline: false,
        workers: {},
        queues: {},
      };
    }
  }

  /**
   * Start monitoring and scaling
   */
  private startMonitoring(): void {
    // Worker scaling check every 2 minutes
    setInterval(async () => {
      try {
        await this.workerPool.scaleWorkers();
      } catch (error) {
        this.logger.error("Worker scaling failed:", error);
      }
    }, 2 * 60 * 1000);

    this.logger.info("Pipeline monitoring started");
  }
}

export const pipelineService = new PipelineService();
export { queueService, WorkerPoolService };
