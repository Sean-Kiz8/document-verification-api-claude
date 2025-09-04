/**
 * Enhanced Rate Limiting Service
 * Sliding window rate limiting with abuse detection and premium features
 */

import { log } from "@/deps.ts";
import { redis } from "@config/redis.ts";
import type {
  AbusePattern,
  ApiKeyTier,
  RateLimitConfig,
  RateLimitMetrics,
  RateLimitOperation,
  RateLimitResult,
  RateLimitStatus,
  RateLimitViolation,
  RateLimitWindow,
  SlidingWindow,
} from "@models/rate_limiting.ts";
import type { ApiKey } from "@models/api_key.ts";

/**
 * Default rate limit configurations
 */
const DEFAULT_RATE_LIMITS: Record<RateLimitOperation, RateLimitConfig> = {
  document_upload: {
    operation: "document_upload",
    limits: { perMinute: 10, perHour: 100, perDay: 1000 },
    slidingWindowSize: 60,
    burstAllowance: 3,
  },
  status_check: {
    operation: "status_check",
    limits: { perMinute: 60, perHour: 600, perDay: 5000 },
    slidingWindowSize: 60,
    burstAllowance: 10,
  },
  results_retrieval: {
    operation: "results_retrieval",
    limits: { perMinute: 30, perHour: 300, perDay: 2000 },
    slidingWindowSize: 60,
    burstAllowance: 5,
  },
  api_key_creation: {
    operation: "api_key_creation",
    limits: { perMinute: 2, perHour: 10, perDay: 50 },
    slidingWindowSize: 60,
    burstAllowance: 0,
  },
  general_api: {
    operation: "general_api",
    limits: { perMinute: 100, perHour: 1000, perDay: 10000 },
    slidingWindowSize: 60,
    burstAllowance: 20,
  },
};

/**
 * API key tiers for different limits
 */
const API_KEY_TIERS: Record<string, ApiKeyTier> = {
  basic: {
    name: "basic",
    multiplier: 1.0,
    burstAllowance: 1,
    premiumFeatures: [],
    bypassAbuse: false,
  },
  premium: {
    name: "premium",
    multiplier: 5.0,
    burstAllowance: 3,
    premiumFeatures: ["higher_limits", "priority_processing"],
    bypassAbuse: false,
  },
  enterprise: {
    name: "enterprise",
    multiplier: 20.0,
    burstAllowance: 10,
    premiumFeatures: ["higher_limits", "priority_processing", "dedicated_support"],
    bypassAbuse: true,
  },
};

/**
 * Abuse detection patterns
 */
const ABUSE_PATTERNS: AbusePattern[] = [
  {
    type: "burst_requests",
    severity: "high",
    description: "Too many requests in short burst",
    threshold: 50, // requests
    window: 30, // 30 seconds
    cooldownDuration: 300, // 5 minutes
  },
  {
    type: "sustained_high_rate",
    severity: "medium",
    description: "Sustained high request rate",
    threshold: 200, // requests
    window: 300, // 5 minutes
    cooldownDuration: 900, // 15 minutes
  },
  {
    type: "error_rate_spike",
    severity: "high",
    description: "High rate of error responses",
    threshold: 20, // error responses
    window: 60, // 1 minute
    cooldownDuration: 600, // 10 minutes
  },
];

class EnhancedRateLimitingService {
  private logger = log.getLogger();
  private configs: Map<RateLimitOperation, RateLimitConfig> = new Map();
  private violations: Map<string, RateLimitViolation[]> = new Map();

  constructor() {
    // Load default configurations
    for (const [operation, config] of Object.entries(DEFAULT_RATE_LIMITS)) {
      this.configs.set(operation as RateLimitOperation, config);
    }
  }

  /**
   * Check rate limit for API key and operation
   */
  async checkRateLimit(
    apiKey: ApiKey,
    operation: RateLimitOperation,
    requestContext: {
      endpoint: string;
      userAgent: string | undefined;
      ipAddress: string | undefined;
      requestId: string;
    },
  ): Promise<RateLimitResult> {
    try {
      // Get API key tier
      const tier = this.getApiKeyTier(apiKey);

      // Check if in cooldown from abuse detection
      const cooldownCheck = await this.checkCooldown(apiKey.id);
      if (cooldownCheck.inCooldown && !tier.bypassAbuse) {
        return this.createCooldownResult(apiKey.id, operation, cooldownCheck, requestContext);
      }

      // Get rate limit configuration with tier adjustments
      const config = this.getAdjustedConfig(operation, tier);

      // Check sliding window limits
      const status = await this.checkSlidingWindow(apiKey.id, operation, config);

      // Create HTTP headers
      const headers = this.createRateLimitHeaders(status);

      // Check for abuse patterns
      if (status.isLimited) {
        await this.checkAbusePatterns(apiKey.id, operation, status, requestContext);
      }

      // Record metrics
      await this.recordMetrics(apiKey.id, operation, status, !status.isLimited);

      if (status.isLimited) {
        // Create violation record
        const violation = await this.createViolation(apiKey.id, operation, status, requestContext);

        return {
          allowed: false,
          status,
          headers: {
            ...headers,
            "Retry-After": status.retryAfter?.toString() || "60",
          },
          violation,
        };
      }

      return {
        allowed: true,
        status,
        headers,
      };
    } catch (error) {
      this.logger.error("Rate limit check failed:", error);

      // Fail open - allow request if rate limiting fails
      return {
        allowed: true,
        status: this.createErrorStatus(apiKey.id, operation),
        headers: {},
      };
    }
  }

  /**
   * Check sliding window rate limits
   */
  private async checkSlidingWindow(
    apiKeyId: string,
    operation: RateLimitOperation,
    config: RateLimitConfig,
  ): Promise<RateLimitStatus> {
    const now = new Date();
    const redisClient = redis.getClient();

    // Generate window keys
    const minuteWindow = this.generateWindowKey(now, "minute");
    const hourWindow = this.generateWindowKey(now, "hour");
    const dayWindow = this.generateWindowKey(now, "day");

    const windows = {
      minute: minuteWindow,
      hour: hourWindow,
      day: dayWindow,
    };

    // Get current usage for all windows
    const [minuteUsage, hourUsage, dayUsage] = await Promise.all([
      this.getSlidingWindowUsage(apiKeyId, operation, "minute", now),
      this.getSlidingWindowUsage(apiKeyId, operation, "hour", now),
      this.getSlidingWindowUsage(apiKeyId, operation, "day", now),
    ]);

    const currentUsage = {
      perMinute: minuteUsage.currentRequests,
      perHour: hourUsage.currentRequests,
      perDay: dayUsage.currentRequests,
    };

    const remaining = {
      perMinute: Math.max(0, config.limits.perMinute - currentUsage.perMinute),
      perHour: Math.max(0, config.limits.perHour - currentUsage.perHour),
      perDay: Math.max(0, config.limits.perDay - currentUsage.perDay),
    };

    // Check if any limit is exceeded
    const isLimited = remaining.perMinute <= 0 || remaining.perHour <= 0 || remaining.perDay <= 0;
    let limitType: RateLimitWindow | undefined;
    let resetTime: Date | undefined;
    let retryAfter: number | undefined;

    if (isLimited) {
      if (remaining.perMinute <= 0) {
        limitType = "minute";
        resetTime = new Date(now.getTime() + (60 - now.getSeconds()) * 1000);
        retryAfter = 60 - now.getSeconds();
      } else if (remaining.perHour <= 0) {
        limitType = "hour";
        const minutesToHour = 60 - now.getMinutes();
        resetTime = new Date(now.getTime() + minutesToHour * 60 * 1000);
        retryAfter = minutesToHour * 60;
      } else {
        limitType = "day";
        const hoursToDay = 24 - now.getHours();
        resetTime = new Date(now.getTime() + hoursToDay * 60 * 60 * 1000);
        retryAfter = hoursToDay * 3600;
      }
    } else {
      // Increment counters if not limited
      await this.incrementSlidingWindow(apiKeyId, operation, now);
    }

    return {
      operation,
      apiKeyId,
      currentUsage,
      limits: config.limits,
      remaining,
      windows,
      isLimited,
      limitType,
      resetTime,
      retryAfter,
      abuseDetected: false, // Will be set by abuse detection
      cooldownUntil: undefined,
    };
  }

  /**
   * Get sliding window usage for specific timeframe
   */
  private async getSlidingWindowUsage(
    apiKeyId: string,
    operation: RateLimitOperation,
    window: RateLimitWindow,
    now: Date,
  ): Promise<SlidingWindow> {
    try {
      const redisClient = redis.getClient();
      const windowKey = `rate_limit:sliding:${apiKeyId}:${operation}:${window}`;

      // Get window size in seconds
      const windowSize = window === "minute" ? 60 : window === "hour" ? 3600 : 86400;
      const cutoffTime = now.getTime() - (windowSize * 1000);

      // Remove expired entries and count current
      await redisClient.zremrangebyscore(windowKey, 0, cutoffTime);
      const currentRequests = await redisClient.zcard(windowKey);

      // Get oldest and newest request timestamps
      const range = await redisClient.zrange(windowKey, 0, -1, { withScore: true });

      let oldestRequest: Date | undefined;
      let newestRequest: Date | undefined;

      if (Array.isArray(range) && range.length >= 2) {
        const firstScore = range[1];
        if (typeof firstScore === "string") {
          oldestRequest = new Date(parseFloat(firstScore));
        }
        if (range.length >= 4) {
          const lastScore = range[range.length - 1];
          if (typeof lastScore === "string") {
            newestRequest = new Date(parseFloat(lastScore));
          }
        }
      }

      const config = this.configs.get(operation);
      const maxRequests = config ? this.getWindowLimit(config, window) : 100;

      return {
        key: windowKey,
        windowSize,
        maxRequests,
        currentRequests,
        oldestRequest,
        newestRequest,
        isLimited: currentRequests >= maxRequests,
      };
    } catch (error) {
      this.logger.warn("Failed to get sliding window usage:", error);
      return {
        key: "",
        windowSize: 60,
        maxRequests: 100,
        currentRequests: 0,
        oldestRequest: undefined,
        newestRequest: undefined,
        isLimited: false,
      };
    }
  }

  /**
   * Increment sliding window counter
   */
  private async incrementSlidingWindow(
    apiKeyId: string,
    operation: RateLimitOperation,
    timestamp: Date,
  ): Promise<void> {
    try {
      const redisClient = redis.getClient();
      const score = timestamp.getTime();
      const member = `${timestamp.getTime()}_${crypto.randomUUID()}`;

      // Increment all windows
      const windows: RateLimitWindow[] = ["minute", "hour", "day"];

      for (const window of windows) {
        const windowKey = `rate_limit:sliding:${apiKeyId}:${operation}:${window}`;

        // Add current request
        await redisClient.zadd(windowKey, score, member);

        // Set expiration for cleanup
        const windowSize = window === "minute" ? 120 : window === "hour" ? 7200 : 172800;
        await redisClient.expire(windowKey, windowSize);
      }
    } catch (error) {
      this.logger.warn("Failed to increment sliding window:", error);
    }
  }

  /**
   * Check abuse patterns
   */
  private async checkAbusePatterns(
    apiKeyId: string,
    operation: RateLimitOperation,
    status: RateLimitStatus,
    requestContext: {
      endpoint: string;
      userAgent: string | undefined;
      ipAddress: string | undefined;
      requestId: string;
    },
  ): Promise<boolean> {
    try {
      for (const pattern of ABUSE_PATTERNS) {
        const isAbuse = await this.detectAbusePattern(apiKeyId, pattern, requestContext);

        if (isAbuse) {
          // Apply cooldown
          await this.applyCooldown(apiKeyId, pattern);

          // Log abuse detection
          await this.logAbuseDetection(apiKeyId, pattern, requestContext);

          status.abuseDetected = true;
          status.cooldownUntil = new Date(Date.now() + pattern.cooldownDuration * 1000);

          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger.error("Abuse pattern check failed:", error);
      return false;
    }
  }

  /**
   * Detect specific abuse pattern
   */
  private async detectAbusePattern(
    apiKeyId: string,
    pattern: AbusePattern,
    requestContext: any,
  ): Promise<boolean> {
    try {
      const redisClient = redis.getClient();
      const now = Date.now();
      const cutoffTime = now - (pattern.window * 1000);

      switch (pattern.type) {
        case "burst_requests": {
          // Check if too many requests in short window
          const burstKey = `abuse:burst:${apiKeyId}`;
          await redisClient.zremrangebyscore(burstKey, 0, cutoffTime);
          const burstCount = await redisClient.zcard(burstKey);

          if (burstCount >= pattern.threshold) {
            return true;
          }

          // Add current request
          await redisClient.zadd(burstKey, now, `${now}_${crypto.randomUUID()}`);
          await redisClient.expire(burstKey, pattern.window);
          break;
        }

        case "error_rate_spike": {
          // Check error rate (would need error tracking)
          const errorKey = `abuse:errors:${apiKeyId}`;
          await redisClient.zremrangebyscore(errorKey, 0, cutoffTime);
          const errorCount = await redisClient.zcard(errorKey);

          return errorCount >= pattern.threshold;
        }

        case "sustained_high_rate": {
          // Check sustained high rate over longer period
          const sustainedKey = `abuse:sustained:${apiKeyId}`;
          await redisClient.zremrangebyscore(sustainedKey, 0, cutoffTime);
          const requestCount = await redisClient.zcard(sustainedKey);

          if (requestCount >= pattern.threshold) {
            return true;
          }

          // Add current request
          await redisClient.zadd(sustainedKey, now, `${now}_${crypto.randomUUID()}`);
          await redisClient.expire(sustainedKey, pattern.window);
          break;
        }
      }

      return false;
    } catch (error) {
      this.logger.warn("Abuse pattern detection failed:", error);
      return false;
    }
  }

  /**
   * Check if API key is in cooldown
   */
  private async checkCooldown(apiKeyId: string): Promise<{
    inCooldown: boolean;
    cooldownUntil?: Date;
    reason?: string;
  }> {
    try {
      const redisClient = redis.getClient();
      const cooldownKey = `cooldown:${apiKeyId}`;

      const cooldownData = await redisClient.hgetall(cooldownKey) as unknown as Record<
        string,
        string
      >;

      if (cooldownData.until) {
        const cooldownUntil = new Date(cooldownData.until);
        const now = new Date();

        if (cooldownUntil > now) {
          return {
            inCooldown: true,
            cooldownUntil,
            reason: cooldownData.reason || "Abuse detected",
          };
        } else {
          // Cleanup expired cooldown
          await redisClient.del(cooldownKey);
        }
      }

      return { inCooldown: false };
    } catch (error) {
      this.logger.warn("Cooldown check failed:", error);
      return { inCooldown: false };
    }
  }

  /**
   * Apply cooldown period
   */
  private async applyCooldown(apiKeyId: string, pattern: AbusePattern): Promise<void> {
    try {
      const redisClient = redis.getClient();
      const cooldownKey = `cooldown:${apiKeyId}`;
      const cooldownUntil = new Date(Date.now() + pattern.cooldownDuration * 1000);

      await redisClient.hset(cooldownKey, {
        until: cooldownUntil.toISOString(),
        reason: pattern.description,
        type: pattern.type,
        severity: pattern.severity,
        appliedAt: new Date().toISOString(),
      });

      await redisClient.expire(cooldownKey, pattern.cooldownDuration);

      this.logger.warn(
        `Cooldown applied to API key ${apiKeyId}: ${pattern.description} (${pattern.cooldownDuration}s)`,
      );
    } catch (error) {
      this.logger.error("Failed to apply cooldown:", error);
    }
  }

  /**
   * Get API key tier based on permissions and metadata
   */
  private getApiKeyTier(apiKey: ApiKey): ApiKeyTier {
    // Check if API key has premium permissions
    if (apiKey.permissions.includes("enterprise")) {
      return API_KEY_TIERS.enterprise!;
    }

    if (apiKey.permissions.includes("premium")) {
      return API_KEY_TIERS.premium!;
    }

    return API_KEY_TIERS.basic!;
  }

  /**
   * Get adjusted configuration based on API key tier
   */
  private getAdjustedConfig(operation: RateLimitOperation, tier: ApiKeyTier): RateLimitConfig {
    const baseConfig = this.configs.get(operation) || DEFAULT_RATE_LIMITS.general_api;

    return {
      ...baseConfig,
      limits: {
        perMinute: Math.floor(baseConfig.limits.perMinute * tier.multiplier),
        perHour: Math.floor(baseConfig.limits.perHour * tier.multiplier),
        perDay: Math.floor(baseConfig.limits.perDay * tier.multiplier),
      },
      burstAllowance: baseConfig.burstAllowance + tier.burstAllowance,
    };
  }

  /**
   * Generate window key for time-based grouping
   */
  private generateWindowKey(date: Date, window: RateLimitWindow): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    const hour = date.getHours().toString().padStart(2, "0");
    const minute = date.getMinutes().toString().padStart(2, "0");

    switch (window) {
      case "minute":
        return `${year}-${month}-${day}-${hour}-${minute}`;
      case "hour":
        return `${year}-${month}-${day}-${hour}`;
      case "day":
        return `${year}-${month}-${day}`;
    }
  }

  /**
   * Get window limit based on configuration
   */
  private getWindowLimit(config: RateLimitConfig, window: RateLimitWindow): number {
    switch (window) {
      case "minute":
        return config.limits.perMinute;
      case "hour":
        return config.limits.perHour;
      case "day":
        return config.limits.perDay;
    }
  }

  /**
   * Create rate limit HTTP headers
   */
  private createRateLimitHeaders(status: RateLimitStatus): Record<string, string> {
    return {
      "X-RateLimit-Limit-Minute": status.limits.perMinute.toString(),
      "X-RateLimit-Limit-Hour": status.limits.perHour.toString(),
      "X-RateLimit-Limit-Day": status.limits.perDay.toString(),
      "X-RateLimit-Remaining-Minute": status.remaining.perMinute.toString(),
      "X-RateLimit-Remaining-Hour": status.remaining.perHour.toString(),
      "X-RateLimit-Remaining-Day": status.remaining.perDay.toString(),
      "X-RateLimit-Reset": status.resetTime?.toISOString() || "",
      "X-RateLimit-Operation": status.operation,
    };
  }

  /**
   * Create violation record
   */
  private async createViolation(
    apiKeyId: string,
    operation: RateLimitOperation,
    status: RateLimitStatus,
    requestContext: any,
  ): Promise<RateLimitViolation> {
    const violation: RateLimitViolation = {
      id: crypto.randomUUID(),
      apiKeyId,
      operation,
      violationType: status.abuseDetected ? "abuse_detected" : "rate_limit_exceeded",
      timestamp: new Date(),
      requestDetails: requestContext,
      limitStatus: status,
      severity: status.abuseDetected ? "high" : "medium",
      actionTaken: status.abuseDetected ? "cooldown_applied" : "blocked",
    };

    // Store violation (in memory for now, could be persisted)
    if (!this.violations.has(apiKeyId)) {
      this.violations.set(apiKeyId, []);
    }
    this.violations.get(apiKeyId)!.push(violation);

    // Log violation
    this.logger.warn(`Rate limit violation: ${violation.id}`, {
      apiKeyId,
      operation,
      violationType: violation.violationType,
      endpoint: requestContext.endpoint,
    });

    return violation;
  }

  /**
   * Create cooldown result
   */
  private createCooldownResult(
    apiKeyId: string,
    operation: RateLimitOperation,
    cooldownInfo: { cooldownUntil?: Date; reason?: string },
    requestContext: any,
  ): RateLimitResult {
    const now = new Date();
    const retryAfter = cooldownInfo.cooldownUntil
      ? Math.ceil((cooldownInfo.cooldownUntil.getTime() - now.getTime()) / 1000)
      : 300;

    const status: RateLimitStatus = {
      operation,
      apiKeyId,
      currentUsage: { perMinute: 0, perHour: 0, perDay: 0 },
      limits: { perMinute: 0, perHour: 0, perDay: 0 },
      remaining: { perMinute: 0, perHour: 0, perDay: 0 },
      windows: { minute: "", hour: "", day: "" },
      isLimited: true,
      limitType: undefined,
      resetTime: undefined,
      abuseDetected: true,
      cooldownUntil: cooldownInfo.cooldownUntil,
      retryAfter,
    };

    return {
      allowed: false,
      status,
      headers: {
        "X-RateLimit-Cooldown": "true",
        "X-RateLimit-Cooldown-Reason": cooldownInfo.reason || "Abuse detected",
        "X-RateLimit-Cooldown-Until": cooldownInfo.cooldownUntil?.toISOString() || "",
        "Retry-After": retryAfter.toString(),
      },
    };
  }

  /**
   * Create error status for fallback
   */
  private createErrorStatus(apiKeyId: string, operation: RateLimitOperation): RateLimitStatus {
    const config = this.configs.get(operation) || DEFAULT_RATE_LIMITS.general_api;

    return {
      operation,
      apiKeyId,
      currentUsage: { perMinute: 0, perHour: 0, perDay: 0 },
      limits: config.limits,
      remaining: config.limits,
      windows: { minute: "", hour: "", day: "" },
      isLimited: false,
      limitType: undefined,
      resetTime: undefined,
      retryAfter: undefined,
      abuseDetected: false,
      cooldownUntil: undefined,
    };
  }

  /**
   * Record metrics for monitoring
   */
  private async recordMetrics(
    apiKeyId: string,
    operation: RateLimitOperation,
    status: RateLimitStatus,
    allowed: boolean,
  ): Promise<void> {
    try {
      const redisClient = redis.getClient();
      const now = new Date();
      const metricsKey = `metrics:rate_limit:${operation}:${this.generateWindowKey(now, "minute")}`;

      // Increment metrics
      await redisClient.hincrby(metricsKey, "total_requests", 1);

      if (allowed) {
        await redisClient.hincrby(metricsKey, "allowed_requests", 1);
      } else {
        await redisClient.hincrby(metricsKey, "blocked_requests", 1);
      }

      if (status.abuseDetected) {
        await redisClient.hincrby(metricsKey, "abuse_detections", 1);
      }

      // Set expiration
      await redisClient.expire(metricsKey, 3600); // 1 hour
    } catch (error) {
      this.logger.warn("Failed to record rate limit metrics:", error);
    }
  }

  /**
   * Log abuse detection
   */
  private async logAbuseDetection(
    apiKeyId: string,
    pattern: AbusePattern,
    requestContext: any,
  ): Promise<void> {
    try {
      this.logger.warn(`Abuse detected for API key ${apiKeyId}:`, {
        type: pattern.type,
        severity: pattern.severity,
        description: pattern.description,
        endpoint: requestContext.endpoint,
        userAgent: requestContext.userAgent,
        ipAddress: requestContext.ipAddress,
        cooldownDuration: pattern.cooldownDuration,
      });
    } catch (error) {
      this.logger.warn("Failed to log abuse detection:", error);
    }
  }

  /**
   * Get rate limit metrics for monitoring
   */
  async getMetrics(
    operation?: RateLimitOperation,
    timeWindow?: string,
  ): Promise<RateLimitMetrics[]> {
    try {
      const redisClient = redis.getClient();
      const operations = operation
        ? [operation]
        : Object.keys(DEFAULT_RATE_LIMITS) as RateLimitOperation[];
      const metrics: RateLimitMetrics[] = [];

      for (const op of operations) {
        const currentWindow = timeWindow || this.generateWindowKey(new Date(), "minute");
        const metricsKey = `metrics:rate_limit:${op}:${currentWindow}`;

        const data = await redisClient.hgetall(metricsKey) as unknown as Record<string, string>;

        const totalRequests = parseInt(data.total_requests || "0");
        const blockedRequests = parseInt(data.blocked_requests || "0");
        const allowedRequests = parseInt(data.allowed_requests || "0");
        const abuseDetections = parseInt(data.abuse_detections || "0");

        metrics.push({
          operation: op,
          timeWindow: currentWindow,
          totalRequests,
          blockedRequests,
          allowedRequests,
          averageRequestRate: totalRequests, // per minute
          peakRequestRate: totalRequests, // simplified
          abuseDetections,
          cooldownsApplied: abuseDetections, // simplified
          uniqueApiKeys: 1, // would need additional tracking
          topConsumers: [], // would need additional tracking
        });
      }

      return metrics;
    } catch (error) {
      this.logger.error("Failed to get rate limit metrics:", error);
      return [];
    }
  }

  /**
   * Get violations for API key
   */
  getViolations(apiKeyId: string): RateLimitViolation[] {
    return this.violations.get(apiKeyId) || [];
  }

  /**
   * Clear all rate limit data (development/testing only)
   */
  async clearAllData(): Promise<void> {
    try {
      const redisClient = redis.getClient();

      const patterns = [
        "rate_limit:sliding:*",
        "cooldown:*",
        "abuse:*",
        "metrics:rate_limit:*",
      ];

      for (const pattern of patterns) {
        const keys = await redisClient.keys(pattern);
        if (keys.length > 0) {
          await redisClient.del(...keys);
          this.logger.info(`Cleared ${keys.length} keys for pattern: ${pattern}`);
        }
      }

      // Clear in-memory data
      this.violations.clear();

      this.logger.info("Rate limiting data cleared");
    } catch (error) {
      this.logger.error("Failed to clear rate limiting data:", error);
      throw error;
    }
  }
}

export const rateLimitingService = new EnhancedRateLimitingService();
export { ABUSE_PATTERNS, API_KEY_TIERS, DEFAULT_RATE_LIMITS };
