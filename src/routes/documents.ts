/**
 * Document Routes
 * API endpoints for document upload and processing
 */

import { Router } from "@/deps.ts";
import { log } from "@/deps.ts";
import { documentUploadService } from "@services/document_upload_service.ts";
import { documentStatusService } from "@services/document_status_service.ts";
import { DocumentQueries } from "@database/queries.ts";
import type { Context } from "@/deps.ts";
import type { AuthenticatedRequest } from "@models/api_key.ts";
import { authMiddleware, requirePermissions } from "@middleware/auth.ts";
import type { DocumentUploadRequest } from "@models/document_upload.ts";

interface AuthContext extends Context {
  auth?: AuthenticatedRequest;
  params: Record<string, string>;
}

const logger = log.getLogger();
const router = new Router();

/**
 * Upload document for processing
 * POST /api/v1/documents
 */
router.post("/api/v1/documents", requirePermissions(["write"]), async (ctx: AuthContext) => {
  try {
    const requestId = ctx.auth?.requestId || crypto.randomUUID();

    // Check if request is multipart/form-data
    const contentType = ctx.request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      ctx.response.status = 400;
      ctx.response.body = {
        status: "error",
        error: {
          code: "INVALID_CONTENT_TYPE",
          message: "Content-Type must be multipart/form-data for file uploads",
        },
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
          version: "v1",
        },
      };
      return;
    }

    // Parse multipart form data
    const body = ctx.request.body;
    const formData = await body.formData();

    // Extract file
    const fileEntry = formData.get("file");
    if (!fileEntry || !(fileEntry instanceof File)) {
      ctx.response.status = 400;
      ctx.response.body = {
        status: "error",
        error: {
          code: "FILE_REQUIRED",
          message: "File is required in 'file' field",
        },
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
          version: "v1",
        },
      };
      return;
    }

    // Extract metadata
    const userId = formData.get("user_id")?.toString();
    const transactionId = formData.get("transaction_id")?.toString();
    const disputeId = formData.get("dispute_id")?.toString();
    const documentType = formData.get("document_type")?.toString() as any;
    const immediateProcessing = formData.get("immediate_processing") === "true";
    const priority = (formData.get("priority")?.toString() as any) || "normal";
    const languageParam = formData.get("language")?.toString();
    const language = languageParam
      ? languageParam.split(",").map((l: string) => l.trim())
      : undefined;

    // Validate required fields
    if (!userId) {
      ctx.response.status = 400;
      ctx.response.body = {
        status: "error",
        error: {
          code: "USER_ID_REQUIRED",
          message: "user_id is required",
        },
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
          version: "v1",
        },
      };
      return;
    }

    if (!transactionId) {
      ctx.response.status = 400;
      ctx.response.body = {
        status: "error",
        error: {
          code: "TRANSACTION_ID_REQUIRED",
          message: "transaction_id is required",
        },
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
          version: "v1",
        },
      };
      return;
    }

    // Create upload request
    const uploadRequest: DocumentUploadRequest = {
      file: fileEntry,
      fileName: fileEntry.name,
      mimeType: fileEntry.type,
      fileSize: fileEntry.size,
      userId,
      transactionId,
      disputeId: disputeId || undefined,
      documentType: documentType || "payment_receipt",
      immediateProcessing,
      priority,
      language,
    };

    // Process upload
    const result = await documentUploadService.uploadDocument(uploadRequest);

    // Set response status based on result
    ctx.response.status = result.status === "success" ? 201 : 400;
    ctx.response.body = result;

    // Log successful upload
    if (result.status === "success" && result.data) {
      logger.info(
        `Document uploaded successfully: ${result.data.documentId} by ${ctx.auth?.apiKey.name}`,
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const requestId = ctx.auth?.requestId || crypto.randomUUID();

    logger.error("Document upload failed:", errorMessage);

    ctx.response.status = 500;
    ctx.response.body = {
      status: "error",
      error: {
        code: "UPLOAD_SERVICE_ERROR",
        message: "Document upload service temporarily unavailable",
      },
      meta: {
        request_id: requestId,
        timestamp: new Date().toISOString(),
        version: "v1",
      },
    };
  }
});

/**
 * Get document processing status
 * GET /api/v1/documents/:id/status
 */
router.get(
  "/api/v1/documents/:id/status",
  requirePermissions(["read"]),
  async (ctx: AuthContext) => {
    try {
      const documentId = ctx.params.id;
      const requestId = ctx.auth?.requestId || crypto.randomUUID();

      if (!documentId) {
        ctx.response.status = 400;
        ctx.response.body = {
          status: "error",
          error: {
            code: "DOCUMENT_ID_REQUIRED",
            message: "Document ID is required",
          },
          meta: {
            request_id: requestId,
            timestamp: new Date().toISOString(),
            version: "v1",
          },
        };
        return;
      }

      // Parse query parameters for options
      const includeProcessingLogs = ctx.request.url.searchParams.get("include_logs") !== "false";
      const includeStageTiming = ctx.request.url.searchParams.get("include_timing") !== "false";
      const includeMetadata = ctx.request.url.searchParams.get("include_metadata") !== "false";
      const useCache = ctx.request.url.searchParams.get("no_cache") !== "true";

      const statusOptions = {
        includeProcessingLogs,
        includeStageTiming,
        includeMetadata,
        useCache,
        maxCacheAge: 300, // 5 minutes
      };

      const status = await documentStatusService.getDocumentStatus(documentId, statusOptions);

      if (!status) {
        ctx.response.status = 404;
        ctx.response.body = {
          status: "error",
          error: {
            code: "DOCUMENT_NOT_FOUND",
            message: `Document ${documentId} not found`,
          },
          meta: {
            request_id: requestId,
            timestamp: new Date().toISOString(),
            version: "v1",
          },
        };
        return;
      }

      // Add cache headers if data was cached
      ctx.response.headers.set("Cache-Control", "private, max-age=300"); // 5 minutes

      ctx.response.status = 200;
      ctx.response.body = {
        status: "success",
        data: status,
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
          version: "v1",
          cached: useCache,
          cacheStats: documentStatusService.getCacheStats(),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const requestId = ctx.auth?.requestId || crypto.randomUUID();

      logger.error("Failed to get document status:", errorMessage);

      ctx.response.status = 500;
      ctx.response.body = {
        status: "error",
        error: {
          code: "STATUS_SERVICE_ERROR",
          message: "Unable to retrieve document status",
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
 * Get processing queue status
 * GET /api/v1/queue/status
 */
router.get("/api/v1/queue/status", requirePermissions(["read"]), async (ctx: AuthContext) => {
  try {
    const requestId = ctx.auth?.requestId || crypto.randomUUID();
    const queueStatus = documentUploadService.getQueueStatus();

    ctx.response.status = 200;
    ctx.response.body = {
      status: "success",
      data: {
        queue: queueStatus,
        processing: {
          service: "document-verification-api",
          status: "operational",
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

    logger.error("Failed to get queue status:", errorMessage);

    ctx.response.status = 500;
    ctx.response.body = {
      status: "error",
      error: {
        code: "QUEUE_STATUS_ERROR",
        message: "Unable to retrieve queue status",
      },
      meta: {
        request_id: requestId,
        timestamp: new Date().toISOString(),
        version: "v1",
      },
    };
  }
});

/**
 * Invalidate document status cache
 * DELETE /api/v1/documents/:id/cache
 */
router.delete(
  "/api/v1/documents/:id/cache",
  requirePermissions(["write"]),
  async (ctx: AuthContext) => {
    try {
      const documentId = ctx.params.id;
      const requestId = ctx.auth?.requestId || crypto.randomUUID();

      if (!documentId) {
        ctx.response.status = 400;
        ctx.response.body = {
          status: "error",
          error: {
            code: "DOCUMENT_ID_REQUIRED",
            message: "Document ID is required",
          },
          meta: {
            request_id: requestId,
            timestamp: new Date().toISOString(),
            version: "v1",
          },
        };
        return;
      }

      // Invalidate cache
      await documentStatusService.invalidateCache(documentId);

      ctx.response.status = 200;
      ctx.response.body = {
        status: "success",
        data: {
          message: "Cache invalidated successfully",
          documentId,
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

      logger.error("Failed to invalidate cache:", errorMessage);

      ctx.response.status = 500;
      ctx.response.body = {
        status: "error",
        error: {
          code: "CACHE_INVALIDATION_ERROR",
          message: "Unable to invalidate document cache",
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

export { router as documentsRouter };
