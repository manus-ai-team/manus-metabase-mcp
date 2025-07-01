import { z } from 'zod';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MetabaseApiClient } from '../api.js';
import { ErrorCode, McpError } from '../types.js';

export async function handleFastSearchCards(
  request: z.infer<typeof CallToolRequestSchema>,
  requestId: string,
  apiClient: MetabaseApiClient,
  logDebug: (message: string, data?: unknown) => void,
  logInfo: (message: string, data?: unknown) => void,
  logWarn: (message: string, data?: unknown, error?: Error) => void,
  logError: (message: string, error: unknown) => void
) {
  const searchQuery = request.params?.arguments?.query as string;
  const maxResults = (request.params?.arguments?.max_results as number) || 50;

  if (!searchQuery) {
    logWarn('Missing query parameter in fast search_cards request', { requestId });
    throw new McpError(
      ErrorCode.InvalidParams,
      'Search query parameter is required'
    );
  }

  logDebug(`Fast searching for cards with query: "${searchQuery}"`);

  const searchStartTime = Date.now();

  try {
    // Use Metabase's native search API
    const searchParams = new URLSearchParams({
      q: searchQuery,
      models: 'card' // Only search for cards/questions
    });

    const response = await apiClient.request<any>(`/api/search?${searchParams.toString()}`);
    const searchTime = Date.now() - searchStartTime;

    // Extract cards from search results and limit results
    let cards = response.data || response || [];
    if (Array.isArray(cards)) {
      cards = cards.filter((item: any) => item.model === 'card').slice(0, maxResults);
    } else {
      cards = [];
    }

    // Enhance results with additional metadata
    const enhancedResults = cards.map((card: any) => ({
      id: card.id,
      name: card.name,
      description: card.description,
      collection_name: card.collection_name,
      database_id: card.database_id,
      created_at: card.created_at,
      updated_at: card.updated_at,
      model: card.model,
      search_context: card.context || null,
      recommended_action: `Use get_card_sql(${card.id}) then execute_query() for reliable execution`
    }));

    logInfo(`Fast search found ${enhancedResults.length} cards in ${searchTime}ms`);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          search_query: searchQuery,
          search_method: 'native_metabase_api',
          total_results: enhancedResults.length,
          performance_advantage: `FAST SEARCH: Completed in ${searchTime}ms using server-side native search API. Much faster than get_cards which fetches all data.`,
          performance_info: {
            search_time_ms: searchTime,
            api_endpoint: '/api/search',
            search_method: 'server_side_native',
            performance_note: 'This method is optimized for speed and should be preferred over get_cards for targeted searches'
          },
          recommended_workflow: 'For cards: 1) Use get_card_sql() to get the SQL, 2) Modify if needed, 3) Use execute_query()',
          when_to_use: {
            use_search_cards: 'For finding specific cards by name, description, or metadata (RECOMMENDED)',
            use_get_cards: 'Only when you need advanced fuzzy matching, SQL content search, or comprehensive data analysis'
          },
          note: 'This uses Metabase native search API for fast results. For advanced fuzzy matching or SQL content search, use get_cards with search parameters.',
          results: enhancedResults
        }, null, 2)
      }]
    };
  } catch (error) {
    logError('Fast search failed, this may indicate the search API is not available', error);
    throw new McpError(
      ErrorCode.InternalError,
      'Fast search failed. The search API may not be available in this Metabase version.'
    );
  }
}
