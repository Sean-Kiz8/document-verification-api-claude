#!/usr/bin/env deno run --allow-net --allow-read --allow-env --allow-write

/**
 * Debug Authentication Issues
 */

import { initializeDatabase } from "@config/database.ts";
import { initializeRedis } from "@config/redis.ts";
import { apiKeyService } from "@services/api_key_service.ts";
import { query } from "@config/database.ts";

async function debugAuth() {
  console.log("🔍 Debugging Authentication...");
  
  try {
    await initializeDatabase();
    await initializeRedis();
    
    // List all API keys
    console.log("\n📋 Existing API keys in database:");
    const keys = await query<Record<string, unknown>>("SELECT id, key_hash, key_prefix, name, permissions, is_active FROM api_keys");
    
    for (const key of keys) {
      console.log(`  ${key.name}: ${key.key_prefix}*** (active: ${key.is_active})`);
      console.log(`    Hash: ${(key.key_hash as string).substring(0, 16)}...`);
      console.log(`    Permissions: ${key.permissions}`);
    }
    
    // Test validation with known key
    if (keys.length > 0) {
      const testKey = "dv_development_edc0bc67130852fead59dbf1321f61af299ac7578cde6077544d9cc1e2050aca";
      
      console.log("\n🔐 Testing API key validation...");
      console.log(`Using key: ${testKey.substring(0, 20)}...`);
      
      try {
        const validation = await apiKeyService.validateApiKey(`Bearer ${testKey}`);
        console.log("Validation result:", {
          isValid: validation.isValid,
          error: validation.error,
          rateLimitExceeded: validation.rateLimitExceeded,
        });
        
        if (validation.apiKey) {
          console.log("API Key found:", {
            id: validation.apiKey.id,
            name: validation.apiKey.name,
            permissions: validation.apiKey.permissions,
            isActive: validation.apiKey.isActive,
          });
        }
      } catch (validationError) {
        console.log("❌ Validation error:", validationError);
      }
    }
    
  } catch (error) {
    console.error("❌ Debug failed:", error);
  }
}

if (import.meta.main) {
  await debugAuth();
}