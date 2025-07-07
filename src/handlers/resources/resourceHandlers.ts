import { generateRequestId } from '../../utils/index.js';
import { ErrorCode, McpError } from '../../types/core.js';
import { MetabaseApiClient } from '../../api.js';
import { getQueryTemplate } from './templates.js';
import {
  optimizeDashboardResource,
  optimizeCardResource,
  optimizeDatabaseResource,
  optimizeTableResource,
  optimizeMetricResource,
  OptimizationLevel,
} from './optimizers.js';
import {
  ListResourcesRequest,
  ReadResourceRequest,
  ListResourceTemplatesRequest,
  ResourceTemplate,
  Resource,
  ResourceContent,
  LogFunction,
} from './types.js';

/**
 * Handle listing all available resources
 */
export async function handleListResources(
  _request: ListResourcesRequest,
  apiClient: MetabaseApiClient,
  logInfo: LogFunction,
  logError: LogFunction
) {
  logInfo('Processing request to list resources', { requestId: generateRequestId() });
  await apiClient.getSessionToken();

  try {
    // Get dashboard list using caching method
    const dashboardsResponse = await apiClient.getDashboardsList();

    const resourceCount = dashboardsResponse.data.length;
    logInfo(
      `Successfully retrieved ${resourceCount} dashboards from Metabase (source: ${dashboardsResponse.source})`
    );

    // Return dashboards as resources
    const resources: Resource[] = dashboardsResponse.data.map((dashboard: any) => ({
      uri: `metabase://dashboard/${dashboard.id}`,
      mimeType: 'application/json',
      name: dashboard.name,
      description: `Metabase dashboard: ${dashboard.name}`,
    }));

    return { resources };
  } catch (error) {
    logError('Failed to retrieve dashboards from Metabase', error);
    throw new McpError(ErrorCode.InternalError, 'Failed to retrieve Metabase resources');
  }
}

/**
 * Handle listing resource templates
 */
export async function handleListResourceTemplates(
  _request: ListResourceTemplatesRequest,
  logInfo: LogFunction
) {
  logInfo('Processing request to list resource templates');

  const resourceTemplates: ResourceTemplate[] = [
    {
      uriTemplate: 'metabase://dashboard/{id}',
      name: 'Dashboard by ID',
      mimeType: 'application/json',
      description: 'Get a Metabase dashboard by its ID',
    },
    {
      uriTemplate: 'metabase://card/{id}',
      name: 'Card by ID',
      mimeType: 'application/json',
      description: 'Get a Metabase question/card by its ID',
    },
    {
      uriTemplate: 'metabase://database/{id}',
      name: 'Database by ID',
      mimeType: 'application/json',
      description: 'Get a Metabase database by its ID',
    },
    {
      uriTemplate: 'metabase://schema/{database_id}/{table_name}',
      name: 'Table Schema',
      mimeType: 'application/json',
      description: 'Get detailed schema information for a specific table',
    },
    {
      uriTemplate: 'metabase://query-template/{category}',
      name: 'Query Template',
      mimeType: 'text/plain',
      description: 'Get SQL query templates by category (joins, aggregations, filters, etc.)',
    },
    {
      uriTemplate: 'metabase://metric/{id}',
      name: 'Business Metric',
      mimeType: 'application/json',
      description: 'Get business metric definition and calculation details',
    },
  ];

  return { resourceTemplates };
}

/**
 * Handle reading a specific resource
 */
export async function handleReadResource(
  request: ReadResourceRequest,
  apiClient: MetabaseApiClient,
  logInfo: LogFunction,
  logWarn: LogFunction,
  logDebug: LogFunction,
  logError: LogFunction
) {
  const requestId = generateRequestId();
  logInfo('Processing request to read resource', {
    requestId,
    uri: request.params?.uri,
  });

  await apiClient.getSessionToken();

  const uri = request.params?.uri;
  if (!uri) {
    logWarn('Missing URI parameter in resource request', { requestId });
    throw new McpError(ErrorCode.InvalidParams, 'URI parameter is required');
  }

  let match;

  try {
    // Handle dashboard resource
    if ((match = uri.match(/^metabase:\/\/dashboard\/(\d+)$/))) {
      return await handleDashboardResource(match[1], uri, apiClient, logDebug, logInfo);
    }

    // Handle card/question resource
    if ((match = uri.match(/^metabase:\/\/card\/(\d+)$/))) {
      return await handleCardResource(match[1], uri, apiClient, logDebug, logInfo);
    }

    // Handle database resource
    if ((match = uri.match(/^metabase:\/\/database\/(\d+)$/))) {
      return await handleDatabaseResource(match[1], uri, apiClient, logDebug, logInfo);
    }

    // Handle table schema resource
    if ((match = uri.match(/^metabase:\/\/schema\/(\d+)\/(.+)$/))) {
      return await handleSchemaResource(match[1], match[2], uri, apiClient, logDebug, logInfo);
    }

    // Handle query template resource
    if ((match = uri.match(/^metabase:\/\/query-template\/(.+)$/))) {
      return await handleQueryTemplateResource(match[1], uri, logDebug);
    }

    // Handle metric resource
    if ((match = uri.match(/^metabase:\/\/metric\/(\d+)$/))) {
      return await handleMetricResource(match[1], uri, apiClient, logDebug, logInfo);
    }

    logWarn(`Invalid URI format: ${uri}`, { requestId });
    throw new McpError(ErrorCode.InvalidRequest, `Invalid URI format: ${uri}`);
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }

    const apiError = error as any;
    const errorMessage = apiError.data?.message || apiError.message || 'Unknown error';
    logError(`Failed to fetch Metabase resource: ${errorMessage}`, error);

    throw new McpError(ErrorCode.InternalError, `Metabase API error: ${errorMessage}`);
  }
}

/**
 * Handle dashboard resource
 */
async function handleDashboardResource(
  id: string,
  uri: string,
  apiClient: MetabaseApiClient,
  logDebug: LogFunction,
  logInfo: LogFunction
) {
  const dashboardId = parseInt(id, 10);
  logDebug(`Fetching dashboard with ID: ${dashboardId}`);

  const response = await apiClient.getDashboard(dashboardId);
  logInfo(
    `Successfully retrieved dashboard: ${response.data.name || dashboardId} (source: ${response.source})`
  );

  // Optimize the dashboard response to reduce token usage
  const optimizedDashboard = optimizeDashboardResource(response.data, OptimizationLevel.STANDARD);

  const contents: ResourceContent[] = [
    {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(optimizedDashboard, null, 2),
    },
  ];

  return { contents };
}

/**
 * Handle card/question resource
 */
async function handleCardResource(
  id: string,
  uri: string,
  apiClient: MetabaseApiClient,
  logDebug: LogFunction,
  logInfo: LogFunction
) {
  const cardId = parseInt(id, 10);
  logDebug(`Fetching card/question with ID: ${cardId}`);

  const response = await apiClient.getCard(cardId);
  logInfo(
    `Successfully retrieved card: ${response.data.name || cardId} (source: ${response.source})`
  );

  // Optimize the card response to reduce token usage
  const optimizedCard = optimizeCardResource(response.data, OptimizationLevel.STANDARD);

  const contents: ResourceContent[] = [
    {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(optimizedCard, null, 2),
    },
  ];

  return { contents };
}

/**
 * Handle database resource
 */
async function handleDatabaseResource(
  id: string,
  uri: string,
  apiClient: MetabaseApiClient,
  logDebug: LogFunction,
  logInfo: LogFunction
) {
  const databaseId = parseInt(id, 10);
  logDebug(`Fetching database with ID: ${databaseId}`);

  const response = await apiClient.getDatabase(databaseId);
  logInfo(
    `Successfully retrieved database: ${response.data.name || databaseId} (source: ${response.source})`
  );

  // Optimize the database response to reduce token usage
  const optimizedDatabase = optimizeDatabaseResource(response.data, OptimizationLevel.STANDARD);

  const contents: ResourceContent[] = [
    {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(optimizedDatabase, null, 2),
    },
  ];

  return { contents };
}

/**
 * Handle table schema resource
 */
async function handleSchemaResource(
  databaseId: string,
  tableName: string,
  uri: string,
  apiClient: MetabaseApiClient,
  logDebug: LogFunction,
  logInfo: LogFunction
) {
  const dbId = parseInt(databaseId, 10);
  logDebug(`Fetching schema for table: ${tableName} in database: ${dbId}`);

  // Get tables from database and find the matching one
  const dbResponse = await apiClient.getDatabase(dbId);
  const table = dbResponse.data.tables?.find((t: any) => t.name === tableName);

  if (!table) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Table '${tableName}' not found in database ${dbId}`
    );
  }

  const tableResponse = await apiClient.getTable(table.id);
  logInfo(
    `Successfully retrieved schema for table: ${tableName} (source: ${tableResponse.source})`
  );

  // Optimize the table response to reduce token usage significantly
  const optimizedTable = optimizeTableResource(tableResponse.data, OptimizationLevel.STANDARD);

  const contents: ResourceContent[] = [
    {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(optimizedTable, null, 2),
    },
  ];

  return { contents };
}

/**
 * Handle query template resource
 */
async function handleQueryTemplateResource(category: string, uri: string, logDebug: LogFunction) {
  logDebug(`Fetching query template for category: ${category}`);

  const templates = getQueryTemplate(category);

  const contents: ResourceContent[] = [
    {
      uri,
      mimeType: 'text/plain',
      text: templates,
    },
  ];

  return { contents };
}

/**
 * Handle metric resource
 */
async function handleMetricResource(
  id: string,
  uri: string,
  apiClient: MetabaseApiClient,
  logDebug: LogFunction,
  logInfo: LogFunction
) {
  const metricId = parseInt(id, 10);
  logDebug(`Fetching metric with ID: ${metricId}`);

  // Get metric from search results (metrics are returned in search)
  const searchParams = new URLSearchParams();
  searchParams.append('models', 'metric');
  searchParams.append('limit', '200');
  const searchResponse = await apiClient.request<any>(`/api/search?${searchParams.toString()}`);

  const searchResults = searchResponse.data || searchResponse;
  const metric = searchResults.find((item: any) => item.id === metricId);
  if (!metric) {
    throw new McpError(ErrorCode.InvalidRequest, `Metric with ID ${metricId} not found`);
  }

  logInfo(`Successfully retrieved metric: ${metric.name}`);

  // Optimize the metric response to reduce token usage
  const optimizedMetric = optimizeMetricResource(metric, OptimizationLevel.STANDARD);

  const contents: ResourceContent[] = [
    {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(optimizedMetric, null, 2),
    },
  ];

  return { contents };
}
