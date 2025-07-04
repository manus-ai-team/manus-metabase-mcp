import { z } from 'zod';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MetabaseApiClient } from '../api.js';
import { ErrorCode, McpError } from '../types/core.js';
import { handleApiError } from '../utils.js';

export function handleClearCache(
  request: z.infer<typeof CallToolRequestSchema>,
  apiClient: MetabaseApiClient,
  logInfo: (message: string, data?: unknown) => void,
  logWarn: (message: string, data?: unknown, error?: Error) => void,
  logError: (message: string, error: unknown) => void
) {
  const cacheType = (request.params?.arguments?.cache_type as string) || 'all';

  // Validate cache_type parameter
  const validCacheTypes = [
    'all',
    'cards',
    'dashboards',
    'tables',
    'databases',
    'collections',
    'fields',
  ];
  if (!validCacheTypes.includes(cacheType)) {
    logWarn(`Invalid cache_type parameter: ${cacheType}`, { validTypes: validCacheTypes });
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid cache_type: ${cacheType}. Valid types are: ${validCacheTypes.join(', ')}`
    );
  }

  try {
    let message = '';
    let cacheStatus = '';

    switch (cacheType) {
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

      case 'collections':
        apiClient.clearCollectionsCache();
        message = 'Collections cache cleared successfully';
        cacheStatus = 'collections_cache_empty';
        break;

      case 'fields':
        apiClient.clearFieldsCache();
        message = 'Fields cache cleared successfully';
        cacheStatus = 'fields_cache_empty';
        break;

      case 'all':
      default:
        apiClient.clearAllCache();
        message =
          'All caches cleared successfully (individual items and lists for cards, dashboards, tables, databases, collections, and fields)';
        cacheStatus = 'all_caches_empty';
        break;
    }

    logInfo(message);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              message,
              cache_type: cacheType,
              cache_status: cacheStatus,
              next_fetch_will_be: 'fresh from API',
              cache_info: {
                cache_explanation:
                  'Unified cache serves both individual card requests and bulk operations efficiently',
              },
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error: any) {
    throw handleApiError(
      error,
      {
        operation: 'Clear cache',
        customMessages: {
          // No specific HTTP status codes expected for cache operations
          // The generic error handling will handle TypeError and other internal errors
        },
      },
      logError
    );
  }
}
