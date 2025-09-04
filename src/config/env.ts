import { loadEnv } from "@/deps.ts";

/**
 * Environment Configuration
 * Loads and validates environment variables for different environments
 */

export interface Config {
  // Server
  port: number;
  environment: "development" | "staging" | "production";

  // Database
  databaseUrl: string;

  // Redis
  redisUrl: string;

  // S3 Storage (Cloudflare R2)
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3Bucket: string;
  s3Endpoint: string;
  s3Region: string;

  // External Services
  llamaParseApiKey: string;
  openaiApiKey: string;

  // Security
  apiKeySecret: string;
  jwtSecret: string;

  // Features
  enableAiVerification: boolean;
  enableRateLimiting: boolean;
  maxFileSize: number; // in bytes
  allowedFileTypes: string[];

  // Performance
  maxConcurrentUploads: number;
  queueTimeout: number; // in milliseconds

  // Logging
  logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
}

/**
 * Load and validate environment configuration
 */
export async function loadConfig(): Promise<Config> {
  // Load environment variables with safe defaults
  const env = await loadEnv({
    allowEmptyValues: true,
    export: false,
  });

  return {
    // Server
    port: parseInt(env.API_PORT || "8000"),
    environment: (env.ENVIRONMENT || "development") as Config["environment"],

    // Database
    databaseUrl: env.DATABASE_URL || "postgresql://user:password@localhost:5432/docverify",

    // Redis
    redisUrl: env.REDIS_URL || "redis://localhost:6379",

    // S3 Storage
    s3AccessKeyId: env.S3_ACCESS_KEY_ID || "",
    s3SecretAccessKey: env.S3_SECRET_ACCESS_KEY || "",
    s3Bucket: env.S3_BUCKET || "document-verification-secure",
    s3Endpoint: env.S3_ENDPOINT || "",
    s3Region: env.S3_REGION || "auto",

    // External Services
    llamaParseApiKey: env.LLAMA_PARSE_API_KEY || "",
    openaiApiKey: env.OPENAI_API_KEY || "",

    // Security
    apiKeySecret: env.API_KEY_SECRET || "change-me-in-production",
    jwtSecret: env.JWT_SECRET || "change-me-in-production",

    // Features
    enableAiVerification: env.ENABLE_AI_VERIFICATION === "true",
    enableRateLimiting: env.ENABLE_RATE_LIMITING !== "false",
    maxFileSize: parseInt(env.MAX_FILE_SIZE || "10485760"), // 10MB default
    allowedFileTypes: (env.ALLOWED_FILE_TYPES || "image/png,image/jpeg,application/pdf").split(","),

    // Performance
    maxConcurrentUploads: parseInt(env.MAX_CONCURRENT_UPLOADS || "100"),
    queueTimeout: parseInt(env.QUEUE_TIMEOUT || "300000"), // 5 minutes default

    // Logging
    logLevel: (env.LOG_LEVEL || "INFO") as Config["logLevel"],
  };
}

/**
 * Validate required configuration values
 */
export function validateConfig(config: Config): void {
  const requiredFields: Array<keyof Config> = [
    "databaseUrl",
    "s3AccessKeyId",
    "s3SecretAccessKey",
    "s3Endpoint",
    "apiKeySecret",
  ];

  const missingFields = requiredFields.filter((field) => !config[field]);

  if (missingFields.length > 0) {
    throw new Error(`Missing required configuration: ${missingFields.join(", ")}`);
  }

  // Validate file size limits
  if (config.maxFileSize > 50 * 1024 * 1024) { // 50MB max
    throw new Error("MAX_FILE_SIZE cannot exceed 50MB");
  }

  // Validate allowed file types
  const validTypes = ["image/png", "image/jpeg", "application/pdf"];
  const invalidTypes = config.allowedFileTypes.filter((type) => !validTypes.includes(type));
  if (invalidTypes.length > 0) {
    throw new Error(`Invalid file types: ${invalidTypes.join(", ")}`);
  }
}

// Global configuration instance
let globalConfig: Config | null = null;

/**
 * Get global configuration (loads once, cached thereafter)
 */
export async function getConfig(): Promise<Config> {
  if (!globalConfig) {
    globalConfig = await loadConfig();
    validateConfig(globalConfig);
  }
  return globalConfig;
}
