/**
 * Error Recovery Mechanisms
 * Handles automatic error recovery and fallback behaviors
 */

import { log } from "@/deps.ts";
import { DocumentVerificationError, ErrorFactory } from "@utils/error_catalog.ts";
import type { ErrorContext } from "@utils/error_catalog.ts";

/**
 * Recovery strategy types
 */
export type RecoveryStrategy =
  | "retry"
  | "fallback"
  | "circuit_breaker"
  | "graceful_degradation"
  | "fail_fast";

/**
 * Recovery configuration
 */
export interface RecoveryConfig {
  strategy: RecoveryStrategy;
  maxRetries: number;
  retryDelay: number; // milliseconds
  exponentialBackoff: boolean;
  maxRetryDelay: number; // milliseconds
  timeout: number; // milliseconds
  circuitBreakerThreshold: number;
  fallbackEnabled: boolean;
}

/**
 * Recovery result
 */
export interface RecoveryResult<T> {
  success: boolean;
  data?: T;
  error?: DocumentVerificationError;
  recoveryAttempted: boolean;
  recoveryStrategy?: RecoveryStrategy;
  attempts: number;
  totalDuration: number;
}

/**
 * Circuit breaker state
 */
interface CircuitBreakerState {
  failures: number;
  lastFailure: Date;
  state: "closed" | "open" | "half_open";
  nextAttempt: Date;
}

class ErrorRecoveryService {
  private logger = log.getLogger();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();

  /**
   * Execute operation with error recovery
   */
  async executeWithRecovery<T>(
    operation: () => Promise<T>,
    config: RecoveryConfig,
    context: ErrorContext,
    operationName: string,
  ): Promise<RecoveryResult<T>> {
    const startTime = Date.now();
    let attempts = 0;
    let lastError: DocumentVerificationError | null = null;

    try {
      // Check circuit breaker state
      if (config.strategy === "circuit_breaker") {
        const circuitState = this.getCircuitBreakerState(operationName);
        if (circuitState.state === "open") {
          throw ErrorFactory.externalService("ocr_unavailable", context, "Circuit breaker is open");
        }
      }

      // Attempt operation with retries
      for (attempts = 1; attempts <= config.maxRetries; attempts++) {
        try {
          // Set timeout for operation
          const result = await Promise.race([
            operation(),
            this.createTimeoutPromise<T>(config.timeout, context),
          ]);

          // Success - reset circuit breaker if applicable
          if (config.strategy === "circuit_breaker") {
            this.resetCircuitBreaker(operationName);
          }

          const duration = Date.now() - startTime;

          return {
            success: true,
            data: result,
            recoveryAttempted: attempts > 1,
            recoveryStrategy: config.strategy,
            attempts,
            totalDuration: duration,
          };
        } catch (error) {
          lastError = error instanceof DocumentVerificationError
            ? error
            : this.classifyRecoveryError(error, context);

          this.logger.warn(
            `Operation ${operationName} failed (attempt ${attempts}/${config.maxRetries}):`,
            {
              error: lastError.code,
              message: lastError.message,
              traceId: context.traceId,
            },
          );

          // Update circuit breaker
          if (config.strategy === "circuit_breaker") {
            this.updateCircuitBreaker(operationName, lastError);
          }

          // Check if we should retry
          if (!this.shouldRetry(lastError, attempts, config)) {
            break;
          }

          // Wait before retry (with exponential backoff if configured)
          if (attempts < config.maxRetries) {
            const delay = this.calculateRetryDelay(attempts, config);
            await this.sleep(delay);
          }
        }
      }

      // All retries failed - attempt fallback if enabled
      if (config.fallbackEnabled) {
        const fallbackResult = await this.attemptFallback(operationName, context);
        if (fallbackResult.success) {
          const duration = Date.now() - startTime;

          return {
            success: true,
            data: fallbackResult.data,
            recoveryAttempted: true,
            recoveryStrategy: "fallback",
            attempts,
            totalDuration: duration,
          };
        }
      }

      // Recovery failed
      const duration = Date.now() - startTime;

      return {
        success: false,
        error: lastError || ErrorFactory.system("internal_error", context),
        recoveryAttempted: attempts > 1,
        recoveryStrategy: config.strategy,
        attempts,
        totalDuration: duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      return {
        success: false,
        error: error instanceof DocumentVerificationError
          ? error
          : ErrorFactory.system("internal_error", context, String(error)),
        recoveryAttempted: false,
        attempts,
        totalDuration: duration,
      };
    }
  }

  /**
   * Create timeout promise
   */
  private createTimeoutPromise<T>(timeoutMs: number, context: ErrorContext): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          ErrorFactory.externalService(
            "ocr_unavailable",
            context,
            `Operation timeout after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
    });
  }

  /**
   * Check if error should trigger retry
   */
  private shouldRetry(
    error: DocumentVerificationError,
    attempt: number,
    config: RecoveryConfig,
  ): boolean {
    // Don't retry if max attempts reached
    if (attempt >= config.maxRetries) {
      return false;
    }

    // Don't retry non-retryable errors
    if (!error.retryable) {
      return false;
    }

    // Don't retry certain error categories
    const nonRetryableCategories = ["authentication", "validation", "business_logic"];
    if (nonRetryableCategories.includes(error.category)) {
      return false;
    }

    return true;
  }

  /**
   * Calculate retry delay with optional exponential backoff
   */
  private calculateRetryDelay(attempt: number, config: RecoveryConfig): number {
    if (!config.exponentialBackoff) {
      return config.retryDelay;
    }

    const delay = config.retryDelay * Math.pow(2, attempt - 1);
    return Math.min(delay, config.maxRetryDelay);
  }

  /**
   * Manage circuit breaker state
   */
  private getCircuitBreakerState(operationName: string): CircuitBreakerState {
    const existing = this.circuitBreakers.get(operationName);

    if (existing) {
      // Check if half-open period has passed
      if (existing.state === "open" && Date.now() > existing.nextAttempt.getTime()) {
        existing.state = "half_open";
      }
      return existing;
    }

    // Create new circuit breaker
    const newState: CircuitBreakerState = {
      failures: 0,
      lastFailure: new Date(),
      state: "closed",
      nextAttempt: new Date(),
    };

    this.circuitBreakers.set(operationName, newState);
    return newState;
  }

  /**
   * Update circuit breaker on failure
   */
  private updateCircuitBreaker(operationName: string, error: DocumentVerificationError): void {
    const state = this.getCircuitBreakerState(operationName);

    state.failures++;
    state.lastFailure = new Date();

    // Open circuit if threshold exceeded
    if (state.failures >= 5) { // Configurable threshold
      state.state = "open";
      state.nextAttempt = new Date(Date.now() + 60000); // 1 minute

      this.logger.warn(`Circuit breaker opened for ${operationName}`, {
        failures: state.failures,
        nextAttempt: state.nextAttempt,
      });
    }
  }

  /**
   * Reset circuit breaker on success
   */
  private resetCircuitBreaker(operationName: string): void {
    const state = this.circuitBreakers.get(operationName);
    if (state) {
      state.failures = 0;
      state.state = "closed";

      if (state.failures > 0) {
        this.logger.info(`Circuit breaker reset for ${operationName}`);
      }
    }
  }

  /**
   * Attempt fallback operation
   */
  private async attemptFallback<T>(
    operationName: string,
    context: ErrorContext,
  ): Promise<{ success: boolean; data?: T }> {
    try {
      this.logger.info(`Attempting fallback for ${operationName}`, {
        traceId: context.traceId,
      });

      // Operation-specific fallbacks
      switch (operationName) {
        case "ocr_processing":
          // Fallback to basic text extraction
          return { success: true, data: { extracted: "fallback_data", confidence: 0.3 } as T };

        case "ai_verification":
          // Fallback to basic validation
          return { success: true, data: { score: 0.5, reasoning: "Fallback verification" } as T };

        case "database_lookup":
          // Fallback to processing without comparison
          return { success: true, data: { found: false, comparison: null } as T };

        default:
          return { success: false };
      }
    } catch (error) {
      this.logger.error(`Fallback failed for ${operationName}:`, error);
      return { success: false };
    }
  }

  /**
   * Classify errors for recovery purposes
   */
  private classifyRecoveryError(error: unknown, context: ErrorContext): DocumentVerificationError {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes("timeout")) {
        return ErrorFactory.externalService("ocr_unavailable", context, "Operation timeout");
      }

      if (message.includes("network") || message.includes("connection")) {
        return ErrorFactory.externalService("ocr_unavailable", context, "Network error");
      }

      return ErrorFactory.system("internal_error", context, error.message);
    }

    return ErrorFactory.system("internal_error", context, String(error));
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get circuit breaker statistics
   */
  getCircuitBreakerStats(): Record<string, CircuitBreakerState> {
    return Object.fromEntries(this.circuitBreakers.entries());
  }

  /**
   * Reset all circuit breakers (for testing)
   */
  resetAllCircuitBreakers(): void {
    this.circuitBreakers.clear();
    this.logger.info("All circuit breakers reset");
  }
}

export const errorRecoveryService = new ErrorRecoveryService();

/**
 * Default recovery configurations for common operations
 */
export const DEFAULT_RECOVERY_CONFIGS: Record<string, RecoveryConfig> = {
  database_operation: {
    strategy: "retry",
    maxRetries: 3,
    retryDelay: 1000,
    exponentialBackoff: true,
    maxRetryDelay: 10000,
    timeout: 30000,
    circuitBreakerThreshold: 5,
    fallbackEnabled: false,
  },

  external_api: {
    strategy: "circuit_breaker",
    maxRetries: 2,
    retryDelay: 2000,
    exponentialBackoff: true,
    maxRetryDelay: 30000,
    timeout: 60000,
    circuitBreakerThreshold: 3,
    fallbackEnabled: true,
  },

  file_processing: {
    strategy: "retry",
    maxRetries: 2,
    retryDelay: 5000,
    exponentialBackoff: false,
    maxRetryDelay: 5000,
    timeout: 120000,
    circuitBreakerThreshold: 5,
    fallbackEnabled: true,
  },

  cache_operation: {
    strategy: "fallback",
    maxRetries: 1,
    retryDelay: 500,
    exponentialBackoff: false,
    maxRetryDelay: 500,
    timeout: 5000,
    circuitBreakerThreshold: 10,
    fallbackEnabled: true,
  },
};
