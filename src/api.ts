import { config, AuthMethod } from './config.js';
import { ErrorCode, McpError } from './types/core.js';

// Logger level enum
enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal'
}

// Interface for tracking data source in API responses
export interface CachedResponse<T> {
  data: T;
  source: 'cache' | 'api';
  fetchTime: number;
}

export class MetabaseApiClient {
  private baseUrl: string;
  public sessionToken: string | null = null;
  private apiKey: string | null = null;
  private authMethod: AuthMethod;
  private headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  // Individual item cache system
  private cardCache: Map<number, { data: any; timestamp: number }> = new Map();
  private dashboardCache: Map<number, { data: any; timestamp: number }> = new Map();
  private tableCache: Map<number, { data: any; timestamp: number }> = new Map();
  private databaseCache: Map<number, { data: any; timestamp: number }> = new Map();
  private collectionCache: Map<number, { data: any; timestamp: number }> = new Map();
  private fieldCache: Map<number, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL_MS: number;
  private readonly REQUEST_TIMEOUT_MS: number;

  constructor() {
    this.baseUrl = config.METABASE_URL;
    this.authMethod = config.METABASE_API_KEY ? AuthMethod.API_KEY : AuthMethod.SESSION;
    this.apiKey = config.METABASE_API_KEY || null;
    this.CACHE_TTL_MS = config.CACHE_TTL_MS;
    this.REQUEST_TIMEOUT_MS = config.REQUEST_TIMEOUT_MS;

    if (this.apiKey) {
      this.logInfo('Using API Key authentication method');
    } else {
      this.logInfo('Using Session Token authentication method');
    }
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



  /**
   * HTTP request utility method with timeout support
   */
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
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
   * Get a single dashboard with caching - checks cache first, then API if needed
   */
  async getDashboard(dashboardId: number): Promise<CachedResponse<any>> {
    const now = Date.now();

    // Check if we have a cached version that's still valid
    const cached = this.dashboardCache.get(dashboardId);
    if (cached && (now - cached.timestamp) < this.CACHE_TTL_MS) {
      this.logDebug(`Using cached data for dashboard ${dashboardId}`);
      return {
        data: cached.data,
        source: 'cache',
        fetchTime: 0
      };
    }

    // Cache miss or stale, fetch from API
    this.logDebug(`Fetching dashboard ${dashboardId} from Metabase API (cache miss or stale)`);
    const startTime = Date.now();

    try {
      const dashboard = await this.request<any>(`/api/dashboard/${dashboardId}`);
      const fetchTime = Date.now() - startTime;

      // Cache the result
      this.dashboardCache.set(dashboardId, {
        data: dashboard,
        timestamp: now
      });

      this.logInfo(`Successfully fetched dashboard ${dashboardId} in ${fetchTime}ms`);
      return {
        data: dashboard,
        source: 'api',
        fetchTime
      };
    } catch (error) {
      this.logError(`Failed to fetch dashboard ${dashboardId} from Metabase API`, error);

      // If we have any cached version (even stale), return it as fallback
      if (cached) {
        this.logWarn(`Using stale cached data for dashboard ${dashboardId} as fallback due to API error`);
        return {
          data: cached.data,
          source: 'cache',
          fetchTime: 0
        };
      }

      throw error;
    }
  }

  /**
   * Get a single card with caching - checks cache first, then API if needed
   */
  async getCard(cardId: number): Promise<CachedResponse<any>> {
    const now = Date.now();
    const cached = this.cardCache.get(cardId);

    // Check if we have cached data that's still valid
    if (cached && (now - cached.timestamp) < this.CACHE_TTL_MS) {
      this.logDebug(`Using cached data for card ${cardId}`);
      return {
        data: cached.data,
        source: 'cache',
        fetchTime: 0
      };
    }

    // Cache miss or stale, fetch from API
    this.logDebug(`Fetching fresh data for card ${cardId} from Metabase API`);
    const startTime = Date.now();

    try {
      const card = await this.request<any>(`/api/card/${cardId}`);
      const fetchTime = Date.now() - startTime;

      // Update cache with full card data
      this.cardCache.set(cardId, {
        data: card,
        timestamp: now
      });

      this.logInfo(`Successfully fetched card ${cardId} in ${fetchTime}ms`);
      return {
        data: card,
        source: 'api',
        fetchTime
      };
    } catch (error) {
      this.logError(`Failed to fetch card ${cardId} from Metabase API`, error);

      // If we have stale cached data, return it as fallback
      if (cached) {
        this.logWarn(`Using stale cached data for card ${cardId} as fallback due to API error`);
        return {
          data: cached.data,
          source: 'cache',
          fetchTime: 0
        };
      }

      throw error;
    }
  }

  /**
   * Clear the cards cache (useful for debugging or when data changes)
   */
  clearCardsCache(): void {
    this.cardCache.clear();
    this.logDebug('Cards cache cleared');
  }

  /**
   * Clear the dashboards cache (useful for debugging or when data changes)
   */
  clearDashboardsCache(): void {
    this.dashboardCache.clear();
    this.logDebug('Dashboards cache cleared');
  }

  /**
   * Clear all caches (cards, dashboards, tables, and databases)
   */
  clearAllCache(): void {
    this.clearCardsCache();
    this.clearDashboardsCache();
    this.clearTablesCache();
    this.clearDatabasesCache();
    this.clearCollectionsCache();
    this.clearFieldsCache();
    this.logInfo('All caches cleared (cards, dashboards, tables, databases, collections, and fields)');
  }



  /**
   * Get Metabase session token (only needed for session auth method)
   */
  async getSessionToken(): Promise<string> {
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
          username: config.METABASE_USER_EMAIL,
          password: config.METABASE_PASSWORD,
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
   * Get a single table with caching - fetches query metadata
   */
  async getTable(tableId: number): Promise<CachedResponse<any>> {
    const now = Date.now();
    const cached = this.tableCache.get(tableId);

    // Check if we have cached data that's still valid
    if (cached && (now - cached.timestamp) < this.CACHE_TTL_MS) {
      this.logDebug(`Using cached data for table ${tableId}`);
      return {
        data: cached.data,
        source: 'cache',
        fetchTime: 0
      };
    }

    // Cache miss or stale, fetch from API
    this.logDebug(`Fetching fresh data for table ${tableId} from Metabase API`);
    const startTime = Date.now();

    try {
      const table = await this.request<any>(`/api/table/${tableId}/query_metadata`);
      const fetchTime = Date.now() - startTime;

      // Update cache with full table data
      this.tableCache.set(tableId, {
        data: table,
        timestamp: now
      });

      this.logInfo(`Successfully fetched table ${tableId} in ${fetchTime}ms`);
      return {
        data: table,
        source: 'api',
        fetchTime
      };
    } catch (error) {
      this.logError(`Failed to fetch table ${tableId} from Metabase API`, error);

      // If we have stale cached data, return it as fallback
      if (cached) {
        this.logWarn(`Using stale cached data for table ${tableId} as fallback due to API error`);
        return {
          data: cached.data,
          source: 'cache',
          fetchTime: 0
        };
      }

      throw error;
    }
  }

  /**
   * Get a single database with caching - includes tables
   */
  async getDatabase(databaseId: number): Promise<CachedResponse<any>> {
    const now = Date.now();
    const cached = this.databaseCache.get(databaseId);

    // Check if we have cached data that's still valid
    if (cached && (now - cached.timestamp) < this.CACHE_TTL_MS) {
      this.logDebug(`Using cached data for database ${databaseId}`);
      return {
        data: cached.data,
        source: 'cache',
        fetchTime: 0
      };
    }

    // Cache miss or stale, fetch from API
    this.logDebug(`Fetching fresh data for database ${databaseId} from Metabase API`);
    const startTime = Date.now();

    try {
      const database = await this.request<any>(`/api/database/${databaseId}?include=tables`);
      const fetchTime = Date.now() - startTime;

      // Update cache with full database data
      this.databaseCache.set(databaseId, {
        data: database,
        timestamp: now
      });

      this.logInfo(`Successfully fetched database ${databaseId} in ${fetchTime}ms`);
      return {
        data: database,
        source: 'api',
        fetchTime
      };
    } catch (error) {
      this.logError(`Failed to fetch database ${databaseId} from Metabase API`, error);

      // If we have stale cached data, return it as fallback
      if (cached) {
        this.logWarn(`Using stale cached data for database ${databaseId} as fallback due to API error`);
        return {
          data: cached.data,
          source: 'cache',
          fetchTime: 0
        };
      }

      throw error;
    }
  }

  /**
   * Get a single collection with caching
   */
  async getCollection(collectionId: number): Promise<CachedResponse<any>> {
    const now = Date.now();
    const cached = this.collectionCache.get(collectionId);

    // Check if we have cached data that's still valid
    if (cached && (now - cached.timestamp) < this.CACHE_TTL_MS) {
      this.logDebug(`Using cached data for collection ${collectionId}`);
      return {
        data: cached.data,
        source: 'cache',
        fetchTime: 0
      };
    }

    // Cache miss or stale, fetch from API
    this.logDebug(`Fetching fresh data for collection ${collectionId} from Metabase API`);
    const startTime = Date.now();

    try {
      const collection = await this.request<any>(`/api/collection/${collectionId}`);
      const fetchTime = Date.now() - startTime;

      // Update cache with full collection data
      this.collectionCache.set(collectionId, {
        data: collection,
        timestamp: now
      });

      this.logInfo(`Successfully fetched collection ${collectionId} in ${fetchTime}ms`);
      return {
        data: collection,
        source: 'api',
        fetchTime
      };
    } catch (error) {
      this.logError(`Failed to fetch collection ${collectionId} from Metabase API`, error);

      // If we have stale cached data, return it as fallback
      if (cached) {
        this.logWarn(`Using stale cached data for collection ${collectionId} as fallback due to API error`);
        return {
          data: cached.data,
          source: 'cache',
          fetchTime: 0
        };
      }

      throw error;
    }
  }

  /**
   * Get a single field with caching
   */
  async getField(fieldId: number): Promise<CachedResponse<any>> {
    const now = Date.now();
    const cached = this.fieldCache.get(fieldId);

    // Check if we have cached data that's still valid
    if (cached && (now - cached.timestamp) < this.CACHE_TTL_MS) {
      this.logDebug(`Using cached data for field ${fieldId}`);
      return {
        data: cached.data,
        source: 'cache',
        fetchTime: 0
      };
    }

    // Cache miss or stale, fetch from API
    this.logDebug(`Fetching fresh data for field ${fieldId} from Metabase API`);
    const startTime = Date.now();

    try {
      const field = await this.request<any>(`/api/field/${fieldId}`);
      const fetchTime = Date.now() - startTime;

      // Update cache with full field data
      this.fieldCache.set(fieldId, {
        data: field,
        timestamp: now
      });

      this.logInfo(`Successfully fetched field ${fieldId} in ${fetchTime}ms`);
      return {
        data: field,
        source: 'api',
        fetchTime
      };
    } catch (error) {
      this.logError(`Failed to fetch field ${fieldId} from Metabase API`, error);

      // If we have stale cached data, return it as fallback
      if (cached) {
        this.logWarn(`Using stale cached data for field ${fieldId} as fallback due to API error`);
        return {
          data: cached.data,
          source: 'cache',
          fetchTime: 0
        };
      }

      throw error;
    }
  }



  /**
   * Clear the tables cache
   */
  clearTablesCache(): void {
    this.tableCache.clear();
    this.logDebug('Tables cache cleared');
  }

  /**
   * Clear the databases cache
   */
  clearDatabasesCache(): void {
    this.databaseCache.clear();
    this.logDebug('Databases cache cleared');
  }

  /**
   * Clear the collections cache
   */
  clearCollectionsCache(): void {
    this.collectionCache.clear();
    this.logDebug('Collections cache cleared');
  }

  /**
   * Clear the fields cache
   */
  clearFieldsCache(): void {
    this.fieldCache.clear();
    this.logDebug('Fields cache cleared');
  }
}
