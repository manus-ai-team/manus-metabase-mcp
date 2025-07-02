import { config, AuthMethod } from './config.js';
import { ErrorCode, McpError } from './types.js';
import { MinimalCard, stripCardFields } from './utils.js';

// Logger level enum
enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal'
}

export class MetabaseApiClient {
  private baseUrl: string;
  public sessionToken: string | null = null;
  private apiKey: string | null = null;
  private authMethod: AuthMethod;
  private headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  // Unified cache system - can serve both individual and bulk requests efficiently
  private unifiedCardCache: Map<number, { data: any; timestamp: number }> = new Map();
  private bulkCacheMetadata: { allCardsFetched: boolean; timestamp: number | null } = {
    allCardsFetched: false,
    timestamp: null
  };
  // Dashboard cache system - same pattern as cards
  private unifiedDashboardCache: Map<number, { data: any; timestamp: number }> = new Map();
  private dashboardBulkCacheMetadata: { allDashboardsFetched: boolean; timestamp: number | null } = {
    allDashboardsFetched: false,
    timestamp: null
  };
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
   * Get all cards with unified caching - stores both full and minimal card data
   * Uses a hybrid approach: stores full card data but returns minimal for search operations
   */
  async getAllCards(): Promise<MinimalCard[]> {
    const now = Date.now();

    // Check if we have cached data that's still valid
    if (this.bulkCacheMetadata.allCardsFetched && this.bulkCacheMetadata.timestamp &&
        (now - this.bulkCacheMetadata.timestamp) < this.CACHE_TTL_MS) {
      this.logDebug(`Using cached cards data (${this.unifiedCardCache.size} cards)`);
      return Array.from(this.unifiedCardCache.values()).map(item => stripCardFields(item.data));
    }

    // Cache is invalid or doesn't exist, fetch fresh data
    this.logDebug('Fetching fresh cards data from Metabase API');
    const startTime = Date.now();

    try {
      const rawCards = await this.request<any[]>('/api/card');
      const fetchTime = Date.now() - startTime;

      // Store full card data in unified cache (so get_card_sql can use it)
      // But return stripped data for search operations to maintain performance
      rawCards.forEach(card => this.unifiedCardCache.set(card.id, {
        data: card, // Store full card data
        timestamp: now
      }));

      this.bulkCacheMetadata.allCardsFetched = true;
      this.bulkCacheMetadata.timestamp = now;

      // Return stripped cards for search operations
      const strippedCards = rawCards.map(stripCardFields);
      const originalSize = JSON.stringify(rawCards).length;
      const strippedSize = JSON.stringify(strippedCards).length;
      const sizeSavings = ((originalSize - strippedSize) / originalSize * 100).toFixed(1);

      this.logInfo(`Successfully fetched ${rawCards.length} cards in ${fetchTime}ms`);
      this.logDebug(`Unified cache stores full data, search returns stripped data (${sizeSavings}% memory savings for search)`);
      return strippedCards;
    } catch (error) {
      this.logError('Failed to fetch cards from Metabase API', error);

      // If we have stale cached data, return it as fallback
      if (this.bulkCacheMetadata.allCardsFetched) {
        this.logWarn('Using stale cached data as fallback due to API error');
        return Array.from(this.unifiedCardCache.values()).map(item => stripCardFields(item.data));
      }

      throw error;
    }
  }

  /**
   * Get all dashboards with unified caching - stores both full and minimal dashboard data
   * Uses a hybrid approach: stores full dashboard data but returns minimal for search operations
   */
  async getAllDashboards(): Promise<any[]> {
    const now = Date.now();

    // Check if we have cached data that's still valid
    if (this.dashboardBulkCacheMetadata.allDashboardsFetched && this.dashboardBulkCacheMetadata.timestamp &&
        (now - this.dashboardBulkCacheMetadata.timestamp) < this.CACHE_TTL_MS) {
      this.logDebug(`Using cached dashboards data (${this.unifiedDashboardCache.size} dashboards)`);
      return Array.from(this.unifiedDashboardCache.values()).map(item => item.data);
    }

    // Cache is invalid or doesn't exist, fetch fresh data
    this.logDebug('Fetching fresh dashboards data from Metabase API');
    const startTime = Date.now();

    try {
      const rawDashboards = await this.request<any[]>('/api/dashboard');
      const fetchTime = Date.now() - startTime;

      // Store full dashboard data in unified cache
      rawDashboards.forEach(dashboard => this.unifiedDashboardCache.set(dashboard.id, {
        data: dashboard, // Store full dashboard data
        timestamp: now
      }));

      this.dashboardBulkCacheMetadata.allDashboardsFetched = true;
      this.dashboardBulkCacheMetadata.timestamp = now;

      this.logInfo(`Successfully fetched ${rawDashboards.length} dashboards in ${fetchTime}ms`);
      this.logDebug(`Dashboard cache populated with ${rawDashboards.length} dashboards`);
      return rawDashboards;
    } catch (error) {
      this.logError('Failed to fetch dashboards from Metabase API', error);

      // If we have stale cached data, return it as fallback
      if (this.dashboardBulkCacheMetadata.allDashboardsFetched) {
        this.logWarn('Using stale cached dashboard data as fallback due to API error');
        return Array.from(this.unifiedDashboardCache.values()).map(item => item.data);
      }

      throw error;
    }
  }

  /**
   * Get a single dashboard with unified caching - checks cache first, then API if needed
   */
  async getDashboard(dashboardId: number): Promise<any> {
    const now = Date.now();

    // Check if we have a cached version that's still valid
    const cached = this.unifiedDashboardCache.get(dashboardId);
    if (cached && (now - cached.timestamp) < this.CACHE_TTL_MS) {
      this.logDebug(`Using cached data for dashboard ${dashboardId} (from ${this.dashboardBulkCacheMetadata.allDashboardsFetched ? 'bulk fetch' : 'individual fetch'})`);
      return cached.data;
    }

    // Check if we have bulk data that covers this dashboard and is still valid
    if (this.dashboardBulkCacheMetadata.allDashboardsFetched &&
        this.dashboardBulkCacheMetadata.timestamp &&
        (now - this.dashboardBulkCacheMetadata.timestamp) < this.CACHE_TTL_MS &&
        this.unifiedDashboardCache.has(dashboardId)) {
      const bulkCached = this.unifiedDashboardCache.get(dashboardId);
      if (bulkCached) {
        this.logDebug(`Using bulk cached data for dashboard ${dashboardId}`);
        return bulkCached.data;
      }
    }

    // Cache miss or stale, fetch from API
    this.logDebug(`Fetching dashboard ${dashboardId} from Metabase API (cache miss or stale)`);
    const startTime = Date.now();

    try {
      const dashboard = await this.request<any>(`/api/dashboard/${dashboardId}`);
      const fetchTime = Date.now() - startTime;

      // Cache the result
      this.unifiedDashboardCache.set(dashboardId, {
        data: dashboard,
        timestamp: now
      });

      this.logInfo(`Successfully fetched dashboard ${dashboardId} in ${fetchTime}ms`);
      return dashboard;
    } catch (error) {
      this.logError(`Failed to fetch dashboard ${dashboardId} from Metabase API`, error);

      // If we have any cached version (even stale), return it as fallback
      if (cached) {
        this.logWarn(`Using stale cached data for dashboard ${dashboardId} as fallback due to API error`);
        return cached.data;
      }

      throw error;
    }
  }

  /**
   * Get a single card with unified caching - checks cache first, then API if needed
   */
  async getCard(cardId: number): Promise<any> {
    const now = Date.now();
    const cached = this.unifiedCardCache.get(cardId);

    // Check if we have cached data that's still valid
    if (cached && (now - cached.timestamp) < this.CACHE_TTL_MS) {
      this.logDebug(`Using cached data for card ${cardId} (from ${this.bulkCacheMetadata.allCardsFetched ? 'bulk fetch' : 'individual fetch'})`);
      return cached.data;
    }

    // If we don't have the specific card cached, but we have a recent bulk fetch,
    // the card might not exist or we might have missed it
    if (this.bulkCacheMetadata.allCardsFetched &&
        this.bulkCacheMetadata.timestamp &&
        (now - this.bulkCacheMetadata.timestamp) < this.CACHE_TTL_MS &&
        !cached) {
      this.logDebug(`Card ${cardId} not found in recent bulk cache - it may not exist`);
      // Still try API call in case it's a newly created card
    }

    // Cache is invalid/doesn't exist, or card not in bulk cache - fetch fresh data
    this.logDebug(`Fetching fresh data for card ${cardId} from Metabase API`);
    const startTime = Date.now();

    try {
      const card = await this.request<any>(`/api/card/${cardId}`);
      const fetchTime = Date.now() - startTime;

      // Update unified cache with full card data
      this.unifiedCardCache.set(cardId, {
        data: card,
        timestamp: now
      });

      this.logInfo(`Successfully fetched card ${cardId} in ${fetchTime}ms`);
      return card;
    } catch (error) {
      this.logError(`Failed to fetch card ${cardId} from Metabase API`, error);

      // If we have stale cached data, return it as fallback
      if (cached) {
        this.logWarn(`Using stale cached data for card ${cardId} as fallback due to API error`);
        return cached.data;
      }

      throw error;
    }
  }

  /**
   * Clear the unified cards cache (useful for debugging or when data changes)
   */
  clearCardsCache(): void {
    this.bulkCacheMetadata.allCardsFetched = false;
    this.bulkCacheMetadata.timestamp = null;
    this.unifiedCardCache.clear();
    this.logDebug('Cards cache cleared');
  }

  /**
   * Clear the unified dashboards cache (useful for debugging or when data changes)
   */
  clearDashboardsCache(): void {
    this.dashboardBulkCacheMetadata.allDashboardsFetched = false;
    this.dashboardBulkCacheMetadata.timestamp = null;
    this.unifiedDashboardCache.clear();
    this.logDebug('Dashboards cache cleared');
  }

  /**
   * Clear all caches (cards and dashboards)
   */
  clearAllCache(): void {
    this.clearCardsCache();
    this.clearDashboardsCache();
    this.logInfo('All caches cleared (cards and dashboards)');
  }

  /**
   * Get bulk cache metadata for determining data source
   */
  getBulkCacheMetadata(): { allCardsFetched: boolean; timestamp: number | null } {
    return this.bulkCacheMetadata;
  }

  /**
   * Get dashboard cache metadata for determining data source
   */
  getDashboardCacheMetadata(): { allDashboardsFetched: boolean; timestamp: number | null } {
    return this.dashboardBulkCacheMetadata;
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
}
