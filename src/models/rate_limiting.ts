/**
 * Rate Limiting Models and Types
 * Enhanced rate limiting with sliding windows and abuse protection
 */

/**
 * Rate limit operation types
 */
export type RateLimitOperation =
  | "document_upload"
  | "status_check"
  | "results_retrieval"
  | "api_key_creation"
  | "general_api";

/**
 * Rate limit window types
 */
export type RateLimitWindow = "minute" | "hour" | "day";

/**
 * Rate limit configuration for different operations
 */
export interface RateLimitConfig {
  operation: RateLimitOperation;
  limits: {
    perMinute: number;
    perHour: number;
    perDay: number;
  };
  slidingWindowSize: number; // in seconds
  burstAllowance: number; // additional requests allowed in burst
}

/**
 * Rate limit status information
 */
export interface RateLimitStatus {
  operation: RateLimitOperation;
  apiKeyId: string;

  // Current usage
  currentUsage: {
    perMinute: number;
    perHour: number;
    perDay: number;
  };

  // Limits
  limits: {
    perMinute: number;
    perHour: number;
    perDay: number;
  };

  // Remaining requests
  remaining: {
    perMinute: number;
    perHour: number;
    perDay: number;
  };

  // Window information
  windows: {
    minute: string;
    hour: string;
    day: string;
  };

  // Status
  isLimited: boolean;
  limitType: RateLimitWindow | undefined;
  resetTime: Date | undefined;
  retryAfter: number | undefined; // seconds until can retry

  // Abuse detection
  abuseDetected: boolean;
  cooldownUntil: Date | undefined;
}

/**
 * Abuse detection pattern
 */
export interface AbusePattern {
  type: "burst_requests" | "sustained_high_rate" | "error_rate_spike" | "suspicious_pattern";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  threshold: number;
  window: number; // in seconds
  cooldownDuration: number; // in seconds
}

/**
 * API key tier for rate limiting
 */
export interface ApiKeyTier {
  name: string;
  multiplier: number; // multiplier for base limits
  burstAllowance: number;
  premiumFeatures: string[];
  bypassAbuse: boolean;
}

/**
 * Rate limit violation event
 */
export interface RateLimitViolation {
  id: string;
  apiKeyId: string;
  operation: RateLimitOperation;
  violationType: "rate_limit_exceeded" | "abuse_detected" | "quota_exhausted";
  timestamp: Date;
  requestDetails: {
    endpoint: string;
    userAgent?: string;
    ipAddress?: string;
    requestId: string;
  };
  limitStatus: RateLimitStatus;
  severity: "low" | "medium" | "high";
  actionTaken: "blocked" | "throttled" | "flagged" | "cooldown_applied";
}

/**
 * Rate limit metrics
 */
export interface RateLimitMetrics {
  operation: RateLimitOperation;
  timeWindow: string;

  // Request statistics
  totalRequests: number;
  blockedRequests: number;
  allowedRequests: number;

  // Performance metrics
  averageRequestRate: number; // requests per minute
  peakRequestRate: number;

  // Abuse metrics
  abuseDetections: number;
  cooldownsApplied: number;

  // API key distribution
  uniqueApiKeys: number;
  topConsumers: Array<{
    apiKeyId: string;
    requestCount: number;
    violationCount: number;
  }>;
}

/**
 * Sliding window implementation
 */
export interface SlidingWindow {
  key: string;
  windowSize: number; // in seconds
  maxRequests: number;
  currentRequests: number;
  oldestRequest: Date | undefined;
  newestRequest: Date | undefined;
  isLimited: boolean;
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  allowed: boolean;
  status: RateLimitStatus;
  headers: Record<string, string>;
  violation?: RateLimitViolation;
}
