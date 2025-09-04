import { query, queryOne, transaction } from "@config/database.ts";
import { generateUuid } from "@/deps.ts";

/**
 * Database Queries Module
 * Type-safe database operations for the Document Verification API
 */

// Type definitions
export interface Document {
  id: string;
  transaction_id: string;
  dispute_id?: string;
  user_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  document_type: "payment_receipt" | "bank_statement" | "invoice" | "other";
  s3_key: string;
  s3_bucket: string;
  upload_timestamp: Date;
  processing_status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  started_processing_at?: Date;
  completed_processing_at?: Date;
  extracted_data?: any;
  comparison_results?: any;
  authenticity_score?: number;
  authenticity_details?: any;
  created_at: Date;
  updated_at: Date;
}

export interface ProcessingLog {
  id: string;
  document_id: string;
  stage: string;
  status: string;
  started_at: Date;
  completed_at?: Date;
  duration_ms?: number;
  log_level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  message?: string;
  error_details?: any;
  metadata?: any;
}

export interface ApiKey {
  id: string;
  key_hash: string;
  key_prefix: string;
  name: string;
  description?: string;
  environment: "development" | "staging" | "production";
  permissions: string[];
  rate_limit_per_minute: number;
  rate_limit_per_hour: number;
  rate_limit_per_day: number;
  is_active: boolean;
  expires_at?: Date;
  last_used_at?: Date;
  usage_count: number;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

export interface RequestLog {
  id: string;
  request_id: string;
  api_key_id?: string;
  method: string;
  path: string;
  user_agent?: string;
  ip_address?: string;
  status_code: number;
  response_time_ms: number;
  response_size_bytes?: number;
  error_code?: string;
  error_message?: string;
  created_at: Date;
}

// Document queries
export const DocumentQueries = {
  /**
   * Create a new document record
   */
  async create(doc: Omit<Document, "id" | "created_at" | "updated_at">): Promise<Document> {
    const sql = `
      INSERT INTO documents (
        transaction_id, dispute_id, user_id, file_name, file_size, mime_type,
        document_type, s3_key, s3_bucket, upload_timestamp, processing_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const result = await queryOne<Document>(sql, [
      doc.transaction_id,
      doc.dispute_id,
      doc.user_id,
      doc.file_name,
      doc.file_size,
      doc.mime_type,
      doc.document_type,
      doc.s3_key,
      doc.s3_bucket,
      doc.upload_timestamp,
      doc.processing_status,
    ]);

    if (!result) {
      throw new Error("Failed to create document");
    }

    return result;
  },

  /**
   * Get document by ID
   */
  async getById(id: string): Promise<Document | null> {
    const sql = "SELECT * FROM documents WHERE id = $1";
    return queryOne<Document>(sql, [id]);
  },

  /**
   * Get document by transaction ID
   */
  async getByTransactionId(transactionId: string): Promise<Document[]> {
    const sql = "SELECT * FROM documents WHERE transaction_id = $1 ORDER BY created_at DESC";
    return query<Document>(sql, [transactionId]);
  },

  /**
   * Get documents by user ID
   */
  async getByUserId(
    userId: string, 
    limit = 50, 
    offset = 0
  ): Promise<Document[]> {
    const sql = `
      SELECT * FROM documents 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT $2 OFFSET $3
    `;
    return query<Document>(sql, [userId, limit, offset]);
  },

  /**
   * Get documents by processing status
   */
  async getByStatus(
    status: Document["processing_status"],
    limit = 100
  ): Promise<Document[]> {
    const sql = `
      SELECT * FROM documents 
      WHERE processing_status = $1 
      ORDER BY created_at ASC 
      LIMIT $2
    `;
    return query<Document>(sql, [status, limit]);
  },

  /**
   * Update document processing status
   */
  async updateStatus(
    id: string,
    status: Document["processing_status"],
    startedAt?: Date,
    completedAt?: Date
  ): Promise<Document | null> {
    const sql = `
      UPDATE documents 
      SET processing_status = $2,
          started_processing_at = COALESCE($3, started_processing_at),
          completed_processing_at = $4,
          updated_at = NOW()
      WHERE id = $1 
      RETURNING *
    `;
    return queryOne<Document>(sql, [id, status, startedAt, completedAt]);
  },

  /**
   * Update extracted data
   */
  async updateExtractedData(
    id: string, 
    extractedData: any
  ): Promise<Document | null> {
    const sql = `
      UPDATE documents 
      SET extracted_data = $2, updated_at = NOW()
      WHERE id = $1 
      RETURNING *
    `;
    return queryOne<Document>(sql, [id, JSON.stringify(extractedData)]);
  },

  /**
   * Update comparison results
   */
  async updateComparisonResults(
    id: string, 
    comparisonResults: any
  ): Promise<Document | null> {
    const sql = `
      UPDATE documents 
      SET comparison_results = $2, updated_at = NOW()
      WHERE id = $1 
      RETURNING *
    `;
    return queryOne<Document>(sql, [id, JSON.stringify(comparisonResults)]);
  },

  /**
   * Update authenticity verification
   */
  async updateAuthenticity(
    id: string,
    score: number,
    details: any
  ): Promise<Document | null> {
    const sql = `
      UPDATE documents 
      SET authenticity_score = $2, 
          authenticity_details = $3,
          updated_at = NOW()
      WHERE id = $1 
      RETURNING *
    `;
    return queryOne<Document>(sql, [id, score, JSON.stringify(details)]);
  },

  /**
   * Delete document
   */
  async delete(id: string): Promise<boolean> {
    const sql = "DELETE FROM documents WHERE id = $1";
    const result = await query(sql, [id]);
    return result.length > 0;
  },

  /**
   * Get document statistics
   */
  async getStats(): Promise<{
    total: number;
    by_status: Record<string, number>;
    recent_24h: number;
  }> {
    const sql = `
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as recent_24h,
        COUNT(*) FILTER (WHERE processing_status = 'queued') as queued,
        COUNT(*) FILTER (WHERE processing_status = 'processing') as processing,
        COUNT(*) FILTER (WHERE processing_status = 'completed') as completed,
        COUNT(*) FILTER (WHERE processing_status = 'failed') as failed,
        COUNT(*) FILTER (WHERE processing_status = 'cancelled') as cancelled
      FROM documents
    `;
    
    const result = await queryOne<any>(sql);
    
    return {
      total: parseInt(result?.total || "0"),
      recent_24h: parseInt(result?.recent_24h || "0"),
      by_status: {
        queued: parseInt(result?.queued || "0"),
        processing: parseInt(result?.processing || "0"),
        completed: parseInt(result?.completed || "0"),
        failed: parseInt(result?.failed || "0"),
        cancelled: parseInt(result?.cancelled || "0"),
      }
    };
  }
};

// Processing Log queries
export const ProcessingLogQueries = {
  /**
   * Create processing log entry
   */
  async create(log: Omit<ProcessingLog, "id">): Promise<ProcessingLog> {
    const sql = `
      INSERT INTO processing_logs (
        document_id, stage, status, started_at, completed_at, 
        duration_ms, log_level, message, error_details, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const result = await queryOne<ProcessingLog>(sql, [
      log.document_id,
      log.stage,
      log.status,
      log.started_at,
      log.completed_at,
      log.duration_ms,
      log.log_level,
      log.message,
      log.error_details ? JSON.stringify(log.error_details) : null,
      log.metadata ? JSON.stringify(log.metadata) : null,
    ]);

    if (!result) {
      throw new Error("Failed to create processing log");
    }

    return result;
  },

  /**
   * Get logs for document
   */
  async getByDocumentId(documentId: string): Promise<ProcessingLog[]> {
    const sql = `
      SELECT * FROM processing_logs 
      WHERE document_id = $1 
      ORDER BY started_at ASC
    `;
    return query<ProcessingLog>(sql, [documentId]);
  },

  /**
   * Get recent error logs
   */
  async getRecentErrors(limit = 100): Promise<ProcessingLog[]> {
    const sql = `
      SELECT * FROM processing_logs 
      WHERE log_level = 'ERROR' 
      ORDER BY started_at DESC 
      LIMIT $1
    `;
    return query<ProcessingLog>(sql, [limit]);
  }
};

// API Key queries
export const ApiKeyQueries = {
  /**
   * Get API key by hash
   */
  async getByHash(keyHash: string): Promise<ApiKey | null> {
    const sql = `
      SELECT * FROM api_keys 
      WHERE key_hash = $1 AND is_active = true
      AND (expires_at IS NULL OR expires_at > NOW())
    `;
    return queryOne<ApiKey>(sql, [keyHash]);
  },

  /**
   * Update API key usage
   */
  async updateUsage(id: string): Promise<void> {
    const sql = `
      UPDATE api_keys 
      SET last_used_at = NOW(), usage_count = usage_count + 1
      WHERE id = $1
    `;
    await query(sql, [id]);
  }
};

// Request Log queries  
export const RequestLogQueries = {
  /**
   * Create request log
   */
  async create(log: Omit<RequestLog, "id" | "created_at">): Promise<RequestLog> {
    const sql = `
      INSERT INTO request_logs (
        request_id, api_key_id, method, path, user_agent, ip_address,
        status_code, response_time_ms, response_size_bytes, error_code, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const result = await queryOne<RequestLog>(sql, [
      log.request_id,
      log.api_key_id,
      log.method,
      log.path,
      log.user_agent,
      log.ip_address,
      log.status_code,
      log.response_time_ms,
      log.response_size_bytes,
      log.error_code,
      log.error_message,
    ]);

    if (!result) {
      throw new Error("Failed to create request log");
    }

    return result;
  }
};