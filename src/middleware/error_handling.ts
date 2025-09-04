/**
 * Centralized Error Handling Middleware
 * Comprehensive error processing with structured logging and data masking
 */

import type { Context, Middleware } from "@/deps.ts";
import { log } from "@/deps.ts";
import {
  DocumentVerificationError,
  ERROR_CATALOG,
  type ErrorContext,
  ErrorFactory,
  type ErrorResponse,
} from "@utils/error_catalog.ts";
import { dataMaskingService } from "@utils/data_masking.ts";
import { structuredLogger } from "@utils/structured_logger.ts";

/**
 * Centralized error handling middleware
 */
export function errorHandlingMiddleware(): Middleware {
  const logger = log.getLogger();

  // Extract handleError function outside to avoid 'this' context issues
  async function handleError(
    ctx: Context,
    error: unknown,
    errorContext: ErrorContext,
    startTime: number,
  ): Promise<void> {
    const duration = Date.now() - startTime;
    let documentError: DocumentVerificationError;

    // Convert to DocumentVerificationError if needed
    if (error instanceof DocumentVerificationError) {
      documentError = error;
    } else if (error instanceof Error) {
      // Classify unknown errors
      documentError = classifyError(error, errorContext);
    } else {
      // Handle non-Error objects
      documentError = ErrorFactory.system("internal_error", errorContext, String(error));
    }

    // Enhance error context
    documentError.context.timestamp = errorContext.timestamp;
    documentError.context.endpoint = errorContext.endpoint;
    documentError.context.requestId = errorContext.requestId;

    // Mask sensitive data in error context
    const maskedContext = await dataMaskingService.maskErrorContext(documentError.context);

    // Log the error with structured logging
    const logEntry = documentError.toLogEntry();
    await structuredLogger.logError({
      ...logEntry,
      context: maskedContext,
      duration,
    });

    // Send alert if required
    if (documentError.requiresAlert()) {
      await sendErrorAlert(documentError, maskedContext);
    }

    // Create and send error response
    const errorResponse = documentError.toErrorResponse();

    ctx.response.status = documentError.httpStatus;
    ctx.response.body = errorResponse;

    // Add additional headers
    ctx.response.headers.set("X-Error-Code", documentError.code);
    ctx.response.headers.set("X-Error-Category", documentError.category);
    ctx.response.headers.set("X-Error-Severity", documentError.severity);

    if (documentError.retryable) {
      ctx.response.headers.set("X-Retryable", "true");

      // Add retry delay suggestions for specific errors
      if (documentError.category === "rate_limiting") {
        ctx.response.headers.set("Retry-After", "60");
      } else if (documentError.category === "external_service") {
        ctx.response.headers.set("Retry-After", "300"); // 5 minutes
      }
    }

    logger.error(`Request failed: ${documentError.code} - ${documentError.message}`, {
      traceId: documentError.traceId,
      requestId: errorContext.requestId,
      endpoint: errorContext.endpoint,
      duration,
      httpStatus: documentError.httpStatus,
    });
  }

  return async (ctx: Context, next) => {
    const startTime = Date.now();
    const traceId = crypto.randomUUID();

    try {
      // Add trace ID to response headers
      ctx.response.headers.set("X-Trace-ID", traceId);

      // Create error context
      const errorContext: ErrorContext = {
        traceId,
        requestId: crypto.randomUUID(),
        userId: undefined,
        documentId: undefined,
        apiKeyId: undefined,
        endpoint: `${ctx.request.method} ${ctx.request.url.pathname}`,
        userAgent: ctx.request.headers.get("user-agent") || undefined,
        ipAddress: (ctx.request as any).ip || undefined,
        timestamp: new Date(),
        metadata: {
          startTime,
          method: ctx.request.method,
          path: ctx.request.url.pathname,
          query: Object.fromEntries(ctx.request.url.searchParams),
        },
      };

      // Add context to request for other middleware
      (ctx as any).errorContext = errorContext;

      await next();

      // Log successful requests
      const duration = Date.now() - startTime;
      await structuredLogger.logRequest({
        traceId,
        requestId: errorContext.requestId,
        method: ctx.request.method,
        path: ctx.request.url.pathname,
        statusCode: ctx.response.status || 200,
        duration,
        success: true,
      });
    } catch (error) {
      await handleError(ctx, error, errorContext, startTime);
    }
  };

  /**
   * Classify unknown errors into appropriate categories
   */
  function classifyError(error: Error, context: ErrorContext): DocumentVerificationError {
    const duration = Date.now() - startTime;
    let documentError: DocumentVerificationError;

    // Convert to DocumentVerificationError if needed
    if (error instanceof DocumentVerificationError) {
      documentError = error;
    } else if (error instanceof Error) {
      // Classify unknown errors
      documentError = classifyError(error, errorContext);
    } else {
      // Handle non-Error objects
      documentError = ErrorFactory.system("internal_error", errorContext, String(error));
    }

    // Enhance error context
    documentError.context.timestamp = errorContext.timestamp;
    documentError.context.endpoint = errorContext.endpoint;
    documentError.context.requestId = errorContext.requestId;

    // Mask sensitive data in error context
    const maskedContext = await dataMaskingService.maskErrorContext(documentError.context);

    // Log the error with structured logging
    const logEntry = documentError.toLogEntry();
    await structuredLogger.logError({
      ...logEntry,
      context: maskedContext,
      duration,
    });

    // Send alert if required
    if (documentError.requiresAlert()) {
      await sendErrorAlert(documentError, maskedContext);
    }

    // Create and send error response
    const errorResponse = documentError.toErrorResponse();

    ctx.response.status = documentError.httpStatus;
    ctx.response.body = errorResponse;

    // Add additional headers
    ctx.response.headers.set("X-Error-Code", documentError.code);
    ctx.response.headers.set("X-Error-Category", documentError.category);
    ctx.response.headers.set("X-Error-Severity", documentError.severity);

    if (documentError.retryable) {
      ctx.response.headers.set("X-Retryable", "true");

      // Add retry delay suggestions for specific errors
      if (documentError.category === "rate_limiting") {
        ctx.response.headers.set("Retry-After", "60");
      } else if (documentError.category === "external_service") {
        ctx.response.headers.set("Retry-After", "300"); // 5 minutes
      }
    }

    logger.error(`Request failed: ${documentError.code} - ${documentError.message}`, {
      traceId: documentError.traceId,
      requestId: errorContext.requestId,
      endpoint: errorContext.endpoint,
      duration,
      httpStatus: documentError.httpStatus,
    });
  }

  /**
   * Classify unknown errors into appropriate categories
   */
  function classifyError(error: Error, context: ErrorContext): DocumentVerificationError {
    const message = error.message.toLowerCase();

    // Database-related errors
    if (
      message.includes("database") || message.includes("connection") || message.includes("pool")
    ) {
      return ErrorFactory.system("database_failed", context, error.message);
    }

    // Storage-related errors
    if (message.includes("s3") || message.includes("storage") || message.includes("upload")) {
      return ErrorFactory.storage("upload_failed", context, error.message);
    }

    // Validation errors
    if (
      message.includes("validation") || message.includes("invalid") || message.includes("required")
    ) {
      return ErrorFactory.validation("invalid_request", context, error.message);
    }

    // Rate limiting errors
    if (message.includes("rate limit") || message.includes("too many")) {
      return ErrorFactory.rateLimit("exceeded", context);
    }

    // External service errors
    if (message.includes("timeout") || message.includes("api") || message.includes("service")) {
      return ErrorFactory.externalService("ocr_unavailable", context, error.message);
    }

    // Default to internal error
    return ErrorFactory.system("internal_error", context, error.message);
  }

  /**
   * Send error alert for critical errors
   */
  async function sendErrorAlert(
    error: DocumentVerificationError,
    context: Partial<ErrorContext>,
  ): Promise<void> {
    try {
      // In a production system, this would integrate with alerting services
      // (e.g., PagerDuty, Slack, email notifications)

      const alertData = {
        error: {
          code: error.code,
          category: error.category,
          severity: error.severity,
          message: error.message,
        },
        context: {
          traceId: error.traceId,
          endpoint: context.endpoint,
          timestamp: context.timestamp?.toISOString(),
          environment: Deno.env.get("ENVIRONMENT") || "development",
        },
      };

      // Log alert (in production, would send to alerting service)
      logger.critical("ERROR ALERT TRIGGERED", alertData);
    } catch (alertError) {
      logger.error("Failed to send error alert:", alertError);
    }
  }
}

/**
 * Validation error helper
 */
export function createValidationError(
  field: string,
  reason: string,
  context: Partial<ErrorContext> = {},
): DocumentVerificationError {
  const message = `Validation failed for field '${field}': ${reason}`;
  return ErrorFactory.validation("invalid_request", context, message);
}

/**
 * Not found error helper
 */
export function createNotFoundError(
  resource: string,
  id: string,
  context: Partial<ErrorContext> = {},
): DocumentVerificationError {
  const message = `${resource} with ID '${id}' not found`;
  return ErrorFactory.processing("not_found", context, message);
}

/**
 * Service unavailable error helper
 */
export function createServiceUnavailableError(
  service: string,
  context: Partial<ErrorContext> = {},
): DocumentVerificationError {
  const message = `${service} service is temporarily unavailable`;
  return ErrorFactory.externalService("ocr_unavailable", context, message);
}
