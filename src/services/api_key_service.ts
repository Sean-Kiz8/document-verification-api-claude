/**
 * API Key Service
 * Handles API key validation, rate limiting, and management
 */

import { log } from "@/deps.ts";
import type { ApiKey, ApiKeyCreation, ApiKeyValidation, RateLimitInfo } from "@models/api_key.ts";
import { query } from "@config/database.ts";
import { redis } from "@config/redis.ts";

class ApiKeyService {
  private logger = log.getLogger();

  /**
   * Generate API key with format: dv_[environment]_[32_char_key]
   */
  async generateApiKey(
    environment: string,
  ): Promise<{ key: string; hash: string; prefix: string }> {
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const keyPart = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const key = `dv_${environment}_${keyPart}`;

    // Create hash for storage (never store plain text keys)
    const hash = await this.hashApiKey(key);
    const prefix = key.substring(0, 12); // dv_prod_abc1

    return { key, hash, prefix };
  }

  /**
   * Create new API key
   */
  async createApiKey(creation: ApiKeyCreation): Promise<{ apiKey: ApiKey; rawKey: string }> {
    try {
      const { key, hash, prefix } = await this.generateApiKey(creation.environment);

      const insertQuery = `
        INSERT INTO api_keys (
          key_hash, key_prefix, name, description, environment, 
          permissions, rate_limit_per_minute, rate_limit_per_hour, 
          rate_limit_per_day, expires_at, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `;

      const permissions = creation.permissions || ["read", "write"];

      const result = await query<Record<string, unknown>>(insertQuery, [
        hash,
        prefix,
        creation.name,
        creation.description || null,
        creation.environment,
        JSON.stringify(permissions),
        creation.rateLimitPerMinute || 60,
        creation.rateLimitPerHour || 1000,
        creation.rateLimitPerDay || 10000,
        creation.expiresAt || null,
        creation.createdBy || null,
      ]);

      if (result.length === 0) {
        throw new Error("Failed to create API key");
      }

      const row = result[0];
      if (!row) {
        throw new Error("Failed to create API key");
      }

      const apiKey = this.mapRowToApiKey(row);
      this.logger.info(`Created API key: ${prefix}*** for ${creation.name}`);

      return { apiKey, rawKey: key };
    } catch (error) {
      this.logger.error("Failed to create API key:", error);
      throw error;
    }
  }

  /**
   * Validate API key and check rate limits
   */
  async validateApiKey(apiKeyHeader: string): Promise<ApiKeyValidation> {
    try {
      // Extract bearer token
      const key = this.extractApiKey(apiKeyHeader);
      if (!key) {
        return { isValid: false, error: "Invalid API key format" };
      }

      // Validate key format
      if (!this.isValidKeyFormat(key)) {
        return { isValid: false, error: "Invalid API key format" };
      }

      // Hash the key for lookup
      const keyHash = await this.hashApiKey(key);

      // Look up API key in database
      const selectQuery = `
        SELECT * FROM api_keys 
        WHERE key_hash = $1 AND is_active = true 
        AND (expires_at IS NULL OR expires_at > NOW())
      `;

      const result = await query<Record<string, unknown>>(selectQuery, [keyHash]);

      if (result.length === 0) {
        return { isValid: false, error: "API key not found or expired" };
      }

      const row = result[0];
      if (!row) {
        return { isValid: false, error: "API key not found or expired" };
      }

      const apiKey = this.mapRowToApiKey(row);

      // Check rate limits
      const rateLimitInfo = await this.checkRateLimit(apiKey);

      if (rateLimitInfo.exceededLimit) {
        return {
          isValid: false,
          error: "Rate limit exceeded",
          rateLimitExceeded: true,
          remainingRequests: {
            perMinute: rateLimitInfo.remainingMinute,
            perHour: rateLimitInfo.remainingHour,
            perDay: rateLimitInfo.remainingDay,
          },
        };
      }

      // Update last used timestamp and usage count
      await this.updateKeyUsage(apiKey.id);

      return {
        isValid: true,
        apiKey,
        remainingRequests: {
          perMinute: rateLimitInfo.remainingMinute,
          perHour: rateLimitInfo.remainingHour,
          perDay: rateLimitInfo.remainingDay,
        },
      };
    } catch (error) {
      this.logger.error("API key validation failed:", error);
      return { isValid: false, error: "Authentication service unavailable" };
    }
  }

  /**
   * Extract API key from Authorization header
   */
  private extractApiKey(authHeader: string): string | null {
    if (!authHeader) return null;

    // Support both "Bearer <key>" and "<key>" formats
    const parts = authHeader.trim().split(" ");

    if (parts.length === 1 && parts[0]) {
      return parts[0];
    }

    if (parts.length === 2 && parts[0] && parts[0].toLowerCase() === "bearer" && parts[1]) {
      return parts[1];
    }

    return null;
  }

  /**
   * Validate API key format: dv_[environment]_[32_char_key]
   */
  private isValidKeyFormat(key: string): boolean {
    const pattern = /^dv_(development|staging|production)_[a-f0-9]{64}$/;
    return pattern.test(key);
  }

  /**
   * Hash API key for database storage
   */
  private async hashApiKey(key: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(key);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer), (byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Check rate limits using Redis
   */
  private async checkRateLimit(apiKey: ApiKey): Promise<RateLimitInfo> {
    const now = new Date();
    const minuteWindow = `${now.getFullYear()}-${
      (now.getMonth() + 1).toString().padStart(2, "0")
    }-${now.getDate().toString().padStart(2, "0")}-${now.getHours().toString().padStart(2, "0")}-${
      now.getMinutes().toString().padStart(2, "0")
    }`;
    const hourWindow = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${
      now.getDate().toString().padStart(2, "0")
    }-${now.getHours().toString().padStart(2, "0")}`;
    const dayWindow = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${
      now.getDate().toString().padStart(2, "0")
    }`;

    const minuteKey = `rate_limit:${apiKey.id}:minute:${minuteWindow}`;
    const hourKey = `rate_limit:${apiKey.id}:hour:${hourWindow}`;
    const dayKey = `rate_limit:${apiKey.id}:day:${dayWindow}`;

    try {
      const redisClient = redis.getClient();

      // Get current counts
      const [minuteCount, hourCount, dayCount] = await Promise.all([
        redisClient.get(minuteKey).then((val) => parseInt(val || "0")),
        redisClient.get(hourKey).then((val) => parseInt(val || "0")),
        redisClient.get(dayKey).then((val) => parseInt(val || "0")),
      ]);

      const remainingMinute = Math.max(0, apiKey.rateLimitPerMinute - minuteCount);
      const remainingHour = Math.max(0, apiKey.rateLimitPerHour - hourCount);
      const remainingDay = Math.max(0, apiKey.rateLimitPerDay - dayCount);

      const exceededLimit = remainingMinute <= 0 || remainingHour <= 0 || remainingDay <= 0;

      if (!exceededLimit) {
        // Increment counters if not exceeded
        const pipeline = redisClient.pipeline();
        pipeline.incr(minuteKey);
        pipeline.expire(minuteKey, 60); // 1 minute
        pipeline.incr(hourKey);
        pipeline.expire(hourKey, 3600); // 1 hour
        pipeline.incr(dayKey);
        pipeline.expire(dayKey, 86400); // 1 day
        await pipeline.exec();
      }

      return {
        windowMinute: minuteWindow,
        windowHour: hourWindow,
        windowDay: dayWindow,
        requestsMinute: minuteCount + (exceededLimit ? 0 : 1),
        requestsHour: hourCount + (exceededLimit ? 0 : 1),
        requestsDay: dayCount + (exceededLimit ? 0 : 1),
        limitMinute: apiKey.rateLimitPerMinute,
        limitHour: apiKey.rateLimitPerHour,
        limitDay: apiKey.rateLimitPerDay,
        remainingMinute: exceededLimit ? remainingMinute : remainingMinute - 1,
        remainingHour: exceededLimit ? remainingHour : remainingHour - 1,
        remainingDay: exceededLimit ? remainingDay : remainingDay - 1,
        exceededLimit,
      };
    } catch (error) {
      this.logger.warn("Rate limit check failed, allowing request:", error);
      // Fall back to allowing the request if Redis fails
      return {
        windowMinute: minuteWindow,
        windowHour: hourWindow,
        windowDay: dayWindow,
        requestsMinute: 1,
        requestsHour: 1,
        requestsDay: 1,
        limitMinute: apiKey.rateLimitPerMinute,
        limitHour: apiKey.rateLimitPerHour,
        limitDay: apiKey.rateLimitPerDay,
        remainingMinute: apiKey.rateLimitPerMinute - 1,
        remainingHour: apiKey.rateLimitPerHour - 1,
        remainingDay: apiKey.rateLimitPerDay - 1,
        exceededLimit: false,
      };
    }
  }

  /**
   * Update API key usage statistics
   */
  private async updateKeyUsage(apiKeyId: string): Promise<void> {
    try {
      const updateQuery = `
        UPDATE api_keys 
        SET last_used_at = NOW(), usage_count = usage_count + 1 
        WHERE id = $1
      `;

      await query(updateQuery, [apiKeyId]);
    } catch (error) {
      this.logger.warn("Failed to update API key usage:", error);
      // Don't fail the request if usage tracking fails
    }
  }

  /**
   * Get API key by hash
   */
  async getApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
    try {
      const selectQuery = `SELECT * FROM api_keys WHERE key_hash = $1 AND is_active = true`;
      const result = await query<Record<string, unknown>>(selectQuery, [keyHash]);

      if (result.length === 0) {
        return null;
      }

      const row = result[0];
      if (!row) {
        return null;
      }

      return this.mapRowToApiKey(row);
    } catch (error) {
      this.logger.error("Failed to get API key:", error);
      throw error;
    }
  }

  /**
   * List all API keys (without sensitive data)
   */
  async listApiKeys(environment?: string): Promise<Omit<ApiKey, "keyHash">[]> {
    try {
      let selectQuery = `
        SELECT id, key_prefix, name, description, environment, permissions, 
               rate_limit_per_minute, rate_limit_per_hour, rate_limit_per_day,
               is_active, expires_at, last_used_at, usage_count, created_by, 
               created_at, updated_at
        FROM api_keys 
      `;
      const params: unknown[] = [];

      if (environment) {
        selectQuery += ` WHERE environment = $1`;
        params.push(environment);
      }

      selectQuery += ` ORDER BY created_at DESC`;

      const result = await query<Record<string, unknown>>(selectQuery, params);

      return result.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        keyPrefix: row.key_prefix as string,
        name: row.name as string,
        description: row.description as string | undefined,
        environment: row.environment as "development" | "staging" | "production",
        permissions: typeof row.permissions === "string" 
        ? JSON.parse(row.permissions) 
        : row.permissions as string[],
        rateLimitPerMinute: row.rate_limit_per_minute as number,
        rateLimitPerHour: row.rate_limit_per_hour as number,
        rateLimitPerDay: row.rate_limit_per_day as number,
        isActive: row.is_active as boolean,
        expiresAt: row.expires_at ? new Date(row.expires_at as string) : undefined,
        lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string) : undefined,
        usageCount: Number(row.usage_count),
        createdBy: row.created_by as string | undefined,
        createdAt: new Date(row.created_at as string),
        updatedAt: new Date(row.updated_at as string),
      }));
    } catch (error) {
      this.logger.error("Failed to list API keys:", error);
      throw error;
    }
  }

  /**
   * Deactivate API key
   */
  async deactivateApiKey(apiKeyId: string): Promise<boolean> {
    try {
      const updateQuery = `UPDATE api_keys SET is_active = false WHERE id = $1`;
      const result = await query(updateQuery, [apiKeyId]);

      return result.length > 0;
    } catch (error) {
      this.logger.error("Failed to deactivate API key:", error);
      throw error;
    }
  }

  /**
   * Get rate limit information for API key
   */
  async getRateLimitInfo(apiKey: ApiKey): Promise<RateLimitInfo> {
    const now = new Date();
    const minuteWindow = `${now.getFullYear()}-${
      (now.getMonth() + 1).toString().padStart(2, "0")
    }-${now.getDate().toString().padStart(2, "0")}-${now.getHours().toString().padStart(2, "0")}-${
      now.getMinutes().toString().padStart(2, "0")
    }`;
    const hourWindow = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${
      now.getDate().toString().padStart(2, "0")
    }-${now.getHours().toString().padStart(2, "0")}`;
    const dayWindow = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${
      now.getDate().toString().padStart(2, "0")
    }`;

    const minuteKey = `rate_limit:${apiKey.id}:minute:${minuteWindow}`;
    const hourKey = `rate_limit:${apiKey.id}:hour:${hourWindow}`;
    const dayKey = `rate_limit:${apiKey.id}:day:${dayWindow}`;

    try {
      const redisClient = redis.getClient();

      const [minuteCount, hourCount, dayCount] = await Promise.all([
        redisClient.get(minuteKey).then((val) => parseInt(val || "0")),
        redisClient.get(hourKey).then((val) => parseInt(val || "0")),
        redisClient.get(dayKey).then((val) => parseInt(val || "0")),
      ]);

      return {
        windowMinute: minuteWindow,
        windowHour: hourWindow,
        windowDay: dayWindow,
        requestsMinute: minuteCount,
        requestsHour: hourCount,
        requestsDay: dayCount,
        limitMinute: apiKey.rateLimitPerMinute,
        limitHour: apiKey.rateLimitPerHour,
        limitDay: apiKey.rateLimitPerDay,
        remainingMinute: Math.max(0, apiKey.rateLimitPerMinute - minuteCount),
        remainingHour: Math.max(0, apiKey.rateLimitPerHour - hourCount),
        remainingDay: Math.max(0, apiKey.rateLimitPerDay - dayCount),
        exceededLimit: minuteCount >= apiKey.rateLimitPerMinute ||
          hourCount >= apiKey.rateLimitPerHour ||
          dayCount >= apiKey.rateLimitPerDay,
      };
    } catch (error) {
      this.logger.warn("Rate limit info check failed:", error);
      return {
        windowMinute: minuteWindow,
        windowHour: hourWindow,
        windowDay: dayWindow,
        requestsMinute: 0,
        requestsHour: 0,
        requestsDay: 0,
        limitMinute: apiKey.rateLimitPerMinute,
        limitHour: apiKey.rateLimitPerHour,
        limitDay: apiKey.rateLimitPerDay,
        remainingMinute: apiKey.rateLimitPerMinute,
        remainingHour: apiKey.rateLimitPerHour,
        remainingDay: apiKey.rateLimitPerDay,
        exceededLimit: false,
      };
    }
  }

  /**
   * Map database row to ApiKey interface
   */
  private mapRowToApiKey(row: Record<string, unknown>): ApiKey {
    return {
      id: row.id as string,
      keyHash: row.key_hash as string,
      keyPrefix: row.key_prefix as string,
      name: row.name as string,
      description: row.description as string | undefined,
      environment: row.environment as "development" | "staging" | "production",
      permissions: typeof row.permissions === "string" 
        ? JSON.parse(row.permissions) 
        : row.permissions as string[],
      rateLimitPerMinute: row.rate_limit_per_minute as number,
      rateLimitPerHour: row.rate_limit_per_hour as number,
      rateLimitPerDay: row.rate_limit_per_day as number,
      isActive: row.is_active as boolean,
      expiresAt: row.expires_at ? new Date(row.expires_at as string) : undefined,
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string) : undefined,
      usageCount: Number(row.usage_count),
      createdBy: row.created_by as string | undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }
}

export const apiKeyService = new ApiKeyService();
