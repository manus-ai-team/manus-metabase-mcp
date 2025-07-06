# Enhanced MCP/API Error Handling

This document outlines the enhanced error handling system implemented in the Metabase MCP server to provide better guidance for AI agents on handling errors and taking appropriate recovery actions.

## Overview

The enhanced error handling system provides:

- **Categorized Error Types**: Specific error categories for different failure scenarios
- **Actionable Guidance**: Clear instructions for agents on what actions to take
- **Recovery Actions**: Specific recommendations for error recovery
- **Troubleshooting Steps**: Step-by-step guidance for problem resolution
- **Retry Logic**: Information about whether errors are retryable and after what delay

## Error Categories

### Authentication (`authentication`)
Issues with API keys, session tokens, or login credentials.

**Common Scenarios:**
- Invalid API key
- Expired session token
- Missing authentication headers

**Recovery Actions:**
- `CHECK_CREDENTIALS`: Verify API key or credentials
- `RETRY_IMMEDIATELY`: For session expiration (auto-retry)

### Authorization (`authorization`)
Permission-related issues when accessing resources.

**Common Scenarios:**
- Insufficient permissions for resource access
- Collection access denied
- Database access restrictions

**Recovery Actions:**
- `VERIFY_PERMISSIONS`: Check user permissions
- `CONTACT_ADMIN`: Request permission changes

### Resource Not Found (`resource_not_found`)
Requested resources don't exist or are inaccessible.

**Common Scenarios:**
- Card/dashboard/database doesn't exist
- Resource has been archived or deleted
- Invalid resource IDs

**Recovery Actions:**
- `CHECK_RESOURCE_EXISTS`: Verify resource ID and status
- `SWITCH_TO_ALTERNATIVE`: Use alternative resources

### Validation (`validation`)
Input parameter validation failures.

**Common Scenarios:**
- Invalid parameter values
- SQL syntax errors
- Missing required parameters

**Recovery Actions:**
- `VALIDATE_INPUT`: Check parameter format and values

### Network (`network`)
Network connectivity and communication issues.

**Common Scenarios:**
- Connection timeouts
- Network unreachable
- DNS resolution failures

**Recovery Actions:**
- `WAIT_AND_RETRY`: Wait and retry operation
- `REDUCE_QUERY_COMPLEXITY`: Simplify requests

### Database (`database`)
Database-specific errors and connection issues.

**Common Scenarios:**
- Query execution failures
- Database connection lost
- Query timeouts

**Recovery Actions:**
- `REDUCE_QUERY_COMPLEXITY`: Simplify queries
- `WAIT_AND_RETRY`: Wait for database recovery

### Query Execution (`query_execution`)
SQL query processing and execution errors.

**Common Scenarios:**
- SQL syntax errors
- Table/column not found
- Query complexity limits

**Recovery Actions:**
- `VALIDATE_INPUT`: Fix SQL syntax
- `REDUCE_QUERY_COMPLEXITY`: Simplify queries

### Rate Limiting (`rate_limit`)
API rate limit exceeded.

**Common Scenarios:**
- Too many requests per time window
- Burst limits exceeded

**Recovery Actions:**
- `WAIT_AND_RETRY`: Wait before next request

### Export Processing (`export_processing`)
Data export and file processing errors.

**Common Scenarios:**
- File size limits exceeded
- Export format processing failures
- Memory/disk space issues

**Recovery Actions:**
- `USE_SMALLER_DATASET`: Reduce data size
- `SWITCH_TO_ALTERNATIVE`: Try different format

## Agent Response Format

When an enhanced error occurs, agents receive structured error information:

```json
{
  "error": "Authentication failed: Invalid API key",
  "category": "authentication",
  "guidance": "Your API key is invalid. Generate a new API key from Metabase Admin > Settings > API Keys.",
  "recoveryAction": "check_credentials",
  "retryable": false,
  "troubleshootingSteps": [
    "Go to Metabase Admin > Settings > API Keys",
    "Generate a new API key",
    "Update your METABASE_API_KEY environment variable",
    "Ensure the API key has not been revoked or expired"
  ]
}
```

## Error Response Examples

### Authentication Error
```
Error: Authentication failed: Invalid API key

Guidance: Your API key is invalid. Generate a new API key from Metabase Admin > Settings > API Keys.

Recovery Action: check_credentials

Retryable: false

Troubleshooting Steps:
1. Go to Metabase Admin > Settings > API Keys
2. Generate a new API key
3. Update your METABASE_API_KEY environment variable
4. Ensure the API key has not been revoked or expired
```

### Resource Not Found Error
```
Error: Dashboard not found: 123

Guidance: Dashboard with ID 123 does not exist. Verify the ID is correct and the resource hasn't been deleted or archived.

Recovery Action: check_resource_exists

Retryable: false

Troubleshooting Steps:
1. Verify the dashboard ID (123) is correct
2. Check if the dashboard has been archived or deleted
3. Use the search tool to find the correct dashboard
4. Verify you have permission to access this dashboard
```

### Network Timeout Error
```
Error: Operation timed out: Search operation

Guidance: Search operation exceeded the 30000ms timeout. Try reducing the complexity of your request or the amount of data being processed.

Recovery Action: reduce_query_complexity

Retryable: true

Troubleshooting Steps:
1. Reduce the amount of data being queried
2. Add more specific filters to your query
3. Try splitting large requests into smaller chunks
4. Consider using the export tool for large datasets
```

### Rate Limit Error
```
Error: Rate limit exceeded

Guidance: Rate limit exceeded. Wait before making additional requests. Consider reducing the frequency of your requests.

Recovery Action: wait_and_retry

Retryable: true

Troubleshooting Steps:
1. Wait before making additional requests
2. Reduce the frequency of API calls
3. Consider batching multiple operations
4. Implement exponential backoff for retries
```

## Recovery Action Guide

### For Agents

When encountering errors, agents should:

1. **Check the `retryable` flag**:
   - `true`: Consider retrying after the specified delay
   - `false`: Don't retry, fix the underlying issue first

2. **Follow the `recoveryAction`**:
   - `CHECK_CREDENTIALS`: Verify authentication setup
   - `VERIFY_PERMISSIONS`: Check user access rights
   - `VALIDATE_INPUT`: Fix parameter values/format
   - `REDUCE_QUERY_COMPLEXITY`: Simplify queries/requests
   - `USE_SMALLER_DATASET`: Reduce data volume
   - `WAIT_AND_RETRY`: Implement delay before retry
   - `SWITCH_TO_ALTERNATIVE`: Try different approach
   - `CONTACT_ADMIN`: Request manual intervention

3. **Use troubleshooting steps**: Follow the provided step-by-step guidance

4. **Implement proper retry logic**:
   - Respect `retryAfterMs` delays
   - Use exponential backoff for network errors
   - Limit retry attempts to avoid infinite loops

## Implementation Details

### Error Factory Classes

The system uses factory classes to create specific error types:

- `AuthenticationErrorFactory`: Authentication-related errors
- `AuthorizationErrorFactory`: Permission-related errors
- `ResourceNotFoundErrorFactory`: Missing resource errors
- `ValidationErrorFactory`: Input validation errors
- `NetworkErrorFactory`: Network and timeout errors
- `DatabaseErrorFactory`: Database operation errors
- `RateLimitErrorFactory`: Rate limiting errors
- `ExportErrorFactory`: Export processing errors

### HTTP Status Code Mapping

The system automatically maps HTTP status codes to appropriate error types:

- `400`: Validation errors (or SQL syntax for query-related operations)
- `401`: Authentication errors
- `403`: Authorization errors
- `404`: Resource not found errors
- `413`: Export file size errors
- `429`: Rate limiting errors
- `500`: Database or internal server errors (context-dependent)
- `502/503`: External service unavailable errors

### Integration Points

Enhanced errors are integrated at multiple levels:

1. **API Client**: HTTP response errors are automatically converted to enhanced errors
2. **Request Handlers**: Validation and business logic errors use error factories
3. **Server**: Enhanced errors are formatted for MCP responses with structured guidance

This comprehensive error handling system ensures that AI agents receive actionable, specific guidance for every error scenario, enabling more effective automated error recovery and debugging.