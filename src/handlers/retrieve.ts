import { z } from 'zod';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MetabaseApiClient } from '../api.js';
import { ErrorCode, McpError } from '../types.js';
import { handleApiError } from '../utils.js';

// Supported model types for the retrieve command
type SupportedModel = 'card' | 'dashboard' | 'table' | 'database';

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
      'Model parameter is required. Must be one of: card, dashboard, table, database'
    );
  }

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    logWarn('Missing or invalid ids parameter in retrieve request', { requestId });
    throw new McpError(
      ErrorCode.InvalidParams,
      'IDs parameter is required and must be a non-empty array of numbers'
    );
  }

  // Validate model type
  const supportedModels: SupportedModel[] = ['card', 'dashboard', 'table', 'database'];
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

    // Fetch each item individually (Metabase doesn't support bulk retrieval for these endpoints)
    for (const id of numericIds) {
      try {
        let item: any;

        switch (model as SupportedModel) {
          case 'card':
            item = await apiClient.getCard(id);
            break;
          case 'dashboard':
            item = await apiClient.getDashboardItems(id);
            break;
          case 'table':
            item = await apiClient.getTable(id);
            break;
          case 'database':
            item = await apiClient.getDatabase(id);
            break;
        }

        results.push({
          id,
          ...item,
          retrieved_at: new Date().toISOString()
        });

        logDebug(`Successfully retrieved ${model} ${id}`);
      } catch (error: any) {
        const errorMessage = error?.message || error?.data?.message || 'Unknown error';
        errors.push({ id, error: errorMessage });
        logWarn(`Failed to retrieve ${model} ${id}: ${errorMessage}`, { requestId });
      }
    }

    const totalTime = Date.now() - startTime;
    const successCount = results.length;
    const errorCount = errors.length;

    // Determine data source based on fetch time (approximate)
    const avgFetchTime = totalTime / numericIds.length;
    const dataSource = avgFetchTime < 10 ? 'cache' : 'api';

    // Create response object
    const response: any = {
      model,
      request_id: requestId,
      total_requested: numericIds.length,
      successful_retrievals: successCount,
      failed_retrievals: errorCount,
      data_source: dataSource,
      total_fetch_time_ms: totalTime,
      average_fetch_time_ms: Math.round(avgFetchTime),
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

    // Add performance info
    if (dataSource === 'cache') {
      response.performance_note = 'Data retrieved primarily from cache (optimal efficiency)';
    } else {
      response.performance_note = 'Data retrieved via API calls (now cached for future requests)';
    }

    // Add usage guidance based on model type
    switch (model as SupportedModel) {
      case 'card':
        response.usage_guidance = 'Use the database_id and dataset_query.native.query with execute_query to run queries. You can modify the SQL as needed.';
        break;
      case 'dashboard':
        response.usage_guidance = 'Dashboard items contain the individual cards/questions within the dashboard. Use get_card_sql to retrieve SQL for specific cards.';
        break;
      case 'table':
        response.usage_guidance = 'Table metadata includes column information, data types, and relationships. Use this data to construct queries against the table.';
        break;
      case 'database':
        response.usage_guidance = 'Database details include connection info and available tables. Use table IDs with the retrieve command to get detailed table metadata.';
        break;
    }

    const logMessage = errorCount > 0
      ? `Retrieved ${successCount}/${numericIds.length} ${model}s (${errorCount} errors, source: ${dataSource}, ${totalTime}ms)`
      : `Successfully retrieved ${successCount} ${model}s (source: ${dataSource}, ${totalTime}ms)`;

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
