/**
 * Error factory utilities for creating specific error instances with detailed guidance
 */

import { ErrorCode, ErrorCategory, RecoveryAction, McpError } from '../types/core.js';

/**
 * Factory for creating authentication-related errors
 */
export class AuthenticationErrorFactory {
  static invalidCredentials(): McpError {
    return new McpError(ErrorCode.InvalidParams, 'Authentication failed: Invalid credentials', {
      category: ErrorCategory.AUTHENTICATION,
      httpStatus: 401,
      userMessage: 'Your API key or login credentials are invalid.',
      agentGuidance:
        'Verify your Metabase API key or username/password in your configuration. Check the METABASE_API_KEY, METABASE_USER_EMAIL, and METABASE_PASSWORD environment variables.',
      recoveryAction: RecoveryAction.CHECK_CREDENTIALS,
      retryable: false,
      troubleshootingSteps: [
        'Verify your API key is correct and not expired',
        'Check that your Metabase URL is correct',
        'Ensure your user account has the necessary permissions',
        'Try logging in to Metabase web interface with the same credentials',
      ],
    });
  }

  static sessionExpired(): McpError {
    return new McpError(ErrorCode.InvalidParams, 'Authentication failed: Session expired', {
      category: ErrorCategory.AUTHENTICATION,
      httpStatus: 401,
      userMessage: 'Your session has expired and needs to be renewed.',
      agentGuidance:
        'The session token has expired. The system will automatically attempt to re-authenticate. If this persists, check your credentials.',
      recoveryAction: RecoveryAction.RETRY_IMMEDIATELY,
      retryable: true,
      troubleshootingSteps: [
        'The system will automatically retry authentication',
        'If retry fails, verify your credentials are still valid',
        'Check if your account has been locked or disabled',
      ],
    });
  }

  static invalidApiKey(): McpError {
    return new McpError(ErrorCode.InvalidParams, 'Authentication failed: Invalid API key', {
      category: ErrorCategory.AUTHENTICATION,
      httpStatus: 401,
      userMessage: 'The provided API key is invalid or has been revoked.',
      agentGuidance:
        'Your API key is invalid. Generate a new API key from Metabase Admin > Settings > API Keys.',
      recoveryAction: RecoveryAction.CHECK_CREDENTIALS,
      retryable: false,
      troubleshootingSteps: [
        'Go to Metabase Admin > Settings > API Keys',
        'Generate a new API key',
        'Update your METABASE_API_KEY environment variable',
        'Ensure the API key has not been revoked or expired',
      ],
    });
  }
}

/**
 * Factory for creating authorization-related errors
 */
export class AuthorizationErrorFactory {
  static insufficientPermissions(resource?: string, action?: string): McpError {
    const resourceMsg = resource ? ` for ${resource}` : '';
    const actionMsg = action ? ` to ${action}` : '';

    return new McpError(
      ErrorCode.InvalidRequest,
      `Access denied: Insufficient permissions${resourceMsg}${actionMsg}`,
      {
        category: ErrorCategory.AUTHORIZATION,
        httpStatus: 403,
        userMessage: `You don't have permission to access this resource${resourceMsg}.`,
        agentGuidance: `Your user account lacks the necessary permissions${actionMsg}${resourceMsg}. Contact your Metabase administrator to grant appropriate permissions.`,
        recoveryAction: RecoveryAction.VERIFY_PERMISSIONS,
        retryable: false,
        additionalContext: { resource, action },
        troubleshootingSteps: [
          'Check your user permissions in Metabase Admin > People',
          'Verify you have access to the required collections/databases',
          'Contact your Metabase administrator for permission changes',
          'Ensure your user group has the necessary permissions',
        ],
      }
    );
  }

  static collectionAccess(collectionId: number): McpError {
    return new McpError(
      ErrorCode.InvalidRequest,
      `Access denied: Cannot access collection ${collectionId}`,
      {
        category: ErrorCategory.AUTHORIZATION,
        httpStatus: 403,
        userMessage: `You don't have permission to access this collection.`,
        agentGuidance: `You lack permission to access collection ${collectionId}. This may be a private collection or you may need to be granted access.`,
        recoveryAction: RecoveryAction.VERIFY_PERMISSIONS,
        retryable: false,
        additionalContext: { collectionId },
        troubleshootingSteps: [
          'Check if the collection exists and is not archived',
          'Verify you have been granted access to this collection',
          'Contact the collection owner or administrator',
          'Try accessing through a different collection path',
        ],
      }
    );
  }
}

/**
 * Factory for creating resource not found errors
 */
export class ResourceNotFoundErrorFactory {
  static resource(resourceType: string, resourceId: number | string): McpError {
    return new McpError(ErrorCode.InvalidRequest, `${resourceType} not found: ${resourceId}`, {
      category: ErrorCategory.RESOURCE_NOT_FOUND,
      httpStatus: 404,
      userMessage: `The requested ${resourceType} could not be found.`,
      agentGuidance: `${resourceType} with ID ${resourceId} does not exist. Verify the ID is correct and the resource hasn't been deleted or archived.`,
      recoveryAction: RecoveryAction.CHECK_RESOURCE_EXISTS,
      retryable: false,
      additionalContext: { resourceType, resourceId },
      troubleshootingSteps: [
        `Verify the ${resourceType} ID (${resourceId}) is correct`,
        `Check if the ${resourceType} has been archived or deleted`,
        `Use the search tool to find the correct ${resourceType}`,
        `Verify you have permission to access this ${resourceType}`,
      ],
    });
  }

  static database(databaseId: number): McpError {
    return new McpError(ErrorCode.InvalidRequest, `Database not found: ${databaseId}`, {
      category: ErrorCategory.RESOURCE_NOT_FOUND,
      httpStatus: 404,
      userMessage: `The specified database could not be found.`,
      agentGuidance: `Database with ID ${databaseId} does not exist or is not accessible. Use the 'list' tool with model='databases' to see available databases.`,
      recoveryAction: RecoveryAction.CHECK_RESOURCE_EXISTS,
      retryable: false,
      additionalContext: { databaseId },
      troubleshootingSteps: [
        'Use list tool to see available databases',
        'Verify the database ID is correct',
        'Check if the database connection is active',
        'Ensure you have permission to access this database',
      ],
    });
  }
}

/**
 * Factory for creating validation errors
 */
export class ValidationErrorFactory {
  static invalidParameter(parameter: string, value: unknown, expectedFormat?: string): McpError {
    const formatMsg = expectedFormat ? ` Expected format: ${expectedFormat}` : '';

    return new McpError(ErrorCode.InvalidParams, `Invalid parameter: ${parameter}`, {
      category: ErrorCategory.VALIDATION,
      httpStatus: 400,
      userMessage: `The parameter '${parameter}' has an invalid value.`,
      agentGuidance: `Parameter '${parameter}' has invalid value '${value}'.${formatMsg} Review the tool's input schema for correct parameter format.`,
      recoveryAction: RecoveryAction.VALIDATE_INPUT,
      retryable: false,
      additionalContext: { parameter, value, expectedFormat },
      troubleshootingSteps: [
        'Check the tool documentation for correct parameter format',
        'Verify the parameter type matches the expected type',
        'Ensure all required parameters are provided',
        'Check parameter value constraints (min/max, enum values, etc.)',
      ],
    });
  }

  static cardParameterMismatch(parameterDetails: any): McpError {
    const paramName =
      parameterDetails?.tag?.name || parameterDetails?.tag?.['display-name'] || 'parameter';
    const submittedValue = parameterDetails?.params?.[0]?.value || 'unknown';
    const expectedType = parameterDetails?.tag?.type || 'unknown';

    return new McpError(ErrorCode.InvalidParams, `Card parameter type mismatch: ${paramName}`, {
      category: ErrorCategory.VALIDATION,
      httpStatus: 400,
      userMessage: `The parameter '${paramName}' has a type mismatch.`,
      agentGuidance: `Parameter '${paramName}' expects ${expectedType} type but received '${submittedValue}'. Check the parameter type requirements for this card. Consider using execute_query with the card's SQL for more flexible parameter handling.`,
      recoveryAction: RecoveryAction.VALIDATE_INPUT,
      retryable: false,
      additionalContext: {
        parameterName: paramName,
        expectedType,
        submittedValue,
        parameterDetails,
      },
      troubleshootingSteps: [
        `Verify parameter '${paramName}' value matches expected type: ${expectedType}`,
        "Check the card's parameter configuration in Metabase",
        'Use the retrieve tool to get card details and parameter requirements',
        "Consider using execute_query with the card's SQL for more flexible parameter handling",
      ],
    });
  }

  static sqlSyntaxError(query: string, error: string): McpError {
    return new McpError(ErrorCode.InvalidRequest, `SQL syntax error: ${error}`, {
      category: ErrorCategory.QUERY_EXECUTION,
      httpStatus: 400,
      userMessage: 'There is a syntax error in your SQL query.',
      agentGuidance: `SQL query contains syntax errors: ${error}. Review the query for proper SQL syntax and ensure all table/column names are correct.`,
      recoveryAction: RecoveryAction.VALIDATE_INPUT,
      retryable: false,
      additionalContext: { query, sqlError: error },
      troubleshootingSteps: [
        'Check SQL syntax for typos and missing keywords',
        'Verify table and column names exist in the database',
        'Ensure proper use of quotes around identifiers',
        'Check for missing commas, parentheses, or other punctuation',
      ],
    });
  }
}

/**
 * Factory for creating network and timeout errors
 */
export class NetworkErrorFactory {
  static timeout(operation: string, timeoutMs: number): McpError {
    return new McpError(ErrorCode.InternalError, `Operation timed out: ${operation}`, {
      category: ErrorCategory.TIMEOUT,
      userMessage: `The operation took too long to complete.`,
      agentGuidance: `${operation} exceeded the ${timeoutMs}ms timeout. Try reducing the complexity of your request or the amount of data being processed.`,
      recoveryAction: RecoveryAction.REDUCE_QUERY_COMPLEXITY,
      retryable: true,
      retryAfterMs: 5000,
      additionalContext: { operation, timeoutMs },
      troubleshootingSteps: [
        'Reduce the amount of data being queried',
        'Add more specific filters to your query',
        'Try splitting large requests into smaller chunks',
        'Consider using the export tool for large datasets',
      ],
    });
  }

  static connectionError(url: string): McpError {
    return new McpError(ErrorCode.InternalError, `Cannot connect to Metabase server: ${url}`, {
      category: ErrorCategory.NETWORK,
      userMessage: 'Unable to connect to the Metabase server.',
      agentGuidance: `Failed to connect to Metabase at ${url}. Check your network connection and verify the Metabase URL is correct and the server is running.`,
      recoveryAction: RecoveryAction.WAIT_AND_RETRY,
      retryable: true,
      retryAfterMs: 10000,
      additionalContext: { url },
      troubleshootingSteps: [
        'Verify the Metabase URL is correct and accessible',
        'Check your network connection',
        'Ensure Metabase server is running and responsive',
        'Check firewall settings and proxy configurations',
      ],
    });
  }
}

/**
 * Factory for creating database and query execution errors
 */
export class DatabaseErrorFactory {
  static queryExecutionError(error: string, query?: string): McpError {
    return new McpError(ErrorCode.InternalError, `Query execution failed: ${error}`, {
      category: ErrorCategory.QUERY_EXECUTION,
      httpStatus: 500,
      userMessage: 'The database query failed to execute.',
      agentGuidance: `Database query execution failed: ${error}. This may be due to query complexity, database issues, or data access problems.`,
      recoveryAction: RecoveryAction.REDUCE_QUERY_COMPLEXITY,
      retryable: true,
      retryAfterMs: 3000,
      additionalContext: { query, dbError: error },
      troubleshootingSteps: [
        'Simplify the query to reduce complexity',
        'Check if the database connection is stable',
        'Verify table and column references are correct',
        'Try breaking complex queries into smaller parts',
      ],
    });
  }

  static connectionLost(databaseId: number): McpError {
    return new McpError(ErrorCode.InternalError, `Database connection lost: ${databaseId}`, {
      category: ErrorCategory.DATABASE,
      httpStatus: 503,
      userMessage: 'Lost connection to the database.',
      agentGuidance: `Database ${databaseId} connection was lost. The database may be temporarily unavailable or experiencing connectivity issues.`,
      recoveryAction: RecoveryAction.WAIT_AND_RETRY,
      retryable: true,
      retryAfterMs: 15000,
      additionalContext: { databaseId },
      troubleshootingSteps: [
        'Wait for the database connection to be restored',
        'Check database server status',
        'Verify database configuration in Metabase',
        'Contact database administrator if issues persist',
      ],
    });
  }
}

/**
 * Factory for creating rate limiting errors
 */
export class RateLimitErrorFactory {
  static exceeded(retryAfterMs?: number): McpError {
    return new McpError(ErrorCode.InternalError, 'Rate limit exceeded', {
      category: ErrorCategory.RATE_LIMIT,
      httpStatus: 429,
      userMessage: 'Too many requests made in a short time.',
      agentGuidance:
        'Rate limit exceeded. Wait before making additional requests. Consider reducing the frequency of your requests.',
      recoveryAction: RecoveryAction.WAIT_AND_RETRY,
      retryable: true,
      retryAfterMs: retryAfterMs || 60000,
      troubleshootingSteps: [
        'Wait before making additional requests',
        'Reduce the frequency of API calls',
        'Consider batching multiple operations',
        'Implement exponential backoff for retries',
      ],
    });
  }
}

/**
 * Factory for creating export and processing errors
 */
export class ExportErrorFactory {
  static fileSizeExceeded(currentSize: number, maxSize: number): McpError {
    return new McpError(ErrorCode.InvalidRequest, `Export file too large: ${currentSize} bytes`, {
      category: ErrorCategory.EXPORT_PROCESSING,
      httpStatus: 413,
      userMessage: 'The export file is too large to process.',
      agentGuidance: `Export file size (${currentSize} bytes) exceeds the maximum allowed size (${maxSize} bytes). Use filters to reduce the result set or export in smaller chunks.`,
      recoveryAction: RecoveryAction.USE_SMALLER_DATASET,
      retryable: false,
      additionalContext: { currentSize, maxSize },
      troubleshootingSteps: [
        'Add WHERE clauses to filter the data',
        'Limit the date range of your query',
        'Select only necessary columns',
        'Consider exporting data in multiple smaller requests',
      ],
    });
  }

  static processingFailed(format: string, error: string): McpError {
    return new McpError(ErrorCode.InternalError, `Export processing failed: ${error}`, {
      category: ErrorCategory.EXPORT_PROCESSING,
      httpStatus: 500,
      userMessage: `Failed to process export in ${format} format.`,
      agentGuidance: `Export processing failed for ${format} format: ${error}. Try using a different format or reducing the data size.`,
      recoveryAction: RecoveryAction.SWITCH_TO_ALTERNATIVE,
      retryable: true,
      additionalContext: { format, error },
      troubleshootingSteps: [
        'Try exporting in a different format (CSV, JSON, XLSX)',
        'Reduce the amount of data being exported',
        'Check if the data contains problematic characters',
        'Verify sufficient disk space for export processing',
      ],
    });
  }
}

/**
 * Utility function to create appropriate error from HTTP response
 */
export function createErrorFromHttpResponse(
  status: number,
  responseData: any,
  operation: string,
  resourceType?: string,
  resourceId?: number | string
): McpError {
  const errorMessage = responseData?.message || responseData?.error || 'HTTP error';
  // Remove unused operation parameter warning
  void operation;

  switch (status) {
    case 400: {
      // Check for Metabase card parameter validation errors
      if (responseData?.error_type === 'invalid-parameter' && responseData?.['ex-data']) {
        return ValidationErrorFactory.cardParameterMismatch(responseData['ex-data']);
      }

      if (
        errorMessage.toLowerCase().includes('sql') ||
        errorMessage.toLowerCase().includes('syntax')
      ) {
        return ValidationErrorFactory.sqlSyntaxError('', errorMessage);
      }
      return ValidationErrorFactory.invalidParameter(
        'request',
        responseData,
        'Check API documentation'
      );
    }

    case 401:
      if (errorMessage.toLowerCase().includes('api key')) {
        return AuthenticationErrorFactory.invalidApiKey();
      }
      if (errorMessage.toLowerCase().includes('session')) {
        return AuthenticationErrorFactory.sessionExpired();
      }
      return AuthenticationErrorFactory.invalidCredentials();

    case 403:
      if (resourceType && resourceId) {
        return AuthorizationErrorFactory.insufficientPermissions(resourceType, 'access');
      }
      return AuthorizationErrorFactory.insufficientPermissions();

    case 404:
      if (resourceType && resourceId) {
        return ResourceNotFoundErrorFactory.resource(resourceType, resourceId);
      }
      return new McpError(ErrorCode.InvalidRequest, 'Metabase item not found', {
        category: ErrorCategory.RESOURCE_NOT_FOUND,
        httpStatus: 404,
        userMessage: 'The requested Metabase item could not be found.',
        agentGuidance:
          'The requested Metabase item does not exist. Verify the item ID and type are correct, and check that the item has not been archived or deleted.',
        recoveryAction: RecoveryAction.CHECK_RESOURCE_EXISTS,
        retryable: false,
        troubleshootingSteps: [
          'Verify the item ID is correct',
          'Check if the item has been archived or deleted',
          'Use the search tool to find the correct item',
          'Verify you have permission to access this item',
        ],
      });

    case 413:
      return ExportErrorFactory.fileSizeExceeded(0, 0);

    case 429: {
      const retryAfter = responseData?.retryAfter || 60000;
      return RateLimitErrorFactory.exceeded(retryAfter);
    }

    case 500:
      if (
        errorMessage.toLowerCase().includes('database') ||
        errorMessage.toLowerCase().includes('sql')
      ) {
        return DatabaseErrorFactory.queryExecutionError(errorMessage);
      }
      return new McpError(ErrorCode.InternalError, `Server error: ${errorMessage}`, {
        category: ErrorCategory.INTERNAL_SERVER,
        httpStatus: 500,
        userMessage: 'The server encountered an internal error.',
        agentGuidance:
          'Metabase server encountered an internal error. This is typically temporary. Try again in a few moments.',
        recoveryAction: RecoveryAction.RETRY_WITH_BACKOFF,
        retryable: true,
        retryAfterMs: 5000,
      });

    case 502:
    case 503:
      return new McpError(ErrorCode.InternalError, 'Service unavailable', {
        category: ErrorCategory.EXTERNAL_SERVICE,
        httpStatus: status,
        userMessage: 'The Metabase service is temporarily unavailable.',
        agentGuidance:
          'Metabase service is temporarily unavailable. This is usually temporary. Wait a few moments and try again.',
        recoveryAction: RecoveryAction.WAIT_AND_RETRY,
        retryable: true,
        retryAfterMs: 30000,
      });

    default:
      return new McpError(ErrorCode.InternalError, `HTTP ${status}: ${errorMessage}`, {
        category: ErrorCategory.EXTERNAL_SERVICE,
        httpStatus: status,
        userMessage: 'An unexpected server error occurred.',
        agentGuidance: `Received HTTP ${status} error: ${errorMessage}. Check the server status and try again.`,
        recoveryAction: RecoveryAction.RETRY_WITH_BACKOFF,
        retryable: true,
        retryAfterMs: 5000,
      });
  }
}
