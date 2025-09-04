import { s3 } from "@config/s3.ts";
import { log } from "@/deps.ts";

/**
 * Document Storage Service
 * Handles secure document storage and retrieval using Cloudflare R2
 */

export interface UploadOptions {
  contentType: string;
  originalFileName: string;
  userId: string;
  transactionId?: string;
  disputeId?: string;
}

export interface StorageResult {
  key: string;
  url: string;
  uploadUrl?: string;
  downloadUrl?: string;
  etag?: string;
  size?: number;
}

export interface FileValidationResult {
  valid: boolean;
  errors: string[];
  contentType?: string;
  size?: number;
}

class StorageService {
  private logger = log.getLogger();

  // Supported MIME types for document uploads
  private readonly ALLOWED_MIME_TYPES = [
    "image/png",
    "image/jpeg",
    "application/pdf",
  ];

  // Maximum file size (10MB)
  private readonly MAX_FILE_SIZE = 10 * 1024 * 1024;

  /**
   * Validate uploaded file
   */
  validateFile(
    fileData: Uint8Array,
    contentType: string,
    originalFileName: string,
  ): FileValidationResult {
    const errors: string[] = [];

    // Check file size
    if (fileData.length > this.MAX_FILE_SIZE) {
      errors.push(`File size ${fileData.length} bytes exceeds maximum ${this.MAX_FILE_SIZE} bytes`);
    }

    if (fileData.length === 0) {
      errors.push("File is empty");
    }

    // Check MIME type
    if (!this.ALLOWED_MIME_TYPES.includes(contentType)) {
      errors.push(
        `Unsupported file type: ${contentType}. Allowed: ${this.ALLOWED_MIME_TYPES.join(", ")}`,
      );
    }

    // Basic file signature validation
    const validSignature = this.validateFileSignature(fileData, contentType);
    if (!validSignature) {
      errors.push("File content does not match declared MIME type");
    }

    // Check filename
    if (!originalFileName || originalFileName.length > 255) {
      errors.push("Invalid filename");
    }

    return {
      valid: errors.length === 0,
      errors,
      contentType,
      size: fileData.length,
    };
  }

  /**
   * Validate file signature matches MIME type
   */
  private validateFileSignature(fileData: Uint8Array, contentType: string): boolean {
    if (fileData.length < 4) return false;

    const header = Array.from(fileData.slice(0, 8))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    switch (contentType) {
      case "image/png":
        return header.startsWith("89504e47"); // PNG signature

      case "image/jpeg":
        return header.startsWith("ffd8ff"); // JPEG signature

      case "application/pdf":
        return header.startsWith("25504446"); // PDF signature (%PDF)

      default:
        return false;
    }
  }

  /**
   * Generate S3 key for document storage
   */
  generateDocumentKey(options: UploadOptions): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, "0");
    const day = now.getDate().toString().padStart(2, "0");

    const documentId = crypto.randomUUID();
    const fileExtension = this.getFileExtension(options.contentType);

    // Structure: documents/YYYY/MM/DD/user_id/transaction_id/document_id.ext
    let key = `documents/${year}/${month}/${day}/${options.userId}`;

    if (options.transactionId) {
      key += `/${options.transactionId}`;
    }

    key += `/${documentId}${fileExtension}`;

    return key;
  }

  /**
   * Get file extension from MIME type
   */
  private getFileExtension(contentType: string): string {
    switch (contentType) {
      case "image/png":
        return ".png";
      case "image/jpeg":
        return ".jpg";
      case "application/pdf":
        return ".pdf";
      default:
        return "";
    }
  }

  /**
   * Upload document directly to S3
   */
  async uploadDocument(
    fileData: Uint8Array,
    options: UploadOptions,
  ): Promise<StorageResult> {
    try {
      // Validate file
      const validation = this.validateFile(fileData, options.contentType, options.originalFileName);
      if (!validation.valid) {
        throw new Error(`File validation failed: ${validation.errors.join(", ")}`);
      }

      // Generate storage key
      const key = this.generateDocumentKey(options);

      // Upload to S3/R2
      const result = await s3.uploadObject(key, fileData, {
        contentType: options.contentType,
        metadata: {
          "original-filename": options.originalFileName,
          "user-id": options.userId,
          "transaction-id": options.transactionId || "",
          "dispute-id": options.disputeId || "",
          "upload-timestamp": new Date().toISOString(),
        },
        cacheControl: "private, max-age=31536000", // 1 year cache for immutable documents
      });

      this.logger.info(`Document uploaded successfully: ${key}`, {
        key,
        userId: options.userId,
        originalFileName: options.originalFileName,
        size: fileData.length,
      });

      return {
        key: result.key,
        url: result.url,
        ...(result.etag ? { etag: result.etag } : {}),
        size: fileData.length,
      };
    } catch (error) {
      this.logger.error("Document upload failed:", error, {
        userId: options.userId,
        originalFileName: options.originalFileName,
        contentType: options.contentType,
      });
      throw error;
    }
  }

  /**
   * Generate signed upload URL for direct client uploads
   */
  async generateUploadUrl(
    options: UploadOptions,
    expiresIn: number = 900, // 15 minutes default
  ): Promise<{
    uploadUrl: string;
    key: string;
    expiresAt: Date;
  }> {
    try {
      // Generate storage key
      const key = this.generateDocumentKey(options);

      // Generate signed upload URL
      const uploadUrl = await s3.generateSignedUrl(key, "PUT", expiresIn);

      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      this.logger.info(`Generated signed upload URL: ${key}`, {
        key,
        userId: options.userId,
        expiresAt,
      });

      return {
        uploadUrl,
        key,
        expiresAt,
      };
    } catch (error) {
      this.logger.error("Failed to generate upload URL:", error, {
        userId: options.userId,
        originalFileName: options.originalFileName,
      });
      throw error;
    }
  }

  /**
   * Generate signed download URL
   */
  async generateDownloadUrl(
    key: string,
    expiresIn: number = 86400, // 24 hours default
  ): Promise<{
    downloadUrl: string;
    expiresAt: Date;
  }> {
    try {
      // Verify object exists
      const exists = await s3.objectExists(key);
      if (!exists) {
        throw new Error("Document not found");
      }

      // Generate signed download URL
      const downloadUrl = await s3.generateSignedUrl(key, "GET", expiresIn);

      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      this.logger.info(`Generated signed download URL: ${key}`, {
        key,
        expiresAt,
      });

      return {
        downloadUrl,
        expiresAt,
      };
    } catch (error) {
      this.logger.error("Failed to generate download URL:", error, { key });
      throw error;
    }
  }

  /**
   * Get document metadata
   */
  async getDocumentInfo(key: string): Promise<{
    exists: boolean;
    contentType?: string;
    size?: number;
    lastModified?: Date;
    metadata?: {
      originalFileName?: string;
      userId?: string;
      transactionId?: string;
      disputeId?: string;
      uploadTimestamp?: string;
    };
  }> {
    try {
      const metadata = await s3.getObjectMetadata(key);

      if (!metadata) {
        return { exists: false };
      }

      const result: {
        exists: boolean;
        contentType?: string;
        size?: number;
        lastModified?: Date;
        metadata?: {
          originalFileName?: string;
          userId?: string;
          transactionId?: string;
          disputeId?: string;
          uploadTimestamp?: string;
        };
      } = { exists: true };

      if (metadata.contentType) result.contentType = metadata.contentType;
      if (metadata.contentLength) result.size = metadata.contentLength;
      if (metadata.lastModified) result.lastModified = metadata.lastModified;

      if (metadata.metadata && Object.keys(metadata.metadata).length > 0) {
        const resultMetadata: any = {};
        if (metadata.metadata["original-filename"]) {
          resultMetadata.originalFileName = metadata.metadata["original-filename"];
        }
        if (metadata.metadata["user-id"]) resultMetadata.userId = metadata.metadata["user-id"];
        if (metadata.metadata["transaction-id"]) {
          resultMetadata.transactionId = metadata.metadata["transaction-id"];
        }
        if (metadata.metadata["dispute-id"]) {
          resultMetadata.disputeId = metadata.metadata["dispute-id"];
        }
        if (metadata.metadata["upload-timestamp"]) {
          resultMetadata.uploadTimestamp = metadata.metadata["upload-timestamp"];
        }

        if (Object.keys(resultMetadata).length > 0) {
          result.metadata = resultMetadata;
        }
      }

      return result;
    } catch (error) {
      this.logger.error("Failed to get document info:", error, { key });
      throw error;
    }
  }

  /**
   * Delete document
   */
  async deleteDocument(key: string): Promise<boolean> {
    try {
      const deleted = await s3.deleteObject(key);

      this.logger.info(`Document deleted: ${key}`, { key, deleted });

      return deleted;
    } catch (error) {
      this.logger.error("Failed to delete document:", error, { key });
      throw error;
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    service: string;
    status: "healthy" | "unhealthy";
    bucket: string;
    endpoint: string;
    lastCheck: string;
    latency?: number;
  }> {
    try {
      const health = await s3.getHealthInfo();

      return {
        service: "cloudflare-r2",
        status: health.status,
        bucket: health.bucket,
        endpoint: health.endpoint,
        lastCheck: health.lastCheck,
        ...(health.latency ? { latency: health.latency } : {}),
      };
    } catch (error) {
      this.logger.error("Failed to get storage stats:", error);

      return {
        service: "cloudflare-r2",
        status: "unhealthy",
        bucket: "unknown",
        endpoint: "unknown",
        lastCheck: new Date().toISOString(),
      };
    }
  }
}

// Export singleton instance
export const storageService = new StorageService();
