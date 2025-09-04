/**
 * Enhanced Rate Limiting Middleware
 * Sliding window rate limiting with abuse detection and premium features
 */

import type { Context, Middleware } from "@/deps.ts";
import { log } from "@/deps.ts";
import { rateLimitingService } from "@services/rate_limiting_service.ts";
import type { AuthContext } from "@middleware/auth.ts";
import type { RateLimitOperation } from "@models/rate_limiting.ts";

/**
 * Enhanced rate limiting middleware
 */
export function enhancedRateLimit(
  operation: RateLimitOperation,
  options: {
    skipForPremium?: boolean;
    customLimits?: {
      perMinute?: number;
      perHour?: number;
      perDay?: number;
    };
    abuseDetection?: boolean;
  } = {},
): Middleware {
  const logger = log.getLogger();

  return async (ctx: AuthContext, next) => {
    try {
      // Skip rate limiting if no authenticated user
      if (!ctx.auth?.apiKey) {
        await next();
        return;
      }

      // Extract request context
      const userAgent = ctx.request.headers.get("user-agent");
      const ipAddress = (ctx.request as any).ip;

      const requestContext: {
        endpoint: string;
        userAgent: string | undefined;
        ipAddress: string | undefined;
        requestId: string;
      } = {
        endpoint: `${ctx.request.method} ${ctx.request.url.pathname}`,
        userAgent: userAgent || undefined,
        ipAddress: ipAddress || undefined,
        requestId: ctx.auth.requestId,
      };

      // Check rate limits
      const result = await rateLimitingService.checkRateLimit(
        ctx.auth.apiKey,
        operation,
        requestContext,
      );

      // Add rate limit headers to response
      for (const [header, value] of Object.entries(result.headers)) {
        ctx.response.headers.set(header, value);
      }

      if (!result.allowed) {
        logger.warn(
          `Rate limit exceeded for API key ${ctx.auth.apiKey.keyPrefix}*** on ${operation}`,
        );

        // Determine status code
        const statusCode = result.status.abuseDetected ? 429 : 429; // Always 429 for rate limits

        // Create error response
        ctx.response.status = statusCode;
        ctx.response.body = {
          status: "error",
          error: {
            code: result.status.abuseDetected ? "ABUSE_DETECTED" : "RATE_LIMIT_EXCEEDED",
            message: result.status.abuseDetected
              ? `API key has been temporarily suspended due to abuse detection until: ${result.status.cooldownUntil?.toISOString()}`
              : `Rate limit exceeded for ${operation}. Check X-RateLimit headers for details.`,
            details: {
              operation,
              limitType: result.status.limitType,
              retryAfter: result.status.retryAfter,
              resetTime: result.status.resetTime?.toISOString(),
              currentUsage: result.status.currentUsage,
              limits: result.status.limits,
              remaining: result.status.remaining,
              abuseDetected: result.status.abuseDetected,
              cooldownUntil: result.status.cooldownUntil?.toISOString(),
            },
          },
          meta: {
            request_id: requestContext.requestId,
            timestamp: new Date().toISOString(),
            version: "v1",
          },
        };

        return;
      }

      // Rate limit passed, continue to next middleware
      await next();
    } catch (error) {
      logger.error("Enhanced rate limiting middleware error:", error);

      // Fail open - allow request if rate limiting fails
      await next();
    }
  };
}

/**
 * Operation-specific rate limiting middleware creators
 */
export const documentUploadRateLimit = () =>
  enhancedRateLimit("document_upload", {
    abuseDetection: true,
  });

export const statusCheckRateLimit = () =>
  enhancedRateLimit("status_check", {
    abuseDetection: false, // Less strict for status checks
  });

export const resultsRetrievalRateLimit = () =>
  enhancedRateLimit("results_retrieval", {
    abuseDetection: true,
  });

export const apiKeyCreationRateLimit = () =>
  enhancedRateLimit("api_key_creation", {
    abuseDetection: true,
    skipForPremium: false, // Always enforce for API key creation
  });

export const generalApiRateLimit = () =>
  enhancedRateLimit("general_api", {
    abuseDetection: false,
  });
