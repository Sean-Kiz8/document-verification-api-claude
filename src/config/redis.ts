/**
 * Redis Configuration
 * Manages Redis connection for caching and rate limiting
 */

import { connectRedis } from "@/deps.ts";
import type { Redis } from "@/deps.ts";
import { getConfig } from "@config/env.ts";
import { log } from "@/deps.ts";

/**
 * Redis configuration interface
 */
export interface RedisConfig {
  url: string;
  maxRetryAttempts: number;
  retryDelayMs: number;
}

/**
 * Redis health information
 */
export interface RedisHealth {
  status: "healthy" | "unhealthy";
  latency?: number;
  lastCheck: string;
  connectionCount?: number;
}

class RedisManager {
  private client: Redis | null = null;
  private config: RedisConfig | null = null;
  private logger = log.getLogger();
  private healthInfo: RedisHealth = {
    status: "unhealthy",
    lastCheck: new Date().toISOString(),
  };

  /**
   * Initialize Redis connection
   */
  async initialize(): Promise<void> {
    if (this.client) {
      this.logger.warn("Redis client already initialized");
      return;
    }

    try {
      const appConfig = await getConfig();

      this.config = {
        url: appConfig.redisUrl,
        maxRetryAttempts: 3,
        retryDelayMs: 1000,
      };

      // Validate configuration
      this.validateConfig();

      // Connect to Redis
      const redisConfig = this.parseRedisUrl();
      const connectionOptions: any = {
        hostname: redisConfig.hostname,
        port: redisConfig.port,
      };

      if (redisConfig.password) {
        connectionOptions.password = redisConfig.password;
      }

      if (redisConfig.database !== undefined) {
        connectionOptions.db = redisConfig.database;
      }

      this.client = await connectRedis(connectionOptions);

      // Test connection
      await this.testConnection();

      this.logger.info("Redis client initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize Redis client:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Redis initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Validate Redis configuration
   */
  private validateConfig(): void {
    if (!this.config || !this.config.url) {
      throw new Error("Redis URL not configured");
    }

    try {
      new URL(this.config.url);
    } catch {
      throw new Error("Invalid Redis URL format");
    }
  }

  /**
   * Parse Redis URL
   */
  private parseRedisUrl(): {
    hostname: string;
    port: number;
    password: string | undefined;
    database: number | undefined;
  } {
    if (!this.config) {
      throw new Error("Redis configuration not loaded");
    }

    const url = new URL(this.config.url);

    return {
      hostname: url.hostname,
      port: url.port ? parseInt(url.port) : 6379,
      password: url.password || undefined,
      database: url.pathname && url.pathname !== "/" ? parseInt(url.pathname.slice(1)) : undefined,
    };
  }

  /**
   * Test Redis connection
   */
  private async testConnection(): Promise<void> {
    if (!this.client) {
      throw new Error("Redis client not initialized");
    }

    try {
      const startTime = Date.now();
      await this.client.ping();
      const latency = Date.now() - startTime;

      this.healthInfo = {
        status: "healthy",
        latency,
        lastCheck: new Date().toISOString(),
      };

      this.logger.info(`Redis connection test successful (${latency}ms)`);
    } catch (error) {
      this.healthInfo = {
        status: "unhealthy",
        lastCheck: new Date().toISOString(),
      };

      this.logger.error("Redis connection test failed:", error);
      throw error;
    }
  }

  /**
   * Get Redis client instance
   */
  getClient(): Redis {
    if (!this.client) {
      throw new Error("Redis client not initialized. Call initialize() first.");
    }
    return this.client;
  }

  /**
   * Get Redis health information
   */
  async getHealthInfo(): Promise<RedisHealth> {
    if (!this.client) {
      return {
        status: "unhealthy",
        lastCheck: new Date().toISOString(),
      };
    }

    try {
      const startTime = Date.now();
      await this.client.ping();
      const latency = Date.now() - startTime;

      this.healthInfo = {
        status: "healthy",
        latency,
        lastCheck: new Date().toISOString(),
      };

      return this.healthInfo;
    } catch (error) {
      this.logger.error("Redis health check failed:", error);

      this.healthInfo = {
        status: "unhealthy",
        lastCheck: new Date().toISOString(),
      };

      return this.healthInfo;
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
        this.client = null;
        this.logger.info("Redis connection closed");
      } catch (error) {
        this.logger.error("Error closing Redis connection:", error);
      }
    }
  }
}

// Global Redis manager instance
const redisManager = new RedisManager();

export { redisManager as redis };

/**
 * Initialize Redis connection
 */
export async function initializeRedis(): Promise<void> {
  await redisManager.initialize();
}

/**
 * Get Redis client for direct access
 */
export function getRedisClient(): Redis {
  return redisManager.getClient();
}

/**
 * Get Redis health information
 */
export async function getRedisHealth(): Promise<RedisHealth> {
  return redisManager.getHealthInfo();
}
