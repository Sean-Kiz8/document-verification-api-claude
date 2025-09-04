-- Migration 001: Initial Database Schema
-- Document Verification API - Anti-fraud system
-- Created: 2025-09-04
-- Description: Creates initial tables, indexes, and constraints

-- Migration metadata
INSERT INTO schema_migrations (version, description, applied_at) 
VALUES ('001', 'Initial database schema with documents, processing_logs, api_keys, and request_logs tables', NOW())
ON CONFLICT (version) DO NOTHING;

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create custom types
CREATE TYPE processing_status AS ENUM (
  'queued',
  'processing', 
  'completed',
  'failed',
  'cancelled'
);

CREATE TYPE document_type AS ENUM (
  'payment_receipt',
  'bank_statement',
  'invoice',
  'other'
);

CREATE TYPE log_level AS ENUM (
  'DEBUG',
  'INFO', 
  'WARN',
  'ERROR'
);

-- Documents table
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id VARCHAR(255) NOT NULL,
  dispute_id VARCHAR(255),
  user_id VARCHAR(255) NOT NULL,
  
  -- File metadata
  file_name VARCHAR(255) NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  mime_type VARCHAR(100) NOT NULL,
  document_type document_type NOT NULL DEFAULT 'payment_receipt',
  
  -- Storage information
  s3_key VARCHAR(500) NOT NULL,
  s3_bucket VARCHAR(255) NOT NULL,
  upload_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Processing information
  processing_status processing_status NOT NULL DEFAULT 'queued',
  started_processing_at TIMESTAMP WITH TIME ZONE,
  completed_processing_at TIMESTAMP WITH TIME ZONE,
  
  -- Extracted data from OCR (JSON format)
  extracted_data JSONB,
  
  -- Comparison results with database records (JSON format)
  comparison_results JSONB,
  
  -- AI authenticity verification score (0.0 to 1.0)
  authenticity_score DECIMAL(3,2) CHECK (authenticity_score >= 0.0 AND authenticity_score <= 1.0),
  
  -- AI authenticity details (JSON format)
  authenticity_details JSONB,
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_file_size CHECK (file_size <= 52428800), -- 50MB max
  CONSTRAINT valid_mime_type CHECK (mime_type IN ('image/png', 'image/jpeg', 'application/pdf')),
  CONSTRAINT processing_timestamps CHECK (
    (started_processing_at IS NULL) OR 
    (completed_processing_at IS NULL) OR 
    (completed_processing_at >= started_processing_at)
  )
);

-- Processing logs table
CREATE TABLE processing_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  
  -- Processing stage information
  stage VARCHAR(100) NOT NULL,
  status VARCHAR(50) NOT NULL,
  
  -- Timing information
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  duration_ms INTEGER,
  
  -- Log details
  log_level log_level NOT NULL DEFAULT 'INFO',
  message TEXT,
  error_details JSONB,
  
  -- Additional context
  metadata JSONB,
  
  -- Constraints
  CONSTRAINT valid_duration CHECK (
    (duration_ms IS NULL) OR 
    (duration_ms >= 0)
  ),
  CONSTRAINT valid_timing CHECK (
    (completed_at IS NULL) OR 
    (completed_at >= started_at)
  )
);

-- API keys table
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  key_prefix VARCHAR(20) NOT NULL,
  
  -- Key metadata
  name VARCHAR(255) NOT NULL,
  description TEXT,
  environment VARCHAR(50) NOT NULL DEFAULT 'production',
  
  -- Permissions and limits
  permissions JSONB NOT NULL DEFAULT '["read", "write"]',
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
  rate_limit_per_hour INTEGER NOT NULL DEFAULT 1000,
  rate_limit_per_day INTEGER NOT NULL DEFAULT 10000,
  
  -- Status and lifecycle
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMP WITH TIME ZONE,
  last_used_at TIMESTAMP WITH TIME ZONE,
  usage_count BIGINT NOT NULL DEFAULT 0,
  
  -- Audit fields
  created_by VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_environment CHECK (environment IN ('development', 'staging', 'production')),
  CONSTRAINT valid_rate_limits CHECK (
    rate_limit_per_minute > 0 AND 
    rate_limit_per_hour > 0 AND 
    rate_limit_per_day > 0
  )
);

-- Request logs table
CREATE TABLE request_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Request identification
  request_id VARCHAR(255) NOT NULL,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  
  -- Request details
  method VARCHAR(10) NOT NULL,
  path VARCHAR(500) NOT NULL,
  user_agent TEXT,
  ip_address INET,
  
  -- Response details
  status_code INTEGER NOT NULL,
  response_time_ms INTEGER NOT NULL,
  response_size_bytes BIGINT,
  
  -- Error information
  error_code VARCHAR(100),
  error_message TEXT,
  
  -- Timestamp
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_method CHECK (method IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS')),
  CONSTRAINT valid_status_code CHECK (status_code >= 100 AND status_code < 600),
  CONSTRAINT valid_response_time CHECK (response_time_ms >= 0)
);

-- Performance indexes
CREATE INDEX idx_documents_transaction_id ON documents(transaction_id);
CREATE INDEX idx_documents_user_id ON documents(user_id);
CREATE INDEX idx_documents_dispute_id ON documents(dispute_id) WHERE dispute_id IS NOT NULL;
CREATE INDEX idx_documents_processing_status ON documents(processing_status);
CREATE INDEX idx_documents_created_at ON documents(created_at DESC);
CREATE INDEX idx_documents_upload_timestamp ON documents(upload_timestamp DESC);

-- Compound indexes for common queries
CREATE INDEX idx_documents_user_status ON documents(user_id, processing_status);
CREATE INDEX idx_documents_transaction_status ON documents(transaction_id, processing_status);

-- Processing logs indexes
CREATE INDEX idx_processing_logs_document_id ON processing_logs(document_id);
CREATE INDEX idx_processing_logs_stage ON processing_logs(stage);
CREATE INDEX idx_processing_logs_status ON processing_logs(status);
CREATE INDEX idx_processing_logs_started_at ON processing_logs(started_at DESC);

-- API keys indexes
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_is_active ON api_keys(is_active) WHERE is_active = true;
CREATE INDEX idx_api_keys_environment ON api_keys(environment);

-- Request logs indexes
CREATE INDEX idx_request_logs_api_key_id ON request_logs(api_key_id);
CREATE INDEX idx_request_logs_created_at ON request_logs(created_at DESC);
CREATE INDEX idx_request_logs_status_code ON request_logs(status_code);
CREATE INDEX idx_request_logs_path ON request_logs(path);

-- JSONB indexes
CREATE INDEX idx_documents_extracted_data_gin ON documents USING GIN (extracted_data);
CREATE INDEX idx_documents_comparison_results_gin ON documents USING GIN (comparison_results);
CREATE INDEX idx_documents_authenticity_details_gin ON documents USING GIN (authenticity_details);

-- Text search index
CREATE INDEX idx_documents_file_name_trgm ON documents USING GIN (file_name gin_trgm_ops);

-- Partial indexes
CREATE INDEX idx_documents_failed ON documents(id) WHERE processing_status = 'failed';
CREATE INDEX idx_documents_processing ON documents(id) WHERE processing_status = 'processing';
CREATE INDEX idx_documents_completed_recent ON documents(completed_processing_at) 
  WHERE processing_status = 'completed' AND completed_processing_at > NOW() - INTERVAL '30 days';

-- Update timestamp trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers
CREATE TRIGGER update_documents_updated_at 
  BEFORE UPDATE ON documents 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_api_keys_updated_at 
  BEFORE UPDATE ON api_keys 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();