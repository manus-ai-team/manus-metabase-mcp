import { z } from 'zod';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MetabaseApiClient } from '../api.js';

export function handleClearCache(
  request: z.infer<typeof CallToolRequestSchema>,
  apiClient: MetabaseApiClient,
  logInfo: (message: string, data?: unknown) => void
) {
  const cacheType = (request.params?.arguments?.cache_type as string) || 'all';
  const cardId = request.params?.arguments?.card_id as number;

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

  case 'bulk':
    apiClient.clearCardsCache();
    message = 'Cards cache cleared (bulk metadata reset)';
    cacheStatus = 'cards_cache_empty';
    break;

  case 'all':
  default:
    apiClient.clearAllCache();
    message = 'All caches cleared successfully (cards and dashboards)';
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
}
