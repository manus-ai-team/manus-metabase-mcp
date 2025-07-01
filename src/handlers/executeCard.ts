import { z } from 'zod';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MetabaseApiClient } from '../api.js';
import { ErrorCode, McpError } from '../types.js';

export async function handleExecuteCard(
  request: z.infer<typeof CallToolRequestSchema>,
  requestId: string,
  apiClient: MetabaseApiClient,
  logDebug: (message: string, data?: unknown) => void,
  logInfo: (message: string, data?: unknown) => void,
  logWarn: (message: string, data?: unknown, error?: Error) => void
) {
  const cardId = request.params?.arguments?.card_id as number;
  if (!cardId) {
    logWarn('Missing card_id parameter in execute_card request', { requestId });
    throw new McpError(
      ErrorCode.InvalidParams,
      'Card ID parameter is required'
    );
  }

  logDebug(`Executing card with ID: ${cardId}`);
  const parameters = request.params?.arguments?.parameters || {};

  // Convert parameters to the format Metabase expects
  let formattedParameters: any[] = [];

  if (typeof parameters === 'object' && parameters !== null) {
    if (Array.isArray(parameters)) {
      // If already an array, use as-is
      formattedParameters = parameters;
    } else {
      // Convert object format to array format
      formattedParameters = Object.entries(parameters).map(([key, value]) => {
        // Determine parameter type based on value
        let paramType = 'text'; // default type used by Metabase
        if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
          paramType = 'id'; // Use 'id' for numeric values (like IDs)
        } else if (typeof value === 'boolean') {
          paramType = 'text';
        }

        return {
          type: paramType,
          target: ['variable', ['template-tag', key]], // Correct format: ["variable", ["template-tag", "variable_name"]]
          value: value
        };
      });
    }
  }

  const response = await apiClient.request<any>(`/api/card/${cardId}/query`, {
    method: 'POST',
    body: JSON.stringify({ parameters: formattedParameters })
  });

  logInfo(`Successfully executed card: ${cardId}`);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(response, null, 2)
    }]
  };
}
