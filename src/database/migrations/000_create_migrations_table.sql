-- Migration 000: Create migrations tracking table
-- This table tracks which migrations have been applied
-- Must be run first before any other migrations

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(10) PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  checksum VARCHAR(64), -- For future integrity checking
  execution_time_ms INTEGER
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at 
  ON schema_migrations(applied_at DESC);

-- Insert this migration
INSERT INTO schema_migrations (version, description, applied_at) 
VALUES ('000', 'Create migrations tracking table', NOW())
ON CONFLICT (version) DO NOTHING;

COMMENT ON TABLE schema_migrations IS 'Tracks database schema migrations and their execution status';