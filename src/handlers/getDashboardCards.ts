import { z } from 'zod';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MetabaseApiClient } from '../api.js';
import { ErrorCode, McpError } from '../types.js';
import { handleApiError } from '../utils.js';
import { stripDashboardCardFields, MinimalDashboardCard } from '../utils.js';

export async function handleGetDashboardCards(
  request: z.infer<typeof CallToolRequestSchema>,
  requestId: string,
  apiClient: MetabaseApiClient,
  logDebug: (message: string, data?: unknown) => void,
  logInfo: (message: string, data?: unknown) => void,
  logWarn: (message: string, data?: unknown, error?: Error) => void,
  logError: (message: string, data?: unknown) => void
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

  try {
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
  } catch (error: any) {
    throw handleApiError(error, {
      operation: 'Fetch dashboard cards',
      resourceType: 'dashboard',
      resourceId: dashboardId,
      customMessages: {
        '400': 'Invalid dashboard_id parameter. Ensure the dashboard ID is a valid number.',
        '404': 'Dashboard not found. Check that the dashboard_id is correct and the dashboard exists.',
        '500': 'Metabase server error. The dashboard may be corrupted or the server is experiencing issues.'
      }
    }, logError);
  }
}
