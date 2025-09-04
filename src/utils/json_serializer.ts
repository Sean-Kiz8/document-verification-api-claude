/**
 * JSON Serializer Utility
 * Handles BigInt and other non-serializable types
 */

/**
 * Convert BigInt values to Numbers recursively
 */
export function sanitizeForJson(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "bigint") {
    return Number(obj);
  }

  if (typeof obj === "object") {
    if (Array.isArray(obj)) {
      return obj.map(item => sanitizeForJson(item));
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeForJson(value);
    }
    return sanitized;
  }

  return obj;
}

/**
 * Safe JSON stringify that handles BigInt
 */
export function safeJsonStringify(obj: unknown, space?: number): string {
  const sanitized = sanitizeForJson(obj);
  return JSON.stringify(sanitized, null, space);
}