import { z } from 'zod';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MetabaseApiClient } from '../api.js';
import { performHybridSearch, performExactSearch } from '../utils.js';

export async function handleGetDashboards(
  request: z.infer<typeof CallToolRequestSchema>,
  requestId: string,
  apiClient: MetabaseApiClient,
  logDebug: (message: string, data?: unknown) => void,
  logInfo: (message: string, data?: unknown) => void,
  logWarn: (message: string, data?: unknown, error?: Error) => void
) {
  const searchQuery = request.params?.arguments?.query as string;
  const searchType = (request.params?.arguments?.search_type as string) || 'auto';
  const fuzzyThreshold = (request.params?.arguments?.fuzzy_threshold as number) || 0.4;
  const maxResults = (request.params?.arguments?.max_results as number) || 50;

  // Log performance warning
  if (!searchQuery) {
    logWarn('get_dashboards called without search query - this will fetch ALL dashboards and can be slow. Consider using search_dashboards for targeted searches.', { requestId });
  } else {
    logWarn(`get_dashboards called with search query "${searchQuery}" - consider using search_dashboards for faster results unless you need advanced fuzzy matching.`, { requestId });
  }

  if (!searchQuery) {
    logDebug('Fetching all dashboards from Metabase', { requestId });
  } else {
    logDebug(`Searching for dashboards with query: "${searchQuery}" (type: ${searchType}, fuzzy_threshold: ${fuzzyThreshold})`, { requestId });
  }

  // Fetch all dashboards first
  const fetchStartTime = Date.now();
  const allDashboards = await apiClient.request<any[]>('/api/dashboard');
  const fetchTime = Date.now() - fetchStartTime;

  let results: any[] = [];
  let searchTime = 0;
  let effectiveSearchType = searchType;

  if (!searchQuery) {
    // No search query provided, return all dashboards
    results = allDashboards.slice(0, maxResults);
    effectiveSearchType = 'all';
    logInfo(`Retrieved ${results.length} dashboards (all dashboards)`);
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
      logInfo(`Found ${results.length} dashboards matching ID: ${targetId}`);
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
      logInfo(`Found ${results.length} dashboards with exact phrase matching: "${searchQuery}"`);
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
      logInfo(`Found ${results.length} dashboards using intelligent hybrid search (exact + substring + fuzzy)`);
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
