import { z } from 'zod';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MetabaseApiClient } from '../api.js';
import { ErrorCode, McpError } from '../types.js';

export async function handleUnifiedSearch(
  request: z.infer<typeof CallToolRequestSchema>,
  requestId: string,
  apiClient: MetabaseApiClient,
  logDebug: (message: string, data?: unknown) => void,
  logInfo: (message: string, data?: unknown) => void,
  logWarn: (message: string, data?: unknown, error?: Error) => void,
  logError: (message: string, error: unknown) => void
) {
  const searchQuery = request.params?.arguments?.query as string;
  const models = (request.params?.arguments?.models as string[]) || ['card', 'dashboard'];
  const maxResults = (request.params?.arguments?.max_results as number) || 50;
  const searchNativeQuery = (request.params?.arguments?.search_native_query as boolean) || false;
  const includeDashboardQuestions = (request.params?.arguments?.include_dashboard_questions as boolean) ?? false;
  const ids = request.params?.arguments?.ids as number[] | undefined;
  const archived = request.params?.arguments?.archived as boolean | undefined;
  const databaseId = request.params?.arguments?.database_id as number | undefined;
  const verified = request.params?.arguments?.verified as boolean | undefined;


  if (!searchQuery && (!ids || ids.length === 0)) {
    logWarn('Missing query or ids parameter in unified search request', { requestId });
    throw new McpError(
      ErrorCode.InvalidParams,
      'Either search query or ids parameter is required'
    );
  }

  // Validate that only one search method is used
  if (searchQuery && ids && ids.length > 0) {
    logWarn('Cannot use both query and ids parameters simultaneously', { requestId });
    throw new McpError(
      ErrorCode.InvalidParams,
      'Cannot use both query and ids parameters - use either search query OR ids, not both'
    );
  }

  // Validate ids usage - only allowed with single model
  if (ids && ids.length > 0 && models.length > 1) {
    logWarn('ids parameter can only be used with a single model type', { requestId });
    throw new McpError(
      ErrorCode.InvalidParams,
      'ids parameter can only be used when searching a single model type'
    );
  }

  // Validate model types
  const validModels = ['card', 'dashboard', 'table', 'dataset', 'segment', 'collection', 'database', 'action', 'indexed-entity', 'metric'];
  const invalidModels = models.filter(model => !validModels.includes(model));
  if (invalidModels.length > 0) {
    logWarn(`Invalid model types specified: ${invalidModels.join(', ')}`, { requestId });
    throw new McpError(
      ErrorCode.InvalidParams,
      `Invalid model types: ${invalidModels.join(', ')}. Valid types are: ${validModels.join(', ')}`
    );
  }

  // Validate database_id if provided
  if (databaseId && (typeof databaseId !== 'number' || databaseId <= 0)) {
    logWarn('Invalid database_id parameter', { requestId });
    throw new McpError(
      ErrorCode.InvalidParams,
      'database_id must be a positive integer'
    );
  }

  logDebug(`Unified search with query: "${searchQuery}", models: ${models.join(', ')}`);

  const searchStartTime = Date.now();

  try {
    // Build search parameters
    const searchParams = new URLSearchParams();

    if (searchQuery) {
      searchParams.append('q', searchQuery);
    }

    // Add models
    models.forEach(model => searchParams.append('models', model));

    // Add optional parameters
    if (searchNativeQuery) {
      searchParams.append('search_native_query', 'true');
    }

    if (includeDashboardQuestions) {
      searchParams.append('include_dashboard_questions', 'true');
    }

    if (ids && ids.length > 0) {
      ids.forEach(id => searchParams.append('ids', id.toString()));
    }

    if (archived === true) {
      searchParams.append('archived', 'true');
    }

    if (databaseId) {
      searchParams.append('table_db_id', databaseId.toString());
    }

    if (verified === true) {
      searchParams.append('verified', 'true');
    }



    const response = await apiClient.request<any>(`/api/search?${searchParams.toString()}`);
    const searchTime = Date.now() - searchStartTime;

    // Extract results and limit
    let results = response.data || response || [];
    if (Array.isArray(results)) {
      results = results.slice(0, maxResults);
    } else {
      results = [];
    }

    // Enhance results with model-specific metadata and recommendations
    const enhancedResults = results.map((item: any) => {
      const baseItem = {
        id: item.id,
        name: item.name,
        description: item.description,
        model: item.model,
        collection_name: item.collection_name,
        created_at: item.created_at,
        updated_at: item.updated_at,
        database_id: item.database_id || null,
        table_id: item.table_id || null,
        archived: item.archived || false
      };

      // Add model-specific recommendations
      if (item.model === 'card') {
        return {
          ...baseItem,
          recommended_action: `Use get_card_sql(${item.id}) then execute_query() for reliable execution`,
        };
      } else if (item.model === 'dashboard') {
        return {
          ...baseItem,
          recommended_action: `Use get_dashboard_cards(${item.id}) to get dashboard details`
        };
      } else {
        return baseItem;
      }
    });

    // Group results by model type for better organization
    const resultsByModel = enhancedResults.reduce((acc: any, item: any) => {
      if (!acc[item.model]) {
        acc[item.model] = [];
      }
      acc[item.model].push(item);
      return acc;
    }, {});

    const totalResults = enhancedResults.length;
    const searchMethod = ids && ids.length > 0 ? 'id_search' : 'query_search';

    logInfo(`Unified search found ${totalResults} items across ${Object.keys(resultsByModel).length} model types in ${searchTime}ms`);

    // Build standardized parameters object for response
    const usedParameters: any = {
      query: searchQuery || null,
      models: models,
      max_results: maxResults
    };

    // Add optional parameters that were actually used
    if (searchNativeQuery) usedParameters.search_native_query = searchNativeQuery;
    if (includeDashboardQuestions) usedParameters.include_dashboard_questions = includeDashboardQuestions;
    if (ids && ids.length > 0) usedParameters.ids = ids;
    if (archived === true) usedParameters.archived = archived;
    if (databaseId) usedParameters.database_id = databaseId;
    if (verified === true) usedParameters.verified = verified;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          search_metrics: {
            method: searchMethod,
            total_results: totalResults,
            search_time_ms: searchTime,
            parameters_used: usedParameters
          },
          results_by_model: Object.keys(resultsByModel).map(model => ({
            model,
            count: resultsByModel[model].length
          })),
          results: enhancedResults
        }, null, 2)
      }]
    };
  } catch (error: any) {
    logError('Unified search failed', error);

    // Extract detailed error information
    let errorMessage = 'Unified search failed';
    let errorDetails = '';
    let statusCode = 'unknown';

    if (error?.response) {
      // HTTP error response
      statusCode = error.response.status?.toString() || 'unknown';
      const responseData = error.response.data || error.response;

      if (typeof responseData === 'string') {
        errorDetails = responseData;
      } else if (responseData?.message) {
        errorDetails = responseData.message;
      } else if (responseData?.error) {
        errorDetails = responseData.error;
      } else {
        errorDetails = JSON.stringify(responseData);
      }

      errorMessage = `Metabase API error (${statusCode})`;

      // Provide specific guidance for common errors
      if (statusCode === '400') {
        if (errorDetails.includes('verified') || errorDetails.includes('premium')) {
          errorMessage += ': The verified parameter requires premium features. Try removing verified parameter or ensure your Metabase instance has premium features enabled.';
        } else if (errorDetails.includes('database') || errorDetails.includes('table_db_id')) {
          errorMessage += ': Invalid database_id parameter. Ensure the database ID exists and you have access to it.';
        } else if (errorDetails.includes('models') || errorDetails.includes('model')) {
          errorMessage += ': Invalid model types specified. Check that all model types are valid: card, dashboard, table, dataset, segment, collection, database, action, indexed-entity, metric.';
        } else {
          errorMessage += ': Invalid search parameters.';
        }
      } else if (statusCode === '401') {
        errorMessage += ': Authentication failed. Check your API key or session.';
      } else if (statusCode === '403') {
        errorMessage += ': Access denied. You may not have permission to search these items.';
      } else if (statusCode === '404') {
        errorMessage += ': Search endpoint not found. This Metabase version may not support the search API.';
      }
    } else if (error?.message) {
      errorDetails = error.message;
      errorMessage = `Search request failed: ${error.message}`;
    } else {
      errorDetails = String(error);
      errorMessage = 'Unknown search error occurred';
    }

    // Log detailed error for debugging
    logError(`Detailed search error - Status: ${statusCode}, Details: ${errorDetails}`, error);

    throw new McpError(
      ErrorCode.InternalError,
      `${errorMessage}${errorDetails ? ` Details: ${errorDetails}` : ''}`
    );
  }
}
