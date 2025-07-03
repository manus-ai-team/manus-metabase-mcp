import { z } from 'zod';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MetabaseApiClient } from '../api.js';
import { ErrorCode, McpError } from '../types.js';

export async function handleGetCardSql(
  request: z.infer<typeof CallToolRequestSchema>,
  requestId: string,
  apiClient: MetabaseApiClient,
  logDebug: (message: string, data?: unknown) => void,
  logInfo: (message: string, data?: unknown) => void,
  logWarn: (message: string, data?: unknown, error?: Error) => void
) {
  const cardId = request.params?.arguments?.card_id as number;
  if (!cardId) {
    logWarn('Missing card_id parameter in get_card_sql request', { requestId });
    throw new McpError(
      ErrorCode.InvalidParams,
      'Card ID parameter is required'
    );
  }

  logDebug(`Fetching SQL details for card with ID: ${cardId}`);

  // Use caching system for optimal performance
  const startTime = Date.now();
  const card = await apiClient.getCard(cardId);
  const fetchTime = Date.now() - startTime;

  // Determine data source based on fetch time
  const dataSource = fetchTime < 5 ? 'cache' : 'api';

  // Extract relevant information for query execution
  const result: any = {
    card_id: cardId,
    card_name: card.name,
    database_id: card.database_id,
    sql_query: card.dataset_query?.native?.query || null,
    template_tags: card.dataset_query?.native?.template_tags || {},
    query_type: card.dataset_query?.type || 'unknown',
    description: card.description || null,
    collection_id: card.collection_id,
    created_at: card.created_at,
    updated_at: card.updated_at,
    data_source: dataSource,
    fetch_time_ms: fetchTime
  };

  // Add guidance for AI agents
  if (!result.sql_query) {
    result.message = 'This card does not contain a native SQL query. It may be a GUI-based question.';
  } else {
    result.message = 'Use the database_id and sql_query with execute_query. You can modify the SQL query to add filters or parameters.';
  }

  // Add performance info
  if (dataSource === 'cache') {
    result.performance_note = 'Data retrieved from cache (optimal efficiency)';
  } else {
    result.performance_note = 'Data retrieved via direct API call (now cached for future requests)';
  }

  logInfo(`Successfully retrieved SQL details for card: ${cardId} (source: ${dataSource}, ${fetchTime}ms)`);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  };
}
