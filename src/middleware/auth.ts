/**
 * Authentication Middleware
 * API key validation and rate limiting middleware for Oak framework
 */

import type { Context, Middleware } from "@/deps.ts";
import { log } from "@/deps.ts";
import { apiKeyService } from "@services/api_key_service.ts";
import type { AuthenticatedRequest } from "@models/api_key.ts";

/**
 * Extended context with authentication info
 */
export interface AuthContext extends Context {
  auth?: AuthenticatedRequest;
}

/**
 * Authentication middleware
 * Validates API key and enforces rate limits
 */
export function authMiddleware(options: {
  skipAuth?: boolean;
  requiredPermissions?: string[];
} = {}): Middleware {
  const logger = log.getLogger();

  return async (ctx: AuthContext, next) => {
    const requestId = crypto.randomUUID();

    try {
      // Skip authentication if configured (for health checks, etc.)
      if (options.skipAuth) {
        await next();
        return;
      }

      // Extract API key from Authorization header
      const authHeader = ctx.request.headers.get("Authorization") ||
        ctx.request.headers.get("X-API-Key");

      if (!authHeader) {
        logger.warn(`Authentication required - missing header (request: ${requestId})`);
        ctx.response.status = 401;
        ctx.response.body = {
          status: "error",
          error: {
            code: "AUTHENTICATION_REQUIRED",
            message: "API key required in Authorization header",
          },
          meta: {
            request_id: requestId,
            timestamp: new Date().toISOString(),
            version: "v1",
          },
        };
        return;
      }

      // Validate API key
      const validation = await apiKeyService.validateApiKey(authHeader);

      if (!validation.isValid) {
        const statusCode = validation.rateLimitExceeded ? 429 : 401;
        const errorCode = validation.rateLimitExceeded ? "RATE_LIMIT_EXCEEDED" : "INVALID_API_KEY";

        logger.warn(`Authentication failed - ${validation.error} (request: ${requestId})`);

        ctx.response.status = statusCode;
        ctx.response.body = {
          status: "error",
          error: {
            code: errorCode,
            message: validation.error || "Invalid API key",
          },
          meta: {
            request_id: requestId,
            timestamp: new Date().toISOString(),
            version: "v1",
          },
        };

        // Add rate limit headers if applicable
        if (validation.rateLimitExceeded && validation.remainingRequests) {
          ctx.response.headers.set(
            "X-RateLimit-Limit-Minute",
            validation.apiKey?.rateLimitPerMinute.toString() || "0",
          );
          ctx.response.headers.set(
            "X-RateLimit-Limit-Hour",
            validation.apiKey?.rateLimitPerHour.toString() || "0",
          );
          ctx.response.headers.set(
            "X-RateLimit-Limit-Day",
            validation.apiKey?.rateLimitPerDay.toString() || "0",
          );
          ctx.response.headers.set(
            "X-RateLimit-Remaining-Minute",
            validation.remainingRequests.perMinute.toString(),
          );
          ctx.response.headers.set(
            "X-RateLimit-Remaining-Hour",
            validation.remainingRequests.perHour.toString(),
          );
          ctx.response.headers.set(
            "X-RateLimit-Remaining-Day",
            validation.remainingRequests.perDay.toString(),
          );
        }

        return;
      }

      // Check required permissions
      if (options.requiredPermissions && validation.apiKey) {
        const hasRequiredPermissions = options.requiredPermissions.every((permission) =>
          validation.apiKey!.permissions.includes(permission)
        );

        if (!hasRequiredPermissions) {
          logger.warn(
            `Insufficient permissions - required: ${
              options.requiredPermissions.join(", ")
            } (request: ${requestId})`,
          );
          ctx.response.status = 403;
          ctx.response.body = {
            status: "error",
            error: {
              code: "INSUFFICIENT_PERMISSIONS",
              message: `Required permissions: ${options.requiredPermissions.join(", ")}`,
            },
            meta: {
              request_id: requestId,
              timestamp: new Date().toISOString(),
              version: "v1",
            },
          };
          return;
        }
      }

      // Add authentication info to context
      if (validation.apiKey && validation.remainingRequests) {
        const rateLimitInfo = await apiKeyService.getRateLimitInfo(validation.apiKey);

        ctx.auth = {
          apiKey: validation.apiKey,
          rateLimitInfo,
          requestId,
        };

        // Add rate limit headers to response
        ctx.response.headers.set(
          "X-RateLimit-Limit-Minute",
          validation.apiKey.rateLimitPerMinute.toString(),
        );
        ctx.response.headers.set(
          "X-RateLimit-Limit-Hour",
          validation.apiKey.rateLimitPerHour.toString(),
        );
        ctx.response.headers.set(
          "X-RateLimit-Limit-Day",
          validation.apiKey.rateLimitPerDay.toString(),
        );
        ctx.response.headers.set(
          "X-RateLimit-Remaining-Minute",
          validation.remainingRequests.perMinute.toString(),
        );
        ctx.response.headers.set(
          "X-RateLimit-Remaining-Hour",
          validation.remainingRequests.perHour.toString(),
        );
        ctx.response.headers.set(
          "X-RateLimit-Remaining-Day",
          validation.remainingRequests.perDay.toString(),
        );

        logger.info(
          `Authenticated request for ${validation.apiKey.name} (${validation.apiKey.keyPrefix}***) - request: ${requestId}`,
        );
      }

      await next();
    } catch (error) {
      logger.error(`Authentication middleware error (request: ${requestId}):`, error);

      ctx.response.status = 500;
      ctx.response.body = {
        status: "error",
        error: {
          code: "AUTHENTICATION_SERVICE_ERROR",
          message: "Authentication service temporarily unavailable",
        },
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
          version: "v1",
        },
      };
    }
  };
}

/**
 * Create middleware requiring specific permissions
 */
export function requirePermissions(permissions: string[]): Middleware {
  return authMiddleware({ requiredPermissions: permissions });
}

/**
 * Create middleware skipping authentication (for public endpoints)
 */
export function skipAuth(): Middleware {
  return authMiddleware({ skipAuth: true });
}
