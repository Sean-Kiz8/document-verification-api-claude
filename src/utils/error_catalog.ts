/**
 * Error Catalog
 * Comprehensive error definitions with specific codes and user-friendly messages
 */

/**
 * Error severity levels
 */
export type ErrorSeverity = "low" | "medium" | "high" | "critical";

/**
 * Error category types
 */
export type ErrorCategory =
  | "authentication"
  | "validation"
  | "processing"
  | "storage"
  | "external_service"
  | "system"
  | "rate_limiting"
  | "business_logic";

/**
 * Error definition structure
 */
export interface ErrorDefinition {
  code: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  httpStatus: number;
  title: string;
  message: string;
  userMessage: string;
  suggestions: string[];
  retryable: boolean;
  logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
  alertRequired: boolean;
}

/**
 * Error context for enhanced logging
 */
export interface ErrorContext {
  traceId: string;
  requestId: string;
  userId: string | undefined;
  documentId: string | undefined;
  apiKeyId: string | undefined;
  endpoint: string;
  userAgent: string | undefined;
  ipAddress: string | undefined;
  timestamp: Date;
  metadata: Record<string, unknown> | undefined;
}

/**
 * Comprehensive error response
 */
export interface ErrorResponse {
  status: "error";
  error: {
    code: string;
    category: ErrorCategory;
    title: string;
    message: string;
    suggestions?: string[];
    retryable: boolean;
    severity: ErrorSeverity;
  };
  trace: {
    traceId: string;
    requestId: string;
    timestamp: string;
    endpoint: string;
  };
  meta: {
    version: string;
    environment?: string;
  };
}

/**
 * Error Catalog - Comprehensive error definitions
 */
export const ERROR_CATALOG: Record<string, ErrorDefinition> = {
  // Authentication Errors (E1001-E1999)
  "E1001": {
    code: "E1001",
    category: "authentication",
    severity: "medium",
    httpStatus: 401,
    title: "Authentication Required",
    message: "API key is required for this endpoint",
    userMessage: "Please provide a valid API key in the Authorization header",
    suggestions: [
      "Include your API key in the Authorization header: 'Bearer dv_env_yourkey'",
      "Ensure your API key is active and not expired",
      "Contact support if you need a new API key",
    ],
    retryable: false,
    logLevel: "WARN",
    alertRequired: false,
  },

  "E1002": {
    code: "E1002",
    category: "authentication",
    severity: "medium",
    httpStatus: 401,
    title: "Invalid API Key",
    message: "The provided API key is invalid or expired",
    userMessage: "Your API key is invalid or has expired",
    suggestions: [
      "Verify your API key format (dv_environment_key)",
      "Check if your API key has expired",
      "Generate a new API key if needed",
    ],
    retryable: false,
    logLevel: "WARN",
    alertRequired: false,
  },

  "E1003": {
    code: "E1003",
    category: "authentication",
    severity: "high",
    httpStatus: 403,
    title: "Insufficient Permissions",
    message: "API key does not have required permissions for this operation",
    userMessage: "Your API key doesn't have permission to perform this action",
    suggestions: [
      "Contact your administrator to upgrade your API key permissions",
      "Use an API key with appropriate permissions",
      "Check the required permissions in the API documentation",
    ],
    retryable: false,
    logLevel: "WARN",
    alertRequired: false,
  },

  // Validation Errors (E2001-E2999)
  "E2001": {
    code: "E2001",
    category: "validation",
    severity: "low",
    httpStatus: 400,
    title: "Invalid Request Format",
    message: "Request body format is invalid or missing required fields",
    userMessage: "Your request is missing required information",
    suggestions: [
      "Check that all required fields are included",
      "Verify the request format matches the API specification",
      "Ensure Content-Type is set correctly",
    ],
    retryable: true,
    logLevel: "INFO",
    alertRequired: false,
  },

  "E2002": {
    code: "E2002",
    category: "validation",
    severity: "medium",
    httpStatus: 400,
    title: "File Validation Failed",
    message: "Uploaded file does not meet validation requirements",
    userMessage: "The uploaded file is invalid",
    suggestions: [
      "Use supported file formats: PDF, PNG, JPEG",
      "Ensure file size is under 50MB",
      "Check that the file is not corrupted",
    ],
    retryable: true,
    logLevel: "INFO",
    alertRequired: false,
  },

  "E2003": {
    code: "E2003",
    category: "validation",
    severity: "medium",
    httpStatus: 400,
    title: "File Too Large",
    message: "Uploaded file exceeds maximum allowed size",
    userMessage: "Your file is too large",
    suggestions: [
      "Compress your file to reduce size",
      "Maximum file size is 50MB",
      "Consider splitting large documents",
    ],
    retryable: true,
    logLevel: "INFO",
    alertRequired: false,
  },

  // Rate Limiting Errors (E2100-E2199)
  "E2101": {
    code: "E2101",
    category: "rate_limiting",
    severity: "medium",
    httpStatus: 429,
    title: "Rate Limit Exceeded",
    message: "Too many requests - rate limit exceeded",
    userMessage: "You've made too many requests. Please slow down.",
    suggestions: [
      "Wait before making another request",
      "Check the X-RateLimit headers for limits",
      "Consider upgrading to a premium API key for higher limits",
    ],
    retryable: true,
    logLevel: "WARN",
    alertRequired: false,
  },

  "E2102": {
    code: "E2102",
    category: "rate_limiting",
    severity: "high",
    httpStatus: 429,
    title: "Abuse Detected",
    message: "Suspicious activity detected - temporary cooldown applied",
    userMessage: "Your API key has been temporarily suspended due to suspicious activity",
    suggestions: [
      "Wait for the cooldown period to expire",
      "Review your request patterns",
      "Contact support if you believe this is an error",
    ],
    retryable: false,
    logLevel: "ERROR",
    alertRequired: true,
  },

  // Processing Errors (E3001-E3999)
  "E3001": {
    code: "E3001",
    category: "processing",
    severity: "medium",
    httpStatus: 404,
    title: "Document Not Found",
    message: "The requested document was not found",
    userMessage: "Document not found",
    suggestions: [
      "Verify the document ID is correct",
      "Check if the document was successfully uploaded",
      "Ensure you have access to this document",
    ],
    retryable: false,
    logLevel: "INFO",
    alertRequired: false,
  },

  "E3002": {
    code: "E3002",
    category: "processing",
    severity: "medium",
    httpStatus: 202,
    title: "Processing Not Complete",
    message: "Document processing is still in progress",
    userMessage: "Document is still being processed",
    suggestions: [
      "Wait a few minutes and try again",
      "Check the document status endpoint",
      "Processing typically takes 5-10 minutes",
    ],
    retryable: true,
    logLevel: "INFO",
    alertRequired: false,
  },

  "E3003": {
    code: "E3003",
    category: "processing",
    severity: "high",
    httpStatus: 500,
    title: "OCR Processing Failed",
    message: "OCR text extraction failed",
    userMessage: "We couldn't extract text from your document",
    suggestions: [
      "Ensure the document image is clear and readable",
      "Try uploading a higher quality scan",
      "Check if the document format is supported",
    ],
    retryable: true,
    logLevel: "ERROR",
    alertRequired: false,
  },

  // Storage Errors (E4001-E4999)
  "E4001": {
    code: "E4001",
    category: "storage",
    severity: "high",
    httpStatus: 500,
    title: "Storage Service Unavailable",
    message: "Document storage service is temporarily unavailable",
    userMessage: "Storage service is temporarily unavailable",
    suggestions: [
      "Try again in a few minutes",
      "Contact support if the problem persists",
      "Check our status page for service updates",
    ],
    retryable: true,
    logLevel: "ERROR",
    alertRequired: true,
  },

  "E4002": {
    code: "E4002",
    category: "storage",
    severity: "high",
    httpStatus: 500,
    title: "File Upload Failed",
    message: "Failed to upload file to storage",
    userMessage: "File upload failed",
    suggestions: [
      "Check your internet connection",
      "Try uploading a smaller file",
      "Retry the upload",
    ],
    retryable: true,
    logLevel: "ERROR",
    alertRequired: false,
  },

  // External Service Errors (E5001-E5999)
  "E5001": {
    code: "E5001",
    category: "external_service",
    severity: "high",
    httpStatus: 503,
    title: "OCR Service Unavailable",
    message: "OCR service is temporarily unavailable",
    userMessage: "Text extraction service is temporarily unavailable",
    suggestions: [
      "Try again later",
      "Processing will continue when the service is restored",
      "Check our status page for updates",
    ],
    retryable: true,
    logLevel: "ERROR",
    alertRequired: true,
  },

  "E5002": {
    code: "E5002",
    category: "external_service",
    severity: "high",
    httpStatus: 503,
    title: "AI Service Unavailable",
    message: "AI verification service is temporarily unavailable",
    userMessage: "AI verification service is temporarily unavailable",
    suggestions: [
      "Document processing will continue without AI verification",
      "Try again later for full analysis",
      "Manual review may be required",
    ],
    retryable: true,
    logLevel: "ERROR",
    alertRequired: true,
  },

  // System Errors (E6001-E6999)
  "E6001": {
    code: "E6001",
    category: "system",
    severity: "critical",
    httpStatus: 500,
    title: "Database Connection Failed",
    message: "Unable to connect to database",
    userMessage: "Database service is temporarily unavailable",
    suggestions: [
      "Try again in a few minutes",
      "Contact support if the problem persists",
    ],
    retryable: true,
    logLevel: "ERROR",
    alertRequired: true,
  },

  "E6002": {
    code: "E6002",
    category: "system",
    severity: "critical",
    httpStatus: 500,
    title: "Cache Service Failed",
    message: "Cache service is unavailable",
    userMessage: "Cache service is temporarily unavailable",
    suggestions: [
      "Requests may be slower than usual",
      "Try again in a few minutes",
    ],
    retryable: true,
    logLevel: "ERROR",
    alertRequired: true,
  },

  "E6003": {
    code: "E6003",
    category: "system",
    severity: "critical",
    httpStatus: 500,
    title: "Internal Server Error",
    message: "An unexpected error occurred",
    userMessage: "An unexpected error occurred. Please try again.",
    suggestions: [
      "Try your request again",
      "Contact support if the problem persists",
      "Include the trace ID when contacting support",
    ],
    retryable: true,
    logLevel: "ERROR",
    alertRequired: true,
  },

  // Business Logic Errors (E7001-E7999)
  "E7001": {
    code: "E7001",
    category: "business_logic",
    severity: "medium",
    httpStatus: 409,
    title: "Document Already Exists",
    message: "A document with this transaction ID already exists",
    userMessage: "Document with this transaction ID already exists",
    suggestions: [
      "Check if you've already uploaded this document",
      "Use a different transaction ID if this is a new transaction",
      "Contact support to update an existing document",
    ],
    retryable: false,
    logLevel: "WARN",
    alertRequired: false,
  },

  "E7002": {
    code: "E7002",
    category: "business_logic",
    severity: "medium",
    httpStatus: 400,
    title: "Transaction Not Found",
    message: "No transaction record found for comparison",
    userMessage: "Transaction record not found in database",
    suggestions: [
      "Verify the transaction ID is correct",
      "Ensure the transaction exists in your system",
      "Document will be processed without comparison data",
    ],
    retryable: false,
    logLevel: "WARN",
    alertRequired: false,
  },
};

/**
 * Error utility class
 */
export class DocumentVerificationError extends Error {
  public readonly code: string;
  public readonly category: ErrorCategory;
  public readonly severity: ErrorSeverity;
  public readonly httpStatus: number;
  public readonly userMessage: string;
  public readonly suggestions: string[];
  public readonly retryable: boolean;
  public readonly traceId: string;
  public readonly context: Partial<ErrorContext>;

  constructor(
    code: string,
    context: Partial<ErrorContext> = {},
    customMessage?: string,
  ) {
    const errorDef = ERROR_CATALOG[code];

    if (!errorDef) {
      // Fallback for unknown error codes
      super(`Unknown error code: ${code}`);
      this.code = "E6003"; // Internal Server Error
      this.category = "system";
      this.severity = "critical";
      this.httpStatus = 500;
      this.userMessage = "An unexpected error occurred";
      this.suggestions = ["Try again later", "Contact support"];
      this.retryable = true;
    } else {
      super(customMessage || errorDef.message);
      this.code = errorDef.code;
      this.category = errorDef.category;
      this.severity = errorDef.severity;
      this.httpStatus = errorDef.httpStatus;
      this.userMessage = errorDef.userMessage;
      this.suggestions = errorDef.suggestions;
      this.retryable = errorDef.retryable;
    }

    this.traceId = context.traceId || crypto.randomUUID();
    this.context = context;
    this.name = "DocumentVerificationError";
  }

  /**
   * Convert to error response format
   */
  toErrorResponse(): ErrorResponse {
    return {
      status: "error",
      error: {
        code: this.code,
        category: this.category,
        title: ERROR_CATALOG[this.code]?.title || "Unknown Error",
        message: this.userMessage,
        suggestions: this.suggestions,
        retryable: this.retryable,
        severity: this.severity,
      },
      trace: {
        traceId: this.traceId,
        requestId: this.context.requestId || "",
        timestamp: (this.context.timestamp || new Date()).toISOString(),
        endpoint: this.context.endpoint || "",
      },
      meta: {
        version: "v1",
        environment: Deno.env.get("ENVIRONMENT") || "development",
      },
    };
  }

  /**
   * Get log entry for structured logging
   */
  toLogEntry(): {
    level: "DEBUG" | "INFO" | "WARN" | "ERROR";
    message: string;
    error: {
      code: string;
      category: ErrorCategory;
      severity: ErrorSeverity;
      httpStatus: number;
      stack: string | undefined;
    };
    context: ErrorContext;
  } {
    const errorDef = ERROR_CATALOG[this.code];

    return {
      level: errorDef?.logLevel || "ERROR",
      message: this.message,
      error: {
        code: this.code,
        category: this.category,
        severity: this.severity,
        httpStatus: this.httpStatus,
        stack: this.stack,
      },
      context: {
        traceId: this.traceId,
        requestId: this.context.requestId || "",
        userId: this.context.userId,
        documentId: this.context.documentId,
        apiKeyId: this.context.apiKeyId,
        endpoint: this.context.endpoint || "",
        userAgent: this.context.userAgent,
        ipAddress: this.context.ipAddress,
        timestamp: this.context.timestamp || new Date(),
        metadata: this.context.metadata,
      },
    };
  }

  /**
   * Check if error requires alerting
   */
  requiresAlert(): boolean {
    const errorDef = ERROR_CATALOG[this.code];
    return errorDef?.alertRequired || this.severity === "critical";
  }
}

/**
 * Error factory functions for common errors
 */
export class ErrorFactory {
  /**
   * Create authentication error
   */
  static authentication(
    type: "required" | "invalid" | "insufficient_permissions",
    context: Partial<ErrorContext> = {},
  ): DocumentVerificationError {
    const codes = {
      required: "E1001",
      invalid: "E1002",
      insufficient_permissions: "E1003",
    };

    return new DocumentVerificationError(codes[type], context);
  }

  /**
   * Create validation error
   */
  static validation(
    type: "invalid_request" | "file_validation" | "file_too_large",
    context: Partial<ErrorContext> = {},
    customMessage?: string,
  ): DocumentVerificationError {
    const codes = {
      invalid_request: "E2001",
      file_validation: "E2002",
      file_too_large: "E2003",
    };

    return new DocumentVerificationError(codes[type], context, customMessage);
  }

  /**
   * Create rate limiting error
   */
  static rateLimit(
    type: "exceeded" | "abuse_detected",
    context: Partial<ErrorContext> = {},
  ): DocumentVerificationError {
    const codes = {
      exceeded: "E2101",
      abuse_detected: "E2102",
    };

    return new DocumentVerificationError(codes[type], context);
  }

  /**
   * Create processing error
   */
  static processing(
    type: "not_found" | "not_complete" | "ocr_failed",
    context: Partial<ErrorContext> = {},
    customMessage?: string,
  ): DocumentVerificationError {
    const codes = {
      not_found: "E3001",
      not_complete: "E3002",
      ocr_failed: "E3003",
    };

    return new DocumentVerificationError(codes[type], context, customMessage);
  }

  /**
   * Create storage error
   */
  static storage(
    type: "unavailable" | "upload_failed",
    context: Partial<ErrorContext> = {},
  ): DocumentVerificationError {
    const codes = {
      unavailable: "E4001",
      upload_failed: "E4002",
    };

    return new DocumentVerificationError(codes[type], context);
  }

  /**
   * Create external service error
   */
  static externalService(
    type: "ocr_unavailable" | "ai_unavailable",
    context: Partial<ErrorContext> = {},
  ): DocumentVerificationError {
    const codes = {
      ocr_unavailable: "E5001",
      ai_unavailable: "E5002",
    };

    return new DocumentVerificationError(codes[type], context);
  }

  /**
   * Create system error
   */
  static system(
    type: "database_failed" | "cache_failed" | "internal_error",
    context: Partial<ErrorContext> = {},
    customMessage?: string,
  ): DocumentVerificationError {
    const codes = {
      database_failed: "E6001",
      cache_failed: "E6002",
      internal_error: "E6003",
    };

    return new DocumentVerificationError(codes[type], context, customMessage);
  }

  /**
   * Create business logic error
   */
  static businessLogic(
    type: "document_exists" | "transaction_not_found",
    context: Partial<ErrorContext> = {},
  ): DocumentVerificationError {
    const codes = {
      document_exists: "E7001",
      transaction_not_found: "E7002",
    };

    return new DocumentVerificationError(codes[type], context);
  }
}

/**
 * Utility functions for error handling
 */
export class ErrorUtils {
  /**
   * Get error definition by code
   */
  static getErrorDefinition(code: string): ErrorDefinition | null {
    return ERROR_CATALOG[code] || null;
  }

  /**
   * Check if error is retryable
   */
  static isRetryable(error: Error): boolean {
    if (error instanceof DocumentVerificationError) {
      return error.retryable;
    }

    // Default behavior for unknown errors
    return false;
  }

  /**
   * Get all errors by category
   */
  static getErrorsByCategory(category: ErrorCategory): ErrorDefinition[] {
    return Object.values(ERROR_CATALOG).filter((error) => error.category === category);
  }

  /**
   * Get all errors by severity
   */
  static getErrorsBySeverity(severity: ErrorSeverity): ErrorDefinition[] {
    return Object.values(ERROR_CATALOG).filter((error) => error.severity === severity);
  }
}
