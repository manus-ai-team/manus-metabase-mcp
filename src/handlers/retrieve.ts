import { z } from 'zod';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MetabaseApiClient, CachedResponse } from '../api.js';
import { ErrorCode, McpError } from '../types/core.js';
import { handleApiError, saveRawStructure } from '../utils.js';
import { OptimizedCard, OptimizedDashboard, OptimizedTable, OptimizedDatabase, OptimizedCollection, OptimizedField } from '../types/optimized.js';

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

// Flag to enable saving raw response structures for documentation
const SAVE_RAW_STRUCTURES = false; // Set to true when you want to capture raw structures



/**
 * Optimize card response by removing unnecessary fields that consume tokens
 * but aren't used by other handlers (execute_query, export_query, etc.)
 */
function optimizeCardResponse(card: any): OptimizedCard {
  const optimized: OptimizedCard = {
    id: card.id,
    name: card.name,
    database_id: card.database_id,
    retrieved_at: new Date().toISOString()
  };

  // Add optional fields only if they exist and have meaningful values
  if (card.description) {
    optimized.description = card.description;
  }

  // Essential for execute_query and export_query
  if (card.dataset_query) {
    optimized.dataset_query = {
      type: card.dataset_query.type,
      database: card.dataset_query.database,
      native: card.dataset_query.native ? {
        query: card.dataset_query.native.query,
        template_tags: card.dataset_query.native.template_tags
      } : undefined
    };
  }

  if (card.collection_id !== null && card.collection_id !== undefined) {
    optimized.collection_id = card.collection_id;
  }

  if (card.query_type) {
    optimized.query_type = card.query_type;
  }

  if (card.archived !== undefined) {
    optimized.archived = card.archived;
  }

  if (card.can_write !== undefined) {
    optimized.can_write = card.can_write;
  }

  if (card.created_at) {
    optimized.created_at = card.created_at;
  }

  if (card.updated_at) {
    optimized.updated_at = card.updated_at;
  }

  // Minimal creator info
  if (card.creator) {
    optimized.creator = {
      id: card.creator.id,
      email: card.creator.email,
      first_name: card.creator.first_name,
      last_name: card.creator.last_name
    };
  }

  // Minimal collection info
  if (card.collection) {
    optimized.collection = {
      id: card.collection.id,
      name: card.collection.name,
      location: card.collection.location
    };
  }

  // Essential parameters for query execution
  if (card.parameters && Array.isArray(card.parameters) && card.parameters.length > 0) {
    optimized.parameters = card.parameters.map((param: any) => ({
      id: param.id,
      name: param.name,
      type: param.type,
      slug: param.slug,
      target: param.target
    }));
  }

  // Analytics data for future use
  if (card.view_count !== undefined) {
    optimized.view_count = card.view_count;
  }

  if (card.query_average_duration !== undefined) {
    optimized.query_average_duration = card.query_average_duration;
  }

  return optimized;
}

/**
 * Optimize dashboard response by removing unnecessary fields that consume tokens
 * but aren't used by other handlers. Focuses on layout, cards, and parameters.
 */
function optimizeDashboardResponse(dashboard: any): OptimizedDashboard {
  const optimized: OptimizedDashboard = {
    id: dashboard.id,
    name: dashboard.name,
    retrieved_at: new Date().toISOString()
  };

  // Add optional fields only if they exist and have meaningful values
  if (dashboard.description) {
    optimized.description = dashboard.description;
  }

  if (dashboard.collection_id !== null && dashboard.collection_id !== undefined) {
    optimized.collection_id = dashboard.collection_id;
  }

  if (dashboard.archived !== undefined) {
    optimized.archived = dashboard.archived;
  }

  if (dashboard.can_write !== undefined) {
    optimized.can_write = dashboard.can_write;
  }

  if (dashboard.created_at) {
    optimized.created_at = dashboard.created_at;
  }

  if (dashboard.updated_at) {
    optimized.updated_at = dashboard.updated_at;
  }

  // Essential dashboard cards with optimized card data
  if (dashboard.dashcards && Array.isArray(dashboard.dashcards) && dashboard.dashcards.length > 0) {
    optimized.dashcards = dashboard.dashcards.map((dashcard: any) => {
      const optimizedDashcard: any = {
        id: dashcard.id,
        card_id: dashcard.card_id,
        dashboard_id: dashcard.dashboard_id,
        row: dashcard.row,
        col: dashcard.col,
        size_x: dashcard.size_x,
        size_y: dashcard.size_y
      };

      // Essential parameter mappings for dashboard filtering
      if (dashcard.parameter_mappings && Array.isArray(dashcard.parameter_mappings) && dashcard.parameter_mappings.length > 0) {
        optimizedDashcard.parameter_mappings = dashcard.parameter_mappings.map((mapping: any) => ({
          parameter_id: mapping.parameter_id,
          card_id: mapping.card_id,
          target: mapping.target
        }));
      }

      // Essential visualization settings
      if (dashcard.visualization_settings && Object.keys(dashcard.visualization_settings).length > 0) {
        optimizedDashcard.visualization_settings = dashcard.visualization_settings;
      }

      // Optimized card data (removing huge result_metadata)
      if (dashcard.card) {
        optimizedDashcard.card = {
          id: dashcard.card.id,
          name: dashcard.card.name,
          database_id: dashcard.card.database_id
        };

        // Add optional card fields only if they exist
        if (dashcard.card.description) {
          optimizedDashcard.card.description = dashcard.card.description;
        }

        if (dashcard.card.query_type) {
          optimizedDashcard.card.query_type = dashcard.card.query_type;
        }

        if (dashcard.card.display) {
          optimizedDashcard.card.display = dashcard.card.display;
        }

        // Essential for execute_query operations
        if (dashcard.card.dataset_query) {
          optimizedDashcard.card.dataset_query = {
            type: dashcard.card.dataset_query.type,
            database: dashcard.card.dataset_query.database,
            native: dashcard.card.dataset_query.native ? {
              query: dashcard.card.dataset_query.native.query,
              template_tags: dashcard.card.dataset_query.native.template_tags
            } : undefined
          };
        }

        // Essential parameters for query execution
        if (dashcard.card.parameters && Array.isArray(dashcard.card.parameters) && dashcard.card.parameters.length > 0) {
          optimizedDashcard.card.parameters = dashcard.card.parameters.map((param: any) => ({
            id: param.id,
            name: param.name,
            type: param.type,
            slug: param.slug,
            target: param.target
          }));
        }
      }

      return optimizedDashcard;
    });
  }

  // Essential dashboard-level parameters
  if (dashboard.parameters && Array.isArray(dashboard.parameters) && dashboard.parameters.length > 0) {
    optimized.parameters = dashboard.parameters.map((param: any) => ({
      id: param.id,
      name: param.name,
      type: param.type,
      slug: param.slug,
      sectionId: param.sectionId
    }));
  }

  // Dashboard tabs (if any)
  if (dashboard.tabs && Array.isArray(dashboard.tabs) && dashboard.tabs.length > 0) {
    optimized.tabs = dashboard.tabs;
  }

  // Layout settings
  if (dashboard.width) {
    optimized.width = dashboard.width;
  }

  if (dashboard.auto_apply_filters !== undefined) {
    optimized.auto_apply_filters = dashboard.auto_apply_filters;
  }

  // Minimal creator info
  if (dashboard.creator || dashboard['last-edit-info']) {
    const creator = dashboard.creator || dashboard['last-edit-info'];
    optimized.creator = {
      id: creator.id,
      email: creator.email,
      first_name: creator.first_name,
      last_name: creator.last_name
    };
  }

  // Minimal collection info
  if (dashboard.collection) {
    optimized.collection = {
      id: dashboard.collection.id,
      name: dashboard.collection.name,
      location: dashboard.collection.location
    };
  }

  return optimized;
}

/**
 * Optimize table response by removing unnecessary fields that consume tokens
 * but aren't used by other handlers. Focuses on essential schema information.
 */
function optimizeTableResponse(table: any): OptimizedTable {
  const optimized: OptimizedTable = {
    id: table.id,
    name: table.name,
    db_id: table.db_id,
    display_name: table.display_name,
    entity_type: table.entity_type,
    active: table.active,
    created_at: table.created_at,
    updated_at: table.updated_at,
    field_order: table.field_order,
    is_upload: table.is_upload,
    initial_sync_status: table.initial_sync_status,
    retrieved_at: new Date().toISOString()
  };

  // Add optional fields only if they exist and have meaningful values
  if (table.description) {
    optimized.description = table.description;
  }

  if (table.schema) {
    optimized.schema = table.schema;
  }

  if (table.view_count !== undefined) {
    optimized.view_count = table.view_count;
  }

  if (table.estimated_row_count !== undefined) {
    optimized.estimated_row_count = table.estimated_row_count;
  }

  // Essential database information (simplified)
  if (table.db) {
    optimized.db = {
      id: table.db.id,
      name: table.db.name,
      engine: table.db.engine
    };

    // Add optional db fields
    if (table.db.description) {
      optimized.db.description = table.db.description;
    }

    if (table.db.timezone) {
      optimized.db.timezone = table.db.timezone;
    }

    if (table.db.dbms_version) {
      optimized.db.dbms_version = table.db.dbms_version;
    }

    if (table.db.is_sample !== undefined) {
      optimized.db.is_sample = table.db.is_sample;
    }

    if (table.db.is_on_demand !== undefined) {
      optimized.db.is_on_demand = table.db.is_on_demand;
    }

    if (table.db.uploads_enabled !== undefined) {
      optimized.db.uploads_enabled = table.db.uploads_enabled;
    }

    if (table.db.auto_run_queries !== undefined) {
      optimized.db.auto_run_queries = table.db.auto_run_queries;
    }
  }

  // Essential field information (without heavy fingerprint data)
  if (table.fields && Array.isArray(table.fields) && table.fields.length > 0) {
    optimized.fields = table.fields.map((field: any) => ({
      id: field.id,
      name: field.name,
      display_name: field.display_name,
      description: field.description || undefined,
      database_type: field.database_type,
      base_type: field.base_type,
      effective_type: field.effective_type,
      semantic_type: field.semantic_type || undefined,
      table_id: field.table_id,
      position: field.position,
      database_position: field.database_position,
      active: field.active,
      database_indexed: field.database_indexed,
      database_required: field.database_required,
      has_field_values: field.has_field_values,
      visibility_type: field.visibility_type,
      preview_display: field.preview_display,
      fk_target_field_id: field.fk_target_field_id || undefined,
      created_at: field.created_at,
      updated_at: field.updated_at
    }));
  }

  return optimized;
}

/**
 * Optimize database response by removing unnecessary fields that consume tokens
 * but aren't used by other handlers. Focuses on essential connection and table info.
 */
function optimizeDatabaseResponse(database: any): OptimizedDatabase {
  const optimized: OptimizedDatabase = {
    id: database.id,
    name: database.name,
    engine: database.engine,
    retrieved_at: new Date().toISOString()
  };

  // Add optional fields only if they exist and have meaningful values
  if (database.description) {
    optimized.description = database.description;
  }

  if (database.timezone) {
    optimized.timezone = database.timezone;
  }

  if (database.auto_run_queries !== undefined) {
    optimized.auto_run_queries = database.auto_run_queries;
  }

  if (database.is_sample !== undefined) {
    optimized.is_sample = database.is_sample;
  }

  if (database.is_on_demand !== undefined) {
    optimized.is_on_demand = database.is_on_demand;
  }

  if (database.uploads_enabled !== undefined) {
    optimized.uploads_enabled = database.uploads_enabled;
  }

  if (database.dbms_version) {
    optimized.dbms_version = {
      flavor: database.dbms_version.flavor,
      version: database.dbms_version.version,
      'semantic-version': database.dbms_version['semantic-version']
    };
  }

  if (database.initial_sync_status) {
    optimized.initial_sync_status = database.initial_sync_status;
  }

  if (database.created_at) {
    optimized.created_at = database.created_at;
  }

  if (database.updated_at) {
    optimized.updated_at = database.updated_at;
  }

  // Essential table information (simplified)
  if (database.tables && Array.isArray(database.tables) && database.tables.length > 0) {
    optimized.tables = database.tables.map((table: any) => ({
      id: table.id,
      name: table.name,
      display_name: table.display_name,
      description: table.description || undefined,
      schema: table.schema || undefined,
      view_count: table.view_count || undefined,
      entity_type: table.entity_type || undefined,
      active: table.active,
      db_id: table.db_id,
      field_order: table.field_order,
      is_upload: table.is_upload,
      initial_sync_status: table.initial_sync_status,
      created_at: table.created_at,
      updated_at: table.updated_at,
      estimated_row_count: table.estimated_row_count || undefined
    }));
  }

  return optimized;
}

/**
 * Optimize collection response by removing unnecessary fields that consume tokens
 * but aren't used by other handlers. Collections are relatively small already.
 */
function optimizeCollectionResponse(collection: any): OptimizedCollection {
  const optimized: OptimizedCollection = {
    id: collection.id,
    name: collection.name,
    archived: collection.archived,
    slug: collection.slug,
    can_write: collection.can_write,
    can_restore: collection.can_restore,
    is_sample: collection.is_sample,
    effective_location: collection.effective_location,
    location: collection.location,
    is_personal: collection.is_personal,
    created_at: collection.created_at,
    can_delete: collection.can_delete,
    retrieved_at: new Date().toISOString()
  };

  // Add optional fields only if they exist and have meaningful values
  if (collection.description) {
    optimized.description = collection.description;
  }

  if (collection.authority_level) {
    optimized.authority_level = collection.authority_level;
  }

  if (collection.personal_owner_id !== null && collection.personal_owner_id !== undefined) {
    optimized.personal_owner_id = collection.personal_owner_id;
  }

  if (collection.type) {
    optimized.type = collection.type;
  }

  if (collection.parent_id !== null && collection.parent_id !== undefined) {
    optimized.parent_id = collection.parent_id;
  }

  if (collection.namespace) {
    optimized.namespace = collection.namespace;
  }

  // Essential hierarchy information
  if (collection.effective_ancestors && Array.isArray(collection.effective_ancestors) && collection.effective_ancestors.length > 0) {
    optimized.effective_ancestors = collection.effective_ancestors.map((ancestor: any) => ({
      'metabase.collections.models.collection.root/is-root?': ancestor['metabase.collections.models.collection.root/is-root?'],
      authority_level: ancestor.authority_level,
      name: ancestor.name,
      is_personal: ancestor.is_personal,
      id: ancestor.id,
      can_write: ancestor.can_write
    }));
  }

  return optimized;
}

/**
 * Optimize field response by removing unnecessary fields that consume tokens
 * but aren't used by other handlers. Focuses on schema information and relationships.
 */
function optimizeFieldResponse(field: any): OptimizedField {
  const optimized: OptimizedField = {
    id: field.id,
    name: field.name,
    display_name: field.display_name,
    database_type: field.database_type,
    base_type: field.base_type,
    effective_type: field.effective_type,
    table_id: field.table_id,
    position: field.position,
    database_position: field.database_position,
    active: field.active,
    database_indexed: field.database_indexed,
    database_required: field.database_required,
    has_field_values: field.has_field_values,
    visibility_type: field.visibility_type,
    preview_display: field.preview_display,
    created_at: field.created_at,
    updated_at: field.updated_at,
    table: {
      id: field.table.id,
      name: field.table.name,
      display_name: field.table.display_name,
      db_id: field.table.db_id
    },
    retrieved_at: new Date().toISOString()
  };

  // Add optional fields only if they exist and have meaningful values
  if (field.description) {
    optimized.description = field.description;
  }

  if (field.semantic_type) {
    optimized.semantic_type = field.semantic_type;
  }

  if (field.fk_target_field_id !== null && field.fk_target_field_id !== undefined) {
    optimized.fk_target_field_id = field.fk_target_field_id;
  }

  // Essential fingerprint data (simplified)
  if (field.fingerprint && field.fingerprint.global) {
    optimized.fingerprint = {
      global: {
        'distinct-count': field.fingerprint.global['distinct-count'],
        'nil%': field.fingerprint.global['nil%']
      }
    };
  }

  // Add optional table fields
  if (field.table.schema) {
    optimized.table.schema = field.table.schema;
  }

  if (field.table.entity_type) {
    optimized.table.entity_type = field.table.entity_type;
  }

  if (field.table.view_count !== undefined) {
    optimized.table.view_count = field.table.view_count;
  }

  // Essential target field information (for foreign keys)
  if (field.target) {
    optimized.target = {
      id: field.target.id,
      name: field.target.name,
      display_name: field.target.display_name,
      table_id: field.target.table_id,
      database_type: field.target.database_type,
      base_type: field.target.base_type,
      effective_type: field.target.effective_type
    };

    if (field.target.semantic_type) {
      optimized.target.semantic_type = field.target.semantic_type;
    }
  }

  return optimized;
}

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

                // Save raw structure for documentation if enabled
        saveRawStructure(model as SupportedModel, response.data, SAVE_RAW_STRUCTURES);

                let result: any;

        // Optimize responses to reduce token usage
        if (model === 'card') {
          result = optimizeCardResponse({
            id,
            ...response.data
          });
        } else if (model === 'dashboard') {
          result = optimizeDashboardResponse({
            id,
            ...response.data
          });
        } else if (model === 'table') {
          result = optimizeTableResponse({
            id,
            ...response.data
          });
        } else if (model === 'database') {
          result = optimizeDatabaseResponse({
            id,
            ...response.data
          });
        } else if (model === 'collection') {
          result = optimizeCollectionResponse({
            id,
            ...response.data
          });
        } else if (model === 'field') {
          result = optimizeFieldResponse({
            id,
            ...response.data
          });
        } else {
          result = {
            id,
            ...response.data,
            retrieved_at: new Date().toISOString()
          };
        }

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
        response.usage_guidance = 'Use the database_id and dataset_query.native.query with execute_query to run queries. You can modify the SQL as needed. Response is optimized to include only essential fields for better performance.';
        break;
      case 'dashboard':
        response.usage_guidance = 'Dashboard data includes optimized layout, cards, and parameters. Use get_card_sql or execute_query with card database_id and dataset_query.native.query from dashcards[].card to run queries. Response is optimized to exclude heavy metadata for better performance.';
        break;
      case 'table':
        response.usage_guidance = 'Table metadata includes optimized column information, data types, and relationships. Use fields[] array to understand table schema and construct queries. Response excludes heavy fingerprint statistics for better performance.';
        break;
      case 'database':
        response.usage_guidance = 'Database details include optimized connection info and available tables. Use tables[] array to see all tables, then retrieve with model="table" for detailed table metadata. Response excludes features array for better performance.';
        break;
      case 'collection':
        response.usage_guidance = 'Collection details include organizational structure and metadata for managing questions, dashboards, models, and other Metabase content. Collections work like folders to organize your Metabase items. Response is lightly optimized to remove archive metadata.';
        break;
      case 'field':
        response.usage_guidance = 'Field metadata includes data type, constraints, and relationships. Use this information when constructing queries or understanding table structure. Response is heavily optimized to exclude nested database features and detailed fingerprint data for better performance.';
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
