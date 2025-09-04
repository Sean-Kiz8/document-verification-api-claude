/**
 * External Dependencies
 * Centralized imports for external modules used throughout the application
 */

// HTTP Framework
export { Application, Context, httpErrors, isHttpError, Router, Status } from "oak";

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
export { assertEquals, assertExists, assertRejects, assertThrows } from "std/assert";

export {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
} from "https://deno.land/std@0.224.0/testing/bdd.ts";

// HTTP utilities
export { STATUS_CODE as HttpStatus } from "https://deno.land/std@0.224.0/http/status.ts";

// Cryptography
export {
  decodeBase64 as base64Decode,
  encodeBase64 as base64Encode,
} from "https://deno.land/std@0.224.0/encoding/base64.ts";
export {
  decodeHex as hexDecode,
  encodeHex as hexEncode,
} from "https://deno.land/std@0.224.0/encoding/hex.ts";

// Validation
export { z } from "zod";

// UUID generation
export { v4 } from "https://deno.land/std@0.224.0/uuid/mod.ts";

// Date utilities
export {
  format as formatDate,
  parse as parseDate,
} from "https://deno.land/std@0.224.0/datetime/mod.ts";

// File system operations
export { ensureDir, exists } from "https://deno.land/std@0.224.0/fs/mod.ts";

// S3/R2 Client for Cloudflare R2
export { AwsClient } from "npm:aws4fetch@1.0.20";

// Types
export type { Middleware, Next } from "oak";
export type { LogLevel } from "std/log";
