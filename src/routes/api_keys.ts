/**
 * API Key Management Routes
 * Endpoints for managing API keys (admin functions)
 */

import { Router } from "@/deps.ts";
import { log } from "@/deps.ts";
import { apiKeyService } from "@services/api_key_service.ts";
import type { Context } from "@/deps.ts";
import type { AuthenticatedRequest } from "@models/api_key.ts";

interface AuthContext extends Context {
  auth?: AuthenticatedRequest;
  params: Record<string, string>;
}
import { requirePermissions } from "@middleware/auth.ts";

const logger = log.getLogger();
const router = new Router();

/**
 * Create new API key
 * POST /api/v1/admin/api-keys
 */
router.post("/api/v1/admin/api-keys", requirePermissions(["admin"]), async (ctx: AuthContext) => {
  try {
    const body = await ctx.request.body.json();

    // Validation
    if (!body.name || typeof body.name !== "string") {
      ctx.response.status = 400;
      ctx.response.body = {
        status: "error",
        error: {
          code: "INVALID_REQUEST",
          message: "Name is required and must be a string",
        },
        meta: {
          request_id: ctx.auth?.requestId || crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          version: "v1",
        },
      };
      return;
    }

    const creation = {
      name: body.name,
      description: body.description || undefined,
      environment: body.environment || "production",
      permissions: body.permissions || undefined,
      rateLimitPerMinute: body.rate_limit_per_minute || undefined,
      rateLimitPerHour: body.rate_limit_per_hour || undefined,
      rateLimitPerDay: body.rate_limit_per_day || undefined,
      expiresAt: body.expires_at ? new Date(body.expires_at) : undefined,
      createdBy: ctx.auth?.apiKey.name || undefined,
    };

    const { apiKey, rawKey } = await apiKeyService.createApiKey(creation);

    logger.info(`API key created: ${apiKey.keyPrefix}*** by ${creation.createdBy}`);

    ctx.response.status = 201;
    ctx.response.body = {
      status: "success",
      data: {
        api_key: rawKey,
        key_id: apiKey.id,
        key_prefix: apiKey.keyPrefix,
        name: apiKey.name,
        environment: apiKey.environment,
        permissions: apiKey.permissions,
        rate_limits: {
          per_minute: apiKey.rateLimitPerMinute,
          per_hour: apiKey.rateLimitPerHour,
          per_day: apiKey.rateLimitPerDay,
        },
        expires_at: apiKey.expiresAt?.toISOString(),
        created_at: apiKey.createdAt.toISOString(),
      },
      meta: {
        request_id: ctx.auth?.requestId || crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        version: "v1",
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("API key creation failed:", errorMessage);

    ctx.response.status = 500;
    ctx.response.body = {
      status: "error",
      error: {
        code: "API_KEY_CREATION_FAILED",
        message: "Failed to create API key",
      },
      meta: {
        request_id: ctx.auth?.requestId || crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        version: "v1",
      },
    };
  }
});

/**
 * List API keys
 * GET /api/v1/admin/api-keys
 */
router.get("/api/v1/admin/api-keys", requirePermissions(["admin"]), async (ctx: AuthContext) => {
  try {
    const environment = ctx.request.url.searchParams.get("environment") || undefined;
    const apiKeys = await apiKeyService.listApiKeys(environment);

    ctx.response.status = 200;
    ctx.response.body = {
      status: "success",
      data: {
        api_keys: apiKeys.map((key) => ({
          id: key.id,
          key_prefix: key.keyPrefix,
          name: key.name,
          description: key.description,
          environment: key.environment,
          permissions: key.permissions,
          rate_limits: {
            per_minute: key.rateLimitPerMinute,
            per_hour: key.rateLimitPerHour,
            per_day: key.rateLimitPerDay,
          },
          is_active: key.isActive,
          expires_at: key.expiresAt?.toISOString(),
          last_used_at: key.lastUsedAt?.toISOString(),
          usage_count: key.usageCount,
          created_by: key.createdBy,
          created_at: key.createdAt.toISOString(),
        })),
        total: apiKeys.length,
      },
      meta: {
        request_id: ctx.auth?.requestId || crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        version: "v1",
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("API key listing failed:", errorMessage);

    ctx.response.status = 500;
    ctx.response.body = {
      status: "error",
      error: {
        code: "API_KEY_LISTING_FAILED",
        message: "Failed to list API keys",
      },
      meta: {
        request_id: ctx.auth?.requestId || crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        version: "v1",
      },
    };
  }
});

/**
 * Deactivate API key
 * DELETE /api/v1/admin/api-keys/:id
 */
router.delete(
  "/api/v1/admin/api-keys/:id",
  requirePermissions(["admin"]),
  async (ctx: AuthContext) => {
    try {
      const apiKeyId = ctx.params.id;

      if (!apiKeyId) {
        ctx.response.status = 400;
        ctx.response.body = {
          status: "error",
          error: {
            code: "INVALID_REQUEST",
            message: "API key ID is required",
          },
          meta: {
            request_id: ctx.auth?.requestId || crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            version: "v1",
          },
        };
        return;
      }

      const deactivated = await apiKeyService.deactivateApiKey(apiKeyId);

      if (!deactivated) {
        ctx.response.status = 404;
        ctx.response.body = {
          status: "error",
          error: {
            code: "API_KEY_NOT_FOUND",
            message: "API key not found",
          },
          meta: {
            request_id: ctx.auth?.requestId || crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            version: "v1",
          },
        };
        return;
      }

      logger.info(`API key deactivated: ${apiKeyId} by ${ctx.auth?.apiKey.name}`);

      ctx.response.status = 200;
      ctx.response.body = {
        status: "success",
        data: {
          message: "API key deactivated successfully",
          api_key_id: apiKeyId,
        },
        meta: {
          request_id: ctx.auth?.requestId || crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          version: "v1",
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error("API key deactivation failed:", errorMessage);

      ctx.response.status = 500;
      ctx.response.body = {
        status: "error",
        error: {
          code: "API_KEY_DEACTIVATION_FAILED",
          message: "Failed to deactivate API key",
        },
        meta: {
          request_id: ctx.auth?.requestId || crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          version: "v1",
        },
      };
    }
  },
);

export { router as apiKeyRouter };
