import { MetabaseApiClient } from '../api.js';
import { handleApiError } from '../utils.js';

export async function handleListDatabases(
  apiClient: MetabaseApiClient,
  logDebug: (message: string, data?: unknown) => void,
  logInfo: (message: string, data?: unknown) => void,
  logError: (message: string, error: unknown) => void
) {
  logDebug('Fetching all databases from Metabase');

  try {
    const response = await apiClient.request<any[]>('/api/database');
    logInfo(`Successfully retrieved ${response.length} databases`);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  } catch (error: any) {
    throw handleApiError(error, {
      operation: 'Fetch databases list',
      customMessages: {
        '404': 'Databases endpoint not found. This Metabase version may not support the databases API.'
      }
    }, logError);
  }
}
