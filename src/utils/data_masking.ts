/**
 * Data Masking Utility
 * Masks sensitive data in logs and error responses
 */

import { log } from "@/deps.ts";
import type { ErrorContext } from "@utils/error_catalog.ts";

/**
 * Sensitive data patterns for masking
 */
const SENSITIVE_PATTERNS = {
  // Credit card numbers (various formats)
  creditCard: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,

  // Bank account numbers (8-17 digits)
  bankAccount: /\b\d{8,17}\b/g,

  // SSN (US Social Security Numbers)
  ssn: /\b\d{3}-?\d{2}-?\d{4}\b/g,

  // API keys (our format and common patterns)
  apiKey: /\b(?:dv_[a-z]+_[a-f0-9]{64}|sk-[A-Za-z0-9]{48,}|llx-[A-Za-z0-9]+)\b/g,

  // Email addresses
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,

  // Phone numbers (various formats)
  phone: /\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,

  // Russian passport numbers
  russianPassport: /\b\d{4}\s?\d{6}\b/g,

  // Russian INN (tax identification numbers)
  russianINN: /\b\d{10,12}\b/g,

  // IBAN codes
  iban: /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}\b/g,

  // Authorization tokens
  authToken: /\b(?:Bearer\s+)?[A-Za-z0-9+/]{20,}={0,2}\b/g,
};

/**
 * Masking configuration
 */
interface MaskingConfig {
  maskChar: string;
  preserveLength: boolean;
  preservePrefix: number;
  preserveSuffix: number;
  replaceWithPlaceholder: boolean;
  placeholderText: string;
}

/**
 * Default masking configurations for different data types
 */
const MASKING_CONFIGS: Record<string, MaskingConfig> = {
  creditCard: {
    maskChar: "*",
    preserveLength: true,
    preservePrefix: 4,
    preserveSuffix: 4,
    replaceWithPlaceholder: false,
    placeholderText: "[CREDIT_CARD]",
  },
  bankAccount: {
    maskChar: "*",
    preserveLength: false,
    preservePrefix: 0,
    preserveSuffix: 0,
    replaceWithPlaceholder: true,
    placeholderText: "[BANK_ACCOUNT]",
  },
  ssn: {
    maskChar: "*",
    preserveLength: true,
    preservePrefix: 0,
    preserveSuffix: 0,
    replaceWithPlaceholder: true,
    placeholderText: "[SSN]",
  },
  apiKey: {
    maskChar: "*",
    preserveLength: false,
    preservePrefix: 8,
    preserveSuffix: 0,
    replaceWithPlaceholder: false,
    placeholderText: "[API_KEY]",
  },
  email: {
    maskChar: "*",
    preserveLength: false,
    preservePrefix: 3,
    preserveSuffix: 0,
    replaceWithPlaceholder: false,
    placeholderText: "[EMAIL]",
  },
  phone: {
    maskChar: "*",
    preserveLength: true,
    preservePrefix: 3,
    preserveSuffix: 2,
    replaceWithPlaceholder: false,
    placeholderText: "[PHONE]",
  },
  default: {
    maskChar: "*",
    preserveLength: false,
    preservePrefix: 0,
    preserveSuffix: 0,
    replaceWithPlaceholder: true,
    placeholderText: "[SENSITIVE_DATA]",
  },
};

class DataMaskingService {
  private logger = log.getLogger();

  /**
   * Mask sensitive data in text
   */
  maskSensitiveData(text: string, options?: { aggressive?: boolean }): string {
    if (!text || typeof text !== "string") {
      return text;
    }

    let maskedText = text;

    // Apply masking for each pattern type
    for (const [patternName, pattern] of Object.entries(SENSITIVE_PATTERNS)) {
      const config = MASKING_CONFIGS[patternName] || MASKING_CONFIGS.default!;
      maskedText = maskedText.replace(pattern, (match) => this.maskValue(match, config));
    }

    // Aggressive masking for high-security scenarios
    if (options?.aggressive) {
      maskedText = this.applyAggressiveMasking(maskedText);
    }

    return maskedText;
  }

  /**
   * Mask sensitive data in objects (recursive)
   */
  maskSensitiveObject(obj: any, depth = 0): any {
    if (depth > 10) return "[MAX_DEPTH_REACHED]"; // Prevent infinite recursion

    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === "string") {
      return this.maskSensitiveData(obj);
    }

    if (typeof obj === "number" && this.isLikelySensitiveNumber(obj)) {
      return "[SENSITIVE_NUMBER]";
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.maskSensitiveObject(item, depth + 1));
    }

    if (typeof obj === "object") {
      const masked: Record<string, any> = {};

      for (const [key, value] of Object.entries(obj)) {
        // Mask keys that might contain sensitive data
        if (this.isSensitiveKey(key)) {
          masked[key] = this.maskByKeyName(key, value);
        } else {
          masked[key] = this.maskSensitiveObject(value, depth + 1);
        }
      }

      return masked;
    }

    return obj;
  }

  /**
   * Mask error context specifically
   */
  async maskErrorContext(context: Partial<ErrorContext>): Promise<Partial<ErrorContext>> {
    const masked = { ...context };

    // Mask user agent (might contain sensitive info)
    if (masked.userAgent) {
      masked.userAgent = this.maskUserAgent(masked.userAgent);
    }

    // Mask metadata
    if (masked.metadata) {
      masked.metadata = this.maskSensitiveObject(masked.metadata);
    }

    return masked;
  }

  /**
   * Mask specific value based on configuration
   */
  private maskValue(value: string, config: MaskingConfig): string {
    if (config.replaceWithPlaceholder) {
      return config.placeholderText;
    }

    if (!config.preserveLength) {
      return config.placeholderText;
    }

    const totalLength = value.length;
    const prefixLength = Math.min(config.preservePrefix, totalLength);
    const suffixLength = Math.min(config.preserveSuffix, totalLength - prefixLength);
    const maskLength = totalLength - prefixLength - suffixLength;

    const prefix = value.substring(0, prefixLength);
    const suffix = suffixLength > 0 ? value.substring(totalLength - suffixLength) : "";
    const mask = config.maskChar.repeat(Math.max(0, maskLength));

    return prefix + mask + suffix;
  }

  /**
   * Check if key name suggests sensitive data
   */
  private isSensitiveKey(key: string): boolean {
    const sensitiveKeys = [
      "password",
      "token",
      "key",
      "secret",
      "auth",
      "credential",
      "card",
      "account",
      "ssn",
      "passport",
      "license",
      "bank",
      "pin",
      "cvv",
      "cvv2",
      "cvc",
      "security_code",
    ];

    const lowerKey = key.toLowerCase();
    return sensitiveKeys.some((sensitiveKey) => lowerKey.includes(sensitiveKey));
  }

  /**
   * Mask value based on key name
   */
  private maskByKeyName(key: string, value: any): any {
    const lowerKey = key.toLowerCase();

    if (lowerKey.includes("card") || lowerKey.includes("account")) {
      return "[FINANCIAL_DATA]";
    }

    if (lowerKey.includes("password") || lowerKey.includes("secret")) {
      return "[CREDENTIAL]";
    }

    if (lowerKey.includes("token") || lowerKey.includes("key")) {
      return "[TOKEN]";
    }

    if (typeof value === "string") {
      return this.maskSensitiveData(value);
    }

    return this.maskSensitiveObject(value);
  }

  /**
   * Check if number is likely sensitive
   */
  private isLikelySensitiveNumber(num: number): boolean {
    const str = num.toString();

    // Credit card-like numbers (13-19 digits)
    if (str.length >= 13 && str.length <= 19) {
      return true;
    }

    // SSN-like numbers (9 digits)
    if (str.length === 9) {
      return true;
    }

    // Bank account-like numbers (8-17 digits)
    if (str.length >= 8 && str.length <= 17) {
      return true;
    }

    return false;
  }

  /**
   * Mask user agent string (might contain sensitive system info)
   */
  private maskUserAgent(userAgent: string): string {
    // Remove potential system identifiers while keeping browser info
    return userAgent
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[IP_ADDRESS]")
      .replace(/\b[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}\b/gi, "[UUID]")
      .replace(/\b[a-f0-9]{32,}\b/gi, "[HASH]");
  }

  /**
   * Apply aggressive masking for high-security scenarios
   */
  private applyAggressiveMasking(text: string): string {
    return text
      // Mask any sequence of 8+ digits
      .replace(/\b\d{8,}\b/g, "[NUMBER_SEQUENCE]")
      // Mask UUIDs
      .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, "[UUID]")
      // Mask long alphanumeric sequences (potential tokens)
      .replace(/\b[A-Za-z0-9]{20,}\b/g, "[TOKEN_SEQUENCE]")
      // Mask URLs with sensitive paths
      .replace(/https?:\/\/[^\s]+/g, "[URL]");
  }

  /**
   * Validate that sensitive data has been properly masked
   */
  validateMasking(text: string): {
    isValid: boolean;
    violations: string[];
  } {
    const violations: string[] = [];

    // Check for common sensitive patterns that should have been masked
    for (const [patternName, pattern] of Object.entries(SENSITIVE_PATTERNS)) {
      const matches = text.match(pattern);
      if (matches) {
        violations.push(`Unmasked ${patternName} detected: ${matches.length} instances`);
      }
    }

    return {
      isValid: violations.length === 0,
      violations,
    };
  }

  /**
   * Get masking statistics
   */
  getMaskingStats(originalText: string, maskedText: string): {
    originalLength: number;
    maskedLength: number;
    charactersChanged: number;
    maskingRatio: number;
  } {
    const originalLength = originalText.length;
    const maskedLength = maskedText.length;

    let charactersChanged = 0;
    const minLength = Math.min(originalLength, maskedLength);

    for (let i = 0; i < minLength; i++) {
      if (originalText[i] !== maskedText[i]) {
        charactersChanged++;
      }
    }

    charactersChanged += Math.abs(originalLength - maskedLength);

    return {
      originalLength,
      maskedLength,
      charactersChanged,
      maskingRatio: originalLength > 0 ? charactersChanged / originalLength : 0,
    };
  }
}

export const dataMaskingService = new DataMaskingService();
