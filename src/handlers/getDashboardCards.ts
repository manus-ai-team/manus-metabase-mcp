import { z } from 'zod';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MetabaseApiClient } from '../api.js';
import { ErrorCode, McpError } from '../types.js';
import { stripDashboardCardFields, MinimalDashboardCard } from '../utils.js';

export async function handleGetDashboardCards(
  request: z.infer<typeof CallToolRequestSchema>,
  requestId: string,
  apiClient: MetabaseApiClient,
  logDebug: (message: string, data?: unknown) => void,
  logInfo: (message: string, data?: unknown) => void,
  logWarn: (message: string, data?: unknown, error?: Error) => void
) {
  const dashboardId = request.params?.arguments?.dashboard_id as number;
  if (!dashboardId || typeof dashboardId !== 'number') {
    logWarn('Missing or invalid dashboard_id parameter in get_dashboard_cards request', { requestId });
    throw new McpError(
      ErrorCode.InvalidParams,
      'Dashboard ID parameter is required and must be a number'
    );
  }

  logDebug(`Fetching cards for dashboard with ID: ${dashboardId}`);
  const response = await apiClient.getDashboard(dashboardId);

  // Extract cards from the dashboard response
  const rawCards = response.dashcards || response.cards || [];
  const cardCount = rawCards.length;

  // Strip unnecessary fields to reduce token usage and improve performance
  const strippedCards: MinimalDashboardCard[] = rawCards.map(stripDashboardCardFields);

  // Calculate memory savings for logging
  const originalSize = JSON.stringify(rawCards).length;
  const strippedSize = JSON.stringify(strippedCards).length;
  const sizeSavings = originalSize > 0 ? ((originalSize - strippedSize) / originalSize * 100).toFixed(1) : '0';

  logInfo(`Successfully retrieved ${cardCount} cards from dashboard: ${dashboardId} (${sizeSavings}% size reduction)`);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        dashboard_id: dashboardId,
        dashboard_name: response.name,
        card_count: cardCount,
        cards: strippedCards
      }, null, 2)
    }]
  };
}
