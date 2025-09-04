#!/bin/bash

# Document Verification API - Docker Development Setup
set -e

echo "🚀 Document Verification API - Docker Setup"
echo "============================================="

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop."
    exit 1
fi

echo "✅ Docker is running"

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📋 Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created"
    echo "⚠️  Please edit .env file with your API keys:"
    echo "   - OPENAI_API_KEY (for AI verification)"
    echo "   - MISTRAL_API_KEY (alternative to OpenAI)" 
    echo "   - LLAMA_PARSE_API_KEY (for OCR)"
    echo "   - S3 credentials (for file storage)"
else
    echo "✅ .env file already exists"
fi

# Stop and remove existing containers
echo "🛑 Stopping existing containers..."
docker-compose down -v --remove-orphans || true

# Build and start services
echo "🔨 Building and starting services..."
docker-compose up --build -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."

# Wait for PostgreSQL
echo "  🗄️  Waiting for PostgreSQL..."
until docker-compose exec -T postgres pg_isready -U postgres -d document_verification; do
    echo "    PostgreSQL is starting up..."
    sleep 2
done
echo "  ✅ PostgreSQL is ready"

# Wait for Redis
echo "  📦 Waiting for Redis..."
until docker-compose exec -T redis redis-cli ping > /dev/null 2>&1; do
    echo "    Redis is starting up..."
    sleep 2
done
echo "  ✅ Redis is ready"

# Wait for API
echo "  🌐 Waiting for API..."
until curl -f http://localhost:8000/health > /dev/null 2>&1; do
    echo "    API is starting up..."
    sleep 3
done
echo "  ✅ API is ready"

# Run database migrations
echo "📊 Running database migrations..."
docker-compose exec api deno run --allow-net --allow-read --allow-env scripts/migrate.ts

# Create admin API key
echo "🔑 Creating development admin API key..."
docker-compose exec api deno run --allow-net --allow-read --allow-env --allow-write scripts/setup_dev.ts

# Test endpoints
echo "🧪 Testing API endpoints..."
echo "  Health check:"
curl -s http://localhost:8000/health | head -c 100
echo "..."
echo ""

echo "  API info:"
curl -s http://localhost:8000/api/v1 | head -c 200  
echo "..."
echo ""

echo ""
echo "🎉 Docker setup completed successfully!"
echo ""
echo "📋 Services running:"
echo "  🗄️  PostgreSQL: localhost:5432"
echo "  📦 Redis: localhost:6379"  
echo "  🌐 API: http://localhost:8000"
echo ""
echo "📚 Useful commands:"
echo "  docker-compose logs api         # View API logs"
echo "  docker-compose logs postgres    # View database logs"
echo "  docker-compose exec api bash    # Shell into API container"
echo "  docker-compose exec postgres psql -U postgres -d document_verification  # Database shell"
echo "  docker-compose down             # Stop all services"
echo "  docker-compose up -d            # Start services"
echo ""
echo "🔗 Test endpoints:"
echo "  curl http://localhost:8000/health"
echo "  curl http://localhost:8000/api/v1"
echo ""