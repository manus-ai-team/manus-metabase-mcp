import { z } from 'zod';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MetabaseApiClient } from '../api.js';
import { ErrorCode, McpError } from '../types.js';

export async function handleFastSearchDashboards(
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
    logWarn('Missing query parameter in fast search_dashboards request', { requestId });
    throw new McpError(
      ErrorCode.InvalidParams,
      'Search query parameter is required'
    );
  }

  logDebug(`Fast searching for dashboards with query: "${searchQuery}"`);

  const searchStartTime = Date.now();

  try {
    // Use Metabase's native search API
    const searchParams = new URLSearchParams({
      q: searchQuery,
      models: 'dashboard' // Only search for dashboards
    });

    const response = await apiClient.request<any>(`/api/search?${searchParams.toString()}`);
    const searchTime = Date.now() - searchStartTime;

    // Extract dashboards from search results and limit results
    let dashboards = response.data || response || [];
    if (Array.isArray(dashboards)) {
      dashboards = dashboards.filter((item: any) => item.model === 'dashboard').slice(0, maxResults);
    } else {
      dashboards = [];
    }

    // Enhance results with additional metadata
    const enhancedResults = dashboards.map((dashboard: any) => ({
      id: dashboard.id,
      name: dashboard.name,
      description: dashboard.description,
      collection_name: dashboard.collection_name,
      created_at: dashboard.created_at,
      updated_at: dashboard.updated_at,
      model: dashboard.model,
      search_context: dashboard.context || null,
      recommended_action: `Use get_dashboard_cards(${dashboard.id}) to get dashboard details`
    }));

    logInfo(`Fast search found ${enhancedResults.length} dashboards in ${searchTime}ms`);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          search_query: searchQuery,
          search_method: 'native_metabase_api',
          total_results: enhancedResults.length,
          performance_advantage: `FAST SEARCH: Completed in ${searchTime}ms using server-side native search API. Much faster than get_dashboards which fetches all data.`,
          performance_info: {
            search_time_ms: searchTime,
            api_endpoint: '/api/search',
            search_method: 'server_side_native',
            performance_note: 'This method is optimized for speed and should be preferred over get_dashboards for targeted searches'
          },
          when_to_use: {
            use_search_dashboards: 'For finding specific dashboards by name, description, or metadata (RECOMMENDED)',
            use_get_dashboards: 'Only when you need advanced fuzzy matching or comprehensive data analysis'
          },
          note: 'This uses Metabase native search API for fast results. For advanced fuzzy matching, use get_dashboards with search parameters.',
          results: enhancedResults
        }, null, 2)
      }]
    };
  } catch (error) {
    logError('Fast dashboard search failed, this may indicate the search API is not available', error);
    throw new McpError(
      ErrorCode.InternalError,
      'Fast search failed. The search API may not be available in this Metabase version.'
    );
  }
}
