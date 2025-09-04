/**
 * Structured Logger Utility
 * Enhanced logging with structured JSON format and context tracking
 */

import { log } from "@/deps.ts";
import type { ErrorContext } from "@utils/error_catalog.ts";

/**
 * Log entry types
 */
export type LogEntryType =
  | "request"
  | "error"
  | "business_event"
  | "security_event"
  | "performance"
  | "audit";

/**
 * Structured log entry
 */
export interface StructuredLogEntry {
  // Standard fields
  timestamp: string;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL";
  type: LogEntryType;
  message: string;

  // Optional context fields
  traceId?: string;
  requestId?: string;
  userId?: string;
  documentId?: string;
  apiKeyId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  duration?: number;

  // Optional nested objects
  error?: {
    code?: string;
    category?: string;
    severity?: string;
    stack?: string;
  };

  performance?: {
    cpuUsage?: number;
    memoryUsage?: number;
    responseTime?: number;
  };

  business?: {
    operation?: string;
    entity?: string;
    entityId?: string;
    outcome?: "success" | "failure" | "partial";
  };

  security?: {
    eventType?: "authentication" | "authorization" | "abuse" | "anomaly";
    riskLevel?: "low" | "medium" | "high" | "critical";
    ipAddress?: string;
    userAgent?: string;
  };

  metadata?: Record<string, unknown>;
  environment?: string;
  service?: string;
  version?: string;
}

/**
 * Request log entry
 */
export interface RequestLogEntry {
  traceId: string;
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  duration: number;
  success: boolean;
  userId?: string;
  apiKeyId?: string;
  userAgent?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Error log entry
 */
export interface ErrorLogEntry {
  level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  message: string;
  error: {
    code: string;
    category: string;
    severity: string;
    stack?: string;
  };
  context: Partial<ErrorContext>;
  duration?: number;
}

/**
 * Business event log entry
 */
export interface BusinessEventLogEntry {
  event: string;
  entity: string;
  entityId: string;
  outcome: "success" | "failure" | "partial";
  details?: Record<string, unknown>;
  traceId?: string;
  requestId?: string;
  userId?: string;
  documentId?: string;
  metadata?: Record<string, unknown>;
}

class StructuredLogger {
  private logger = log.getLogger();

  /**
   * Log a request
   */
  async logRequest(entry: RequestLogEntry): Promise<void> {
    try {
      const structuredEntry: StructuredLogEntry = {
        timestamp: new Date().toISOString(),
        level: entry.success ? "INFO" : "WARN",
        type: "request",
        message: `${entry.method} ${entry.path} - ${entry.statusCode} (${entry.duration}ms)`,
        traceId: entry.traceId,
        requestId: entry.requestId,
        userId: entry.userId,
        apiKeyId: entry.apiKeyId,
        method: entry.method,
        path: entry.path,
        statusCode: entry.statusCode,
        duration: entry.duration,
        security: {
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
        },
        metadata: entry.metadata,
        environment: Deno.env.get("ENVIRONMENT"),
        service: "document-verification-api",
        version: "1.0.0",
      };

      await this.writeLogEntry(structuredEntry);
    } catch (error) {
      this.logger.error("Failed to log request:", error);
    }
  }

  /**
   * Log an error
   */
  async logError(entry: ErrorLogEntry): Promise<void> {
    try {
      const structuredEntry: StructuredLogEntry = {
        timestamp: new Date().toISOString(),
        level: entry.level,
        type: "error",
        message: entry.message,
        traceId: entry.context.traceId,
        requestId: entry.context.requestId,
        userId: entry.context.userId,
        documentId: entry.context.documentId,
        apiKeyId: entry.context.apiKeyId,
        method: entry.context.endpoint?.split(" ")[0],
        path: entry.context.endpoint?.split(" ")[1],
        duration: entry.duration,
        error: entry.error,
        security: {
          ipAddress: entry.context.ipAddress,
          userAgent: entry.context.userAgent,
        },
        metadata: entry.context.metadata,
        environment: Deno.env.get("ENVIRONMENT"),
        service: "document-verification-api",
        version: "1.0.0",
      };

      await this.writeLogEntry(structuredEntry);

      // Also log to console for development
      if (entry.level === "ERROR") {
        this.logger.error(`${entry.error.code}: ${entry.message}`, {
          traceId: entry.context.traceId,
          category: entry.error.category,
          severity: entry.error.severity,
        });
      }
    } catch (error) {
      this.logger.error("Failed to log error:", error);
    }
  }

  /**
   * Log business event
   */
  async logBusinessEvent(entry: BusinessEventLogEntry): Promise<void> {
    try {
      const structuredEntry: StructuredLogEntry = {
        timestamp: new Date().toISOString(),
        level: entry.outcome === "success" ? "INFO" : "WARN",
        type: "business_event",
        message: `${entry.event}: ${entry.entity}(${entry.entityId}) - ${entry.outcome}`,
        traceId: entry.traceId,
        requestId: entry.requestId,
        userId: entry.userId,
        documentId: entry.documentId,
        business: {
          operation: entry.event,
          entity: entry.entity,
          entityId: entry.entityId,
          outcome: entry.outcome,
        },
        metadata: entry.details,
        environment: Deno.env.get("ENVIRONMENT"),
        service: "document-verification-api",
        version: "1.0.0",
      };

      await this.writeLogEntry(structuredEntry);
    } catch (error) {
      this.logger.error("Failed to log business event:", error);
    }
  }

  /**
   * Log security event
   */
  async logSecurityEvent(
    eventType: "authentication" | "authorization" | "abuse" | "anomaly",
    message: string,
    context: Partial<ErrorContext>,
    riskLevel: "low" | "medium" | "high" | "critical" = "medium",
  ): Promise<void> {
    try {
      const structuredEntry: StructuredLogEntry = {
        timestamp: new Date().toISOString(),
        level: riskLevel === "critical" || riskLevel === "high" ? "ERROR" : "WARN",
        type: "security_event",
        message,
        traceId: context.traceId,
        requestId: context.requestId,
        userId: context.userId,
        apiKeyId: context.apiKeyId,
        security: {
          eventType,
          riskLevel,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        metadata: context.metadata,
        environment: Deno.env.get("ENVIRONMENT"),
        service: "document-verification-api",
        version: "1.0.0",
      };

      await this.writeLogEntry(structuredEntry);

      // Also log to console for immediate visibility
      if (riskLevel === "critical" || riskLevel === "high") {
        this.logger.error(`SECURITY ALERT: ${message}`, {
          traceId: context.traceId,
          eventType,
          riskLevel,
        });
      }
    } catch (error) {
      this.logger.error("Failed to log security event:", error);
    }
  }

  /**
   * Log performance metrics
   */
  async logPerformance(
    operation: string,
    duration: number,
    context: Partial<ErrorContext>,
    metrics?: {
      cpuUsage?: number;
      memoryUsage?: number;
      queueDepth?: number;
    },
  ): Promise<void> {
    try {
      const structuredEntry: StructuredLogEntry = {
        timestamp: new Date().toISOString(),
        level: "INFO",
        type: "performance",
        message: `Performance: ${operation} completed in ${duration}ms`,
        traceId: context.traceId,
        requestId: context.requestId,
        documentId: context.documentId,
        duration,
        performance: {
          responseTime: duration,
          cpuUsage: metrics?.cpuUsage,
          memoryUsage: metrics?.memoryUsage,
        },
        business: {
          operation,
          outcome: "success",
        },
        metadata: {
          queueDepth: metrics?.queueDepth,
          ...context.metadata,
        },
        environment: Deno.env.get("ENVIRONMENT"),
        service: "document-verification-api",
        version: "1.0.0",
      };

      await this.writeLogEntry(structuredEntry);
    } catch (error) {
      this.logger.error("Failed to log performance metrics:", error);
    }
  }

  /**
   * Write structured log entry
   */
  private async writeLogEntry(entry: StructuredLogEntry): Promise<void> {
    try {
      // In production, this would write to log aggregation service
      // (e.g., ELK stack, CloudWatch, Datadog)

      const logLine = JSON.stringify(entry);

      // Write to console in structured format
      switch (entry.level) {
        case "DEBUG":
          this.logger.debug(logLine);
          break;
        case "INFO":
          this.logger.info(logLine);
          break;
        case "WARN":
          this.logger.warn(logLine);
          break;
        case "ERROR":
        case "CRITICAL":
          this.logger.error(logLine);
          break;
      }

      // In production, also write to external logging service
      await this.writeToExternalLogger(entry);
    } catch (error) {
      // Fallback logging
      console.error("Structured logging failed:", error);
      console.log("Original log entry:", entry);
    }
  }

  /**
   * Write to external logging service (placeholder)
   */
  private async writeToExternalLogger(entry: StructuredLogEntry): Promise<void> {
    // In production, implement integration with:
    // - ELK Stack (Elasticsearch, Logstash, Kibana)
    // - CloudWatch Logs
    // - Datadog
    // - Splunk
    // - Other log aggregation services

    // For now, just ensure the entry is properly formatted
    if (!entry.timestamp || !entry.level || !entry.type) {
      throw new Error("Invalid log entry format");
    }
  }

  /**
   * Search logs by criteria (placeholder for production implementation)
   */
  async searchLogs(criteria: {
    traceId?: string;
    requestId?: string;
    userId?: string;
    documentId?: string;
    level?: string;
    category?: string;
    timeRange?: {
      start: Date;
      end: Date;
    };
    limit?: number;
  }): Promise<StructuredLogEntry[]> {
    // In production, this would query the log aggregation service
    // For development, return empty array
    this.logger.info("Log search requested:", criteria);
    return [];
  }

  /**
   * Get logging statistics
   */
  getLoggingStats(): {
    entriesLogged: number;
    errorCount: number;
    warningCount: number;
    criticalCount: number;
    averageLogSize: number;
  } {
    // In production, this would return actual statistics
    return {
      entriesLogged: 0,
      errorCount: 0,
      warningCount: 0,
      criticalCount: 0,
      averageLogSize: 0,
    };
  }
}

export const structuredLogger = new StructuredLogger();
