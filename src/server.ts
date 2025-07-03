import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import {
  LogLevel,
} from './config.js';
import {
  generateRequestId,
} from './utils.js';
import {
  ErrorCode,
  McpError,
  ApiError,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
} from './types.js';
import { MetabaseApiClient } from './api.js';
import {
  handleListDatabases,
  handleGetCardSql,
  handleGetDashboardCards,
  handleExecuteQuery,
  handleUnifiedSearch,
  handleExportQuery,
  handleClearCache
} from './handlers/index.js';

export class MetabaseServer {
  private server: Server;
  private apiClient: MetabaseApiClient;

  constructor() {
    this.server = new Server(
      {
        name: 'metabase-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.apiClient = new MetabaseApiClient();

    this.setupResourceHandlers();
    this.setupToolHandlers();

    // Enhanced error handling with logging
    this.server.onerror = (error: Error) => {
      this.logError('Unexpected server error occurred', error);
    };

    process.on('SIGINT', async () => {
      this.logInfo('Gracefully shutting down server');
      await this.server.close();
      process.exit(0);
    });
  }

  // Enhanced logging utilities
  private log(level: LogLevel, message: string, data?: unknown, error?: Error) {
    const timestamp = new Date().toISOString();

    const logMessage: Record<string, unknown> = {
      timestamp,
      level,
      message
    };

    if (data !== undefined) {
      logMessage.data = data;
    }

    if (error) {
      logMessage.error = error.message || 'Unknown error';
      logMessage.stack = error.stack;
    }

    // Output structured log for machine processing
    console.error(JSON.stringify(logMessage));

    // Output human-readable format
    try {
      const logPrefix = level.toUpperCase();

      if (error) {
        console.error(`[${timestamp}] ${logPrefix}: ${message} - ${error.message || 'Unknown error'}`);
      } else {
        console.error(`[${timestamp}] ${logPrefix}: ${message}`);
      }
    } catch (e) {
      // Ignore if console is not available
    }
  }

  private logDebug(message: string, data?: unknown) {
    this.log(LogLevel.DEBUG, message, data);
  }

  private logInfo(message: string, data?: unknown) {
    this.log(LogLevel.INFO, message, data);
  }

  private logWarn(message: string, data?: unknown, error?: Error) {
    this.log(LogLevel.WARN, message, data, error);
  }

  private logError(message: string, error: unknown) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    this.log(LogLevel.ERROR, message, undefined, errorObj);
  }

  private logFatal(message: string, error: unknown) {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    this.log(LogLevel.FATAL, message, undefined, errorObj);
  }

  /**
   * Set up resource handlers
   */
  private setupResourceHandlers() {
    this.server.setRequestHandler(ListResourcesRequestSchema, async (_request) => {
      this.logInfo('Processing request to list resources', { requestId: generateRequestId() });
      await this.apiClient.getSessionToken();

      try {
        // Get dashboard list
        this.logDebug('Fetching dashboards from Metabase');
        const dashboardsResponse = await this.apiClient.request<any[]>('/api/dashboard');

        const resourceCount = dashboardsResponse.length;
        this.logInfo(`Successfully retrieved ${resourceCount} dashboards from Metabase`);

        // Return dashboards as resources
        return {
          resources: dashboardsResponse.map((dashboard: any) => ({
            uri: `metabase://dashboard/${dashboard.id}`,
            mimeType: 'application/json',
            name: dashboard.name,
            description: `Metabase dashboard: ${dashboard.name}`
          }))
        };
      } catch (error) {
        this.logError('Failed to retrieve dashboards from Metabase', error);
        throw new McpError(
          ErrorCode.InternalError,
          'Failed to retrieve Metabase resources'
        );
      }
    });

    // Resource templates
    this.server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
      this.logInfo('Processing request to list resource templates');
      return {
        resourceTemplates: [
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
        ],
      };
    });

    // Read resource
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const requestId = generateRequestId();
      this.logInfo('Processing request to read resource', {
        requestId,
        uri: request.params?.uri
      });

      await this.apiClient.getSessionToken();

      const uri = request.params?.uri;
      if (!uri) {
        this.logWarn('Missing URI parameter in resource request', { requestId });
        throw new McpError(
          ErrorCode.InvalidParams,
          'URI parameter is required'
        );
      }

      let match;

      try {
        // Handle dashboard resource
        if ((match = uri.match(/^metabase:\/\/dashboard\/(\d+)$/))) {
          const dashboardId = match[1];
          this.logDebug(`Fetching dashboard with ID: ${dashboardId}`);

          const response = await this.apiClient.request<any>(`/api/dashboard/${dashboardId}`);
          this.logInfo(`Successfully retrieved dashboard: ${response.name || dashboardId}`);

          return {
            contents: [{
              uri: request.params?.uri,
              mimeType: 'application/json',
              text: JSON.stringify(response, null, 2)
            }]
          };
        }

        // Handle question/card resource
        else if ((match = uri.match(/^metabase:\/\/card\/(\d+)$/))) {
          const cardId = match[1];
          this.logDebug(`Fetching card/question with ID: ${cardId}`);

          const response = await this.apiClient.request<any>(`/api/card/${cardId}`);
          this.logInfo(`Successfully retrieved card: ${response.name || cardId}`);

          return {
            contents: [{
              uri: request.params?.uri,
              mimeType: 'application/json',
              text: JSON.stringify(response, null, 2)
            }]
          };
        }

        // Handle database resource
        else if ((match = uri.match(/^metabase:\/\/database\/(\d+)$/))) {
          const databaseId = match[1];
          this.logDebug(`Fetching database with ID: ${databaseId}`);

          const response = await this.apiClient.request<any>(`/api/database/${databaseId}`);
          this.logInfo(`Successfully retrieved database: ${response.name || databaseId}`);

          return {
            contents: [{
              uri: request.params?.uri,
              mimeType: 'application/json',
              text: JSON.stringify(response, null, 2)
            }]
          };
        }

        else {
          this.logWarn(`Invalid URI format: ${uri}`, { requestId });
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Invalid URI format: ${uri}`
          );
        }
      } catch (error) {
        const apiError = error as ApiError;
        const errorMessage = apiError.data?.message || apiError.message || 'Unknown error';
        this.logError(`Failed to fetch Metabase resource: ${errorMessage}`, error);

        throw new McpError(
          ErrorCode.InternalError,
          `Metabase API error: ${errorMessage}`
        );
      }
    });
  }

  /**
   * Set up tool handlers
   */
  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      this.logInfo('Processing request to list available tools');
      return {
        tools: [
          {
            name: 'search',
            description: '[RECOMMENDED] Unified search across all Metabase items using native search API. Supports cards, dashboards, tables, collections, databases, and more. Use this FIRST for finding any Metabase content. Returns search metrics, unified recommendations, and clean results organized by model type.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query - searches across names, descriptions, and metadata. Required for database searches.'
                },
                models: {
                  type: 'array',
                  items: {
                    type: 'string',
                    enum: ['card', 'dashboard', 'table', 'dataset', 'segment', 'collection', 'database', 'action', 'indexed-entity', 'metric']
                  },
                  description: 'Model types to search (default: ["card", "dashboard"]). RESTRICTION: "database" model cannot be mixed with others and must be used exclusively.',
                  default: ['card', 'dashboard']
                },
                max_results: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 50)',
                  minimum: 1,
                  maximum: 200,
                  default: 50
                },
                search_native_query: {
                  type: 'boolean',
                  description: 'Search within SQL query content of cards (default: false)',
                  default: false
                },
                include_dashboard_questions: {
                  type: 'boolean',
                  description: 'Include questions within dashboards in results (default: false)',
                  default: false
                },
                ids: {
                  type: 'array',
                  items: { type: 'number' },
                  description: 'Search for specific IDs. RESTRICTIONS: Only works with single model type, cannot be used with "table" or "database" models.'
                },
                archived: {
                  type: 'boolean',
                  description: 'Search archived items only (default: false)'
                },
                database_id: {
                  type: 'number',
                  description: 'Search items from specific database ID. RESTRICTION: Cannot be used when searching for databases (models=["database"]).'
                },
                verified: {
                  type: 'boolean',
                  description: 'Search verified items only (requires premium features)'
                },

              },
              required: []
            }
          },


          {
            name: 'list_databases',
            description: '[FAST] List all databases in Metabase',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },

          {
            name: 'get_dashboard_cards',
            description: '[FAST] Get all cards in a dashboard',
            inputSchema: {
              type: 'object',
              properties: {
                dashboard_id: {
                  type: 'number',
                  description: 'ID of the dashboard'
                }
              },
              required: ['dashboard_id']
            }
          },
          {
            name: 'execute_query',
            description: '[RECOMMENDED] Execute a SQL query against a Metabase database. This is the preferred method for running queries as it provides better control and reliability. Results are limited to improve performance for AI agents - use export_query for larger datasets.',
            inputSchema: {
              type: 'object',
              properties: {
                database_id: {
                  type: 'number',
                  description: 'ID of the database to query'
                },
                query: {
                  type: 'string',
                  description: 'SQL query to execute. You can modify card queries by getting them via get_card_sql first.'
                },
                native_parameters: {
                  type: 'array',
                  items: { type: 'object' },
                  description: 'Optional parameters for the query'
                },
                row_limit: {
                  type: 'number',
                  description: 'Maximum number of rows to return (default: 500, max: 2000). If the query has an existing LIMIT clause that is more restrictive (lower), the existing limit will be preserved. For larger datasets, use export_query instead.',
                  default: 500,
                  minimum: 1,
                  maximum: 2000
                }
              },
              required: ['database_id', 'query']
            }
          },
          {
            name: 'get_card_sql',
            description: '[RECOMMENDED] Get the SQL query and database details from a Metabase card/question. Uses optimized unified caching for maximum efficiency. Use this before execute_query to get the SQL you can modify.',
            inputSchema: {
              type: 'object',
              properties: {
                card_id: {
                  type: 'number',
                  description: 'ID of the card/question to get SQL from'
                }
              },
              required: ['card_id']
            }
          },
          {
            name: 'export_query',
            description: '[ADVANCED] Export large SQL query results using Metabase export endpoints (supports up to 1M rows). Returns data in specified format (CSV, JSON, or XLSX) and automatically saves to Downloads/Metabase folder.',
            inputSchema: {
              type: 'object',
              properties: {
                database_id: {
                  type: 'number',
                  description: 'ID of the database to query'
                },
                query: {
                  type: 'string',
                  description: 'SQL query to execute and export'
                },
                format: {
                  type: 'string',
                  enum: ['csv', 'json', 'xlsx'],
                  description: 'Export format: csv (text), json (structured data), or xlsx (Excel file)',
                  default: 'csv'
                },
                native_parameters: {
                  type: 'array',
                  description: 'Optional parameters for the query',
                  items: {
                    type: 'object'
                  }
                },
                filename: {
                  type: 'string',
                  description: 'Custom filename (without extension) for the saved file. If not provided, a timestamp-based name will be used.'
                }
              },
              required: ['database_id', 'query']
            }
          },
          {
            name: 'clear_cache',
            description: '[UTILITY] Clear the internal cache for cards and dashboards data. Useful for debugging or when you know the data has changed.',
            inputSchema: {
              type: 'object',
              properties: {
                cache_type: {
                  type: 'string',
                  enum: ['all', 'cards', 'dashboards', 'individual', 'bulk'],
                  description: 'Type of cache to clear: "all" (default - clears both cards and dashboards), "cards" (cards only), "dashboards" (dashboards only), "individual" (single card cache), or "bulk" (cards cache metadata)',
                  default: 'all'
                },
                card_id: {
                  type: 'number',
                  description: 'Optional: Clear cache for specific card ID (only works with cache_type="individual")'
                }
              },
              required: []
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params?.name || 'unknown';
      const requestId = generateRequestId();

      this.logInfo(`Processing tool execution request: ${toolName}`, {
        requestId,
        arguments: request.params?.arguments
      });

      await this.apiClient.getSessionToken();

      try {
        switch (request.params?.name) {
        case 'search':
          return handleUnifiedSearch(request, requestId, this.apiClient, this.logDebug.bind(this), this.logInfo.bind(this), this.logWarn.bind(this), this.logError.bind(this));

        case 'list_databases':
          return handleListDatabases(this.apiClient, this.logDebug.bind(this), this.logInfo.bind(this));
        case 'get_card_sql':
          return handleGetCardSql(request, requestId, this.apiClient, this.logDebug.bind(this), this.logInfo.bind(this), this.logWarn.bind(this));

        case 'get_dashboard_cards':
          return handleGetDashboardCards(request, requestId, this.apiClient, this.logDebug.bind(this), this.logInfo.bind(this), this.logWarn.bind(this));
        case 'execute_query':
          return handleExecuteQuery(request, requestId, this.apiClient, this.logDebug.bind(this), this.logInfo.bind(this), this.logWarn.bind(this), this.logError.bind(this));
        case 'export_query':
          return handleExportQuery(request, requestId, this.apiClient, this.logDebug.bind(this), this.logInfo.bind(this), this.logWarn.bind(this), this.logError.bind(this));
        case 'clear_cache':
          return handleClearCache(request, this.apiClient, this.logInfo.bind(this));
        default:
          this.logWarn(`Received request for unknown tool: ${request.params?.name}`, { requestId });
          return {
            content: [
              {
                type: 'text',
                text: `Unknown tool: ${request.params?.name}`
              }
            ],
            isError: true
          };
        }
      } catch (error) {
        const apiError = error as ApiError;
        const errorMessage = apiError.data?.message || apiError.message || 'Unknown error';

        this.logError(`Tool execution failed: ${errorMessage}`, error);
        return {
          content: [{
            type: 'text',
            text: `Metabase API error: ${errorMessage}`
          }],
          isError: true
        };
      }
    });
  }

  async run() {
    try {
      this.logInfo('Starting Metabase MCP server');
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      this.logInfo('Metabase MCP server successfully connected and running on stdio transport');
    } catch (error) {
      this.logFatal('Failed to start Metabase MCP server', error);
      throw error;
    }
  }
}
