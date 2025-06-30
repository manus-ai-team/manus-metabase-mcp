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
   * HTTP request utility method
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

    const response = await fetch(url.toString(), {
      ...options,
      headers
    });

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
      this.logInfo('Processing request to list resources', { requestId: this.generateRequestId() });
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
      const requestId = this.generateRequestId();
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
   * Generate a unique request ID
   */
  private generateRequestId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  /**
   * Generate standardized export result message
   */
  private generateExportMessage(
    format: string,
    query: string,
    databaseId: number,
    rowCount: number,
    fileSize: string,
    saveFile: boolean,
    savedFilePath: string,
    filename: string,
    fileSaveError?: string
  ): string {
    const queryPreview = query.length > 100 ? `${query.substring(0, 100)}...` : query;

    let statusMessage = '';
    if (saveFile) {
      if (fileSaveError) {
        statusMessage = `\nFile Save Status: FAILED - ${fileSaveError}\nFallback: Use manual copy-paste method below\n`;
      } else {
        statusMessage = `\nFile Save Status: SUCCESS\nFile Location: ${savedFilePath}\nDownloads Folder: Available for use\n`;
      }
    }

    const formatUpper = format.toUpperCase();

    return `# Query Export Results (${formatUpper} Format)

Query: ${queryPreview}
Database ID: ${databaseId}
${format === 'xlsx' ? `File Size: ${fileSize} bytes` : `Rows Exported: ${rowCount.toLocaleString()}`}
Export Method: Metabase high-capacity API (supports up to 1M rows)${statusMessage}

## Manual Save Instructions${saveFile && !fileSaveError ? ' (Alternative Method)' : ''}:

1. Select all the ${formatUpper} content below${format === 'csv' ? ' (between the ```csv markers)' : ''}
2. Copy the selected text (Cmd+C / Ctrl+C)
3. Open a ${format === 'xlsx' ? 'spreadsheet application' : format === 'json' ? 'text editor' : 'text editor or spreadsheet application'}
4. Paste the content (Cmd+V / Ctrl+V)
5. Save as: ${filename}

## ${formatUpper} Data:

${format === 'xlsx' ?
    `Excel file exported successfully. ${saveFile && !fileSaveError ?
      `File has been saved to: ${savedFilePath}\nCompatible with: Excel, Google Sheets, LibreOffice Calc, and other spreadsheet applications` :
      'To save this Excel file:\n1. Set save_file: true in your export_query parameters\n2. The file will be automatically saved to your Downloads folder\n3. Open with Excel, Google Sheets, or any spreadsheet application'
    }\n\nTechnical Details:\n- Binary Data: Contains Excel binary data (.xlsx format)\n- High Capacity: Supports up to 1 million rows (vs. 2,000 row limit of standard queries)\n- Native Format: Preserves data types and formatting for spreadsheet applications` :
    '```' + format + '\n'
}`;
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
            description: '[RECOMMENDED] Get the SQL query and database details from a Metabase card/question. Use this before execute_query to get the SQL you can modify.',
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
            description: 'Search for questions/cards by name, ID, or query content',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query - can be card name (partial match), exact ID, or SQL content to search for'
                },
                search_type: {
                  type: 'string',
                  enum: ['name', 'id', 'content', 'auto'],
                  description: "Type of search: 'name' for name search, 'id' for exact ID match, 'content' for SQL content search, 'auto' to auto-detect",
                  default: 'auto'
                }
              },
              required: ['query']
            }
          },
          {
            name: 'search_dashboards',
            description: 'Search for dashboards by name or ID',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query - can be dashboard name (partial match) or exact ID'
                },
                search_type: {
                  type: 'string',
                  enum: ['name', 'id', 'auto'],
                  description: "Type of search: 'name' for name search, 'id' for exact ID match, 'auto' to auto-detect",
                  default: 'auto'
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
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params?.name || 'unknown';
      const requestId = this.generateRequestId();

      this.logInfo(`Processing tool execution request: ${toolName}`, {
        requestId,
        toolName,
        arguments: request.params?.arguments
      });

      await this.getSessionToken();

      try {
        switch (request.params?.name) {
        case 'list_dashboards': {
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

        case 'list_cards': {
          this.logDebug('Fetching all cards/questions from Metabase');
          const response = await this.request<any[]>('/api/card');
          this.logInfo(`Successfully retrieved ${response.length} cards/questions`);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(response, null, 2)
            }]
          };
        }

        case 'list_databases': {
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

        case 'get_card_sql': {
          const cardId = request.params?.arguments?.card_id as number;
          if (!cardId) {
            this.logWarn('Missing card_id parameter in get_card_sql request', { requestId });
            throw new McpError(
              ErrorCode.InvalidParams,
              'Card ID parameter is required'
            );
          }

          this.logDebug(`Fetching SQL details for card with ID: ${cardId}`);
          const card = await this.request<any>(`/api/card/${cardId}`);

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
            updated_at: card.updated_at
          };

          // Add guidance for AI agents
          if (!result.sql_query) {
            result.message = 'This card does not contain a native SQL query. It may be a GUI-based question.';
          } else {
            result.message = 'Use the database_id and sql_query with execute_query. You can modify the SQL query to add filters or parameters.';
          }

          this.logInfo(`Successfully retrieved SQL details for card: ${cardId}`);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          };
        }

        case 'execute_card': {
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

        case 'get_dashboard_cards': {
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

        case 'execute_query': {
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

        case 'search_cards': {
          const searchQuery = request.params?.arguments?.query as string;
          const searchType = (request.params?.arguments?.search_type as string) || 'auto';

          if (!searchQuery) {
            this.logWarn('Missing query parameter in search_cards request', { requestId });
            throw new McpError(
              ErrorCode.InvalidParams,
              'Search query parameter is required'
            );
          }

          this.logDebug(`Searching for cards with query: "${searchQuery}" (type: ${searchType})`);

          // Fetch all cards first
          const allCards = await this.request<any[]>('/api/card');

          let results: any[] = [];

          // Determine search type
          const isNumeric = /^\d+$/.test(searchQuery.trim());
          let effectiveSearchType = searchType;

          if (searchType === 'auto') {
            // Auto-detect search type based on query content
            if (isNumeric) {
              effectiveSearchType = 'id';
            } else if (/\b(SELECT|FROM|WHERE|JOIN|INSERT|UPDATE|DELETE|WITH)\b/i.test(searchQuery)) {
              effectiveSearchType = 'content';
            } else {
              effectiveSearchType = 'name';
            }
          }

          if (effectiveSearchType === 'id') {
            const targetId = parseInt(searchQuery.trim(), 10);
            results = allCards.filter(card => card.id === targetId);
            this.logInfo(`Found ${results.length} cards matching ID: ${targetId}`);
          } else if (effectiveSearchType === 'content') {
            // Content search (case-insensitive partial match in SQL query)
            const searchTerm = searchQuery.toLowerCase().trim();
            results = allCards.filter(card => {
              // Check if card has a dataset_query with native SQL
              if (card.dataset_query?.native?.query) {
                const sqlQuery = card.dataset_query.native.query.toLowerCase();
                return sqlQuery.includes(searchTerm);
              }
              return false;
            });
            this.logInfo(`Found ${results.length} cards with SQL content matching: "${searchQuery}"`);
          } else {
            // Name search (case-insensitive partial match)
            const searchTerm = searchQuery.toLowerCase().trim();
            results = allCards.filter(card =>
              card.name && card.name.toLowerCase().includes(searchTerm)
            );
            this.logInfo(`Found ${results.length} cards matching name pattern: "${searchQuery}"`);
          }

          // Enhance results with SQL preview for better AI agent guidance
          const enhancedResults = results.map(card => ({
            ...card,
            has_sql: !!(card.dataset_query?.native?.query),
            sql_preview: card.dataset_query?.native?.query ?
              card.dataset_query.native.query.substring(0, 200) + (card.dataset_query.native.query.length > 200 ? '...' : '') :
              null,
            recommended_action: card.dataset_query?.native?.query ?
              `Use get_card_sql(${card.id}) then execute_query() for reliable execution` :
              'This card uses GUI query builder - execute_card may be needed'
          }));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                search_query: searchQuery,
                search_type: effectiveSearchType,
                total_results: results.length,
                recommended_workflow: 'For cards with SQL: 1) Use get_card_sql() to get the SQL, 2) Modify if needed, 3) Use execute_query()',
                results: enhancedResults
              }, null, 2)
            }]
          };
        }

        case 'search_dashboards': {
          const searchQuery = request.params?.arguments?.query as string;
          const searchType = (request.params?.arguments?.search_type as string) || 'auto';

          if (!searchQuery) {
            this.logWarn('Missing query parameter in search_dashboards request', { requestId });
            throw new McpError(
              ErrorCode.InvalidParams,
              'Search query parameter is required'
            );
          }

          this.logDebug(`Searching for dashboards with query: "${searchQuery}" (type: ${searchType})`);

          // Fetch all dashboards first
          const allDashboards = await this.request<any[]>('/api/dashboard');

          let results: any[] = [];

          // Determine search type
          const isNumeric = /^\d+$/.test(searchQuery.trim());
          const effectiveSearchType = searchType === 'auto' ? (isNumeric ? 'id' : 'name') : searchType;

          if (effectiveSearchType === 'id') {
            const targetId = parseInt(searchQuery.trim(), 10);
            results = allDashboards.filter(dashboard => dashboard.id === targetId);
            this.logInfo(`Found ${results.length} dashboards matching ID: ${targetId}`);
          } else {
            // Name search (case-insensitive partial match)
            const searchTerm = searchQuery.toLowerCase().trim();
            results = allDashboards.filter(dashboard =>
              dashboard.name && dashboard.name.toLowerCase().includes(searchTerm)
            );
            this.logInfo(`Found ${results.length} dashboards matching name pattern: "${searchQuery}"`);
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                search_query: searchQuery,
                search_type: effectiveSearchType,
                total_results: results.length,
                results: results
              }, null, 2)
            }]
          };
        }

        case 'export_query': {
          const databaseId = request.params?.arguments?.database_id as number;
          const query = request.params?.arguments?.query as string;
          const format = (request.params?.arguments?.format as string) || 'csv';
          const nativeParameters = request.params?.arguments?.native_parameters || [];
          const saveFile = request.params?.arguments?.save_file as boolean || false;
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
              const baseFilename = customFilename || `metabase_export_${timestamp}`;
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

              const baseMessage = this.generateExportMessage(
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
              const baseFilename = customFilename || `metabase_export_${timestamp}`;
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

              const baseMessage = this.generateExportMessage(
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
              const baseFilename = customFilename || `metabase_export_${timestamp}`;
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

              const baseMessage = this.generateExportMessage(
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
