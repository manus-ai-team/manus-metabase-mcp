import { z } from 'zod';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MetabaseApiClient } from '../api.js';
import { ErrorCode, McpError } from '../types.js';
import { handleApiError } from '../utils.js';

export function handleClearCache(
  request: z.infer<typeof CallToolRequestSchema>,
  apiClient: MetabaseApiClient,
  logInfo: (message: string, data?: unknown) => void,
  logWarn: (message: string, data?: unknown, error?: Error) => void,
  logError: (message: string, error: unknown) => void
) {
  const cacheType = (request.params?.arguments?.cache_type as string) || 'all';
  const cardId = request.params?.arguments?.card_id as number;

  // Validate cache_type parameter
  const validCacheTypes = ['all', 'cards', 'dashboards', 'tables', 'databases', 'individual', 'bulk'];
  if (!validCacheTypes.includes(cacheType)) {
    logWarn(`Invalid cache_type parameter: ${cacheType}`, { validTypes: validCacheTypes });
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid cache_type: ${cacheType}. Valid types are: ${validCacheTypes.join(', ')}`
    );
  }

  // Validate card_id parameter when using individual cache type
  if (cacheType === 'individual' && cardId && (typeof cardId !== 'number' || cardId <= 0)) {
    logWarn(`Invalid card_id parameter for individual cache clear: ${cardId}`);
    throw new McpError(
      ErrorCode.InvalidParams,
      'card_id must be a positive integer when using individual cache type'
    );
  }

  try {
    let message = '';
    let cacheStatus = '';

    switch (cacheType) {
    case 'individual':
      if (cardId) {
        // Clear individual card from API client cache
        apiClient.clearIndividualCardCache(cardId);
        message = `Individual card cache cleared for card ${cardId}`;
        cacheStatus = `card_${cardId}_cache_empty`;
      } else {
        // Clear all individual cards from API client cache
        apiClient.clearAllIndividualCardsCache();
        message = 'All individual card caches cleared';
        cacheStatus = 'individual_cache_empty';
      }
      break;

    case 'cards':
      apiClient.clearCardsCache();
      message = 'Cards cache cleared successfully';
      cacheStatus = 'cards_cache_empty';
      break;

    case 'dashboards':
      apiClient.clearDashboardsCache();
      message = 'Dashboards cache cleared successfully';
      cacheStatus = 'dashboards_cache_empty';
      break;

    case 'tables':
      apiClient.clearTablesCache();
      message = 'Tables cache cleared successfully';
      cacheStatus = 'tables_cache_empty';
      break;

    case 'databases':
      apiClient.clearDatabasesCache();
      message = 'Databases cache cleared successfully';
      cacheStatus = 'databases_cache_empty';
      break;

    case 'bulk':
      apiClient.clearCardsCache();
      message = 'Cards cache cleared (bulk metadata reset)';
      cacheStatus = 'cards_cache_empty';
      break;

    case 'all':
    default:
      apiClient.clearAllCache();
      message = 'All caches cleared successfully (cards, dashboards, tables, and databases)';
      cacheStatus = 'all_caches_empty';
      break;
    }

    logInfo(message);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          message,
          cache_type: cacheType,
          card_id: cardId || null,
          cache_status: cacheStatus,
          next_fetch_will_be: 'fresh from API',
          cache_info: {
            cache_explanation: 'Unified cache serves both individual card requests and bulk operations efficiently'
          }
        }, null, 2)
      }]
    };
  } catch (error: any) {
    throw handleApiError(error, {
      operation: 'Clear cache',
      customMessages: {
        // No specific HTTP status codes expected for cache operations
        // The generic error handling will handle TypeError and other internal errors
      }
    }, logError);
  }
}
