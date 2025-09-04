/**
 * External Dependencies
 * Centralized imports for external modules used throughout the application
 */

// HTTP Framework
export {
  Application,
  Router,
  Context,
  Status,
  isHttpError,
  httpErrors,
} from "oak";

// export { getQuery } from "https://deno.land/x/oak@v16.1.0/helpers.ts"; // Not used yet

// Database
export { Client as PostgresClient, Pool as PostgresPool } from "postgres";

// Redis
export { connect as connectRedis } from "redis";
export type { Redis } from "redis";

// Environment and Configuration
export { load as loadEnv } from "std/dotenv";

// Logging
export * as log from "std/log";

// Testing
export {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "std/assert";

export {
  describe,
  it,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "https://deno.land/std@0.224.0/testing/bdd.ts";

// HTTP utilities
export { STATUS_CODE as HttpStatus } from "https://deno.land/std@0.224.0/http/status.ts";

// Cryptography
export { encodeBase64 as base64Encode, decodeBase64 as base64Decode } from "https://deno.land/std@0.224.0/encoding/base64.ts";
export { encodeHex as hexEncode, decodeHex as hexDecode } from "https://deno.land/std@0.224.0/encoding/hex.ts";

// Validation
export { z } from "zod";

// UUID generation
export { v4 as generateUuid } from "https://deno.land/std@0.224.0/uuid/mod.ts";

// Date utilities
export { format as formatDate, parse as parseDate } from "https://deno.land/std@0.224.0/datetime/mod.ts";

// File system operations
export { ensureDir, exists } from "https://deno.land/std@0.224.0/fs/mod.ts";

// S3 SDK for Cloudflare R2 - TODO: Add when implementing S3 integration
// export { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "https://deno.land/x/aws_api@v0.8.2/services/s3/mod.ts";
// export { ApiFactory } from "https://deno.land/x/aws_api@v0.8.2/client/mod.ts";

// Types
export type { Middleware, Next } from "oak";
export type { LogLevel } from "std/log";