import { z } from 'zod';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MetabaseApiClient, CachedResponse } from '../api.js';
import { ErrorCode, McpError } from '../types.js';
import { handleApiError } from '../utils.js';

// Supported model types for the retrieve command
type SupportedModel = 'card' | 'dashboard' | 'table' | 'database' | 'collection' | 'field';

// Rate limiting and performance constants
const MAX_IDS_PER_REQUEST = 50; // Maximum IDs per request to prevent abuse and ensure reasonable response times
const CONCURRENCY_LIMITS = {
  SMALL_REQUEST_THRESHOLD: 3,    // ≤3 IDs: Full concurrency for minimal latency
  MEDIUM_REQUEST_THRESHOLD: 20,  // 4-20 IDs: Moderate batching for balanced performance
  MEDIUM_BATCH_SIZE: 8,          // Concurrent requests for medium batches
  LARGE_BATCH_SIZE: 5            // Conservative batching for large requests (21-50)
};

export async function handleRetrieve(
  request: z.infer<typeof CallToolRequestSchema>,
  requestId: string,
  apiClient: MetabaseApiClient,
  logDebug: (message: string, data?: unknown) => void,
  logInfo: (message: string, data?: unknown) => void,
  logWarn: (message: string, data?: unknown, error?: Error) => void,
  logError: (message: string, data?: unknown) => void
) {
  const { model, ids } = request.params?.arguments || {};

  // Validate required parameters
  if (!model) {
    logWarn('Missing model parameter in retrieve request', { requestId });
    throw new McpError(
      ErrorCode.InvalidParams,
      'Model parameter is required. Must be one of: card, dashboard, table, database, collection, field'
    );
  }

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    logWarn('Missing or invalid ids parameter in retrieve request', { requestId });
    throw new McpError(
      ErrorCode.InvalidParams,
      'IDs parameter is required and must be a non-empty array of numbers'
    );
  }

  // Validate maximum number of IDs to prevent abuse and ensure reasonable response times
  if (ids.length > MAX_IDS_PER_REQUEST) {
    logWarn(`Too many IDs requested: ${ids.length}. Maximum allowed: ${MAX_IDS_PER_REQUEST}`, { requestId });
    throw new McpError(
      ErrorCode.InvalidParams,
      `Too many IDs requested. Maximum allowed: ${MAX_IDS_PER_REQUEST} per request. For larger datasets, please make multiple requests.`
    );
  }

  // Validate model type
  const supportedModels: SupportedModel[] = ['card', 'dashboard', 'table', 'database', 'collection', 'field'];
  if (!supportedModels.includes(model as SupportedModel)) {
    logWarn(`Invalid model type: ${model}`, { requestId });
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid model type. Must be one of: ${supportedModels.join(', ')}`
    );
  }

  // Validate all IDs are numbers
  const numericIds: number[] = [];
  for (const id of ids) {
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
      logWarn(`Invalid ID: ${id}. All IDs must be positive integers`, { requestId });
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid ID: ${id}. All IDs must be positive integers`
      );
    }
    numericIds.push(id);
  }

  logDebug(`Retrieving ${model} details for IDs: ${numericIds.join(', ')}`);

  try {
    const startTime = Date.now();
    const results: any[] = [];
    const errors: Array<{ id: number; error: string }> = [];
    let apiHits = 0;
    let cacheHits = 0;

    // Intelligent concurrency control based on request size and server protection
    // - Small requests (≤3): Full concurrency for minimal latency
    // - Medium requests (4-20): Moderate batching for balanced performance
    // - Large requests (21-50): Conservative batching to prevent server overload
    const CONCURRENT_LIMIT = numericIds.length <= CONCURRENCY_LIMITS.SMALL_REQUEST_THRESHOLD ? numericIds.length :
                           numericIds.length <= CONCURRENCY_LIMITS.MEDIUM_REQUEST_THRESHOLD ? CONCURRENCY_LIMITS.MEDIUM_BATCH_SIZE :
                           CONCURRENCY_LIMITS.LARGE_BATCH_SIZE;

    logDebug(`Processing ${numericIds.length} ${model}(s) with concurrency limit: ${CONCURRENT_LIMIT}`);

    // Process requests concurrently with controlled concurrency to balance performance and server load
    const processId = async (id: number) => {
      try {
        let response: CachedResponse<any>;

        switch (model as SupportedModel) {
          case 'card':
            response = await apiClient.getCard(id);
            break;
          case 'dashboard':
            response = await apiClient.getDashboard(id);
            break;
          case 'table':
            response = await apiClient.getTable(id);
            break;
          case 'database':
            response = await apiClient.getDatabase(id);
            break;
          case 'collection':
            response = await apiClient.getCollection(id);
            break;
          case 'field':
            response = await apiClient.getField(id);
            break;
        }

        // Track cache vs API hits accurately
        if (response.source === 'cache') {
          cacheHits++;
        } else {
          apiHits++;
        }

        const result = {
          id,
          ...response.data,
          retrieved_at: new Date().toISOString()
        };

        logDebug(`Successfully retrieved ${model} ${id} from ${response.source}`);
        return { success: true, id, result };
      } catch (error: any) {
        const errorMessage = error?.message || error?.data?.message || 'Unknown error';
        logWarn(`Failed to retrieve ${model} ${id}: ${errorMessage}`, { requestId });
        return { success: false, id, error: errorMessage };
      }
    };

    // Process IDs in batches to control concurrency
    const processBatch = async (batch: number[]) => {
      return Promise.allSettled(batch.map(processId));
    };

    // Split IDs into batches and process them
    const batches: number[][] = [];
    for (let i = 0; i < numericIds.length; i += CONCURRENT_LIMIT) {
      batches.push(numericIds.slice(i, i + CONCURRENT_LIMIT));
    }

    // Process all batches sequentially, but items within each batch concurrently
    for (const batch of batches) {
      const batchResults = await processBatch(batch);

      batchResults.forEach((result) => {
        if (result.status === 'fulfilled') {
          const { success, id, result: itemResult, error } = result.value;
          if (success) {
            results.push(itemResult);
          } else {
            errors.push({ id, error });
          }
        } else {
          // This shouldn't happen with our current implementation, but handle it gracefully
          logWarn(`Unexpected batch processing error: ${result.reason}`, { requestId });
        }
      });
    }

    const totalTime = Date.now() - startTime;
    const successCount = results.length;
    const errorCount = errors.length;

    // Create detailed data source information
    const dataSource = {
      cache_hits: cacheHits,
      api_calls: apiHits,
      total_successful: successCount,
      primary_source: cacheHits > apiHits ? 'cache' : apiHits > cacheHits ? 'api' : 'mixed'
    };

    // Calculate performance metrics
    const averageTimePerItem = Math.round(totalTime / numericIds.length);
    const concurrencyUsed = Math.min(CONCURRENT_LIMIT, numericIds.length);
    const estimatedSequentialTime = averageTimePerItem * numericIds.length;
    const timesSaved = numericIds.length > 1 ? Math.round(((estimatedSequentialTime - totalTime) / estimatedSequentialTime) * 100) : 0;

    // Create response object
    const response: any = {
      model,
      request_id: requestId,
      total_requested: numericIds.length,
      successful_retrievals: successCount,
      failed_retrievals: errorCount,
      data_source: dataSource,
      performance_metrics: {
        total_time_ms: totalTime,
        average_time_per_item_ms: averageTimePerItem,
        concurrency_used: concurrencyUsed,
      },
      retrieved_at: new Date().toISOString(),
      results: results
    };

    // Add errors if any occurred
    if (errors.length > 0) {
      response.errors = errors;
      response.message = `Retrieved ${successCount}/${numericIds.length} ${model}s successfully. ${errorCount} failed.`;
    } else {
      response.message = `Successfully retrieved all ${successCount} ${model}(s).`;
    }

    // Add performance info based on data source
    if (dataSource.primary_source === 'cache') {
      response.performance_note = `Data retrieved primarily from cache (${cacheHits} cache hits, ${apiHits} API calls)${timesSaved > 0 ? ` with ${timesSaved}% time savings from concurrent processing` : ''}`;
    } else if (dataSource.primary_source === 'api') {
      response.performance_note = `Data retrieved primarily via API calls (${apiHits} API calls, ${cacheHits} cache hits)${timesSaved > 0 ? ` with ${timesSaved}% time savings from concurrent processing` : ''} - now cached for future requests`;
    } else {
      response.performance_note = `Data retrieved from mixed sources (${cacheHits} cache hits, ${apiHits} API calls)${timesSaved > 0 ? ` with ${timesSaved}% time savings from concurrent processing` : ''}`;
    }

    // Add usage guidance based on model type
    switch (model as SupportedModel) {
      case 'card':
        response.usage_guidance = 'Use the database_id and dataset_query.native.query with execute_query to run queries. You can modify the SQL as needed.';
        break;
      case 'dashboard':
        response.usage_guidance = 'Dashboard data includes full metadata, layout, and all cards/questions within the dashboard. Use retrieve with model="card" to get SQL for specific cards found in the dashboard.';
        break;
      case 'table':
        response.usage_guidance = 'Table metadata includes column information, data types, and relationships. Use this data to construct queries against the table.';
        break;
      case 'database':
        response.usage_guidance = 'Database details include connection info and available tables. Use retrieve with model="table" to get detailed table metadata.';
        break;
      case 'collection':
        response.usage_guidance = 'Collection details include organizational structure and metadata for managing questions, dashboards, models, and other Metabase content. Collections work like folders to organize your Metabase items.';
        break;
      case 'field':
        response.usage_guidance = 'Field metadata includes data type, constraints, and relationships. Use this information when constructing queries or understanding table structure.';
        break;
    }

    const logMessage = errorCount > 0
      ? `Retrieved ${successCount}/${numericIds.length} ${model}s (${errorCount} errors, source: ${dataSource.primary_source})`
      : `Successfully retrieved ${successCount} ${model}s (source: ${dataSource.primary_source})`;

    logInfo(logMessage);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };

  } catch (error: any) {
    throw handleApiError(error, {
      operation: `Retrieve ${model} details`,
      resourceType: model as string,
      resourceId: numericIds.join(', '),
      customMessages: {
        '400': `Invalid ${model} parameters. Ensure all IDs are valid numbers.`,
        '404': `One or more ${model}s not found. Check that the IDs are correct and the ${model}s exist.`,
        '500': `Metabase server error while retrieving ${model}s. The server may be experiencing issues.`
      }
    }, logError);
  }
}
