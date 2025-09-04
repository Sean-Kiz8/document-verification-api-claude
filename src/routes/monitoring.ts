/**
 * Monitoring Routes
 * API endpoints for system monitoring and rate limit management
 */

import { Router } from "@/deps.ts";
import { log } from "@/deps.ts";
import { rateLimitingService } from "@services/rate_limiting_service.ts";
import { documentStatusService } from "@services/document_status_service.ts";
import { documentResultsService } from "@services/document_results_service.ts";
import { requirePermissions } from "@middleware/auth.ts";
import { generalApiRateLimit } from "@middleware/enhanced_rate_limiting.ts";
import type { Context } from "@/deps.ts";
import type { AuthenticatedRequest } from "@models/api_key.ts";

interface AuthContext extends Context {
  auth?: AuthenticatedRequest;
  params: Record<string, string>;
}

const logger = log.getLogger();
const router = new Router();

/**
 * Get rate limiting metrics
 * GET /api/v1/admin/rate-limits/metrics
 */
router.get(
  "/api/v1/admin/rate-limits/metrics",
  requirePermissions(["admin"]),
  generalApiRateLimit(),
  async (ctx: AuthContext) => {
    try {
      const requestId = ctx.auth?.requestId || crypto.randomUUID();

      // Get query parameters
      const operation = ctx.request.url.searchParams.get("operation") as any;
      const timeWindow = ctx.request.url.searchParams.get("time_window") || undefined;

      const metrics = await rateLimitingService.getMetrics(operation, timeWindow);

      ctx.response.status = 200;
      ctx.response.body = {
        status: "success",
        data: {
          metrics,
          generatedAt: new Date().toISOString(),
          operations: operation ? [operation] : [
            "document_upload",
            "status_check",
            "results_retrieval",
            "api_key_creation",
            "general_api",
          ],
        },
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
          version: "v1",
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const requestId = ctx.auth?.requestId || crypto.randomUUID();

      logger.error("Failed to get rate limit metrics:", errorMessage);

      ctx.response.status = 500;
      ctx.response.body = {
        status: "error",
        error: {
          code: "METRICS_RETRIEVAL_FAILED",
          message: "Unable to retrieve rate limit metrics",
        },
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
          version: "v1",
        },
      };
    }
  },
);

/**
 * Get rate limit violations for API key
 * GET /api/v1/admin/rate-limits/violations/:api_key_id
 */
router.get(
  "/api/v1/admin/rate-limits/violations/:api_key_id",
  requirePermissions(["admin"]),
  generalApiRateLimit(),
  async (ctx: AuthContext) => {
    try {
      const apiKeyId = ctx.params.api_key_id;
      const requestId = ctx.auth?.requestId || crypto.randomUUID();

      if (!apiKeyId) {
        ctx.response.status = 400;
        ctx.response.body = {
          status: "error",
          error: {
            code: "API_KEY_ID_REQUIRED",
            message: "API key ID is required",
          },
          meta: {
            request_id: requestId,
            timestamp: new Date().toISOString(),
            version: "v1",
          },
        };
        return;
      }

      const violations = rateLimitingService.getViolations(apiKeyId);

      ctx.response.status = 200;
      ctx.response.body = {
        status: "success",
        data: {
          apiKeyId,
          violations,
          totalViolations: violations.length,
          recentViolations: violations.filter((v) =>
            Date.now() - v.timestamp.getTime() < 24 * 60 * 60 * 1000 // last 24 hours
          ).length,
        },
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
          version: "v1",
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const requestId = ctx.auth?.requestId || crypto.randomUUID();

      logger.error("Failed to get rate limit violations:", errorMessage);

      ctx.response.status = 500;
      ctx.response.body = {
        status: "error",
        error: {
          code: "VIOLATIONS_RETRIEVAL_FAILED",
          message: "Unable to retrieve rate limit violations",
        },
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
          version: "v1",
        },
      };
    }
  },
);

/**
 * Clear rate limiting data (development only)
 * DELETE /api/v1/admin/rate-limits/data
 */
router.delete(
  "/api/v1/admin/rate-limits/data",
  requirePermissions(["admin"]),
  async (ctx: AuthContext) => {
    try {
      const requestId = ctx.auth?.requestId || crypto.randomUUID();

      // Only allow in development environment
      if (Deno.env.get("ENVIRONMENT") !== "development") {
        ctx.response.status = 403;
        ctx.response.body = {
          status: "error",
          error: {
            code: "OPERATION_NOT_ALLOWED",
            message: "Rate limit data clearing only allowed in development environment",
          },
          meta: {
            request_id: requestId,
            timestamp: new Date().toISOString(),
            version: "v1",
          },
        };
        return;
      }

      await rateLimitingService.clearAllData();

      ctx.response.status = 200;
      ctx.response.body = {
        status: "success",
        data: {
          message: "Rate limiting data cleared successfully",
          clearedAt: new Date().toISOString(),
        },
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
          version: "v1",
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const requestId = ctx.auth?.requestId || crypto.randomUUID();

      logger.error("Failed to clear rate limiting data:", errorMessage);

      ctx.response.status = 500;
      ctx.response.body = {
        status: "error",
        error: {
          code: "DATA_CLEARING_FAILED",
          message: "Unable to clear rate limiting data",
        },
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
          version: "v1",
        },
      };
    }
  },
);

/**
 * Get system cache statistics
 * GET /api/v1/admin/cache/stats
 */
router.get(
  "/api/v1/admin/cache/stats",
  requirePermissions(["admin"]),
  generalApiRateLimit(),
  async (ctx: AuthContext) => {
    try {
      const requestId = ctx.auth?.requestId || crypto.randomUUID();

      // Get cache stats from all services
      const statusCacheStats = documentStatusService.getCacheStats();
      const resultsCacheStats = documentResultsService.getCacheStats();

      ctx.response.status = 200;
      ctx.response.body = {
        status: "success",
        data: {
          caches: {
            documentStatus: {
              ...statusCacheStats,
              service: "document_status",
              ttl: "5 minutes",
            },
            documentResults: {
              ...resultsCacheStats,
              service: "document_results",
              ttl: "1 hour",
            },
          },
          summary: {
            totalMemoryCacheSize: statusCacheStats.memoryCacheSize +
              resultsCacheStats.memoryCacheSize,
            totalCacheHits: statusCacheStats.totalCacheHits + resultsCacheStats.totalCacheHits,
          },
        },
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
          version: "v1",
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const requestId = ctx.auth?.requestId || crypto.randomUUID();

      logger.error("Failed to get cache statistics:", errorMessage);

      ctx.response.status = 500;
      ctx.response.body = {
        status: "error",
        error: {
          code: "CACHE_STATS_FAILED",
          message: "Unable to retrieve cache statistics",
        },
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
          version: "v1",
        },
      };
    }
  },
);

export { router as monitoringRouter };
