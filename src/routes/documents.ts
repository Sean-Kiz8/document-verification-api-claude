/**
 * Document Routes
 * API endpoints for document upload and processing
 */

import { Router } from "@/deps.ts";
import { log } from "@/deps.ts";
import { documentUploadService } from "@services/document_upload_service.ts";
import { documentStatusService } from "@services/document_status_service.ts";
import { documentResultsService } from "@services/document_results_service.ts";
import { DocumentQueries } from "@database/queries.ts";
import type { Context } from "@/deps.ts";
import type { AuthenticatedRequest } from "@models/api_key.ts";
import { authMiddleware, requirePermissions } from "@middleware/auth.ts";
import {
  documentUploadRateLimit,
  resultsRetrievalRateLimit,
  statusCheckRateLimit,
} from "@middleware/enhanced_rate_limiting.ts";
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
router.post(
  "/api/v1/documents",
  requirePermissions(["write"]),
  documentUploadRateLimit(),
  async (ctx: AuthContext) => {
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
        fileSize: Number(fileEntry.size), // Convert BigInt to Number
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
  },
);

/**
 * Get document processing status
 * GET /api/v1/documents/:id/status
 */
router.get(
  "/api/v1/documents/:id/status",
  requirePermissions(["read"]),
  statusCheckRateLimit(),
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
 * Get document processing results
 * GET /api/v1/documents/:id/results
 */
router.get(
  "/api/v1/documents/:id/results",
  requirePermissions(["read"]),
  resultsRetrievalRateLimit(),
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
      const includeRawText = ctx.request.url.searchParams.get("include_raw_text") !== "false";
      const includeDiscrepancyDetails =
        ctx.request.url.searchParams.get("include_discrepancies") !== "false";
      const includeDocumentAccess =
        ctx.request.url.searchParams.get("include_document_access") !== "false";
      const compressionLevel = (ctx.request.url.searchParams.get("compression") as any) || "basic";
      const useCache = ctx.request.url.searchParams.get("no_cache") !== "true";
      const summaryOnly = ctx.request.url.searchParams.get("summary_only") === "true";

      // If summary only, use lightweight endpoint
      if (summaryOnly) {
        const summary = await documentResultsService.getProcessingSummary(documentId);

        if (!summary) {
          ctx.response.status = 404;
          ctx.response.body = {
            status: "error",
            error: {
              code: "DOCUMENT_NOT_FOUND_OR_INCOMPLETE",
              message: "Document not found or processing not completed",
            },
            meta: {
              request_id: requestId,
              timestamp: new Date().toISOString(),
              version: "v1",
            },
          };
          return;
        }

        ctx.response.status = 200;
        ctx.response.body = {
          status: "success",
          data: {
            summary,
          },
          meta: {
            request_id: requestId,
            timestamp: new Date().toISOString(),
            version: "v1",
            format: "summary",
          },
        };
        return;
      }

      const resultsOptions = {
        includeProcessingLogs,
        includeRawText,
        includeDiscrepancyDetails,
        includeDocumentAccess,
        compressionLevel,
        useCache,
        maxCacheAge: 3600, // 1 hour
      };

      const results = await documentResultsService.getDocumentResults(documentId, resultsOptions);

      if (!results) {
        ctx.response.status = 404;
        ctx.response.body = {
          status: "error",
          error: {
            code: "DOCUMENT_NOT_FOUND_OR_INCOMPLETE",
            message: "Document not found or processing not completed",
          },
          meta: {
            request_id: requestId,
            timestamp: new Date().toISOString(),
            version: "v1",
          },
        };
        return;
      }

      // Add cache headers for completed results
      ctx.response.headers.set("Cache-Control", "private, max-age=3600"); // 1 hour

      // Add response compression hint
      if (compressionLevel !== "none") {
        ctx.response.headers.set("Content-Encoding", "gzip");
      }

      ctx.response.status = 200;
      ctx.response.body = {
        status: "success",
        data: results,
        meta: {
          request_id: requestId,
          timestamp: new Date().toISOString(),
          version: "v1",
          cached: useCache,
          compressed: compressionLevel !== "none",
          cacheStats: documentResultsService.getCacheStats(),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      const requestId = ctx.auth?.requestId || crypto.randomUUID();

      // Handle specific error cases
      if (errorMessage.includes("not yet completed")) {
        ctx.response.status = 202; // Accepted but not ready
        ctx.response.body = {
          status: "error",
          error: {
            code: "PROCESSING_NOT_COMPLETED",
            message: "Document processing is still in progress",
          },
          meta: {
            request_id: requestId,
            timestamp: new Date().toISOString(),
            version: "v1",
          },
        };
        return;
      }

      logger.error("Failed to get document results:", errorMessage);

      ctx.response.status = 500;
      ctx.response.body = {
        status: "error",
        error: {
          code: "RESULTS_SERVICE_ERROR",
          message: "Unable to retrieve document results",
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

      // Invalidate both status and results cache
      await documentStatusService.invalidateCache(documentId);
      await documentResultsService.invalidateCache(documentId);

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
