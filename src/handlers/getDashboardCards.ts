import { z } from 'zod';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MetabaseApiClient } from '../api.js';
import { ErrorCode, McpError } from '../types.js';

export async function handleGetDashboardCards(
  request: z.infer<typeof CallToolRequestSchema>,
  requestId: string,
  apiClient: MetabaseApiClient,
  logDebug: (message: string, data?: unknown) => void,
  logInfo: (message: string, data?: unknown) => void,
  logWarn: (message: string, data?: unknown, error?: Error) => void
) {
  const dashboardId = request.params?.arguments?.dashboard_id;
  if (!dashboardId) {
    logWarn('Missing dashboard_id parameter in get_dashboard_cards request', { requestId });
    throw new McpError(
      ErrorCode.InvalidParams,
      'Dashboard ID parameter is required'
    );
  }

  logDebug(`Fetching cards for dashboard with ID: ${dashboardId}`);
  const response = await apiClient.request<any>(`/api/dashboard/${dashboardId}`);

  const cardCount = response.cards?.length || 0;
  logInfo(`Successfully retrieved ${cardCount} cards from dashboard: ${dashboardId}`);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(response.cards, null, 2)
    }]
  };
}
