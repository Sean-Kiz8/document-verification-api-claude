#!/bin/bash

# Docker Development Helper Script
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🐳 Document Verification API - Docker Development Helper${NC}"
echo "==========================================================="

# Function to show usage
show_usage() {
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  setup     - Initial setup with database and API key creation"
    echo "  start     - Start all services"
    echo "  stop      - Stop all services"
    echo "  restart   - Restart all services"
    echo "  logs      - Show API logs"
    echo "  logs-all  - Show all service logs"
    echo "  shell     - Enter API container shell"
    echo "  db-shell  - Enter database shell"
    echo "  test      - Run test suite"
    echo "  health    - Check all service health"
    echo "  cleanup   - Clean up containers and volumes"
    echo ""
    echo "Examples:"
    echo "  $0 setup           # Initial setup"
    echo "  $0 start           # Start services"
    echo "  $0 logs            # View API logs"
    echo "  $0 test            # Run tests"
}

# Function to check Docker
check_docker() {
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}❌ Docker not found. Please install Docker Desktop.${NC}"
        exit 1
    fi
    
    if ! docker info > /dev/null 2>&1; then
        echo -e "${RED}❌ Docker is not running. Please start Docker Desktop.${NC}"
        exit 1
    fi
}

# Function to setup environment
setup_env() {
    echo -e "${BLUE}🔧 Setting up development environment...${NC}"
    
    # Create .env if it doesn't exist
    if [ ! -f .env ]; then
        cp .env.example .env
        echo -e "${GREEN}✅ Created .env file${NC}"
        echo -e "${YELLOW}⚠️  Please edit .env with your API keys:${NC}"
        echo "   - OPENAI_API_KEY (for AI verification)"
        echo "   - LLAMA_PARSE_API_KEY (for OCR)"
        echo "   - S3 credentials (for file storage)"
    else
        echo -e "${GREEN}✅ .env file already exists${NC}"
    fi
}

# Function to start services
start_services() {
    echo -e "${BLUE}🚀 Starting services...${NC}"
    docker-compose up -d
    
    echo -e "${YELLOW}⏳ Waiting for services to be healthy...${NC}"
    
    # Wait for services
    until docker-compose exec -T postgres pg_isready -U postgres -d document_verification > /dev/null 2>&1; do
        echo "  PostgreSQL starting..."
        sleep 2
    done
    echo -e "${GREEN}  ✅ PostgreSQL ready${NC}"
    
    until docker-compose exec -T redis redis-cli ping > /dev/null 2>&1; do
        echo "  Redis starting..."
        sleep 2
    done
    echo -e "${GREEN}  ✅ Redis ready${NC}"
    
    until curl -f http://localhost:8000/health > /dev/null 2>&1; do
        echo "  API starting..."
        sleep 3
    done
    echo -e "${GREEN}  ✅ API ready${NC}"
    
    echo -e "${GREEN}🎉 All services are running!${NC}"
    echo ""
    echo "Services available at:"
    echo "  🌐 API: http://localhost:8000"
    echo "  🗄️  PostgreSQL: localhost:5432"
    echo "  📦 Redis: localhost:6379"
}

# Function to run tests
run_tests() {
    echo -e "${BLUE}🧪 Running test suite...${NC}"
    
    echo "Database tests..."
    docker-compose exec api deno run --allow-all scripts/test_database.ts
    
    echo "Authentication tests..."
    docker-compose exec api deno run --allow-all scripts/test_auth.ts
    
    echo "Storage tests..."
    docker-compose exec api deno run --allow-all scripts/test_s3.ts
    
    echo "Rate limiting tests..."
    docker-compose exec api deno run --allow-all scripts/test_rate_limiting.ts
    
    echo -e "${GREEN}✅ Test suite completed${NC}"
}

# Function to check health
check_health() {
    echo -e "${BLUE}🔍 Checking service health...${NC}"
    
    echo "API Health:"
    curl -s http://localhost:8000/health | jq '.' 2>/dev/null || curl -s http://localhost:8000/health
    
    echo -e "\nAPI Info:"
    curl -s http://localhost:8000/api/v1 | jq '.status, .statistics' 2>/dev/null || curl -s http://localhost:8000/api/v1 | head -c 200
}

# Main script logic
case "$1" in
    "setup")
        check_docker
        setup_env
        docker-compose down -v --remove-orphans 2>/dev/null || true
        start_services
        echo -e "${BLUE}📊 Running database migrations...${NC}"
        docker-compose exec api deno run --allow-all scripts/migrate.ts
        echo -e "${BLUE}🔑 Creating admin API key...${NC}"
        docker-compose exec api deno run --allow-all scripts/setup_dev.ts
        ;;
    "start")
        check_docker
        start_services
        ;;
    "stop")
        echo -e "${YELLOW}🛑 Stopping services...${NC}"
        docker-compose down
        ;;
    "restart")
        echo -e "${YELLOW}🔄 Restarting services...${NC}"
        docker-compose down
        start_services
        ;;
    "logs")
        docker-compose logs -f api
        ;;
    "logs-all")
        docker-compose logs -f
        ;;
    "shell")
        docker-compose exec api bash
        ;;
    "db-shell")
        docker-compose exec postgres psql -U postgres -d document_verification
        ;;
    "test")
        run_tests
        ;;
    "health")
        check_health
        ;;
    "cleanup")
        echo -e "${YELLOW}🧹 Cleaning up containers and volumes...${NC}"
        docker-compose down -v --remove-orphans
        docker system prune -f
        echo -e "${GREEN}✅ Cleanup completed${NC}"
        ;;
    *)
        show_usage
        exit 1
        ;;
esac