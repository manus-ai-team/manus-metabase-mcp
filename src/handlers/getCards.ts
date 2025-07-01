import { z } from 'zod';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MetabaseApiClient } from '../api.js';
import { performHybridSearch, performExactSearch } from '../utils.js';

export async function handleGetCards(
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
    logWarn('get_cards called without search query - this will fetch ALL cards and can be very slow. Consider using search_cards for targeted searches.', { requestId });
  } else {
    logWarn(`get_cards called with search query "${searchQuery}" - consider using search_cards for faster results unless you need advanced fuzzy matching or SQL content search.`, { requestId });
  }

  if (!searchQuery) {
    logDebug('Fetching all cards from Metabase', { requestId });
  } else {
    logDebug(`Searching for cards with query: "${searchQuery}" (type: ${searchType}, fuzzy_threshold: ${fuzzyThreshold})`, { requestId });
  }

  // Fetch all cards using cached method
  const fetchStartTime = Date.now();
  const allCards = await apiClient.getAllCards();
  const fetchTime = Date.now() - fetchStartTime;

  let results: any[] = [];
  let searchTime = 0;
  let effectiveSearchType = searchType;

  if (!searchQuery) {
    // No search query provided, return all cards
    results = allCards.slice(0, maxResults);
    effectiveSearchType = 'all';
    logInfo(`Retrieved ${results.length} cards (all cards)`);
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
      logInfo(`Found ${results.length} cards matching ID: ${targetId}`);
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
      logInfo(`Found ${results.length} cards with exact phrase matching: "${searchQuery}"`);
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
      logInfo(`Found ${results.length} cards using intelligent hybrid search (exact + substring + fuzzy)`);
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
