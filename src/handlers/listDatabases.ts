import { MetabaseApiClient } from '../api.js';

export async function handleListDatabases(
  apiClient: MetabaseApiClient,
  logDebug: (message: string, data?: unknown) => void,
  logInfo: (message: string, data?: unknown) => void
) {
  logDebug('Fetching all databases from Metabase');
  const response = await apiClient.request<any[]>('/api/database');
  logInfo(`Successfully retrieved ${response.length} databases`);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(response, null, 2)
    }]
  };
}
