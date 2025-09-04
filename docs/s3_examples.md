# Cloudflare R2 Storage Examples

## API Usage Examples for Document Storage

### 1. Generate Signed Upload URL

```bash
# Request signed upload URL
curl -X POST http://localhost:8000/api/v1/upload-url \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "user_id": "user123",
    "file_name": "payment_receipt.pdf",
    "content_type": "application/pdf",
    "transaction_id": "txn_456",
    "dispute_id": "disp_789"
  }'
```

**Response:**

```json
{
  "status": "success",
  "data": {
    "upload_url": "https://account.r2.cloudflarestorage.com/bucket/documents/2025/09/04/user123/txn_456/uuid.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&...",
    "document_key": "documents/2025/09/04/user123/txn_456/uuid.pdf",
    "expires_at": "2025-09-04T11:45:00Z",
    "expires_in_seconds": 900
  },
  "meta": {
    "request_id": "req-uuid",
    "timestamp": "2025-09-04T11:30:00Z",
    "version": "v1"
  }
}
```

### 2. Upload Document to Signed URL

```bash
# Upload file using the signed URL from previous step
curl -X PUT "{upload_url_from_response}" \
  -H "Content-Type: application/pdf" \
  --data-binary @payment_receipt.pdf
```

### 3. Check Storage Health

```bash
# Check storage system health
curl http://localhost:8000/health
```

**Response:**

```json
{
  "status": "healthy",
  "service": "document-verification-api",
  "version": "1.0.0",
  "timestamp": "2025-09-04T11:30:00Z",
  "environment": "development",
  "database": {
    "status": "healthy",
    "latency": "45ms",
    "connections": {
      "total": 10,
      "active": 2,
      "idle": 8
    }
  },
  "storage": {
    "status": "healthy",
    "service": "cloudflare-r2",
    "bucket": "document-verification-secure",
    "latency": "123ms"
  }
}
```

## Configuration

### Environment Variables for R2

```bash
# Cloudflare R2 Configuration
S3_ACCESS_KEY_ID="your_r2_access_key"
S3_SECRET_ACCESS_KEY="your_r2_secret_key"
S3_BUCKET="document-verification-secure"
S3_ENDPOINT="https://your-account.r2.cloudflarestorage.com"
S3_REGION="auto"
```

### Supported File Types

- **PNG Images**: `image/png` (max 10MB)
- **JPEG Images**: `image/jpeg` (max 10MB)
- **PDF Documents**: `application/pdf` (max 10MB)

### Storage Key Structure

Documents are stored with hierarchical keys:

```
documents/YYYY/MM/DD/user_id/transaction_id/document_uuid.ext
```

**Example:**

```
documents/2025/09/04/user123/txn_456/a1b2c3d4-e5f6-7890-abcd-ef1234567890.pdf
```

### Security Features

- **File validation**: MIME type and signature verification
- **Size limits**: Maximum 10MB per file
- **Signed URLs**: Temporary access with expiration
- **Metadata storage**: Original filename, user info, timestamps
- **Encryption**: Server-side encryption with R2's default KMS

### Error Handling

The storage service provides detailed error information:

```json
{
  "status": "error",
  "error": {
    "code": "FILE_TOO_LARGE",
    "message": "File size 15728640 bytes exceeds maximum 10485760 bytes"
  },
  "meta": {
    "request_id": "req-uuid",
    "timestamp": "2025-09-04T11:30:00Z",
    "version": "v1"
  }
}
```

### Common Error Codes

- `INVALID_FILE_TYPE` - Unsupported MIME type
- `FILE_TOO_LARGE` - File exceeds 10MB limit
- `FILE_EMPTY` - Empty file uploaded
- `INVALID_SIGNATURE` - File content doesn't match MIME type
- `UPLOAD_URL_GENERATION_FAILED` - S3 service unavailable
- `DOCUMENT_NOT_FOUND` - Requested document doesn't exist
