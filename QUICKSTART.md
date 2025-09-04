# 🚀 Quick Start Guide

## One-Command Setup (Docker)

```bash
# Complete setup and start
./scripts/docker_setup.sh
```

## Manual Setup

```bash
# 1. Start services
docker-compose up -d

# 2. Wait for startup (check logs)
docker-compose logs -f api

# 3. Test health
curl http://localhost:8000/health

# 4. Test API info  
curl http://localhost:8000/api/v1
```

## Development Commands

```bash
./scripts/docker_dev.sh start     # Start services
./scripts/docker_dev.sh logs      # View logs
./scripts/docker_dev.sh health    # Health check
./scripts/docker_dev.sh test      # Run tests
./scripts/docker_dev.sh stop      # Stop services
```

## Services Available

- **API**: http://localhost:8000
- **Health**: http://localhost:8000/health
- **API Info**: http://localhost:8000/api/v1
- **PostgreSQL**: localhost:5433
- **Redis**: localhost:6379

## Troubleshooting

```bash
# View specific service logs
docker-compose logs postgres
docker-compose logs redis
docker-compose logs api

# Clean restart
docker-compose down -v
docker-compose up -d

# Check container status
docker-compose ps
```

## API Keys (Optional for Basic Testing)

Edit `.env` file for full features:

- `OPENAI_API_KEY` - AI authenticity verification
- `LLAMA_PARSE_API_KEY` - OCR text extraction
- `S3_*` credentials - File storage

Without these keys, the API will start but with limited functionality.
