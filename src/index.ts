#!/usr/bin/env node

/**
 * Metabase MCP Server - Jericho's Custom Fork
 *
 * Original Author: Hyeongjun Yu (@hyeongjun-dev)
 * Forked & Modified by: Jericho Sequitin (@jerichosequitin)
 *
 * Implements interaction with Metabase API, providing the following functions:
 * - Get dashboard list
 * - Get questions list
 * - Get database list
 * - Execute question queries
 * - Get dashboard details
 * - Search for dashboards and questions
 * - Export query results to CSV, JSON, or XLSX
 * - Get SQL query from a question
 * - Execute a question with parameters
 * - Execute a custom SQL query
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  generateRequestId,
  sanitizeFilename,
  toBooleanSafe,
  generateExportMessage,
  performHybridSearch,
  performExactSearch,
  MinimalCard,
  stripCardFields,
} from './utils.js';

// Custom error enum
enum ErrorCode {
  InternalError = 'internal_error',
  InvalidRequest = 'invalid_request',
  InvalidParams = 'invalid_params',
  MethodNotFound = 'method_not_found'
}

// Custom error class
class McpError extends Error {
  code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'McpError';
  }
}

// API error type definition
interface ApiError {
  status?: number;
  message?: string;
  data?: { message?: string };
}



// Get Metabase configuration from environment variables
const METABASE_URL = process.env.METABASE_URL;
const METABASE_USER_EMAIL = process.env.METABASE_USER_EMAIL;
const METABASE_PASSWORD = process.env.METABASE_PASSWORD;
const METABASE_API_KEY = process.env.METABASE_API_KEY;

if (!METABASE_URL || (!METABASE_API_KEY && (!METABASE_USER_EMAIL || !METABASE_PASSWORD))) {
  throw new Error('METABASE_URL is required, and either METABASE_API_KEY or both METABASE_USER_EMAIL and METABASE_PASSWORD must be provided');
}

// Create custom Schema object using z.object
const ListResourceTemplatesRequestSchema = z.object({
  method: z.literal('resources/list_templates')
});

const ListToolsRequestSchema = z.object({
  method: z.literal('tools/list')
});

// Logger level enum
enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal'
}

// Authentication method enum
enum AuthMethod {
  SESSION = 'session',
  API_KEY = 'api_key'
}

class MetabaseServer {
  private server: Server;
  private baseUrl: string;
  private sessionToken: string | null = null;
  private apiKey: string | null = null;
  private authMethod: AuthMethod = METABASE_API_KEY ? AuthMethod.API_KEY : AuthMethod.SESSION;
  private headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  // Add caching for expensive operations
  private cardsCache: { data: MinimalCard[] | null; timestamp: number | null } = { data: null, timestamp: null };
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache
  private readonly REQUEST_TIMEOUT_MS = 30000; // 30 seconds timeout

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

    this.baseUrl = METABASE_URL!;
    if (METABASE_API_KEY) {
      this.apiKey = METABASE_API_KEY;
      this.logInfo('Using API Key authentication method');
    } else {
      this.logInfo('Using Session Token authentication method');
    }

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
   * HTTP request utility method with timeout support
   */
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const headers = { ...this.headers };

    // Add appropriate authentication headers based on the method
    if (this.authMethod === AuthMethod.API_KEY && this.apiKey) {
      // Use X-API-KEY header as specified in the Metabase documentation
      headers['X-API-KEY'] = this.apiKey;
    } else if (this.authMethod === AuthMethod.SESSION && this.sessionToken) {
      headers['X-Metabase-Session'] = this.sessionToken;
    }

    this.logDebug(`Making request to ${url.toString()}`);
    this.logDebug(`Using headers: ${JSON.stringify(headers)}`);

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url.toString(), {
        ...options,
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = `API request failed with status ${response.status}: ${response.statusText}`;
        this.logWarn(errorMessage, errorData);

        throw {
          status: response.status,
          message: response.statusText,
          data: errorData
        };
      }

      this.logDebug(`Received successful response from ${path}`);
      return response.json() as Promise<T>;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        this.logError(`Request to ${path} timed out after ${this.REQUEST_TIMEOUT_MS}ms`, error);
        throw new McpError(
          ErrorCode.InternalError,
          `Request timed out after ${this.REQUEST_TIMEOUT_MS / 1000} seconds`
        );
      }
      throw error;
    }
  }

  /**
   * Get all cards with caching to prevent repeated expensive API calls
   * Strips unnecessary fields to improve memory usage and performance
   */
  private async getAllCards(): Promise<MinimalCard[]> {
    const now = Date.now();

    // Check if we have cached data that's still valid
    if (this.cardsCache.data && this.cardsCache.timestamp &&
        (now - this.cardsCache.timestamp) < this.CACHE_TTL_MS) {
      this.logDebug(`Using cached cards data (${this.cardsCache.data.length} cards)`);
      return this.cardsCache.data;
    }

    // Cache is invalid or doesn't exist, fetch fresh data
    this.logDebug('Fetching fresh cards data from Metabase API');
    const startTime = Date.now();

    try {
      const rawCards = await this.request<any[]>('/api/card');
      const fetchTime = Date.now() - startTime;

      // Strip unnecessary fields to improve memory usage and performance
      const strippedCards = rawCards.map(stripCardFields);
      const originalSize = JSON.stringify(rawCards).length;
      const strippedSize = JSON.stringify(strippedCards).length;
      const sizeSavings = ((originalSize - strippedSize) / originalSize * 100).toFixed(1);

      // Update cache with stripped data
      this.cardsCache.data = strippedCards;
      this.cardsCache.timestamp = now;

      this.logInfo(`Successfully fetched ${rawCards.length} cards in ${fetchTime}ms`);
      this.logDebug(`Field stripping reduced memory usage by ${sizeSavings}% (${originalSize} → ${strippedSize} bytes)`);
      return strippedCards;
    } catch (error) {
      this.logError('Failed to fetch cards from Metabase API', error);

      // If we have stale cached data, return it as fallback
      if (this.cardsCache.data) {
        this.logWarn('Using stale cached data as fallback due to API error');
        return this.cardsCache.data;
      }

      throw error;
    }
  }

  /**
   * Clear the cards cache (useful for debugging or when data changes)
   */
  private clearCardsCache(): void {
    this.cardsCache.data = null;
    this.cardsCache.timestamp = null;
    this.logDebug('Cards cache cleared');
  }

  /**
   * Get Metabase session token (only needed for session auth method)
   */
  private async getSessionToken(): Promise<string> {
    // If using API Key authentication, return the API key directly
    if (this.authMethod === AuthMethod.API_KEY && this.apiKey) {
      this.logInfo('Using API Key authentication', {
        keyLength: this.apiKey.length,
        keyFormat: this.apiKey.includes('mb_') ? 'starts with mb_' : 'other format'
      });
      return this.apiKey;
    }

    // For session auth, continue with existing logic
    if (this.sessionToken) {
      return this.sessionToken;
    }

    this.logInfo('Initiating authentication with Metabase');
    try {
      const response = await this.request<{ id: string }>('/api/session', {
        method: 'POST',
        body: JSON.stringify({
          username: METABASE_USER_EMAIL,
          password: METABASE_PASSWORD,
        }),
      });

      this.sessionToken = response.id;
      this.logInfo('Successfully authenticated with Metabase');
      return this.sessionToken;
    } catch (error) {
      this.logError('Authentication with Metabase failed', error);
      throw new McpError(
        ErrorCode.InternalError,
        'Failed to authenticate with Metabase'
      );
    }
  }

  /**
   * Set up resource handlers
   */
  private setupResourceHandlers() {
    this.server.setRequestHandler(ListResourcesRequestSchema, async (_request) => {
      this.logInfo('Processing request to list resources', { requestId: generateRequestId() });
      await this.getSessionToken();

      try {
        // Get dashboard list
        this.logDebug('Fetching dashboards from Metabase');
        const dashboardsResponse = await this.request<any[]>('/api/dashboard');

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

      await this.getSessionToken();

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

          const response = await this.request<any>(`/api/dashboard/${dashboardId}`);
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

          const response = await this.request<any>(`/api/card/${cardId}`);
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

          const response = await this.request<any>(`/api/database/${databaseId}`);
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
            name: 'list_dashboards',
            description: 'List all dashboards in Metabase',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'list_cards',
            description: 'List all questions/cards in Metabase',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'list_databases',
            description: 'List all databases in Metabase',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'execute_card',
            description: '[DEPRECATED - Use execute_query instead] Execute a Metabase question/card directly. This method is unreliable and may timeout. Prefer using get_card_sql + execute_query for better control.',
            inputSchema: {
              type: 'object',
              properties: {
                card_id: {
                  type: 'number',
                  description: 'ID of the card/question to execute'
                },
                parameters: {
                  type: 'object',
                  description: 'Optional parameters for the query'
                }
              },
              required: ['card_id']
            }
          },
          {
            name: 'get_dashboard_cards',
            description: 'Get all cards in a dashboard',
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
            description: '[RECOMMENDED] Execute a SQL query against a Metabase database. This is the preferred method for running queries as it provides better control and reliability than execute_card.',
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
                  description: 'Optional parameters for the query',
                  items: {
                    type: 'object'
                  }
                }
              },
              required: ['database_id', 'query']
            }
          },
          {
            name: 'get_card_sql',
            description: '[RECOMMENDED] Get the SQL query and database details from a Metabase card/question. Uses cached data when available for better performance, with API fallback. Use this before execute_query to get the SQL you can modify.',
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
            name: 'search_cards',
            description: '[FAST] Search for questions/cards using Metabase native search API. Searches name, description, and other metadata. For advanced fuzzy matching or SQL content search, use advanced_search_cards.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query - searches across card names, descriptions, and metadata'
                },
                max_results: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 50)',
                  minimum: 1,
                  maximum: 200,
                  default: 50
                }
              },
              required: ['query']
            }
          },
          {
            name: 'search_dashboards',
            description: '[FAST] Search for dashboards using Metabase native search API. Searches name, description, and other metadata. For advanced fuzzy matching, use advanced_search_dashboards.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query - searches across dashboard names, descriptions, and metadata'
                },
                max_results: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 50)',
                  minimum: 1,
                  maximum: 200,
                  default: 50
                }
              },
              required: ['query']
            }
          },
          {
            name: 'advanced_search_cards',
            description: '[ADVANCED] Search for questions/cards by name, description, ID, or query content with intelligent hybrid matching (exact + substring + fuzzy). Slower but more comprehensive than search_cards.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query - can be card name/description, exact ID, or SQL content to search for'
                },
                search_type: {
                  type: 'string',
                  enum: ['auto', 'id', 'exact'],
                  description: "Type of search: 'auto' for intelligent hybrid search (exact + substring + fuzzy), 'id' for exact ID match, 'exact' for exact phrase matching only",
                  default: 'auto'
                },
                fuzzy_threshold: {
                  type: 'number',
                  description: 'Minimum similarity score for fuzzy matching in auto mode (0.0-1.0, default: 0.4). Higher values = stricter matching.',
                  minimum: 0.0,
                  maximum: 1.0,
                  default: 0.4
                },
                max_results: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 50)',
                  minimum: 1,
                  maximum: 200,
                  default: 50
                }
              },
              required: ['query']
            }
          },
          {
            name: 'advanced_search_dashboards',
            description: '[ADVANCED] Search for dashboards by name, description, or ID with intelligent hybrid matching (exact + substring + fuzzy). Slower but more comprehensive than search_dashboards.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query - can be dashboard name/description or exact ID'
                },
                search_type: {
                  type: 'string',
                  enum: ['auto', 'id', 'exact'],
                  description: "Type of search: 'auto' for intelligent hybrid search (exact + substring + fuzzy), 'id' for exact ID match, 'exact' for exact phrase matching only",
                  default: 'auto'
                },
                fuzzy_threshold: {
                  type: 'number',
                  description: 'Minimum similarity score for fuzzy matching in auto mode (0.0-1.0, default: 0.4). Higher values = stricter matching.',
                  minimum: 0.0,
                  maximum: 1.0,
                  default: 0.4
                },
                max_results: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 50)',
                  minimum: 1,
                  maximum: 200,
                  default: 50
                }
              },
              required: ['query']
            }
          },
          {
            name: 'export_query',
            description: 'Export large SQL query results using Metabase export endpoints (supports up to 1M rows vs 2K limit of execute_query). Returns data in specified format (CSV, JSON, or XLSX).',
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
                save_file: {
                  type: 'boolean',
                  description: 'Whether to automatically save the exported data to the Downloads folder',
                  default: false
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
            description: 'Clear the internal cache for cards data. Useful for debugging or when you know the data has changed.',
            inputSchema: {
              type: 'object',
              properties: {
                random_string: {
                  type: 'string',
                  description: 'Dummy parameter for no-parameter tools'
                }
              },
              required: ['random_string']
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

      await this.getSessionToken();

      try {
        switch (request.params?.name) {
        case 'list_dashboards':
          return this._handleListDashboards();
        case 'list_cards':
          return this._handleListCards();
        case 'list_databases':
          return this._handleListDatabases();
        case 'get_card_sql':
          return this._handleGetCardSql(request, requestId);
        case 'execute_card':
          return this._handleExecuteCard(request, requestId);
        case 'get_dashboard_cards':
          return this._handleGetDashboardCards(request, requestId);
        case 'execute_query':
          return this._handleExecuteQuery(request, requestId);
        case 'search_cards':
          return this._handleFastSearchCards(request, requestId);
        case 'search_dashboards':
          return this._handleFastSearchDashboards(request, requestId);
        case 'advanced_search_cards':
          return this._handleAdvancedSearchCards(request, requestId);
        case 'advanced_search_dashboards':
          return this._handleAdvancedSearchDashboards(request, requestId);
        case 'export_query':
          return this._handleExportQuery(request, requestId);
        case 'clear_cache':
          return this._handleClearCache();
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

  private async _handleListDashboards() {
    this.logDebug('Fetching all dashboards from Metabase');
    const response = await this.request<any[]>('/api/dashboard');
    this.logInfo(`Successfully retrieved ${response.length} dashboards`);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  }

  private async _handleListCards() {
    this.logDebug('Fetching all cards/questions from Metabase');
    const response = await this.getAllCards();
    this.logInfo(`Successfully retrieved ${response.length} cards/questions`);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  }

  private async _handleListDatabases() {
    this.logDebug('Fetching all databases from Metabase');
    const response = await this.request<any[]>('/api/database');
    this.logInfo(`Successfully retrieved ${response.length} databases`);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  }

  private async _handleGetCardSql(request: z.infer<typeof CallToolRequestSchema>, requestId: string) {
    const cardId = request.params?.arguments?.card_id as number;
    if (!cardId) {
      this.logWarn('Missing card_id parameter in get_card_sql request', { requestId });
      throw new McpError(
        ErrorCode.InvalidParams,
        'Card ID parameter is required'
      );
    }

    this.logDebug(`Fetching SQL details for card with ID: ${cardId}`);

    let card: any = null;
    let dataSource = 'api_call'; // Track where we got the data from

    // Optimization: First try to get card data from cached cards list
    try {
      const allCards = await this.getAllCards();
      const cachedCard = allCards.find(c => c.id === cardId);

      if (cachedCard) {
        card = cachedCard;
        dataSource = 'cache';
        this.logDebug(`Found card ${cardId} in cached cards list, using cached data`);
      }
    } catch (cacheError) {
      this.logWarn('Failed to retrieve card from cache, falling back to individual API call', { cardId }, cacheError as Error);
    }

    // Fallback: If not found in cache or cache failed, make individual API call
    if (!card) {
      this.logDebug(`Card ${cardId} not found in cache or cache unavailable, making individual API call`);
      card = await this.request<any>(`/api/card/${cardId}`);
      dataSource = 'api_call';
    }

    // Extract relevant information for query execution
    const result: any = {
      card_id: cardId,
      card_name: card.name,
      database_id: card.database_id,
      sql_query: card.dataset_query?.native?.query || null,
      template_tags: card.dataset_query?.native?.template_tags || {},
      query_type: card.dataset_query?.type || 'unknown',
      description: card.description || null,
      collection_id: card.collection_id,
      created_at: card.created_at,
      updated_at: card.updated_at,
      data_source: dataSource // Include info about where data came from
    };

    // Add guidance for AI agents
    if (!result.sql_query) {
      result.message = 'This card does not contain a native SQL query. It may be a GUI-based question.';
    } else {
      result.message = 'Use the database_id and sql_query with execute_query. You can modify the SQL query to add filters or parameters.';
    }

    // Add performance info
    if (dataSource === 'cache') {
      result.performance_note = 'Data retrieved from cached cards list (faster)';
    } else {
      result.performance_note = 'Data retrieved via individual API call (fallback method)';
    }

    this.logInfo(`Successfully retrieved SQL details for card: ${cardId} (source: ${dataSource})`);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  }

  private async _handleExecuteCard(request: z.infer<typeof CallToolRequestSchema>, requestId: string) {
    const cardId = request.params?.arguments?.card_id as number;
    if (!cardId) {
      this.logWarn('Missing card_id parameter in execute_card request', { requestId });
      throw new McpError(
        ErrorCode.InvalidParams,
        'Card ID parameter is required'
      );
    }

    this.logDebug(`Executing card with ID: ${cardId}`);
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

    const response = await this.request<any>(`/api/card/${cardId}/query`, {
      method: 'POST',
      body: JSON.stringify({ parameters: formattedParameters })
    });

    this.logInfo(`Successfully executed card: ${cardId}`);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  }

  private async _handleGetDashboardCards(request: z.infer<typeof CallToolRequestSchema>, requestId: string) {
    const dashboardId = request.params?.arguments?.dashboard_id;
    if (!dashboardId) {
      this.logWarn('Missing dashboard_id parameter in get_dashboard_cards request', { requestId });
      throw new McpError(
        ErrorCode.InvalidParams,
        'Dashboard ID parameter is required'
      );
    }

    this.logDebug(`Fetching cards for dashboard with ID: ${dashboardId}`);
    const response = await this.request<any>(`/api/dashboard/${dashboardId}`);

    const cardCount = response.cards?.length || 0;
    this.logInfo(`Successfully retrieved ${cardCount} cards from dashboard: ${dashboardId}`);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.cards, null, 2)
      }]
    };
  }

  private async _handleExecuteQuery(request: z.infer<typeof CallToolRequestSchema>, requestId: string) {
    const databaseId = request.params?.arguments?.database_id;
    const query = request.params?.arguments?.query;
    const nativeParameters = request.params?.arguments?.native_parameters || [];

    if (!databaseId) {
      this.logWarn('Missing database_id parameter in execute_query request', { requestId });
      throw new McpError(
        ErrorCode.InvalidParams,
        'Database ID parameter is required'
      );
    }

    if (!query) {
      this.logWarn('Missing query parameter in execute_query request', { requestId });
      throw new McpError(
        ErrorCode.InvalidParams,
        'SQL query parameter is required'
      );
    }

    this.logDebug(`Executing SQL query against database ID: ${databaseId}`);

    // Build query request body
    const queryData = {
      type: 'native',
      native: {
        query: query,
        template_tags: {}
      },
      parameters: nativeParameters,
      database: databaseId
    };

    const response = await this.request<any>('/api/dataset', {
      method: 'POST',
      body: JSON.stringify(queryData)
    });

    this.logInfo(`Successfully executed SQL query against database: ${databaseId}`);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  }

  private async _handleFastSearchCards(request: z.infer<typeof CallToolRequestSchema>, requestId: string) {
    const searchQuery = request.params?.arguments?.query as string;
    const maxResults = (request.params?.arguments?.max_results as number) || 50;

    if (!searchQuery) {
      this.logWarn('Missing query parameter in fast search_cards request', { requestId });
      throw new McpError(
        ErrorCode.InvalidParams,
        'Search query parameter is required'
      );
    }

    this.logDebug(`Fast searching for cards with query: "${searchQuery}"`);

    const searchStartTime = Date.now();

    try {
      // Use Metabase's native search API
      const searchParams = new URLSearchParams({
        q: searchQuery,
        models: 'card' // Only search for cards/questions
      });

      const response = await this.request<any>(`/api/search?${searchParams.toString()}`);
      const searchTime = Date.now() - searchStartTime;

      // Extract cards from search results and limit results
      let cards = response.data || response || [];
      if (Array.isArray(cards)) {
        cards = cards.filter((item: any) => item.model === 'card').slice(0, maxResults);
      } else {
        cards = [];
      }

      // Enhance results with additional metadata
      const enhancedResults = cards.map((card: any) => ({
        id: card.id,
        name: card.name,
        description: card.description,
        collection_name: card.collection_name,
        database_id: card.database_id,
        created_at: card.created_at,
        updated_at: card.updated_at,
        model: card.model,
        search_context: card.context || null,
        recommended_action: `Use get_card_sql(${card.id}) then execute_query() for reliable execution`
      }));

      this.logInfo(`Fast search found ${enhancedResults.length} cards in ${searchTime}ms`);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            search_query: searchQuery,
            search_method: 'native_metabase_api',
            total_results: enhancedResults.length,
            performance_info: {
              search_time_ms: searchTime,
              api_endpoint: '/api/search',
              search_method: 'server_side_native'
            },
            recommended_workflow: 'For cards: 1) Use get_card_sql() to get the SQL, 2) Modify if needed, 3) Use execute_query()',
            note: 'This uses Metabase native search API for fast results. For advanced fuzzy matching or SQL content search, use advanced_search_cards.',
            results: enhancedResults
          }, null, 2)
        }]
      };
    } catch (error) {
      this.logError('Fast search failed, this may indicate the search API is not available', error);
      throw new McpError(
        ErrorCode.InternalError,
        'Fast search failed. The search API may not be available in this Metabase version.'
      );
    }
  }

  private async _handleFastSearchDashboards(request: z.infer<typeof CallToolRequestSchema>, requestId: string) {
    const searchQuery = request.params?.arguments?.query as string;
    const maxResults = (request.params?.arguments?.max_results as number) || 50;

    if (!searchQuery) {
      this.logWarn('Missing query parameter in fast search_dashboards request', { requestId });
      throw new McpError(
        ErrorCode.InvalidParams,
        'Search query parameter is required'
      );
    }

    this.logDebug(`Fast searching for dashboards with query: "${searchQuery}"`);

    const searchStartTime = Date.now();

    try {
      // Use Metabase's native search API
      const searchParams = new URLSearchParams({
        q: searchQuery,
        models: 'dashboard' // Only search for dashboards
      });

      const response = await this.request<any>(`/api/search?${searchParams.toString()}`);
      const searchTime = Date.now() - searchStartTime;

      // Extract dashboards from search results and limit results
      let dashboards = response.data || response || [];
      if (Array.isArray(dashboards)) {
        dashboards = dashboards.filter((item: any) => item.model === 'dashboard').slice(0, maxResults);
      } else {
        dashboards = [];
      }

      // Enhance results with additional metadata
      const enhancedResults = dashboards.map((dashboard: any) => ({
        id: dashboard.id,
        name: dashboard.name,
        description: dashboard.description,
        collection_name: dashboard.collection_name,
        created_at: dashboard.created_at,
        updated_at: dashboard.updated_at,
        model: dashboard.model,
        search_context: dashboard.context || null,
        recommended_action: `Use get_dashboard_cards(${dashboard.id}) to get dashboard details`
      }));

      this.logInfo(`Fast search found ${enhancedResults.length} dashboards in ${searchTime}ms`);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            search_query: searchQuery,
            search_method: 'native_metabase_api',
            total_results: enhancedResults.length,
            performance_info: {
              search_time_ms: searchTime,
              api_endpoint: '/api/search',
              search_method: 'server_side_native'
            },
            note: 'This uses Metabase native search API for fast results. For advanced fuzzy matching, use advanced_search_dashboards.',
            results: enhancedResults
          }, null, 2)
        }]
      };
    } catch (error) {
      this.logError('Fast dashboard search failed, this may indicate the search API is not available', error);
      throw new McpError(
        ErrorCode.InternalError,
        'Fast search failed. The search API may not be available in this Metabase version.'
      );
    }
  }

  private async _handleAdvancedSearchCards(request: z.infer<typeof CallToolRequestSchema>, requestId: string) {
    const searchQuery = request.params?.arguments?.query as string;
    const searchType = (request.params?.arguments?.search_type as string) || 'auto';
    const fuzzyThreshold = (request.params?.arguments?.fuzzy_threshold as number) || 0.4;
    const maxResults = (request.params?.arguments?.max_results as number) || 50;

    if (!searchQuery) {
      this.logWarn('Missing query parameter in search_cards request', { requestId });
      throw new McpError(
        ErrorCode.InvalidParams,
        'Search query parameter is required'
      );
    }

    this.logDebug(`Searching for cards with query: "${searchQuery}" (type: ${searchType}, fuzzy_threshold: ${fuzzyThreshold})`);

    // Fetch all cards using cached method
    const fetchStartTime = Date.now();
    const allCards = await this.getAllCards();
    const fetchTime = Date.now() - fetchStartTime;

    let results: any[] = [];
    const searchStartTime = Date.now();

    // Determine search type
    const isNumeric = /^\d+$/.test(searchQuery.trim());
    let effectiveSearchType = searchType;

    if (searchType === 'auto') {
      // Auto-detect search type based on query content
      if (isNumeric) {
        effectiveSearchType = 'id';
      } else {
        // Default to intelligent hybrid search
        effectiveSearchType = 'auto';
      }
    }

    if (effectiveSearchType === 'id') {
      const targetId = parseInt(searchQuery.trim(), 10);
      results = allCards.filter(card => card.id === targetId);
      this.logInfo(`Found ${results.length} cards matching ID: ${targetId}`);
    } else if (effectiveSearchType === 'exact') {
      // Exact phrase search
      const exactResults = performExactSearch(
        allCards,
        searchQuery,
        (card) => ({
          name: card.name,
          description: card.description,
          sql: card.dataset_query?.native?.query
        }),
        maxResults
      );
      results = exactResults;
      this.logInfo(`Found ${results.length} cards with exact phrase matching: "${searchQuery}"`);
    } else {
      // Auto: Intelligent hybrid search (exact + substring + fuzzy)
      const hybridResults = performHybridSearch(
        allCards,
        searchQuery,
        (card) => ({
          name: card.name,
          description: card.description,
          sql: card.dataset_query?.native?.query
        }),
        fuzzyThreshold,
        maxResults
      );
      results = hybridResults;
      this.logInfo(`Found ${results.length} cards using intelligent hybrid search (exact + substring + fuzzy)`);
    }

    const searchTime = Date.now() - searchStartTime;

    // Enhance results with SQL preview and search matching info
    const enhancedResults = results.map(card => {
      const baseCard = {
        ...card,
        has_sql: !!(card.dataset_query?.native?.query),
        sql_preview: card.dataset_query?.native?.query ?
          card.dataset_query.native.query.substring(0, 200) + (card.dataset_query.native.query.length > 200 ? '...' : '') :
          null,
        recommended_action: card.dataset_query?.native?.query ?
          `Use get_card_sql(${card.id}) then execute_query() for reliable execution` :
          'This card uses GUI query builder - execute_card may be needed'
      };

      // Add search matching info based on search type
      if (effectiveSearchType === 'auto' && 'search_score' in card) {
        return {
          ...baseCard,
          search_score: card.search_score,
          match_type: card.match_type,
          matched_field: card.matched_field,
          match_quality: card.search_score > 0.9 ? 'excellent' :
            card.search_score > 0.8 ? 'very good' :
              card.search_score > 0.6 ? 'good' : 'moderate'
        };
      } else if (effectiveSearchType === 'exact' && 'matched_field' in card) {
        return {
          ...baseCard,
          matched_field: card.matched_field,
          match_type: 'exact'
        };
      }

      return baseCard;
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          search_query: searchQuery,
          search_type: effectiveSearchType,
          fuzzy_threshold: effectiveSearchType === 'fuzzy' ? fuzzyThreshold : undefined,
          total_results: results.length,
          performance_info: {
            fetch_time_ms: fetchTime,
            search_time_ms: searchTime,
            total_cards_searched: allCards.length,
            cache_used: fetchTime < 1000, // Assume cache was used if fetch was very fast
            search_method_used: effectiveSearchType
          },
          recommended_workflow: 'For cards with SQL: 1) Use get_card_sql() to get the SQL, 2) Modify if needed, 3) Use execute_query()',
          search_info: effectiveSearchType === 'auto' ? {
            explanation: 'Intelligent hybrid search combining exact matches, substring matches, and fuzzy matching. Results ranked by relevance score.',
            fuzzy_threshold_used: fuzzyThreshold,
            scoring: 'excellent (>0.9), very good (0.8-0.9), good (0.6-0.8), moderate (0.4-0.6)',
            fields_searched: ['name', 'description', 'sql_content'],
            match_types: ['exact', 'substring', 'fuzzy']
          } : effectiveSearchType === 'exact' ? {
            explanation: 'Exact phrase matching across all searchable fields.',
            fields_searched: ['name', 'description', 'sql_content']
          } : undefined,
          results: enhancedResults
        }, null, 2)
      }]
    };
  }

  private async _handleAdvancedSearchDashboards(request: z.infer<typeof CallToolRequestSchema>, requestId: string) {
    const searchQuery = request.params?.arguments?.query as string;
    const searchType = (request.params?.arguments?.search_type as string) || 'auto';
    const fuzzyThreshold = (request.params?.arguments?.fuzzy_threshold as number) || 0.4;
    const maxResults = (request.params?.arguments?.max_results as number) || 50;

    if (!searchQuery) {
      this.logWarn('Missing query parameter in search_dashboards request', { requestId });
      throw new McpError(
        ErrorCode.InvalidParams,
        'Search query parameter is required'
      );
    }

    this.logDebug(`Searching for dashboards with query: "${searchQuery}" (type: ${searchType}, fuzzy_threshold: ${fuzzyThreshold})`);

    // Fetch all dashboards first
    const fetchStartTime = Date.now();
    const allDashboards = await this.request<any[]>('/api/dashboard');
    const fetchTime = Date.now() - fetchStartTime;

    let results: any[] = [];
    const searchStartTime = Date.now();

    // Determine search type
    const isNumeric = /^\d+$/.test(searchQuery.trim());
    let effectiveSearchType = searchType;

    if (searchType === 'auto') {
      // Auto-detect search type based on query content
      if (isNumeric) {
        effectiveSearchType = 'id';
      } else {
        // Default to intelligent hybrid search
        effectiveSearchType = 'auto';
      }
    }

    if (effectiveSearchType === 'id') {
      const targetId = parseInt(searchQuery.trim(), 10);
      results = allDashboards.filter(dashboard => dashboard.id === targetId);
      this.logInfo(`Found ${results.length} dashboards matching ID: ${targetId}`);
    } else if (effectiveSearchType === 'exact') {
      // Exact phrase search
      const exactResults = performExactSearch(
        allDashboards,
        searchQuery,
        (dashboard) => ({
          name: dashboard.name,
          description: dashboard.description
        }),
        maxResults
      );
      results = exactResults;
      this.logInfo(`Found ${results.length} dashboards with exact phrase matching: "${searchQuery}"`);
    } else {
      // Auto: Intelligent hybrid search (exact + substring + fuzzy)
      const hybridResults = performHybridSearch(
        allDashboards,
        searchQuery,
        (dashboard) => ({
          name: dashboard.name,
          description: dashboard.description
        }),
        fuzzyThreshold,
        maxResults
      );
      results = hybridResults;
      this.logInfo(`Found ${results.length} dashboards using intelligent hybrid search (exact + substring + fuzzy)`);
    }

    const searchTime = Date.now() - searchStartTime;

    // Enhance results with search matching info
    const enhancedResults = results.map(dashboard => {
      const baseDashboard = { ...dashboard };

      // Add search matching info based on search type
      if (effectiveSearchType === 'auto' && 'search_score' in dashboard) {
        return {
          ...baseDashboard,
          search_score: dashboard.search_score,
          match_type: dashboard.match_type,
          matched_field: dashboard.matched_field,
          match_quality: dashboard.search_score > 0.9 ? 'excellent' :
            dashboard.search_score > 0.8 ? 'very good' :
              dashboard.search_score > 0.6 ? 'good' : 'moderate'
        };
      } else if (effectiveSearchType === 'exact' && 'matched_field' in dashboard) {
        return {
          ...baseDashboard,
          matched_field: dashboard.matched_field,
          match_type: 'exact'
        };
      }

      return baseDashboard;
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          search_query: searchQuery,
          search_type: effectiveSearchType,
          fuzzy_threshold: effectiveSearchType === 'fuzzy' ? fuzzyThreshold : undefined,
          total_results: results.length,
          performance_info: {
            fetch_time_ms: fetchTime,
            search_time_ms: searchTime,
            total_dashboards_searched: allDashboards.length,
            search_method_used: effectiveSearchType
          },
          search_info: effectiveSearchType === 'auto' ? {
            explanation: 'Intelligent hybrid search combining exact matches, substring matches, and fuzzy matching. Results ranked by relevance score.',
            fuzzy_threshold_used: fuzzyThreshold,
            scoring: 'excellent (>0.9), very good (0.8-0.9), good (0.6-0.8), moderate (0.4-0.6)',
            fields_searched: ['name', 'description'],
            match_types: ['exact', 'substring', 'fuzzy']
          } : effectiveSearchType === 'exact' ? {
            explanation: 'Exact phrase matching across all searchable fields.',
            fields_searched: ['name', 'description']
          } : undefined,
          results: enhancedResults
        }, null, 2)
      }]
    };
  }

  private async _handleExportQuery(request: z.infer<typeof CallToolRequestSchema>, requestId: string) {
    const databaseId = request.params?.arguments?.database_id as number;
    const query = request.params?.arguments?.query as string;
    const format = (request.params?.arguments?.format as string) || 'csv';
    const nativeParameters = request.params?.arguments?.native_parameters || [];
    const saveFile = toBooleanSafe(request.params?.arguments?.save_file);
    const customFilename = request.params?.arguments?.filename as string;

    if (!databaseId) {
      this.logWarn('Missing database_id parameter in export_query request', { requestId });
      throw new McpError(
        ErrorCode.InvalidParams,
        'Database ID parameter is required'
      );
    }

    if (!query) {
      this.logWarn('Missing query parameter in export_query request', { requestId });
      throw new McpError(
        ErrorCode.InvalidParams,
        'SQL query parameter is required'
      );
    }

    if (!['csv', 'json', 'xlsx'].includes(format)) {
      this.logWarn(`Invalid format parameter in export_query request: ${format}`, { requestId });
      throw new McpError(
        ErrorCode.InvalidParams,
        'Format must be one of: csv, json, xlsx'
      );
    }

    this.logDebug(`Exporting query in ${format} format from database ID: ${databaseId}`);

    try {
      // Build query request body according to Metabase export API requirements
      const queryData = {
        type: 'native',
        native: {
          query: query,
          template_tags: {}
        },
        parameters: nativeParameters,
        database: databaseId
      };

      // Use the export endpoint which supports larger result sets (up to 1M rows)
      const exportEndpoint = `/api/dataset/${format}`;

      // Build the request body with required parameters as per API documentation
      const requestBody = {
        query: queryData,
        format_rows: false,
        pivot_results: false,
        visualization_settings: {}
      };

      // For export endpoints, we need to handle different response types
      const url = new URL(exportEndpoint, this.baseUrl);
      const headers = { ...this.headers };

      // Add appropriate authentication headers
      if (this.authMethod === AuthMethod.API_KEY && this.apiKey) {
        headers['X-API-KEY'] = this.apiKey;
      } else if (this.authMethod === AuthMethod.SESSION && this.sessionToken) {
        headers['X-Metabase-Session'] = this.sessionToken;
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = `Export API request failed with status ${response.status}: ${response.statusText}`;
        this.logWarn(errorMessage, errorData);
        throw {
          status: response.status,
          message: response.statusText,
          data: errorData
        };
      }

      // Handle different response types based on format
      let responseData;
      if (format === 'json') {
        responseData = await response.json();
      } else if (format === 'csv') {
        // For CSV, get as text
        responseData = await response.text();
      } else if (format === 'xlsx') {
        // For XLSX, get as buffer for binary data
        responseData = await response.arrayBuffer();
      } else {
        // Fallback to text
        responseData = await response.text();
      }

      this.logInfo(`Successfully exported query in ${format} format from database: ${databaseId}`);

      if (format === 'json') {
        // Count rows for user info (JSON format has different structure)
        const rowCount = responseData?.data?.rows?.length || 0;
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const sanitizedCustomFilename = sanitizeFilename(customFilename);
        const baseFilename = sanitizedCustomFilename || `metabase_export_${timestamp}`;
        const filename = `${baseFilename}.json`;

        let fileSaveError: string | undefined;
        let savedFilePath = '';

        // Save file if requested
        if (saveFile) {
          try {
            // Get Downloads directory path
            const downloadsPath = path.join(os.homedir(), 'Downloads');
            savedFilePath = path.join(downloadsPath, filename);

            // Ensure Downloads directory exists
            if (!fs.existsSync(downloadsPath)) {
              fs.mkdirSync(downloadsPath, { recursive: true });
            }

            // Write the JSON file
            fs.writeFileSync(savedFilePath, JSON.stringify(responseData, null, 2), 'utf8');
          } catch (error) {
            fileSaveError = error instanceof Error ? error.message : 'Unknown error';
          }
        }

        const baseMessage = generateExportMessage(
          format,
          query,
          databaseId,
          rowCount,
          '',
          saveFile,
          savedFilePath,
          filename,
          fileSaveError
        );

        return {
          content: [{
            type: 'text',
            text: baseMessage + JSON.stringify(responseData, null, 2) + '\n```\n\nSuccess: Exported ' + rowCount.toLocaleString() + ' rows using Metabase\'s high-capacity export endpoint.\nAdvantage: This method supports up to 1 million rows vs. the 2,000 row limit of standard queries.'
          }]
        };
      } else if (format === 'csv') {
        // Count rows for user info
        const rows = responseData.split('\n').filter((row: string) => row.trim());
        const rowCount = Math.max(0, rows.length - 1); // Subtract header row
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const sanitizedCustomFilename = sanitizeFilename(customFilename);
        const baseFilename = sanitizedCustomFilename || `metabase_export_${timestamp}`;
        const filename = `${baseFilename}.csv`;

        let fileSaveError: string | undefined;
        let savedFilePath = '';

        // Save file if requested
        if (saveFile) {
          try {
            // Get Downloads directory path
            const downloadsPath = path.join(os.homedir(), 'Downloads');
            savedFilePath = path.join(downloadsPath, filename);

            // Ensure Downloads directory exists
            if (!fs.existsSync(downloadsPath)) {
              fs.mkdirSync(downloadsPath, { recursive: true });
            }

            // Write the CSV file
            fs.writeFileSync(savedFilePath, responseData, 'utf8');
          } catch (error) {
            fileSaveError = error instanceof Error ? error.message : 'Unknown error';
          }
        }

        const baseMessage = generateExportMessage(
          format,
          query,
          databaseId,
          rowCount,
          '',
          saveFile,
          savedFilePath,
          filename,
          fileSaveError
        );

        return {
          content: [{
            type: 'text',
            text: baseMessage + responseData + '\n```\n\nSuccess: Exported ' + rowCount.toLocaleString() + ' rows using Metabase\'s high-capacity export endpoint.\nAdvantage: This method supports up to 1 million rows vs. the 2,000 row limit of standard queries.'
          }]
        };
      } else {
        // For XLSX format, handle binary data
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const sanitizedCustomFilename = sanitizeFilename(customFilename);
        const baseFilename = sanitizedCustomFilename || `metabase_export_${timestamp}`;
        const filename = `${baseFilename}.xlsx`;

        let fileSaveError: string | undefined;
        let savedFilePath = '';
        let fileSize = 'Unknown';

        // Save file if requested
        if (saveFile) {
          try {
            // Get Downloads directory path
            const downloadsPath = path.join(os.homedir(), 'Downloads');
            savedFilePath = path.join(downloadsPath, filename);

            // Ensure Downloads directory exists
            if (!fs.existsSync(downloadsPath)) {
              fs.mkdirSync(downloadsPath, { recursive: true });
            }

            // For XLSX, we need to handle binary data properly
            // The response should be an ArrayBuffer
            if (responseData instanceof ArrayBuffer) {
              // Convert ArrayBuffer to Buffer for Node.js file writing
              const buffer = Buffer.from(responseData);
              fs.writeFileSync(savedFilePath, buffer);
              fileSize = buffer.length.toLocaleString();
            } else {
              // Fallback for other data types
              fs.writeFileSync(savedFilePath, responseData);
              fileSize = 'Unknown size';
            }
          } catch (error) {
            fileSaveError = error instanceof Error ? error.message : 'Unknown error';
          }
        } else {
          if (responseData instanceof ArrayBuffer) {
            fileSize = responseData.byteLength.toLocaleString();
          } else {
            fileSize = 'Unknown size';
          }
        }

        const baseMessage = generateExportMessage(
          format,
          query,
          databaseId,
          0, // XLSX doesn't have easy row counting
          fileSize,
          saveFile,
          savedFilePath,
          filename,
          fileSaveError
        );

        return {
          content: [{
            type: 'text',
            text: baseMessage + '\n\nSuccess: Excel file exported using Metabase\'s high-capacity export endpoint.\nAdvantage: This method supports up to 1 million rows vs. the 2,000 row limit of standard queries.'
          }]
        };
      }
    } catch (error) {
      const apiError = error as ApiError;
      const errorMessage = apiError.data?.message || apiError.message || 'Unknown error';

      this.logError(`Failed to export query in ${format} format: ${errorMessage}`, error);
      return {
        content: [{
          type: 'text',
          text: `Failed to export query in ${format} format: ${errorMessage}\n\nNote: Make sure your query is valid and the database connection is working. The export endpoint supports up to 1 million rows.`
        }],
        isError: true
      };
    }
  }

  private _handleClearCache() {
    this.logDebug('Clearing cards cache');
    this.clearCardsCache();
    this.logInfo('Cards cache cleared successfully');

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          message: 'Cards cache cleared successfully',
          cache_status: 'empty',
          next_fetch_will_be: 'fresh from API'
        }, null, 2)
      }]
    };
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

// Add global error handlers
process.on('uncaughtException', (error: Error) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'fatal',
    message: 'Uncaught exception detected',
    error: error.message,
    stack: error.stack
  }));
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown, _promise: Promise<unknown>) => {
  const errorMessage = reason instanceof Error ? reason.message : String(reason);
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'fatal',
    message: 'Unhandled promise rejection detected',
    error: errorMessage
  }));
});

const server = new MetabaseServer();
server.run().catch(error => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'fatal',
    message: 'Fatal error during server startup',
    error: error instanceof Error ? error.message : String(error)
  }));
  process.exit(1);
});
