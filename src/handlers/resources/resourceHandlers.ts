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
 * Handle listing all available resources using hierarchical approach for better scalability
 */
export async function handleListResources(
  _request: ListResourcesRequest,
  apiClient: MetabaseApiClient,
  logInfo: LogFunction,
  logError: LogFunction
) {
  const requestId = generateRequestId();
  logInfo('Processing request to list hierarchical Metabase resources', { requestId });
  await apiClient.getSessionToken();

  try {
    const resources: Resource[] = [];
    let totalResourceCount = 0;

    // Fetch core data: cards, dashboards, collections, and databases
    const [cardsResponse, dashboardsResponse, collectionsResponse, databasesResponse] =
      await Promise.all([
        apiClient.getCardsList().catch(error => {
          logError('Failed to fetch cards', error);
          return { data: [], source: 'error' };
        }),
        apiClient.getDashboardsList().catch(error => {
          logError('Failed to fetch dashboards', error);
          return { data: [], source: 'error' };
        }),
        apiClient.getCollectionsList().catch(error => {
          logError('Failed to fetch collections', error);
          return { data: [], source: 'error' };
        }),
        apiClient.getDatabasesList().catch(error => {
          logError('Failed to fetch databases', error);
          return { data: [], source: 'error' };
        }),
      ]);

    // Add top 20 cards based on views
    if (cardsResponse.data.length > 0) {
      const topCards = cardsResponse.data
        .filter((card: any) => !card.archived) // Only active cards
        .sort((a: any, b: any) => (b.view_count || 0) - (a.view_count || 0)) // Sort by views descending
        .slice(0, 20) // Top 20
        .map((card: any) => ({
          uri: `metabase://card/${card.id}`,
          mimeType: 'application/json',
          name: `[Card] ${card.name}`,
          description: `Card: ${card.name}${card.description ? ` - ${card.description}` : ''}${
            card.view_count ? ` (${card.view_count} views)` : ''
          }`,
        }));

      resources.push(...topCards);
      totalResourceCount += topCards.length;
      logInfo(
        `Added ${topCards.length} top cards by views (from ${cardsResponse.data.length} total)`
      );
    }

    // Add top 20 dashboards based on views
    if (dashboardsResponse.data.length > 0) {
      const topDashboards = dashboardsResponse.data
        .filter((dashboard: any) => !dashboard.archived) // Only active dashboards
        .sort((a: any, b: any) => (b.view_count || 0) - (a.view_count || 0)) // Sort by views descending
        .slice(0, 20) // Top 20
        .map((dashboard: any) => ({
          uri: `metabase://dashboard/${dashboard.id}`,
          mimeType: 'application/json',
          name: `[Dashboard] ${dashboard.name}`,
          description: `Dashboard: ${dashboard.name}${dashboard.description ? ` - ${dashboard.description}` : ''}${
            dashboard.view_count ? ` (${dashboard.view_count} views)` : ''
          }`,
        }));

      resources.push(...topDashboards);
      totalResourceCount += topDashboards.length;
      logInfo(
        `Added ${topDashboards.length} top dashboards by views (from ${dashboardsResponse.data.length} total)`
      );
    }

    // Add ROOT collections only (location: "/")
    if (collectionsResponse.data.length > 0) {
      const rootCollectionResources = collectionsResponse.data
        .filter((collection: any) => !collection.personal_owner_id) // Exclude personal collections
        .filter((collection: any) => collection.location === '/') // Only root collections
        .map((collection: any) => ({
          uri: `metabase://collection/${collection.id}`,
          mimeType: 'application/json',
          name: `[Collection] ${collection.name}`,
          description: `Collection: ${collection.name}${collection.description ? ` - ${collection.description}` : ''}`,
        }));

      resources.push(...rootCollectionResources);
      totalResourceCount += rootCollectionResources.length;
      logInfo(
        `Added ${rootCollectionResources.length} root collections (${collectionsResponse.data.length} total, filtered to location: "/")`
      );
    }

    // Add ALL databases (important for navigation)
    if (databasesResponse.data.length > 0) {
      const databaseResources = databasesResponse.data
        .filter((database: any) => !database.is_sample) // Exclude sample databases
        .map((database: any) => ({
          uri: `metabase://database/${database.id}`,
          mimeType: 'application/json',
          name: `[Database] ${database.name}`,
          description: `Database: ${database.name} (${database.engine})${database.description ? ` - ${database.description}` : ''}`,
        }));

      resources.push(...databaseResources);
      totalResourceCount += databaseResources.length;
      logInfo(
        `Added ${databaseResources.length} databases (${databasesResponse.data.length} total, source: ${databasesResponse.source})`
      );
    }

    // Sort resources by type priority for better organization
    const sortedResources = resources.sort((a, b) => {
      const typeOrder = {
        '[Card]': 0, // Top cards first
        '[Dashboard]': 1, // Top dashboards second
        '[Collection]': 2, // All collections third
        '[Database]': 3, // All databases last
      };

      const getType = (name: string) => {
        for (const key of Object.keys(typeOrder)) {
          if (name.startsWith(key)) {
            return typeOrder[key as keyof typeof typeOrder];
          }
        }
        return 999; // Unknown type goes to the end
      };

      const aType = getType(a.name);
      const bType = getType(b.name);

      if (aType !== bType) {
        return aType - bType;
      }

      // Within same type, sort alphabetically by name
      return a.name.localeCompare(b.name);
    });

    logInfo(
      `Successfully retrieved ${sortedResources.length} view-based resources (from ${totalResourceCount} total items)`
    );

    return { resources: sortedResources };
  } catch (error) {
    logError('Failed to retrieve Metabase resources', error);
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

    // Handle collection resource
    if ((match = uri.match(/^metabase:\/\/collection\/(\d+)$/))) {
      return await handleCollectionResource(match[1], uri, apiClient, logDebug, logInfo);
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

/**
 * Handle individual collection resource - returns collection items
 */
async function handleCollectionResource(
  id: string,
  uri: string,
  apiClient: MetabaseApiClient,
  logDebug: LogFunction,
  logInfo: LogFunction
) {
  const collectionId = parseInt(id, 10);
  logDebug(`Fetching collection items for collection ID: ${collectionId}`);

  // Get both collection metadata and its items
  const [collectionResponse, itemsResponse] = await Promise.all([
    apiClient.getCollection(collectionId),
    apiClient.getCollectionItems(collectionId),
  ]);

  const collection = collectionResponse.data;
  const items = itemsResponse.data || [];

  logInfo(`Successfully retrieved collection "${collection.name}" with ${items.length} items`);

  // Organize items by type for better presentation
  const organizedItems = {
    cards: items.filter((item: any) => item.model === 'card'),
    dashboards: items.filter((item: any) => item.model === 'dashboard'),
    collections: items.filter((item: any) => item.model === 'collection'),
    other: items.filter((item: any) => !['card', 'dashboard', 'collection'].includes(item.model)),
  };

  // Create response with collection metadata and organized items
  const collectionWithItems = {
    id: collection.id,
    name: collection.name,
    description: collection.description,
    location: collection.location,
    created_at: collection.created_at,
    updated_at: collection.updated_at,
    archived: collection.archived,
    items: {
      total_count: items.length,
      cards: organizedItems.cards.map((card: any) => ({
        id: card.id,
        name: card.name,
        description: card.description,
        model: card.model,
        view_count: card.view_count,
      })),
      dashboards: organizedItems.dashboards.map((dashboard: any) => ({
        id: dashboard.id,
        name: dashboard.name,
        description: dashboard.description,
        model: dashboard.model,
        view_count: dashboard.view_count,
      })),
      collections: organizedItems.collections.map((subcollection: any) => ({
        id: subcollection.id,
        name: subcollection.name,
        description: subcollection.description,
        model: subcollection.model,
      })),
      other: organizedItems.other.map((item: any) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        model: item.model,
      })),
    },
    retrieved_at: new Date().toISOString(),
  };

  const contents: ResourceContent[] = [
    {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(collectionWithItems, null, 2),
    },
  ];

  return { contents };
}
