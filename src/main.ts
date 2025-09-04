import { Application, log, Router } from "@/deps.ts";
import { getConfig } from "@config/env.ts";
import { getDatabaseHealth, initializeDatabase } from "@config/database.ts";
import { getS3Health, initializeS3 } from "@config/s3.ts";
import { getRedisHealth, initializeRedis } from "@config/redis.ts";
import { DocumentQueries } from "@database/queries.ts";
import { storageService } from "@services/storage_service.ts";
import { authMiddleware, skipAuth } from "@middleware/auth.ts";
import { apiKeyRouter } from "@routes/api_keys.ts";

/**
 * Document Verification API
 * Anti-fraud system for payment document processing
 */

async function startServer() {
  try {
    // Load configuration
    const config = await getConfig();

    // Setup logging
    await log.setup({
      handlers: {
        console: new log.ConsoleHandler(config.logLevel, {
          formatter: (logRecord) => {
            const timestamp = new Date().toISOString();
            return `${timestamp} [${logRecord.level}] ${logRecord.msg}`;
          },
        }),
      },
      loggers: {
        default: {
          level: config.logLevel,
          handlers: ["console"],
        },
      },
    });

    const logger = log.getLogger();
    logger.info(`Starting Document Verification API in ${config.environment} mode`);

    // Initialize database connection
    logger.info("Initializing database connection...");
    await initializeDatabase();
    logger.info("Database connection initialized successfully");

    // Initialize S3/R2 storage
    logger.info("Initializing S3/R2 storage...");
    await initializeS3();
    logger.info("S3/R2 storage initialized successfully");

    // Initialize Redis cache
    logger.info("Initializing Redis cache...");
    await initializeRedis();
    logger.info("Redis cache initialized successfully");

    // Create Oak application
    const app = new Application();
    const router = new Router();

    // Enhanced health check endpoint with database, storage, and cache status
    router.get("/health", skipAuth(), async (ctx) => {
      try {
        const dbHealth = await getDatabaseHealth();
        const s3Health = await getS3Health();
        const redisHealth = await getRedisHealth();
        const storageStats = await storageService.getStorageStats();

        const overallHealthy = dbHealth.status === "healthy" &&
          s3Health.status === "healthy" &&
          redisHealth.status === "healthy";

        ctx.response.status = overallHealthy ? 200 : 503;
        ctx.response.body = {
          status: overallHealthy ? "healthy" : "unhealthy",
          service: "document-verification-api",
          version: "1.0.0",
          timestamp: new Date().toISOString(),
          environment: config.environment,
          database: {
            status: dbHealth.status,
            latency: dbHealth.latency ? `${dbHealth.latency}ms` : undefined,
            connections: dbHealth.connections,
          },
          storage: {
            status: s3Health.status,
            service: storageStats.service,
            bucket: s3Health.bucket,
            latency: s3Health.latency ? `${s3Health.latency}ms` : undefined,
          },
          cache: {
            status: redisHealth.status,
            latency: redisHealth.latency ? `${redisHealth.latency}ms` : undefined,
          },
        };
      } catch (error) {
        logger.error("Health check failed:", error);
        ctx.response.status = 503;
        ctx.response.body = {
          status: "unhealthy",
          service: "document-verification-api",
          version: "1.0.0",
          timestamp: new Date().toISOString(),
          environment: config.environment,
          error: "Health check failed",
        };
      }
    });

    // API v1 routes placeholder
    router.get("/api/v1", skipAuth(), async (ctx) => {
      try {
        const stats = await DocumentQueries.getStats();

        ctx.response.status = 200;
        ctx.response.body = {
          message: "Document Verification API v1",
          version: "1.0.0",
          status: "operational",
          statistics: {
            total_documents: stats.total,
            recent_24h: stats.recent_24h,
            processing_queue: {
              queued: stats.by_status.queued,
              processing: stats.by_status.processing,
            },
            completed: stats.by_status.completed,
            failed: stats.by_status.failed,
          },
          endpoints: [
            "GET /health - Health check with database and storage status",
            "GET /api/v1 - API information and statistics",
            "POST /api/v1/upload-url - Generate signed upload URL",
            "POST /api/v1/documents - Upload document (coming soon)",
            "GET /api/v1/documents/:id/status - Check processing status (coming soon)",
            "GET /api/v1/documents/:id/results - Get processing results (coming soon)",
          ],
        };
      } catch (error) {
        logger.error("API info endpoint error:", error);
        ctx.response.status = 500;
        ctx.response.body = {
          message: "Document Verification API v1",
          version: "1.0.0",
          status: "error",
          error: "Failed to load statistics",
          endpoints: [
            "GET /health - Health check",
            "POST /api/v1/documents - Upload document (coming soon)",
            "GET /api/v1/documents/:id/status - Check status (coming soon)",
            "GET /api/v1/documents/:id/results - Get results (coming soon)",
          ],
        };
      }
    });

    // Generate signed upload URL endpoint
    router.post("/api/v1/upload-url", authMiddleware(), async (ctx) => {
      try {
        const body = await ctx.request.body.json();

        // Basic validation
        if (!body.user_id || !body.file_name || !body.content_type) {
          ctx.response.status = 400;
          ctx.response.body = {
            status: "error",
            error: {
              code: "INVALID_REQUEST",
              message: "Missing required fields: user_id, file_name, content_type",
            },
            meta: {
              request_id: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              version: "v1",
            },
          };
          return;
        }

        const uploadOptions = {
          contentType: body.content_type,
          originalFileName: body.file_name,
          userId: body.user_id,
          transactionId: body.transaction_id,
          disputeId: body.dispute_id,
        };

        // Generate signed upload URL
        const result = await storageService.generateUploadUrl(uploadOptions, 900); // 15 minutes

        ctx.response.status = 200;
        ctx.response.body = {
          status: "success",
          data: {
            upload_url: result.uploadUrl,
            document_key: result.key,
            expires_at: result.expiresAt.toISOString(),
            expires_in_seconds: 900,
          },
          meta: {
            request_id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            version: "v1",
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error("Upload URL generation failed:", errorMessage);

        ctx.response.status = 500;
        ctx.response.body = {
          status: "error",
          error: {
            code: "UPLOAD_URL_GENERATION_FAILED",
            message: "Failed to generate upload URL",
          },
          meta: {
            request_id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            version: "v1",
          },
        };
      }
    });

    // Global error handler
    app.addEventListener("error", (evt) => {
      logger.error(`Unhandled error: ${evt.error.message}`, evt.error);
    });

    // Error handling middleware
    app.use(async (ctx, next) => {
      try {
        await next();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.error(`Request error: ${errorMessage}`, error);

        ctx.response.status = 500;
        ctx.response.body = {
          status: "error",
          error: {
            code: "INTERNAL_ERROR",
            message: config.environment === "development"
              ? errorMessage
              : "An internal server error occurred",
          },
          meta: {
            request_id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            version: "v1",
          },
        };
      }
    });

    // CORS middleware
    app.use(async (ctx, next) => {
      ctx.response.headers.set("Access-Control-Allow-Origin", "*");
      ctx.response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      ctx.response.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-API-Key",
      );

      if (ctx.request.method === "OPTIONS") {
        ctx.response.status = 200;
        return;
      }

      await next();
    });

    // Security headers middleware
    app.use(async (ctx, next) => {
      ctx.response.headers.set("X-Content-Type-Options", "nosniff");
      ctx.response.headers.set("X-Frame-Options", "DENY");
      ctx.response.headers.set("X-XSS-Protection", "1; mode=block");
      ctx.response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

      if (config.environment === "production") {
        ctx.response.headers.set(
          "Strict-Transport-Security",
          "max-age=31536000; includeSubDomains",
        );
      }

      await next();
    });

    // Request logging middleware
    app.use(async (ctx, next) => {
      const start = Date.now();
      await next();
      const duration = Date.now() - start;

      logger.info(
        `${ctx.request.method} ${ctx.request.url} - ${ctx.response.status} (${duration}ms)`,
      );
    });

    // Register routes
    app.use(router.routes());
    app.use(router.allowedMethods());

    // Register API key management routes
    app.use(apiKeyRouter.routes());
    app.use(apiKeyRouter.allowedMethods());

    // 404 handler
    app.use((ctx) => {
      ctx.response.status = 404;
      ctx.response.body = {
        status: "error",
        error: {
          code: "NOT_FOUND",
          message: "Endpoint not found",
        },
        meta: {
          request_id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          version: "v1",
        },
      };
    });

    logger.info(`Server starting on port ${config.port}`);
    await app.listen({ port: config.port });
  } catch (error) {
    console.error("Failed to start server:", error);
    Deno.exit(1);
  }
}

// Handle graceful shutdown
const handleShutdown = () => {
  console.log("\nReceived shutdown signal, closing server...");
  Deno.exit(0);
};

Deno.addSignalListener("SIGINT", handleShutdown);
Deno.addSignalListener("SIGTERM", handleShutdown);

// Start the server
if (import.meta.main) {
  await startServer();
}
