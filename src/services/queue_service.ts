/**
 * Redis Queue Service
 * Manages async processing queues with priority levels and retry mechanisms
 */

import { log } from "@/deps.ts";
import { redis } from "@config/redis.ts";
import type {
  PipelineConfig,
  ProcessingStageType,
  QueueMessage,
  QueueOperationResult,
  QueuePriority,
  QueueStats,
} from "@models/queue.ts";

/**
 * Default pipeline configuration
 */
export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  // Queue settings
  maxQueueSize: 10000,
  messageRetention: 7 * 24 * 60 * 60, // 7 days

  // Worker settings
  maxWorkers: 10,
  workerTimeout: 300000, // 5 minutes
  heartbeatInterval: 30000, // 30 seconds

  // Retry settings
  maxRetries: 3,
  retryBackoffBase: 1000, // 1 second
  retryBackoffMax: 60000, // 1 minute

  // Performance settings
  batchSize: 10,
  prefetchCount: 5,

  // Monitoring settings
  metricsInterval: 60000, // 1 minute
  healthCheckInterval: 30000, // 30 seconds
};

class QueueService {
  private logger = log.getLogger();
  private config: PipelineConfig;

  constructor(config: PipelineConfig = DEFAULT_PIPELINE_CONFIG) {
    this.config = config;
  }

  /**
   * Enqueue message with priority
   */
  async enqueue(
    stage: ProcessingStageType,
    message: QueueMessage,
    priority: QueuePriority = "medium",
  ): Promise<QueueOperationResult> {
    try {
      const redisClient = redis.getClient();
      const queueKey = this.getQueueKey(stage, priority);
      const messageKey = this.getMessageKey(message.id);

      // Store message data
      await redisClient.hset(messageKey, {
        id: message.id,
        documentId: message.documentId,
        stage: message.stage,
        priority: message.priority,
        enqueuedAt: message.enqueuedAt.toISOString(),
        retryCount: message.retryCount.toString(),
        maxRetries: message.maxRetries.toString(),
        lastError: message.lastError || "",
        metadata: JSON.stringify(message.metadata),
        config: JSON.stringify(message.config || {}),
      });

      // Set message expiration
      await redisClient.expire(messageKey, this.config.messageRetention);

      // Add to priority queue
      const score = this.calculateScore(priority, message.enqueuedAt);
      await redisClient.zadd(queueKey, score, message.id);

      // Update queue metrics
      await this.updateQueueMetrics(stage, priority, "enqueued");

      const queueSize = await redisClient.zcard(queueKey);
      const estimatedTime = this.estimateProcessingTime(queueSize, priority);

      this.logger.info(
        `Message enqueued: ${message.id} to ${stage}/${priority} (position: ${queueSize})`,
      );

      return {
        success: true,
        messageId: message.id,
        queuePosition: queueSize,
        estimatedProcessingTime: estimatedTime,
      };
    } catch (error) {
      this.logger.error("Failed to enqueue message:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Dequeue message from highest priority queue
   */
  async dequeue(stage: ProcessingStageType): Promise<QueueMessage | null> {
    try {
      const redisClient = redis.getClient();
      const priorities: QueuePriority[] = ["high", "medium", "low"];

      // Try each priority level
      for (const priority of priorities) {
        const queueKey = this.getQueueKey(stage, priority);

        // Use ZPOPMIN for atomic dequeue with score
        const result = await redisClient.zpopmin(queueKey, 1);

        if (result && result.length >= 2) {
          const messageId = result[0];
          const messageKey = this.getMessageKey(messageId);

          // Get full message data
          const messageData = await redisClient.hgetall(messageKey);

          if (Object.keys(messageData).length > 0) {
            // Parse message
            const message = this.parseMessage(messageData);

            // Update dequeue metrics
            await this.updateQueueMetrics(stage, priority, "dequeued");

            this.logger.debug(`Message dequeued: ${messageId} from ${stage}/${priority}`);

            return message;
          }
        }
      }

      return null;
    } catch (error) {
      this.logger.error("Failed to dequeue message:", error);
      throw error;
    }
  }

  /**
   * Peek at next message without removing it
   */
  async peek(stage: ProcessingStageType, priority?: QueuePriority): Promise<QueueMessage | null> {
    try {
      const redisClient = redis.getClient();
      const priorities: QueuePriority[] = priority ? [priority] : ["high", "medium", "low"];

      for (const p of priorities) {
        const queueKey = this.getQueueKey(stage, p);

        // Get first message without removing
        const result = await redisClient.zrange(queueKey, 0, 0);

        if (result && result.length > 0) {
          const messageId = result[0];
          const messageKey = this.getMessageKey(messageId);
          const messageData = await redisClient.hgetall(messageKey);

          if (Object.keys(messageData).length > 0) {
            return this.parseMessage(messageData);
          }
        }
      }

      return null;
    } catch (error) {
      this.logger.error("Failed to peek queue:", error);
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(stage?: ProcessingStageType): Promise<QueueStats[]> {
    try {
      const redisClient = redis.getClient();
      const stages: ProcessingStageType[] = stage ? [stage] : [
        "document_validation",
        "s3_upload",
        "ocr_extraction",
        "data_comparison",
        "ai_verification",
      ];

      const stats: QueueStats[] = [];

      for (const s of stages) {
        const priorities: QueuePriority[] = ["high", "medium", "low"];
        let totalMessages = 0;
        const messagesByPriority: Record<QueuePriority, number> = {
          high: 0,
          medium: 0,
          low: 0,
        };

        const messagesByStage: Record<ProcessingStageType, number> = {
          document_validation: 0,
          s3_upload: 0,
          ocr_extraction: 0,
          data_comparison: 0,
          ai_verification: 0,
        };

        let oldestMessage: Date | undefined;
        let newestMessage: Date | undefined;

        for (const priority of priorities) {
          const queueKey = this.getQueueKey(s, priority);
          const count = await redisClient.zcard(queueKey);

          messagesByPriority[priority] = count;
          totalMessages += count;

          // Get timestamp of oldest and newest messages
          if (count > 0) {
            const oldest = await redisClient.zrange(queueKey, 0, 0, "WITHSCORES");
            const newest = await redisClient.zrange(queueKey, -1, -1, "WITHSCORES");

            if (oldest.length >= 2) {
              const oldestScore = parseFloat(oldest[1]);
              const oldestTime = new Date(oldestScore);
              if (!oldestMessage || oldestTime < oldestMessage) {
                oldestMessage = oldestTime;
              }
            }

            if (newest.length >= 2) {
              const newestScore = parseFloat(newest[1]);
              const newestTime = new Date(newestScore);
              if (!newestMessage || newestTime > newestMessage) {
                newestMessage = newestTime;
              }
            }
          }
        }

        messagesByStage[s] = totalMessages;

        // Calculate average wait time and throughput
        const averageWaitTime = await this.calculateAverageWaitTime(s);
        const throughputPerHour = await this.calculateThroughput(s);

        stats.push({
          queueName: s,
          totalMessages,
          messagesByPriority,
          messagesByStage,
          oldestMessage,
          newestMessage,
          averageWaitTime,
          throughputPerHour,
        });
      }

      return stats;
    } catch (error) {
      this.logger.error("Failed to get queue stats:", error);
      throw error;
    }
  }

  /**
   * Remove message from queue
   */
  async removeMessage(
    messageId: string,
    stage: ProcessingStageType,
    priority: QueuePriority,
  ): Promise<boolean> {
    try {
      const redisClient = redis.getClient();
      const queueKey = this.getQueueKey(stage, priority);
      const messageKey = this.getMessageKey(messageId);

      // Remove from queue
      const removed = await redisClient.zrem(queueKey, messageId);

      // Delete message data
      await redisClient.del(messageKey);

      if (removed > 0) {
        await this.updateQueueMetrics(stage, priority, "removed");
        this.logger.debug(`Message removed: ${messageId} from ${stage}/${priority}`);
      }

      return removed > 0;
    } catch (error) {
      this.logger.error("Failed to remove message:", error);
      throw error;
    }
  }

  /**
   * Move message to dead letter queue
   */
  async moveToDeadLetter(message: QueueMessage, reason: string): Promise<boolean> {
    try {
      const redisClient = redis.getClient();
      const dlqKey = this.getDeadLetterKey();
      const dlqEntryKey = `dlq:${message.id}`;

      const dlqEntry = {
        originalMessage: JSON.stringify(message),
        failureReason: reason,
        failedAt: new Date().toISOString(),
        retryAttempts: message.retryCount,
        lastError: message.lastError || "",
        canRetry: this.canRetry(message, reason),
      };

      // Store DLQ entry
      await redisClient.hset(dlqEntryKey, dlqEntry);
      await redisClient.expire(dlqEntryKey, 30 * 24 * 60 * 60); // 30 days

      // Add to DLQ sorted set
      await redisClient.zadd(dlqKey, Date.now(), message.id);

      // Remove from original queue
      const queueKey = this.getQueueKey(message.stage, message.priority);
      await redisClient.zrem(queueKey, message.id);

      this.logger.warn(`Message moved to DLQ: ${message.id}, reason: ${reason}`);

      return true;
    } catch (error) {
      this.logger.error("Failed to move message to dead letter queue:", error);
      throw error;
    }
  }

  /**
   * Get Redis key for queue
   */
  private getQueueKey(stage: ProcessingStageType, priority: QueuePriority): string {
    return `queue:${stage}:${priority}`;
  }

  /**
   * Get Redis key for message data
   */
  private getMessageKey(messageId: string): string {
    return `message:${messageId}`;
  }

  /**
   * Get Redis key for dead letter queue
   */
  private getDeadLetterKey(): string {
    return "queue:dead_letter";
  }

  /**
   * Calculate score for queue ordering (priority + timestamp)
   */
  private calculateScore(priority: QueuePriority, enqueuedAt: Date): number {
    const priorityWeight = {
      high: 1000000,
      medium: 100000,
      low: 10000,
    };

    // Higher priority gets lower score (processed first)
    // Within same priority, earlier messages get lower score
    const baseScore = Date.now() - enqueuedAt.getTime();
    return baseScore - priorityWeight[priority];
  }

  /**
   * Parse message from Redis hash
   */
  private parseMessage(data: Record<string, string>): QueueMessage {
    return {
      id: data.id,
      documentId: data.documentId,
      stage: data.stage as ProcessingStageType,
      priority: data.priority as QueuePriority,
      enqueuedAt: new Date(data.enqueuedAt),
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
      startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
      completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
      retryCount: parseInt(data.retryCount) || 0,
      maxRetries: parseInt(data.maxRetries) || 3,
      lastError: data.lastError || undefined,
      metadata: JSON.parse(data.metadata || "{}"),
      config: JSON.parse(data.config || "{}"),
    };
  }

  /**
   * Update queue metrics
   */
  private async updateQueueMetrics(
    stage: ProcessingStageType,
    priority: QueuePriority,
    operation: "enqueued" | "dequeued" | "removed",
  ): Promise<void> {
    try {
      const redisClient = redis.getClient();
      const metricsKey = `metrics:queue:${stage}:${priority}`;
      const timestamp = new Date().toISOString();

      await redisClient.hincrby(metricsKey, operation, 1);
      await redisClient.hset(metricsKey, "lastUpdate", timestamp);
      await redisClient.expire(metricsKey, 24 * 60 * 60); // 24 hours
    } catch (error) {
      this.logger.warn("Failed to update queue metrics:", error);
    }
  }

  /**
   * Calculate average wait time for stage
   */
  private async calculateAverageWaitTime(stage: ProcessingStageType): Promise<number> {
    try {
      const redisClient = redis.getClient();
      const avgKey = `avg_wait:${stage}`;
      const avgTime = await redisClient.get(avgKey);
      return avgTime ? parseFloat(avgTime) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Calculate throughput per hour
   */
  private async calculateThroughput(stage: ProcessingStageType): Promise<number> {
    try {
      const redisClient = redis.getClient();
      const throughputKey = `throughput:${stage}`;
      const throughput = await redisClient.get(throughputKey);
      return throughput ? parseFloat(throughput) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Estimate processing time based on queue position and priority
   */
  private estimateProcessingTime(queuePosition: number, priority: QueuePriority): number {
    const baseTimes = {
      high: 30, // 30 seconds base
      medium: 60, // 1 minute base
      low: 120, // 2 minutes base
    };

    return baseTimes[priority] + (queuePosition * 10); // +10 seconds per position
  }

  /**
   * Check if message can be retried
   */
  private canRetry(message: QueueMessage, reason: string): boolean {
    if (message.retryCount >= message.maxRetries) {
      return false;
    }

    // Some errors are not retryable
    const nonRetryableReasons = [
      "invalid_format",
      "file_not_found",
      "unauthorized",
      "quota_exceeded",
    ];

    return !nonRetryableReasons.some((nr) => reason.toLowerCase().includes(nr));
  }

  /**
   * Get pipeline configuration
   */
  getConfig(): PipelineConfig {
    return this.config;
  }

  /**
   * Update pipeline configuration
   */
  updateConfig(newConfig: Partial<PipelineConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info("Pipeline configuration updated");
  }

  /**
   * Clear all queues (development/testing only)
   */
  async clearAllQueues(): Promise<void> {
    try {
      const redisClient = redis.getClient();
      const pattern = "queue:*";

      // Get all queue keys
      const keys = await redisClient.keys(pattern);

      if (keys.length > 0) {
        await redisClient.del(...keys);
        this.logger.info(`Cleared ${keys.length} queue keys`);
      }

      // Also clear message data
      const messagePattern = "message:*";
      const messageKeys = await redisClient.keys(messagePattern);

      if (messageKeys.length > 0) {
        await redisClient.del(...messageKeys);
        this.logger.info(`Cleared ${messageKeys.length} message keys`);
      }
    } catch (error) {
      this.logger.error("Failed to clear queues:", error);
      throw error;
    }
  }

  /**
   * Health check for queue service
   */
  async healthCheck(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    details: {
      redisConnection: boolean;
      totalQueuedMessages: number;
      oldestMessageAge?: number;
      workerCount?: number;
    };
  }> {
    try {
      const redisClient = redis.getClient();

      // Test Redis connection
      await redisClient.ping();

      // Get total queued messages
      const stats = await this.getQueueStats();
      const totalMessages = stats.reduce((sum, s) => sum + s.totalMessages, 0);

      // Find oldest message
      let oldestMessageAge: number | undefined;
      for (const stat of stats) {
        if (stat.oldestMessage) {
          const age = Date.now() - stat.oldestMessage.getTime();
          if (!oldestMessageAge || age > oldestMessageAge) {
            oldestMessageAge = age;
          }
        }
      }

      // Determine health status
      let status: "healthy" | "degraded" | "unhealthy" = "healthy";

      if (totalMessages > this.config.maxQueueSize * 0.8) {
        status = "degraded";
      }

      if (
        totalMessages >= this.config.maxQueueSize ||
        (oldestMessageAge && oldestMessageAge > 30 * 60 * 1000)
      ) {
        status = "unhealthy";
      }

      return {
        status,
        details: {
          redisConnection: true,
          totalQueuedMessages: totalMessages,
          oldestMessageAge: oldestMessageAge ? Math.round(oldestMessageAge / 1000) : undefined,
        },
      };
    } catch (error) {
      this.logger.error("Queue health check failed:", error);
      return {
        status: "unhealthy",
        details: {
          redisConnection: false,
          totalQueuedMessages: 0,
        },
      };
    }
  }
}

export const queueService = new QueueService();
