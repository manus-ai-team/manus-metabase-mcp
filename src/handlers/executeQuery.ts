import { z } from 'zod';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MetabaseApiClient } from '../api.js';
import { ErrorCode, McpError, ApiError } from '../types.js';

export async function handleExecuteQuery(
  request: z.infer<typeof CallToolRequestSchema>,
  requestId: string,
  apiClient: MetabaseApiClient,
  logDebug: (message: string, data?: unknown) => void,
  logInfo: (message: string, data?: unknown) => void,
  logWarn: (message: string, data?: unknown, error?: Error) => void,
  logError: (message: string, error: unknown) => void
) {
  const databaseId = request.params?.arguments?.database_id;
  const query = request.params?.arguments?.query;
  const nativeParameters = request.params?.arguments?.native_parameters || [];
  const rowLimitArg = request.params?.arguments?.row_limit;
  const rowLimit = typeof rowLimitArg === 'number' ? rowLimitArg : 500;

  if (!databaseId) {
    logWarn('Missing database_id parameter in execute_query request', { requestId });
    throw new McpError(
      ErrorCode.InvalidParams,
      'Database ID parameter is required'
    );
  }

  if (!query || typeof query !== 'string') {
    logWarn('Missing or invalid query parameter in execute_query request', { requestId });
    throw new McpError(
      ErrorCode.InvalidParams,
      'SQL query parameter is required and must be a string'
    );
  }

  // Validate row limit
  if (rowLimit < 1 || rowLimit > 2000) {
    logWarn(`Invalid row_limit parameter: ${rowLimit}. Must be between 1 and 2000.`, { requestId });
    throw new McpError(
      ErrorCode.InvalidParams,
      'Row limit must be between 1 and 2000. For larger datasets, use export_query instead.'
    );
  }

  logDebug(`Executing SQL query against database ID: ${databaseId} with row limit: ${rowLimit}`);

  // Handle LIMIT clause: only override if our limit is more restrictive than existing limit
  let limitedQuery = query.trim();
  let finalLimit = rowLimit;

  // Check for existing LIMIT clause
  const limitRegex = /\bLIMIT\s+(\d+)\s*;?\s*$/i;
  const limitMatch = limitedQuery.match(limitRegex);

  if (limitMatch) {
    const existingLimit = parseInt(limitMatch[1], 10);
    logDebug(`Found existing LIMIT clause: ${existingLimit}, requested limit: ${rowLimit}`);

    if (existingLimit <= rowLimit) {
      // Existing limit is more restrictive, keep it
      logDebug(`Keeping existing LIMIT ${existingLimit} as it's more restrictive than requested ${rowLimit}`);
      finalLimit = existingLimit;
      // Don't modify the query
    } else {
      // Our limit is more restrictive, replace the existing one
      logDebug(`Replacing existing LIMIT ${existingLimit} with more restrictive limit ${rowLimit}`);
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

      logDebug(`Found LIMIT clause(s) in query: ${existingLimits.join(', ')}, min: ${minExistingLimit}`);

      if (minExistingLimit <= rowLimit) {
        // Existing limit is more restrictive, keep the query as is
        logDebug(`Keeping existing LIMIT clauses as minimum ${minExistingLimit} is more restrictive than requested ${rowLimit}`);
        finalLimit = minExistingLimit;
        // Don't modify the query
      } else {
        // Our limit is more restrictive, remove all existing LIMIT clauses
        logDebug(`Removing existing LIMIT clauses and applying more restrictive limit ${rowLimit}`);
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
    const response = await apiClient.request<any>('/api/dataset', {
      method: 'POST',
      body: JSON.stringify(queryData)
    });

    const rowCount = response?.data?.rows?.length || 0;
    logInfo(`Successfully executed SQL query against database: ${databaseId}, returned ${rowCount} rows (limit: ${finalLimit})`);

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

    logError(`Failed to execute query: ${errorMessage}`, error);

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
