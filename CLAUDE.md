# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Task Master AI Instructions
**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md

## Project Overview

**Document Verification API** - Anti-fraud system for automatic payment document verification and processing. This is a Deno-based TypeScript API that provides OCR extraction, database comparison, and AI-powered authenticity verification of payment documents.

### Architecture
- **Runtime**: Deno with native TypeScript support
- **Database**: PostgreSQL for transaction data and results storage  
- **Cache**: Redis for session management and performance optimization
- **Storage**: Cloudflare S3 for secure document storage
- **OCR**: Llama Parse for text extraction
- **AI**: OpenAI for document authenticity verification
- **Authentication**: Simple API key authentication

### Key Features
1. **OCR Processing** - Automatic text extraction from PNG/PDF payment documents
2. **Data Comparison** - Compare extracted data with database transaction records
3. **AI Verification** - OpenAI-powered authenticity scoring and fraud detection
4. **Async Processing** - Queue-based processing with status polling
5. **Secure Storage** - Encrypted S3 storage for sensitive documents

## Development Commands

### Project Setup
```bash
# Initialize Deno project (when implementation begins)
deno init

# Install dependencies (Deno uses URL imports, minimal package.json)
deno cache deps.ts

# Format code
deno fmt

# Lint code  
deno lint

# Type check
deno check main.ts
```

### Running the Application
```bash
# Development server
deno run --allow-net --allow-read --allow-env main.ts

# Production with all permissions
deno run --allow-all main.ts

# Run with specific permissions
deno run --allow-net --allow-read --allow-env --allow-write main.ts
```

### Testing
```bash
# Run all tests
deno test

# Run tests with coverage
deno test --coverage=coverage

# Generate coverage report
deno coverage coverage

# Run specific test file
deno test tests/ocr_test.ts

# Watch mode for tests
deno test --watch
```

### Database Operations
```bash
# Run database migrations (once implemented)
deno run --allow-net --allow-read scripts/migrate.ts

# Seed development data
deno run --allow-net --allow-read scripts/seed.ts

# Database reset for development
deno run --allow-net --allow-read scripts/reset_db.ts
```

## Core Architecture

### API Structure
```
src/
├── main.ts                 # Application entry point
├── deps.ts                 # External dependencies
├── config/                 # Configuration management
│   ├── database.ts         # PostgreSQL configuration
│   ├── redis.ts            # Cache configuration  
│   └── s3.ts               # Storage configuration
├── routes/                 # API endpoints
│   ├── documents.ts        # Document upload/processing routes
│   ├── status.ts           # Status checking routes
│   └── health.ts           # Health check endpoints
├── services/               # Business logic layer
│   ├── ocr_service.ts      # Llama Parse integration
│   ├── ai_service.ts       # OpenAI integration
│   ├── comparison_service.ts # Data comparison logic
│   └── storage_service.ts  # S3 operations
├── models/                 # Data models and types
│   ├── document.ts         # Document model
│   ├── extraction.ts       # OCR result types
│   └── comparison.ts       # Comparison result types
├── middleware/             # HTTP middleware
│   ├── auth.ts             # API key authentication
│   ├── rate_limit.ts       # Rate limiting
│   └── validation.ts       # Request validation
├── utils/                  # Utility functions
│   ├── logger.ts           # Structured logging
│   ├── queue.ts            # Async processing queue
│   └── errors.ts           # Error handling
└── database/               # Database operations
    ├── migrations/         # SQL migration files
    ├── schema.sql          # Database schema
    └── queries.ts          # Database queries
```

### Processing Pipeline
1. **Document Upload** → S3 storage with validation
2. **OCR Extraction** → Llama Parse text extraction
3. **Data Comparison** → Match against transaction database
4. **AI Verification** → OpenAI authenticity scoring
5. **Results Storage** → Cache results in Redis/PostgreSQL

## Environment Configuration

### Required Environment Variables
```bash
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/docverify"

# Redis Cache  
REDIS_URL="redis://localhost:6379"

# S3 Storage (Cloudflare)
S3_ACCESS_KEY_ID="your_access_key"
S3_SECRET_ACCESS_KEY="your_secret_key"
S3_BUCKET="document-verification-secure"
S3_ENDPOINT="https://your-account.r2.cloudflarestorage.com"

# External Services
LLAMA_PARSE_API_KEY="your_llama_parse_key"
OPENAI_API_KEY="sk-your-openai-key"

# Application
API_PORT=8000
API_KEY_SECRET="your-jwt-secret"
ENVIRONMENT="development"
```

### Development Setup
1. Copy `.env.example` to `.env` and configure API keys
2. Ensure PostgreSQL and Redis are running locally
3. Create database: `createdb document_verification`
4. Run migrations when implemented
5. Start development server with `deno run --allow-all main.ts`

## Key Implementation Guidelines

### Deno Best Practices
- Use URL imports for external dependencies in `deps.ts`
- Leverage Deno's built-in TypeScript support - no build step needed
- Use Deno's standard library when possible
- Implement proper permission flags (`--allow-net`, `--allow-read`, etc.)

### Security Requirements
- All file uploads must be validated for type and size
- Implement rate limiting on all endpoints (10 uploads/minute)
- Use JWT tokens for API authentication
- Store documents with encryption at rest (S3-KMS)
- Log all processing stages for audit trails
- Sanitize all OCR extracted data before database storage

### Performance Targets
- Document upload: < 1 second response
- OCR processing: < 5 seconds
- Status checks: < 50ms (cached)
- Support 100 concurrent uploads
- 99.9% uptime requirement

### Error Handling
- Use structured error responses with error codes
- Implement circuit breakers for external services
- Graceful degradation when AI service unavailable
- Comprehensive logging with correlation IDs
- Retry logic for transient failures

## API Design Patterns

### Response Format
All endpoints return standardized JSON:
```typescript
{
  "status": "success" | "error",
  "data": {...} | null,
  "error": {...} | null,  
  "meta": {
    "request_id": string,
    "timestamp": string,
    "version": "v1"
  }
}
```

### Authentication
API key format: `dv_[environment]_[32_char_key]`
Header: `X-API-Key: dv_prod_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

### Async Processing
Long operations return immediately with:
- `document_id` for tracking
- `processing_status`: "queued" | "processing" | "completed" | "failed"
- Status polling endpoint for updates

## Testing Strategy

### Test Structure
```
tests/
├── unit/                   # Unit tests for individual functions
│   ├── services/          # Service layer tests
│   ├── models/            # Data model tests
│   └── utils/             # Utility function tests
├── integration/           # Integration tests
│   ├── api/               # API endpoint tests
│   ├── database/          # Database operation tests
│   └── external/          # External service integration tests
└── e2e/                   # End-to-end workflow tests
    ├── upload_flow.ts     # Complete upload to results flow
    └── error_scenarios.ts # Error handling tests
```

### Test Data
- Use test fixtures for sample documents
- Mock external API responses (Llama Parse, OpenAI)
- Test database with isolated transactions
- Include Russian language payment documents for testing

## Monitoring and Observability

### Logging
- Structured JSON logging with correlation IDs
- Log levels: DEBUG, INFO, WARN, ERROR
- Security: Never log API keys or sensitive document content
- Performance: Log processing times for each stage

### Metrics
Key metrics to track:
- Document processing success/failure rates
- OCR accuracy scores
- AI authenticity confidence distributions
- API response times by endpoint
- Queue depths and processing times

### Health Checks
Implement `/health` endpoint checking:
- Database connectivity
- Redis availability  
- S3 storage access
- External API health (Llama Parse, OpenAI)