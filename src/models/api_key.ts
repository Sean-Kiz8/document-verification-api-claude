/**
 * API Key Models and Types
 * Defines data structures for API key authentication system
 */

export interface ApiKey {
  id: string;
  keyHash: string;
  keyPrefix: string;
  name: string;
  description: string | undefined;
  environment: "development" | "staging" | "production";
  permissions: string[];
  rateLimitPerMinute: number;
  rateLimitPerHour: number;
  rateLimitPerDay: number;
  isActive: boolean;
  expiresAt: Date | undefined;
  lastUsedAt: Date | undefined;
  usageCount: number;
  createdBy: string | undefined;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKeyCreation {
  name: string;
  description: string | undefined;
  environment: "development" | "staging" | "production";
  permissions: string[] | undefined;
  rateLimitPerMinute: number | undefined;
  rateLimitPerHour: number | undefined;
  rateLimitPerDay: number | undefined;
  expiresAt: Date | undefined;
  createdBy: string | undefined;
}

export interface ApiKeyValidation {
  isValid: boolean;
  apiKey?: ApiKey;
  error?: string;
  rateLimitExceeded?: boolean;
  remainingRequests?: {
    perMinute: number;
    perHour: number;
    perDay: number;
  };
}

export interface RateLimitInfo {
  windowMinute: string;
  windowHour: string;
  windowDay: string;
  requestsMinute: number;
  requestsHour: number;
  requestsDay: number;
  limitMinute: number;
  limitHour: number;
  limitDay: number;
  remainingMinute: number;
  remainingHour: number;
  remainingDay: number;
  exceededLimit: boolean;
}

export interface AuthenticatedRequest {
  apiKey: ApiKey;
  rateLimitInfo: RateLimitInfo;
  requestId: string;
}
