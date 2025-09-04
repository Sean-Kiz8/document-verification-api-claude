# Document Verification API Dockerfile
FROM denoland/deno:1.45.5

# Set working directory
WORKDIR /app

# Copy dependency files first (for layer caching)
COPY deno.json deno.lock* ./
RUN rm -f deno.lock

# Copy source code
COPY src/ ./src/
COPY scripts/ ./scripts/

# Cache dependencies
RUN deno cache src/main.ts

# Install curl for healthcheck
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -r docverify && useradd -r -g docverify -s /bin/bash docverify
RUN chown -R docverify:docverify /app
USER docverify

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

# Start the application
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-env", "--allow-write", "src/main.ts"]