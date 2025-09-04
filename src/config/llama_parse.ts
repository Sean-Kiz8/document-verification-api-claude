/**
 * Llama Parse Configuration
 * API client setup for OCR document processing
 */

import { log } from "@/deps.ts";
import { getConfig } from "@config/env.ts";
import type { OcrConfig } from "@models/ocr.ts";

/**
 * Llama Parse API configuration
 */
export interface LlamaParseConfig {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  retryAttempts: number;
  defaultLanguages: string[];
  defaultPreset: "cost_effective" | "agentic" | "agentic_plus" | "use_case_oriented";
  numWorkers: number;
  maxFileSize: number; // in bytes
}

/**
 * Default OCR configuration for payment documents
 */
export const DEFAULT_OCR_CONFIG: OcrConfig = {
  language: ["en", "ru"], // English and Russian support
  timeout: 15000, // 15 seconds
  retryAttempts: 2,
  preset: "agentic", // Best for complex documents with images/tables
  numWorkers: 4,
  verbose: true,
};

class LlamaParseManager {
  private config: LlamaParseConfig | null = null;
  private logger = log.getLogger();

  /**
   * Initialize Llama Parse configuration
   */
  async initialize(): Promise<void> {
    try {
      const appConfig = await getConfig();

      this.config = {
        apiKey: appConfig.llamaParseApiKey,
        baseUrl: "https://api.cloud.llamaindex.ai/api/v1",
        timeout: 15000, // 15 seconds
        retryAttempts: 2,
        defaultLanguages: ["en", "ru"],
        defaultPreset: "agentic",
        numWorkers: 4,
        maxFileSize: 50 * 1024 * 1024, // 50MB max file size
      };

      // Validate required configuration
      this.validateConfig();

      this.logger.info("Llama Parse configuration initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize Llama Parse configuration:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Llama Parse initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Validate Llama Parse configuration
   */
  private validateConfig(): void {
    if (!this.config) {
      throw new Error("Llama Parse configuration not loaded");
    }

    if (!this.config.apiKey) {
      throw new Error("LLAMA_PARSE_API_KEY is required but not configured");
    }

    if (!this.config.apiKey.startsWith("llx-")) {
      throw new Error("Invalid Llama Parse API key format. Should start with 'llx-'");
    }

    // Validate base URL format
    try {
      new URL(this.config.baseUrl);
    } catch {
      throw new Error("Invalid Llama Parse base URL format");
    }

    this.logger.info(
      `Llama Parse configured with API key: ${this.config.apiKey.substring(0, 8)}...`,
    );
  }

  /**
   * Get Llama Parse configuration
   */
  getConfig(): LlamaParseConfig {
    if (!this.config) {
      throw new Error("Llama Parse configuration not initialized. Call initialize() first.");
    }
    return this.config;
  }

  /**
   * Create HTTP headers for API requests
   */
  createHeaders(): Record<string, string> {
    if (!this.config) {
      throw new Error("Llama Parse configuration not initialized");
    }

    return {
      "Authorization": `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "document-verification-api/1.0.0",
    };
  }

  /**
   * Create form data headers for file uploads
   */
  createFormHeaders(): Record<string, string> {
    if (!this.config) {
      throw new Error("Llama Parse configuration not initialized");
    }

    return {
      "Authorization": `Bearer ${this.config.apiKey}`,
      "User-Agent": "document-verification-api/1.0.0",
      // Content-Type will be set automatically for FormData
    };
  }

  /**
   * Get API endpoint URL
   */
  getEndpoint(path: string): string {
    if (!this.config) {
      throw new Error("Llama Parse configuration not initialized");
    }

    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${this.config.baseUrl}${cleanPath}`;
  }

  /**
   * Check if file size is within limits
   */
  isFileSizeValid(fileSize: number): boolean {
    if (!this.config) {
      return false;
    }
    return fileSize <= this.config.maxFileSize;
  }

  /**
   * Get health information
   */
  async getHealthInfo(): Promise<{
    status: "healthy" | "unhealthy";
    apiKey: string;
    baseUrl: string;
    lastCheck: string;
    latency?: number;
  }> {
    if (!this.config) {
      return {
        status: "unhealthy",
        apiKey: "not_configured",
        baseUrl: "unknown",
        lastCheck: new Date().toISOString(),
      };
    }

    try {
      const startTime = Date.now();

      // Test API connectivity with a simple health check
      const response = await fetch(this.getEndpoint("/health"), {
        method: "GET",
        headers: this.createHeaders(),
        signal: AbortSignal.timeout(5000), // 5 second timeout for health check
      });

      const latency = Date.now() - startTime;
      const status = response.ok ? "healthy" : "unhealthy";

      return {
        status,
        apiKey: `${this.config.apiKey.substring(0, 8)}...`,
        baseUrl: this.config.baseUrl,
        lastCheck: new Date().toISOString(),
        latency,
      };
    } catch (error) {
      this.logger.warn("Llama Parse health check failed:", error);

      return {
        status: "unhealthy",
        apiKey: `${this.config.apiKey.substring(0, 8)}...`,
        baseUrl: this.config.baseUrl,
        lastCheck: new Date().toISOString(),
      };
    }
  }
}

// Global Llama Parse manager instance
const llamaParseManager = new LlamaParseManager();

export { llamaParseManager as llamaParse };

/**
 * Initialize Llama Parse configuration
 */
export async function initializeLlamaParse(): Promise<void> {
  await llamaParseManager.initialize();
}

/**
 * Get Llama Parse configuration
 */
export function getLlamaParseConfig(): LlamaParseConfig {
  return llamaParseManager.getConfig();
}

/**
 * Get Llama Parse health information
 */
export async function getLlamaParseHealth() {
  return llamaParseManager.getHealthInfo();
}
