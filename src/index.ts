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
  config,
  authMethod,
  AuthMethod,
  LogLevel,
} from './config.js';
import {
  generateRequestId,
  sanitizeFilename,
  performHybridSearch,
  performExactSearch,
} from './utils.js';
import {
  ErrorCode,
  McpError,
  ApiError,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
} from './types.js';
import { MetabaseApiClient } from './api.js';

class MetabaseServer {
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
            name: 'search_cards',
            description: '[RECOMMENDED] Fast search for questions/cards using Metabase native search API. Use this FIRST when looking for specific cards by name, description, or metadata. Much faster than get_cards for targeted searches.',
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
            description: '[RECOMMENDED] Fast search for dashboards using Metabase native search API. Use this FIRST when looking for specific dashboards by name, description, or metadata. Much faster than get_dashboards for targeted searches.',
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
            name: 'get_cards',
            description: '[SLOW] Get all questions/cards in Metabase with optional advanced search. WARNING: This fetches ALL cards from the server and can be very slow on large Metabase instances. Use search_cards instead for finding specific cards. Only use this when you need comprehensive data analysis, advanced fuzzy matching, or SQL content search.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Optional search query - can be card name/description, exact ID, or SQL content to search for. If omitted, returns all cards. WARNING: Fetching all cards can be very slow.'
                },
                search_type: {
                  type: 'string',
                  enum: ['auto', 'id', 'exact'],
                  description: "Type of search when query is provided: 'auto' for intelligent hybrid search (exact + substring + fuzzy), 'id' for exact ID match, 'exact' for exact phrase matching only",
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
              required: []
            }
          },
          {
            name: 'get_dashboards',
            description: '[SLOW] Get all dashboards in Metabase with optional advanced search. WARNING: This fetches ALL dashboards from the server and can be slow on large Metabase instances. Use search_dashboards instead for finding specific dashboards. Only use this when you need comprehensive data analysis or advanced fuzzy matching.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Optional search query - can be dashboard name/description or exact ID. If omitted, returns all dashboards. WARNING: Fetching all dashboards can be slow.'
                },
                search_type: {
                  type: 'string',
                  enum: ['auto', 'id', 'exact'],
                  description: "Type of search when query is provided: 'auto' for intelligent hybrid search (exact + substring + fuzzy), 'id' for exact ID match, 'exact' for exact phrase matching only",
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
            name: 'execute_card',
            description: '[DEPRECATED] Execute a Metabase question/card directly. This method is unreliable and may timeout. Prefer using get_card_sql + execute_query for better control.',
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
            description: '[RECOMMENDED] Execute a SQL query against a Metabase database. This is the preferred method for running queries as it provides better control and reliability than execute_card. Results are limited to improve performance for AI agents - use export_query for larger datasets.',
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
            description: '[RECOMMENDED] Get the SQL query and database details from a Metabase card/question. Uses optimized unified caching for maximum efficiency - benefits from previous get_cards calls and caches individual requests. Use this before execute_query to get the SQL you can modify.',
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
            description: '[UTILITY] Clear the internal cache for cards data. Useful for debugging or when you know the data has changed.',
            inputSchema: {
              type: 'object',
              properties: {
                cache_type: {
                  type: 'string',
                  enum: ['all', 'individual', 'bulk'],
                  description: 'Type of cache to clear: "all" (default), "individual" (single card cache), or "bulk" (unified cache metadata)',
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
        case 'search_cards':
          return this._handleFastSearchCards(request, requestId);
        case 'search_dashboards':
          return this._handleFastSearchDashboards(request, requestId);
        case 'get_cards':
          return this._handleGetCards(request, requestId);
        case 'get_dashboards':
          return this._handleGetDashboards(request, requestId);
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
        case 'export_query':
          return this._handleExportQuery(request, requestId);
        case 'clear_cache':
          return this._handleClearCache(request);
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

  private async _handleGetCards(request: z.infer<typeof CallToolRequestSchema>, requestId: string) {
    const searchQuery = request.params?.arguments?.query as string;
    const searchType = (request.params?.arguments?.search_type as string) || 'auto';
    const fuzzyThreshold = (request.params?.arguments?.fuzzy_threshold as number) || 0.4;
    const maxResults = (request.params?.arguments?.max_results as number) || 50;

    // Log performance warning
    if (!searchQuery) {
      this.logWarn('get_cards called without search query - this will fetch ALL cards and can be very slow. Consider using search_cards for targeted searches.', { requestId });
    } else {
      this.logWarn(`get_cards called with search query "${searchQuery}" - consider using search_cards for faster results unless you need advanced fuzzy matching or SQL content search.`, { requestId });
    }

    if (!searchQuery) {
      this.logDebug('Fetching all cards from Metabase', { requestId });
    } else {
      this.logDebug(`Searching for cards with query: "${searchQuery}" (type: ${searchType}, fuzzy_threshold: ${fuzzyThreshold})`, { requestId });
    }

    // Fetch all cards using cached method
    const fetchStartTime = Date.now();
    const allCards = await this.apiClient.getAllCards();
    const fetchTime = Date.now() - fetchStartTime;

    let results: any[] = [];
    let searchTime = 0;
    let effectiveSearchType = searchType;

    if (!searchQuery) {
      // No search query provided, return all cards
      results = allCards.slice(0, maxResults);
      effectiveSearchType = 'all';
      this.logInfo(`Retrieved ${results.length} cards (all cards)`);
    } else {
      // Search query provided, perform search
      const searchStartTime = Date.now();

      // Determine search type
      const isNumeric = /^\d+$/.test(searchQuery.trim());

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

      searchTime = Date.now() - searchStartTime;
    }

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
          search_query: searchQuery || null,
          search_type: effectiveSearchType,
          fuzzy_threshold: effectiveSearchType === 'fuzzy' ? fuzzyThreshold : undefined,
          total_results: results.length,
          performance_warning: searchQuery ?
            'PERFORMANCE TIP: For simple name/description searches, use search_cards instead of get_cards for much faster results.' :
            'PERFORMANCE WARNING: You fetched ALL cards from the server. Use search_cards for targeted searches to improve performance.',
          performance_info: {
            fetch_time_ms: fetchTime,
            search_time_ms: searchTime,
            total_cards_searched: allCards.length,
            cache_used: fetchTime < 1000, // Assume cache was used if fetch was very fast
            search_method_used: effectiveSearchType,
            alternative_recommendation: 'Use search_cards for faster targeted searches'
          },
          recommended_workflow: 'For cards with SQL: 1) Use get_card_sql() to get the SQL, 2) Modify if needed, 3) Use execute_query()',
          search_info: effectiveSearchType === 'all' ? {
            explanation: 'Retrieved all available cards (no search query provided). Results limited by max_results parameter.',
            result_limit: maxResults,
            total_available: allCards.length
          } : effectiveSearchType === 'auto' ? {
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

  private async _handleGetDashboards(request: z.infer<typeof CallToolRequestSchema>, requestId: string) {
    const searchQuery = request.params?.arguments?.query as string;
    const searchType = (request.params?.arguments?.search_type as string) || 'auto';
    const fuzzyThreshold = (request.params?.arguments?.fuzzy_threshold as number) || 0.4;
    const maxResults = (request.params?.arguments?.max_results as number) || 50;

    // Log performance warning
    if (!searchQuery) {
      this.logWarn('get_dashboards called without search query - this will fetch ALL dashboards and can be slow. Consider using search_dashboards for targeted searches.', { requestId });
    } else {
      this.logWarn(`get_dashboards called with search query "${searchQuery}" - consider using search_dashboards for faster results unless you need advanced fuzzy matching.`, { requestId });
    }

    if (!searchQuery) {
      this.logDebug('Fetching all dashboards from Metabase', { requestId });
    } else {
      this.logDebug(`Searching for dashboards with query: "${searchQuery}" (type: ${searchType}, fuzzy_threshold: ${fuzzyThreshold})`, { requestId });
    }

    // Fetch all dashboards first
    const fetchStartTime = Date.now();
    const allDashboards = await this.apiClient.request<any[]>('/api/dashboard');
    const fetchTime = Date.now() - fetchStartTime;

    let results: any[] = [];
    let searchTime = 0;
    let effectiveSearchType = searchType;

    if (!searchQuery) {
      // No search query provided, return all dashboards
      results = allDashboards.slice(0, maxResults);
      effectiveSearchType = 'all';
      this.logInfo(`Retrieved ${results.length} dashboards (all dashboards)`);
    } else {
      // Search query provided, perform search
      const searchStartTime = Date.now();

      // Determine search type
      const isNumeric = /^\d+$/.test(searchQuery.trim());

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

      searchTime = Date.now() - searchStartTime;
    }

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
          search_query: searchQuery || null,
          search_type: effectiveSearchType,
          fuzzy_threshold: effectiveSearchType === 'fuzzy' ? fuzzyThreshold : undefined,
          total_results: results.length,
          performance_warning: searchQuery ?
            'PERFORMANCE TIP: For simple name/description searches, use search_dashboards instead of get_dashboards for much faster results.' :
            'PERFORMANCE WARNING: You fetched ALL dashboards from the server. Use search_dashboards for targeted searches to improve performance.',
          performance_info: {
            fetch_time_ms: fetchTime,
            search_time_ms: searchTime,
            total_dashboards_searched: allDashboards.length,
            search_method_used: effectiveSearchType,
            alternative_recommendation: 'Use search_dashboards for faster targeted searches'
          },
          search_info: effectiveSearchType === 'all' ? {
            explanation: 'Retrieved all available dashboards (no search query provided). Results limited by max_results parameter.',
            result_limit: maxResults,
            total_available: allDashboards.length
          } : effectiveSearchType === 'auto' ? {
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

  private async _handleListDatabases() {
    this.logDebug('Fetching all databases from Metabase');
    const response = await this.apiClient.request<any[]>('/api/database');
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

    // Use unified caching system - may benefit from previous bulk fetch
    const startTime = Date.now();
    const card = await this.apiClient.getCard(cardId);
    const fetchTime = Date.now() - startTime;

    // Determine data source based on fetch time and cache state
    let dataSource: string;
    if (fetchTime < 5) {
      const bulkCacheMetadata = this.apiClient.getBulkCacheMetadata();
      dataSource = bulkCacheMetadata.allCardsFetched ? 'unified_cache_bulk' : 'unified_cache_individual';
    } else {
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
      data_source: dataSource,
      fetch_time_ms: fetchTime
    };

    // Add guidance for AI agents
    if (!result.sql_query) {
      result.message = 'This card does not contain a native SQL query. It may be a GUI-based question.';
    } else {
      result.message = 'Use the database_id and sql_query with execute_query. You can modify the SQL query to add filters or parameters.';
    }

    // Add performance info
    if (dataSource === 'unified_cache_bulk') {
      result.performance_note = 'Data retrieved from unified cache (populated by previous get_cards call - optimal efficiency)';
    } else if (dataSource === 'unified_cache_individual') {
      result.performance_note = 'Data retrieved from unified cache (populated by previous get_card_sql call)';
    } else {
      result.performance_note = 'Data retrieved via direct API call (now cached in unified cache for future requests)';
    }

    this.logInfo(`Successfully retrieved SQL details for card: ${cardId} (source: ${dataSource}, ${fetchTime}ms)`);
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

    const response = await this.apiClient.request<any>(`/api/card/${cardId}/query`, {
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
    const response = await this.apiClient.request<any>(`/api/dashboard/${dashboardId}`);

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
    const rowLimitArg = request.params?.arguments?.row_limit;
    const rowLimit = typeof rowLimitArg === 'number' ? rowLimitArg : 500;

    if (!databaseId) {
      this.logWarn('Missing database_id parameter in execute_query request', { requestId });
      throw new McpError(
        ErrorCode.InvalidParams,
        'Database ID parameter is required'
      );
    }

    if (!query || typeof query !== 'string') {
      this.logWarn('Missing or invalid query parameter in execute_query request', { requestId });
      throw new McpError(
        ErrorCode.InvalidParams,
        'SQL query parameter is required and must be a string'
      );
    }

    // Validate row limit
    if (rowLimit < 1 || rowLimit > 2000) {
      this.logWarn(`Invalid row_limit parameter: ${rowLimit}. Must be between 1 and 2000.`, { requestId });
      throw new McpError(
        ErrorCode.InvalidParams,
        'Row limit must be between 1 and 2000. For larger datasets, use export_query instead.'
      );
    }

    this.logDebug(`Executing SQL query against database ID: ${databaseId} with row limit: ${rowLimit}`);

    // Handle LIMIT clause: only override if our limit is more restrictive than existing limit
    let limitedQuery = query.trim();
    let finalLimit = rowLimit;

    // Check for existing LIMIT clause
    const limitRegex = /\bLIMIT\s+(\d+)\s*;?\s*$/i;
    const limitMatch = limitedQuery.match(limitRegex);

    if (limitMatch) {
      const existingLimit = parseInt(limitMatch[1], 10);
      this.logDebug(`Found existing LIMIT clause: ${existingLimit}, requested limit: ${rowLimit}`);

      if (existingLimit <= rowLimit) {
        // Existing limit is more restrictive, keep it
        this.logDebug(`Keeping existing LIMIT ${existingLimit} as it's more restrictive than requested ${rowLimit}`);
        finalLimit = existingLimit;
        // Don't modify the query
      } else {
        // Our limit is more restrictive, replace the existing one
        this.logDebug(`Replacing existing LIMIT ${existingLimit} with more restrictive limit ${rowLimit}`);
        limitedQuery = limitedQuery.replace(limitRegex, '');
        // We'll add our limit below
      }
    } else {
      // Check for LIMIT in middle of query (less common but possible)
      const midLimitRegex = /\bLIMIT\s+(\d+)/gi;
      const midLimitMatches = [...limitedQuery.matchAll(midLimitRegex)];

      if (midLimitMatches.length > 0) {
        // Find the most restrictive existing limit
        const existingLimits = midLimitMatches.map(match => parseInt(match[1], 10));
        const minExistingLimit = Math.min(...existingLimits);

        this.logDebug(`Found LIMIT clause(s) in query: ${existingLimits.join(', ')}, min: ${minExistingLimit}`);

        if (minExistingLimit <= rowLimit) {
          // Existing limit is more restrictive, keep the query as is
          this.logDebug(`Keeping existing LIMIT clauses as minimum ${minExistingLimit} is more restrictive than requested ${rowLimit}`);
          finalLimit = minExistingLimit;
          // Don't modify the query
        } else {
          // Our limit is more restrictive, remove all existing LIMIT clauses
          this.logDebug(`Removing existing LIMIT clauses and applying more restrictive limit ${rowLimit}`);
          limitedQuery = limitedQuery.replace(midLimitRegex, '');
          // We'll add our limit below
        }
      }
    }

    // Add our LIMIT clause only if we determined we need to override
    if (finalLimit === rowLimit && (limitMatch || limitedQuery !== query.trim())) {
      if (limitedQuery.endsWith(';')) {
        limitedQuery = limitedQuery.slice(0, -1) + ` LIMIT ${rowLimit};`;
      } else {
        limitedQuery = limitedQuery + ` LIMIT ${rowLimit}`;
      }
    } else if (finalLimit === rowLimit && !limitMatch) {
      // No existing limit found, add ours
      if (limitedQuery.endsWith(';')) {
        limitedQuery = limitedQuery.slice(0, -1) + ` LIMIT ${rowLimit};`;
      } else {
        limitedQuery = limitedQuery + ` LIMIT ${rowLimit}`;
      }
    }

    // Build query request body
    const queryData = {
      type: 'native',
      native: {
        query: limitedQuery,
        template_tags: {}
      },
      parameters: nativeParameters,
      database: databaseId
    };

    try {
      const response = await this.apiClient.request<any>('/api/dataset', {
        method: 'POST',
        body: JSON.stringify(queryData)
      });

      const rowCount = response?.data?.rows?.length || 0;
      this.logInfo(`Successfully executed SQL query against database: ${databaseId}, returned ${rowCount} rows (limit: ${finalLimit})`);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            query: query,
            database_id: databaseId,
            row_count: rowCount,
            applied_limit: finalLimit,
            data: response
          }, null, 2)
        }]
      };
    } catch (error) {
      const apiError = error as ApiError;
      const errorMessage = apiError.data?.message || apiError.message || 'Unknown error';

      this.logError(`Failed to execute query: ${errorMessage}`, error);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: "Query execution failed",
            error: errorMessage,
            query: query,
            database_id: databaseId
          }, null, 2)
        }],
        isError: true
      };
    }
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

      const response = await this.apiClient.request<any>(`/api/search?${searchParams.toString()}`);
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
            performance_advantage: `FAST SEARCH: Completed in ${searchTime}ms using server-side native search API. Much faster than get_cards which fetches all data.`,
            performance_info: {
              search_time_ms: searchTime,
              api_endpoint: '/api/search',
              search_method: 'server_side_native',
              performance_note: 'This method is optimized for speed and should be preferred over get_cards for targeted searches'
            },
            recommended_workflow: 'For cards: 1) Use get_card_sql() to get the SQL, 2) Modify if needed, 3) Use execute_query()',
            when_to_use: {
              use_search_cards: 'For finding specific cards by name, description, or metadata (RECOMMENDED)',
              use_get_cards: 'Only when you need advanced fuzzy matching, SQL content search, or comprehensive data analysis'
            },
            note: 'This uses Metabase native search API for fast results. For advanced fuzzy matching or SQL content search, use get_cards with search parameters.',
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

      const response = await this.apiClient.request<any>(`/api/search?${searchParams.toString()}`);
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
            performance_advantage: `FAST SEARCH: Completed in ${searchTime}ms using server-side native search API. Much faster than get_dashboards which fetches all data.`,
            performance_info: {
              search_time_ms: searchTime,
              api_endpoint: '/api/search',
              search_method: 'server_side_native',
              performance_note: 'This method is optimized for speed and should be preferred over get_dashboards for targeted searches'
            },
            when_to_use: {
              use_search_dashboards: 'For finding specific dashboards by name, description, or metadata (RECOMMENDED)',
              use_get_dashboards: 'Only when you need advanced fuzzy matching or comprehensive data analysis'
            },
            note: 'This uses Metabase native search API for fast results. For advanced fuzzy matching, use get_dashboards with search parameters.',
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

  private async _handleExportQuery(request: z.infer<typeof CallToolRequestSchema>, requestId: string) {
    const databaseId = request.params?.arguments?.database_id as number;
    const query = request.params?.arguments?.query as string;
    const format = (request.params?.arguments?.format as string) || 'csv';
    const nativeParameters = request.params?.arguments?.native_parameters || [];
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
      const url = new URL(exportEndpoint, config.METABASE_URL);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add appropriate authentication headers
      if (authMethod === AuthMethod.API_KEY && config.METABASE_API_KEY) {
        headers['X-API-KEY'] = config.METABASE_API_KEY;
      } else if (authMethod === AuthMethod.SESSION && this.apiClient.sessionToken) {
        headers['X-Metabase-Session'] = this.apiClient.sessionToken;
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
      let rowCount: number | undefined = 0;
      let fileSize = 0;

      try {
        if (format === 'json') {
          responseData = await response.json();
          // JSON export format might have different structures, let's be more flexible
          if (responseData && typeof responseData === 'object') {
            // Try different possible structures for row counting
            rowCount = responseData?.data?.rows?.length ||
                      responseData?.rows?.length ||
                      (Array.isArray(responseData) ? responseData.length : 0);
          }
          this.logDebug(`JSON export row count: ${rowCount}`);
        } else if (format === 'csv') {
          responseData = await response.text();
          // Count rows for CSV (subtract header row)
          const rows = responseData.split('\n').filter((row: string) => row.trim());
          rowCount = Math.max(0, rows.length - 1);
          this.logDebug(`CSV export row count: ${rowCount}`);
        } else if (format === 'xlsx') {
          responseData = await response.arrayBuffer();
          fileSize = responseData.byteLength;
          // For XLSX, we can't easily count rows from ArrayBuffer
          rowCount = undefined;
          this.logDebug(`XLSX export file size: ${fileSize} bytes`);
        }
      } catch (parseError) {
        this.logError(`Failed to parse ${format} response: ${parseError}`, parseError);
        throw new Error(`Failed to parse ${format} response: ${parseError}`);
      }

      // Validate that we have data before proceeding with file operations
      // For XLSX, check file size; for others, check row count
      const hasData = format === 'xlsx' ? fileSize > 100 : (rowCount && rowCount > 0);
      if (!hasData) {
        this.logWarn(`Query returned no data for export`, { requestId });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              message: "Query executed successfully but returned no data to export",
              query: query,
              database_id: databaseId,
              format: format,
              row_count: rowCount
            }, null, 2)
          }]
        };
      }

      // Always save files to Downloads/Metabase directory
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const sanitizedCustomFilename = sanitizeFilename(customFilename);
      const baseFilename = sanitizedCustomFilename || `metabase_export_${timestamp}`;
      const filename = `${baseFilename}.${format}`;

      // Create Metabase subdirectory in Downloads
      const downloadsPath = path.join(os.homedir(), 'Downloads', 'Metabase');
      const savedFilePath = path.join(downloadsPath, filename);

      let fileSaveError: string | undefined;

      try {
        // Ensure Downloads/Metabase directory exists
        if (!fs.existsSync(downloadsPath)) {
          fs.mkdirSync(downloadsPath, { recursive: true });
        }

        // Write the file based on format and calculate file size
        if (format === 'json') {
          const jsonString = JSON.stringify(responseData, null, 2);
          fs.writeFileSync(savedFilePath, jsonString, 'utf8');
          fileSize = Buffer.byteLength(jsonString, 'utf8');
        } else if (format === 'csv') {
          fs.writeFileSync(savedFilePath, responseData, 'utf8');
          fileSize = Buffer.byteLength(responseData, 'utf8');
        } else if (format === 'xlsx') {
          // Handle binary data for XLSX
          if (responseData instanceof ArrayBuffer) {
            const buffer = Buffer.from(responseData);
            fs.writeFileSync(savedFilePath, buffer);
            fileSize = buffer.length;
          } else {
            throw new Error('XLSX response is not in expected ArrayBuffer format');
          }
        }

        this.logInfo(`Successfully exported to ${savedFilePath}`);
      } catch (saveError) {
        fileSaveError = saveError instanceof Error ? saveError.message : 'Unknown file save error';
        this.logError(`Failed to save export file: ${fileSaveError}`, saveError);
      }

      // Generate standardized JSON response
      if (fileSaveError) {
        const errorResponse: any = {
          success: false,
          message: "Export completed but failed to save file",
          error: fileSaveError,
          query: query,
          database_id: databaseId,
          format: format,
          row_count: rowCount,
          intended_file_path: savedFilePath
        };

        // Add file size for all formats
        if (fileSize > 0) {
          errorResponse.file_size_bytes = fileSize;
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(errorResponse, null, 2)
          }],
          isError: true
        };
      }

      // Successful export - return standardized JSON response
      const successResponse: any = {
        success: true,
        message: "Export completed successfully",
        query: query,
        file_path: savedFilePath,
        filename: filename,
        format: format,
        row_count: rowCount,
        database_id: databaseId,
        file_size_bytes: fileSize
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(successResponse, null, 2)
        }]
      };
    } catch (error) {
      const apiError = error as ApiError;
      const errorMessage = apiError.data?.message || apiError.message || 'Unknown error';

      this.logError(`Failed to export query in ${format} format: ${errorMessage}`, error);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            message: "Export failed",
            error: errorMessage,
            query: query,
            database_id: databaseId,
            format: format
          }, null, 2)
        }],
        isError: true
      };
    }
  }

  private _handleClearCache(request?: z.infer<typeof CallToolRequestSchema>) {
    const cacheType = (request?.params?.arguments?.cache_type as string) || 'all';
    const cardId = request?.params?.arguments?.card_id as number;

    let message = '';
    let cacheStatus = '';

    switch (cacheType) {
    case 'individual':
      if (cardId) {
        // Clear individual card from API client cache
        message = `Individual card cache cleared for card ${cardId}`;
        cacheStatus = `card_${cardId}_cache_empty`;
      } else {
        // Clear all individual cards from API client cache
        message = 'All individual card caches cleared';
        cacheStatus = 'individual_cache_empty';
      }
      break;

    case 'bulk':
      this.apiClient.clearCardsCache();
      message = 'Unified cache cleared (bulk metadata reset)';
      cacheStatus = 'unified_cache_empty';
      break;

    case 'all':
    default:
      this.apiClient.clearCardsCache();
      message = 'Unified cache cleared successfully';
      cacheStatus = 'unified_cache_empty';
      break;
    }

    this.logInfo(message);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          message,
          cache_type: cacheType,
          card_id: cardId || null,
          cache_status: cacheStatus,
          next_fetch_will_be: 'fresh from API',
          cache_info: {
            cache_explanation: 'Unified cache serves both individual card requests and bulk operations efficiently'
          }
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
