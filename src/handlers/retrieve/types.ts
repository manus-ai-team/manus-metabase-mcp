// Supported model types for the retrieve command
export type SupportedModel = 'card' | 'dashboard' | 'table' | 'database' | 'collection' | 'field';

// Rate limiting and performance constants
export const MAX_IDS_PER_REQUEST = 50; // Maximum IDs per request to prevent abuse and ensure reasonable response times

// Database-specific limits (databases can have massive metadata)
export const MAX_DATABASE_IDS_PER_REQUEST = 2; // Maximum database IDs per request due to large table/field metadata

export const CONCURRENCY_LIMITS = {
  SMALL_REQUEST_THRESHOLD: 3, // ≤3 IDs: Full concurrency for minimal latency
  MEDIUM_REQUEST_THRESHOLD: 20, // 4-20 IDs: Moderate batching for balanced performance
  MEDIUM_BATCH_SIZE: 8, // Concurrent requests for medium batches
  LARGE_BATCH_SIZE: 5, // Conservative batching for large requests (21-50)
};

// Optimization thresholds for token usage management
export const OPTIMIZATION_THRESHOLDS = {
  AGGRESSIVE_OPTIMIZATION_THRESHOLD: 10, // ≥10 IDs: Enable aggressive optimization to prevent >25k token responses
  ULTRA_MINIMAL_THRESHOLD: 25, // ≥25 IDs: Ultra-minimal response for very large datasets
};

// Flag to enable saving raw response structures for documentation
export const SAVE_RAW_STRUCTURES = false; // Set to true when you want to capture raw structures
