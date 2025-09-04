import { PostgresPool } from "@/deps.ts";
import { getConfig } from "@config/env.ts";
import { log } from "@/deps.ts";

/**
 * Database Connection Pool Configuration
 * Manages PostgreSQL connections for the Document Verification API
 */

export interface DatabaseConfig {
  connectionString: string;
  poolSize: number;
  connectionTimeout: number;
  idleTimeout: number;
  maxLifetime: number;
}

class DatabaseManager {
  private pool: PostgresPool | null = null;
  private config: DatabaseConfig | null = null;
  private logger = log.getLogger();

  /**
   * Initialize database connection pool
   */
  async initialize(): Promise<void> {
    if (this.pool) {
      this.logger.warn("Database pool already initialized");
      return;
    }

    try {
      const appConfig = await getConfig();

      this.config = {
        connectionString: appConfig.databaseUrl,
        poolSize: parseInt(Deno.env.get("DB_POOL_SIZE") || "10"),
        connectionTimeout: parseInt(Deno.env.get("DB_CONNECTION_TIMEOUT") || "30000"), // 30s
        idleTimeout: parseInt(Deno.env.get("DB_IDLE_TIMEOUT") || "600000"), // 10min
        maxLifetime: parseInt(Deno.env.get("DB_MAX_LIFETIME") || "3600000"), // 1hr
      };

      this.pool = new PostgresPool(
        this.config.connectionString,
        this.config.poolSize,
        true, // lazy connection
      );

      // Test initial connection
      await this.testConnection();

      this.logger.info(`Database pool initialized with ${this.config.poolSize} connections`);
    } catch (error) {
      this.logger.error("Failed to initialize database pool:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Database initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Get database pool instance
   */
  getPool(): PostgresPool {
    if (!this.pool) {
      throw new Error("Database pool not initialized. Call initialize() first.");
    }
    return this.pool;
  }

  /**
   * Test database connection
   */
  async testConnection(): Promise<void> {
    if (!this.pool) {
      throw new Error("Database pool not initialized");
    }

    try {
      using client = await this.pool.connect();
      const result = await client.queryObject("SELECT 1 as test, NOW() as timestamp");

      if (result.rows.length === 0) {
        throw new Error("Database connection test failed - no results");
      }

      this.logger.info("Database connection test successful");
    } catch (error) {
      this.logger.error("Database connection test failed:", error);
      throw error;
    }
  }

  /**
   * Get database health information
   */
  async getHealthInfo(): Promise<{
    status: "healthy" | "unhealthy";
    connections: {
      total: number;
      active: number;
      idle: number;
    };
    lastCheck: string;
    latency?: number;
  }> {
    if (!this.pool) {
      return {
        status: "unhealthy",
        connections: { total: 0, active: 0, idle: 0 },
        lastCheck: new Date().toISOString(),
      };
    }

    try {
      const startTime = Date.now();

      // Test connection and measure latency
      using client = await this.pool.connect();
      await client.queryObject("SELECT 1");

      const latency = Date.now() - startTime;

      return {
        status: "healthy",
        connections: {
          total: this.config?.poolSize || 0,
          active: 0, // PostgresPool doesn't expose this info
          idle: 0, // PostgresPool doesn't expose this info
        },
        lastCheck: new Date().toISOString(),
        latency,
      };
    } catch (error) {
      this.logger.error("Database health check failed:", error);

      return {
        status: "unhealthy",
        connections: { total: 0, active: 0, idle: 0 },
        lastCheck: new Date().toISOString(),
      };
    }
  }

  /**
   * Execute a query with automatic connection management
   */
  async query<T>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    if (!this.pool) {
      throw new Error("Database pool not initialized");
    }

    try {
      using client = await this.pool.connect();
      const result = await client.queryObject<T>(sql, params);
      return result.rows;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Database query failed:", { sql, error: errorMessage });
      throw error;
    }
  }

  /**
   * Execute a query and return single result
   */
  async queryOne<T>(
    sql: string,
    params?: unknown[],
  ): Promise<T | null> {
    const results = await this.query<T>(sql, params);
    return results.length > 0 ? results[0] || null : null;
  }

  /**
   * Execute multiple queries in a transaction
   */
  async transaction<T>(
    callback: (client: any) => Promise<T>,
  ): Promise<T> {
    if (!this.pool) {
      throw new Error("Database pool not initialized");
    }

    using client = await this.pool.connect();

    try {
      await client.queryObject("BEGIN");
      const result = await callback(client);
      await client.queryObject("COMMIT");
      return result;
    } catch (error) {
      await client.queryObject("ROLLBACK");
      this.logger.error("Database transaction failed:", error);
      throw error;
    }
  }

  /**
   * Close database connection pool
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.logger.info("Database pool closed");
    }
  }

  /**
   * Get configuration info (safe for logging)
   */
  getConfigInfo(): Partial<DatabaseConfig> {
    if (!this.config) {
      return {};
    }

    return {
      poolSize: this.config.poolSize,
      connectionTimeout: this.config.connectionTimeout,
      idleTimeout: this.config.idleTimeout,
      maxLifetime: this.config.maxLifetime,
    };
  }
}

// Global database manager instance
const databaseManager = new DatabaseManager();

export { databaseManager as db };

/**
 * Initialize database connection
 * Should be called once during application startup
 */
export async function initializeDatabase(): Promise<void> {
  await databaseManager.initialize();
}

/**
 * Get database pool for direct access
 */
export function getDatabase(): PostgresPool {
  return databaseManager.getPool();
}

/**
 * Helper function for queries
 */
export async function query<T>(sql: string, params?: unknown[]): Promise<T[]> {
  return databaseManager.query<T>(sql, params);
}

/**
 * Helper function for single row queries
 */
export async function queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
  return databaseManager.queryOne<T>(sql, params);
}

/**
 * Helper function for transactions
 */
export async function transaction<T>(
  callback: (client: any) => Promise<T>,
): Promise<T> {
  return databaseManager.transaction(callback);
}

/**
 * Database health check
 */
export async function getDatabaseHealth() {
  return databaseManager.getHealthInfo();
}
