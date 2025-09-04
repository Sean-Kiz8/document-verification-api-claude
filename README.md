# Document Verification API

Anti-fraud system for automatic payment document verification and processing.

## 🚀 Quick Start

### Prerequisites

- **Docker** and **Docker Compose**

## 🐳 Docker Setup (Recommended)

### One-Command Setup

```bash
# Complete setup with one command
./scripts/docker_setup.sh
```

### Development Commands

```bash
# Quick development helper
./scripts/docker_dev.sh setup     # Initial setup
./scripts/docker_dev.sh start     # Start services  
./scripts/docker_dev.sh logs      # View API logs
./scripts/docker_dev.sh test      # Run tests
./scripts/docker_dev.sh health    # Check health
./scripts/docker_dev.sh stop      # Stop services
```

### Manual Docker Commands

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f api

# Database shell
docker-compose exec postgres psql -U postgres -d document_verification

# API container shell  
docker-compose exec api bash

# Stop services
docker-compose down
```

### Services:

- **API**: http://localhost:8000 (health check, endpoints)
- **PostgreSQL**: localhost:5432 (database)
- **Redis**: localhost:6379 (cache)

## 💻 Local Development (Alternative)

### Prerequisites

- **Deno** (latest version)
- **PostgreSQL** 14+
- **Redis** 6+

### Setup and Run

```bash
# Install dependencies (macOS)
brew install postgresql@14 redis deno

# Start services
brew services start postgresql@14
brew services start redis

# Create database
createdb document_verification

# Copy config and edit with API keys
cp .env.example .env

# Run setup
deno run --allow-all scripts/setup_dev.ts

# Start development server
deno task dev
```

## 📖 API Documentation

### Authentication

All API endpoints (except `/health` and `/api/v1`) require API key authentication:

```bash
# Header format
Authorization: Bearer dv_development_your_api_key_here

# Or using X-API-Key header
X-API-Key: dv_development_your_api_key_here
```

### Core Endpoints

#### Document Upload

```bash
POST /api/v1/documents
Content-Type: multipart/form-data

# Form fields:
# file: Document file (PDF, PNG, JPEG, max 10MB)
# user_id: User identifier
# transaction_id: Transaction ID for comparison
# dispute_id: Optional dispute ID
# document_type: payment_receipt | bank_statement | invoice | other
# priority: high | normal | low
# immediate_processing: true | false
# language: en,ru (comma-separated)
```

#### Document Status

```bash
GET /api/v1/documents/{document_id}/status

# Query parameters:
# include_logs: true | false (default: true)
# include_timing: true | false (default: true) 
# include_metadata: true | false (default: true)
# no_cache: true | false (force fresh data)
```

#### Document Results

```bash
GET /api/v1/documents/{document_id}/results

# Query parameters:
# include_raw_text: true | false
# include_discrepancies: true | false
# include_document_access: true | false
# compression: none | basic | maximum
# summary_only: true | false (lightweight response)
# no_cache: true | false
```

### Admin Endpoints (require admin permission)

```bash
# Create API key
POST /api/v1/admin/api-keys

# List API keys  
GET /api/v1/admin/api-keys

# Deactivate API key
DELETE /api/v1/admin/api-keys/{key_id}

# Rate limiting metrics
GET /api/v1/admin/rate-limits/metrics

# Cache statistics
GET /api/v1/admin/cache/stats
```

## 🔧 Development Commands

```bash
# Format code
deno fmt

# Type check
deno check src/main.ts

# Run tests
deno task test

# Run specific test suites
deno run --allow-all scripts/test_auth.ts
deno run --allow-all scripts/test_s3.ts
deno run --allow-all scripts/test_ocr.ts
deno run --allow-all scripts/test_upload.ts
deno run --allow-all scripts/test_status.ts
deno run --allow-all scripts/test_results.ts
deno run --allow-all scripts/test_rate_limiting.ts

# Database operations
deno run --allow-all scripts/migrate.ts
deno run --allow-all scripts/test_database.ts
```

## 🏗️ Architecture

### Processing Pipeline

1. **Document Upload** → Multipart handling, validation, S3 storage
2. **OCR Extraction** → Llama Parse with Russian/English support
3. **Data Comparison** → Compare with transaction database (planned)
4. **AI Verification** → OpenAI/Mistral authenticity analysis
5. **Results Caching** → Redis caching with 1-hour TTL

### Security Features

- **API Key Authentication** with permissions and rate limiting
- **Sliding Window Rate Limiting** with abuse detection
- **Data Masking** for PII and financial information
- **Comprehensive Error Handling** with structured logging
- **Circuit Breakers** for external service protection

### Performance Features

- **Multi-layer Caching** (Memory + Redis)
- **Async Processing Pipeline** with priority queues
- **Connection Pooling** for database and Redis
- **Compression** support for large responses
- **Health Monitoring** for all services

## 🛡️ Security

### Rate Limits (per API key)

- **Document Upload**: 10/min, 100/hour, 1000/day
- **Status Check**: 60/min, 600/hour, 5000/day
- **Results Retrieval**: 30/min, 300/hour, 2000/day
- **API Key Creation**: 2/min, 10/hour, 50/day

### API Key Tiers

- **Basic** (1x limits): Standard rate limits
- **Premium** (5x limits): Higher limits + priority processing
- **Enterprise** (20x limits): Highest limits + abuse bypass

### Data Protection

- **Sensitive Data Masking**: Credit cards, SSN, bank accounts
- **Secure Storage**: Encrypted S3 with signed URLs
- **Access Control**: Permission-based API access
- **Audit Logging**: Complete request/response tracking

## 🔍 Monitoring

### Health Checks

- **Database**: Connection, latency, query performance
- **Redis**: Connection, memory usage, latency
- **S3 Storage**: Connectivity, bucket access
- **OCR Service**: Llama Parse API availability
- **Processing Pipeline**: Queue depth, worker health

### Error Handling

- **Error Codes**: E1001-E7002 comprehensive catalog
- **Structured Logging**: JSON format with trace IDs
- **Alert System**: Critical error notifications
- **Recovery Mechanisms**: Automatic retry and fallback

## 📊 File Structure

```
src/
├── main.ts                     # Application entry point
├── deps.ts                     # External dependencies
├── config/                     # Configuration management
│   ├── env.ts                  # Environment variables
│   ├── database.ts             # PostgreSQL setup
│   ├── redis.ts                # Redis cache setup
│   ├── s3.ts                   # Cloudflare R2 setup
│   └── llama_parse.ts          # OCR service setup
├── services/                   # Business logic
│   ├── api_key_service.ts      # API key management
│   ├── storage_service.ts      # S3 file operations
│   ├── ocr_service.ts          # Document OCR processing
│   ├── document_upload_service.ts    # Upload handling
│   ├── document_status_service.ts    # Status tracking
│   ├── document_results_service.ts   # Results aggregation
│   └── rate_limiting_service.ts      # Enhanced rate limiting
├── routes/                     # API endpoints
│   ├── documents.ts            # Document operations
│   ├── api_keys.ts             # API key management
│   └── monitoring.ts           # System monitoring
├── middleware/                 # HTTP middleware
│   ├── auth.ts                 # Authentication
│   └── enhanced_rate_limiting.ts     # Rate limiting
├── models/                     # Data models
│   ├── api_key.ts              # Authentication models
│   ├── ocr.ts                  # OCR processing models
│   ├── document_upload.ts      # Upload models
│   ├── document_status.ts      # Status models
│   ├── document_results.ts     # Results models
│   └── rate_limiting.ts        # Rate limiting models
├── utils/                      # Utilities
│   ├── error_catalog.ts        # Error definitions
│   ├── data_masking.ts         # PII masking
│   ├── structured_logger.ts    # JSON logging
│   └── error_recovery.ts       # Recovery mechanisms
└── database/                   # Database operations
    ├── schema.sql              # Database schema
    ├── queries.ts              # Typed queries
    └── migrations/             # Migration files
```

## 🧪 Testing

Run comprehensive test suite:

```bash
# All tests
deno task test

# Individual components
deno run --allow-all scripts/test_auth.ts        # Authentication
deno run --allow-all scripts/test_s3.ts          # Storage
deno run --allow-all scripts/test_ocr.ts         # OCR processing  
deno run --allow-all scripts/test_upload.ts      # Document upload
deno run --allow-all scripts/test_status.ts      # Status tracking
deno run --allow-all scripts/test_results.ts     # Results retrieval
deno run --allow-all scripts/test_rate_limiting.ts  # Rate limiting
```

## 🤝 Contributing

1. Follow TypeScript strict mode
2. Use structured logging for all operations
3. Include comprehensive error handling
4. Write tests for new features
5. Update API documentation

## 📞 Support

For issues and questions:

1. Check the health endpoint for service status
2. Review structured logs for error details
3. Use trace IDs for error correlation
4. Test with the provided scripts

## 🚀 Quick Development Setup

### Docker One-Command Start

```bash
# Complete setup and start
./scripts/docker_setup.sh

# Development helpers  
./scripts/docker_dev.sh start     # Start services
./scripts/docker_dev.sh logs      # View logs
./scripts/docker_dev.sh test      # Run tests
./scripts/docker_dev.sh health    # Health check
./scripts/docker_dev.sh stop      # Stop services
```

### Troubleshooting

```bash
# If database connection fails
docker-compose logs postgres

# If Redis connection fails  
docker-compose logs redis

# If API fails to start
docker-compose logs api

# Clean restart
docker-compose down -v && docker-compose up -d
```

## 📄 License

Document Verification API - Anti-fraud payment document processing system.
