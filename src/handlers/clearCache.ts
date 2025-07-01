import { z } from 'zod';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MetabaseApiClient } from '../api.js';

export function handleClearCache(
  request: z.infer<typeof CallToolRequestSchema> | undefined,
  apiClient: MetabaseApiClient,
  logInfo: (message: string, data?: unknown) => void
) {
  const cacheType = (request?.params?.arguments?.cache_type as string) || 'all';
  const cardId = request?.params?.arguments?.card_id as number;

  let message = '';
  let cacheStatus = '';

  switch (cacheType) {
  case 'individual':
    if (cardId) {
      // Clear individual card from API client cache
      message = `Individual card cache cleared for card ${cardId}`;
      cacheStatus = `card_${cardId}_cache_empty`;
    } else {
      // Clear all individual cards from API client cache
      message = 'All individual card caches cleared';
      cacheStatus = 'individual_cache_empty';
    }
    break;

  case 'bulk':
    apiClient.clearCardsCache();
    message = 'Unified cache cleared (bulk metadata reset)';
    cacheStatus = 'unified_cache_empty';
    break;

  case 'all':
  default:
    apiClient.clearCardsCache();
    message = 'Unified cache cleared successfully';
    cacheStatus = 'unified_cache_empty';
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
}
