import { AwsClient } from "@/deps.ts";
import { getConfig } from "@config/env.ts";
import { log } from "@/deps.ts";

/**
 * Cloudflare R2 S3-Compatible Storage Configuration
 * Manages connection and operations with R2 using S3 API
 */

export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

class S3Manager {
  private client: AwsClient | null = null;
  private config: S3Config | null = null;
  private logger = log.getLogger();

  /**
   * Initialize S3/R2 client
   */
  async initialize(): Promise<void> {
    if (this.client) {
      this.logger.warn("S3 client already initialized");
      return;
    }

    try {
      const appConfig = await getConfig();

      this.config = {
        endpoint: appConfig.s3Endpoint,
        bucket: appConfig.s3Bucket,
        region: appConfig.s3Region,
        accessKeyId: appConfig.s3AccessKeyId,
        secretAccessKey: appConfig.s3SecretAccessKey,
      };

      // Validate required configuration
      this.validateConfig();

      // Initialize AWS client for Cloudflare R2
      this.client = new AwsClient({
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
        region: this.config.region,
        service: "s3",
      });

      // Test connection
      await this.testConnection();

      this.logger.info(`S3/R2 client initialized for bucket: ${this.config.bucket}`);
    } catch (error) {
      this.logger.error("Failed to initialize S3 client:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`S3 initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Validate S3 configuration
   */
  private validateConfig(): void {
    if (!this.config) {
      throw new Error("S3 configuration not loaded");
    }

    const requiredFields: Array<keyof S3Config> = [
      "endpoint",
      "bucket",
      "accessKeyId",
      "secretAccessKey",
    ];

    const missingFields = requiredFields.filter((field) => !this.config![field]);

    if (missingFields.length > 0) {
      throw new Error(`Missing required S3 configuration: ${missingFields.join(", ")}`);
    }

    // Validate endpoint format
    try {
      new URL(this.config.endpoint);
    } catch {
      throw new Error("Invalid S3 endpoint URL format");
    }
  }

  /**
   * Test S3 connection by listing bucket
   */
  private async testConnection(): Promise<void> {
    if (!this.client || !this.config) {
      throw new Error("S3 client not initialized");
    }

    try {
      // Test connection by making a simple head bucket request
      const response = await this.client.fetch(this.config.endpoint, {
        method: "HEAD",
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`S3 connection test failed: ${response.status} ${response.statusText}`);
      }

      this.logger.info("S3 connection test successful");
    } catch (error) {
      this.logger.error("S3 connection test failed:", error);
      throw error;
    }
  }

  /**
   * Get S3 client instance
   */
  getClient(): AwsClient {
    if (!this.client) {
      throw new Error("S3 client not initialized. Call initialize() first.");
    }
    return this.client;
  }

  /**
   * Get S3 configuration
   */
  getConfig(): S3Config {
    if (!this.config) {
      throw new Error("S3 configuration not loaded");
    }
    return this.config;
  }

  /**
   * Get bucket URL
   */
  getBucketUrl(): string {
    if (!this.config) {
      throw new Error("S3 configuration not loaded");
    }
    return `${this.config.endpoint}/${this.config.bucket}`;
  }

  /**
   * Generate object URL
   */
  getObjectUrl(key: string): string {
    return `${this.getBucketUrl()}/${key}`;
  }

  /**
   * Get S3 health information
   */
  async getHealthInfo(): Promise<{
    status: "healthy" | "unhealthy";
    bucket: string;
    endpoint: string;
    lastCheck: string;
    latency?: number;
  }> {
    if (!this.client || !this.config) {
      return {
        status: "unhealthy",
        bucket: "unknown",
        endpoint: "unknown",
        lastCheck: new Date().toISOString(),
      };
    }

    try {
      const startTime = Date.now();

      // Test connection
      const response = await this.client.fetch(this.config.endpoint, {
        method: "HEAD",
      });

      const latency = Date.now() - startTime;
      const status = (response.ok || response.status === 404) ? "healthy" : "unhealthy";

      return {
        status,
        bucket: this.config.bucket,
        endpoint: this.config.endpoint,
        lastCheck: new Date().toISOString(),
        latency,
      };
    } catch (error) {
      this.logger.error("S3 health check failed:", error);

      return {
        status: "unhealthy",
        bucket: this.config.bucket,
        endpoint: this.config.endpoint,
        lastCheck: new Date().toISOString(),
      };
    }
  }

  /**
   * Generate signed URL for operations
   */
  async generateSignedUrl(
    key: string,
    method: "GET" | "PUT" | "DELETE" = "GET",
    expiresIn: number = 3600, // 1 hour default
  ): Promise<string> {
    if (!this.client || !this.config) {
      throw new Error("S3 client not initialized");
    }

    try {
      const objectUrl = this.getObjectUrl(key);
      const url = new URL(objectUrl);
      url.searchParams.set("X-Amz-Expires", expiresIn.toString());

      const request = new Request(url.toString(), { method });
      const signedRequest = await this.client.sign(request, {
        aws: { signQuery: true },
      });

      return signedRequest.url;
    } catch (error) {
      this.logger.error("Failed to generate signed URL:", error);
      throw error;
    }
  }

  /**
   * Upload object to S3/R2
   */
  async uploadObject(
    key: string,
    body: Uint8Array | ReadableStream | string,
    options?: {
      contentType?: string;
      metadata?: Record<string, string>;
      cacheControl?: string;
    },
  ): Promise<{
    key: string;
    url: string;
    etag?: string;
  }> {
    if (!this.client || !this.config) {
      throw new Error("S3 client not initialized");
    }

    try {
      const objectUrl = this.getObjectUrl(key);

      const headers: Record<string, string> = {};

      if (options?.contentType) {
        headers["Content-Type"] = options.contentType;
      }

      if (options?.cacheControl) {
        headers["Cache-Control"] = options.cacheControl;
      }

      // Add metadata headers
      if (options?.metadata) {
        for (const [metaKey, metaValue] of Object.entries(options.metadata)) {
          headers[`x-amz-meta-${metaKey}`] = metaValue;
        }
      }

      const response = await this.client.fetch(objectUrl, {
        method: "PUT",
        headers,
        body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `S3 upload failed: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      const etag = response.headers.get("etag");

      this.logger.info(`Successfully uploaded object: ${key}`);

      const result: { key: string; url: string; etag?: string } = {
        key,
        url: objectUrl,
      };

      if (etag) {
        result.etag = etag;
      }

      return result;
    } catch (error) {
      this.logger.error("S3 upload failed:", error);
      throw error;
    }
  }

  /**
   * Delete object from S3/R2
   */
  async deleteObject(key: string): Promise<boolean> {
    if (!this.client || !this.config) {
      throw new Error("S3 client not initialized");
    }

    try {
      const objectUrl = this.getObjectUrl(key);

      const response = await this.client.fetch(objectUrl, {
        method: "DELETE",
      });

      if (!response.ok && response.status !== 404) {
        const errorText = await response.text();
        throw new Error(
          `S3 delete failed: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      this.logger.info(`Successfully deleted object: ${key}`);
      return true;
    } catch (error) {
      this.logger.error("S3 delete failed:", error);
      throw error;
    }
  }

  /**
   * Check if object exists
   */
  async objectExists(key: string): Promise<boolean> {
    if (!this.client || !this.config) {
      throw new Error("S3 client not initialized");
    }

    try {
      const objectUrl = this.getObjectUrl(key);

      const response = await this.client.fetch(objectUrl, {
        method: "HEAD",
      });

      return response.ok;
    } catch (error) {
      this.logger.error("S3 head object failed:", error);
      return false;
    }
  }

  /**
   * Get object metadata
   */
  async getObjectMetadata(key: string): Promise<
    {
      contentType?: string;
      contentLength?: number;
      lastModified?: Date;
      etag?: string;
      metadata?: Record<string, string>;
    } | null
  > {
    if (!this.client || !this.config) {
      throw new Error("S3 client not initialized");
    }

    try {
      const objectUrl = this.getObjectUrl(key);

      const response = await this.client.fetch(objectUrl, {
        method: "HEAD",
      });

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`S3 head object failed: ${response.status} ${response.statusText}`);
      }

      const metadata: Record<string, string> = {};

      // Extract custom metadata
      for (const [headerName, headerValue] of response.headers.entries()) {
        if (headerName.startsWith("x-amz-meta-")) {
          const metaKey = headerName.replace("x-amz-meta-", "");
          metadata[metaKey] = headerValue;
        }
      }

      const result: {
        contentType?: string;
        contentLength?: number;
        lastModified?: Date;
        etag?: string;
        metadata?: Record<string, string>;
      } = {};

      const contentType = response.headers.get("content-type");
      if (contentType) result.contentType = contentType;

      const contentLength = response.headers.get("content-length");
      if (contentLength) result.contentLength = parseInt(contentLength);

      const lastModified = response.headers.get("last-modified");
      if (lastModified) result.lastModified = new Date(lastModified);

      const etag = response.headers.get("etag");
      if (etag) result.etag = etag;

      if (Object.keys(metadata).length > 0) result.metadata = metadata;

      return result;
    } catch (error) {
      this.logger.error("S3 get metadata failed:", error);
      throw error;
    }
  }
}

// Global S3 manager instance
const s3Manager = new S3Manager();

export { s3Manager as s3 };

/**
 * Initialize S3 connection
 */
export async function initializeS3(): Promise<void> {
  await s3Manager.initialize();
}

/**
 * Get S3 client for direct access
 */
export function getS3Client(): AwsClient {
  return s3Manager.getClient();
}

/**
 * Get S3 configuration
 */
export function getS3Config(): S3Config {
  return s3Manager.getConfig();
}

/**
 * S3 health check
 */
export async function getS3Health() {
  return s3Manager.getHealthInfo();
}
