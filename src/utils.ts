/**
 * Utility functions for the Metabase MCP server.
 */

import { ErrorCode, McpError } from './types/core.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Minimal card interface containing only the fields needed by MCP operations
 */
export interface MinimalCard {
  id: number;
  name: string;
  description?: string;
  database_id: number;
  dataset_query?: {
    type?: string;
    native?: {
      query?: string;
      template_tags?: Record<string, any>;
    };
  };
  collection_id?: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * Minimal dashboard card interface containing only the fields needed by MCP operations
 */
export interface MinimalDashboardCard {
  id: number;
  card_id: number;
  dashboard_id: number;
  row: number;
  col: number;
  size_x: number;
  size_y: number;
  parameter_mappings?: Array<{
    parameter_id: string;
    card_id: number;
    target: any;
  }>;
  visualization_settings?: Record<string, any>;
  card?: {
    id: number;
    name: string;
    description?: string;
    database_id: number;
    query_type?: string;
    display?: string;
    dataset_query?: {
      type?: string;
      native?: {
        query?: string;
        template_tags?: Record<string, any>;
      };
    };
  };
}

/**
 * Strip unnecessary fields from card objects to improve memory usage and performance
 * Only keeps fields that are actually used in MCP operations
 */
export function stripCardFields(card: any): MinimalCard {
  const result: MinimalCard = {
    id: card.id,
    name: card.name,
    database_id: card.database_id,
  };

  // Only add optional fields if they exist to reduce memory footprint
  if (card.description) {
    result.description = card.description;
  }

  if (card.dataset_query) {
    result.dataset_query = {
      type: card.dataset_query.type,
      native: card.dataset_query.native
        ? {
            query: card.dataset_query.native.query,
            template_tags: card.dataset_query.native.template_tags,
          }
        : undefined,
    };
  }

  if (card.collection_id !== null && card.collection_id !== undefined) {
    result.collection_id = card.collection_id;
  }

  if (card.created_at) {
    result.created_at = card.created_at;
  }

  if (card.updated_at) {
    result.updated_at = card.updated_at;
  }

  return result;
}

/**
 * Strip unnecessary fields from dashboard card objects to improve memory usage and performance
 * Only keeps fields that are actually used in MCP operations
 */
export function stripDashboardCardFields(dashcard: any): MinimalDashboardCard {
  const result: MinimalDashboardCard = {
    id: dashcard.id,
    card_id: dashcard.card_id,
    dashboard_id: dashcard.dashboard_id,
    row: dashcard.row,
    col: dashcard.col,
    size_x: dashcard.size_x,
    size_y: dashcard.size_y,
  };

  // Only add optional fields if they exist to reduce memory footprint
  if (dashcard.parameter_mappings && Array.isArray(dashcard.parameter_mappings)) {
    result.parameter_mappings = dashcard.parameter_mappings.map((mapping: any) => ({
      parameter_id: mapping.parameter_id,
      card_id: mapping.card_id,
      target: mapping.target,
    }));
  }

  if (dashcard.visualization_settings && Object.keys(dashcard.visualization_settings).length > 0) {
    result.visualization_settings = dashcard.visualization_settings;
  }

  // Strip the nested card object using the existing stripCardFields logic
  if (dashcard.card) {
    result.card = {
      id: dashcard.card.id,
      name: dashcard.card.name,
      database_id: dashcard.card.database_id,
    };

    // Only add optional card fields if they exist
    if (dashcard.card.description) {
      result.card.description = dashcard.card.description;
    }

    if (dashcard.card.query_type) {
      result.card.query_type = dashcard.card.query_type;
    }

    if (dashcard.card.display) {
      result.card.display = dashcard.card.display;
    }

    if (dashcard.card.dataset_query) {
      result.card.dataset_query = {
        type: dashcard.card.dataset_query.type,
        native: dashcard.card.dataset_query.native
          ? {
              query: dashcard.card.dataset_query.native.query,
              template_tags: dashcard.card.dataset_query.native.template_tags,
            }
          : undefined,
      };
    }
  }

  return result;
}

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Sanitize filename to prevent path traversal attacks
 */
export function sanitizeFilename(filename: string | undefined): string {
  if (!filename || typeof filename !== 'string') {
    return '';
  }

  // Remove path separators and other dangerous characters
  // Keep only alphanumeric, hyphens, underscores, spaces, and dots
  return filename
    .replace(/[/\\:*?"<>|]/g, '') // Remove path separators and invalid filename chars
    .replace(/\.\./g, '') // Remove parent directory references
    .replace(/^\.+/, '') // Remove leading dots
    .trim()
    .substring(0, 255); // Limit length to prevent filesystem issues
}

/**
 * Convert parameter to boolean safely
 */
export function toBooleanSafe(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return Boolean(value);
}

/**
 * Validate that a value is a positive integer
 */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Validate that a string is not empty after trimming
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Safely parse a number with fallback
 */
export function parseNumberSafe(value: unknown, fallback: number = 0): number {
  if (typeof value === 'number' && !isNaN(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

/**
 * Generate standardized export result message
 */
export function generateExportMessage(
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

${
  format === 'xlsx'
    ? `Excel file exported successfully. ${
        saveFile && !fileSaveError
          ? `File has been saved to: ${savedFilePath}\nCompatible with: Excel, Google Sheets, LibreOffice Calc, and other spreadsheet applications`
          : 'To save this Excel file:\n1. Set save_file: true in your export_query parameters\n2. The file will be automatically saved to your Downloads folder\n3. Open with Excel, Google Sheets, or any spreadsheet application'
      }\n\nTechnical Details:\n- Binary Data: Contains Excel binary data (.xlsx format)\n- High Capacity: Supports up to 1 million rows (vs. 2,000 row limit of standard queries)\n- Native Format: Preserves data types and formatting for spreadsheet applications`
    : '```' + format + '\n'
}`;
}

/**
 * Error handling context for different operations
 */
export interface ErrorContext {
  operation: string;
  resourceType?: string;
  resourceId?: string | number;
  customMessages?: {
    [statusCode: string]: string;
  };
}

/**
 * Centralized error handling utility that creates consistent McpError instances
 * with detailed context and actionable guidance for AI agents
 */
export function handleApiError(
  error: any,
  context: ErrorContext,
  logError: (message: string, error: unknown) => void
): McpError {
  logError(`${context.operation} failed`, error);

  // Extract detailed error information
  let errorMessage = `${context.operation} failed`;
  let errorDetails = '';
  let statusCode = 'unknown';

  if (error?.response) {
    // HTTP error response
    statusCode = error.response.status?.toString() || 'unknown';
    const responseData = error.response.data || error.response;

    if (typeof responseData === 'string') {
      errorDetails = responseData;
    } else if (responseData?.message) {
      errorDetails = responseData.message;
    } else if (responseData?.error) {
      errorDetails = responseData.error;
    } else {
      errorDetails = JSON.stringify(responseData);
    }

    errorMessage = `Metabase API error (${statusCode})`;

    // Check for custom messages first
    if (context.customMessages?.[statusCode]) {
      errorMessage += `: ${context.customMessages[statusCode]}`;
    } else {
      // Apply generic status code handling
      errorMessage += getStatusCodeMessage(statusCode, context);
    }
  } else if (error?.message) {
    errorDetails = error.message;
    errorMessage = getGenericErrorMessage(error.message, context);
  } else {
    errorDetails = String(error);
    errorMessage = `Unknown error occurred during ${context.operation.toLowerCase()}`;
  }

  // Log detailed error for debugging
  logError(
    `Detailed ${context.operation.toLowerCase()} error - Status: ${statusCode}, Details: ${errorDetails}`,
    error
  );

  return new McpError(
    ErrorCode.InternalError,
    `${errorMessage}${errorDetails ? ` Details: ${errorDetails}` : ''}`
  );
}

/**
 * Get standard error message based on HTTP status code
 */
function getStatusCodeMessage(statusCode: string, context: ErrorContext): string {
  const { operation, resourceType, resourceId } = context;

  switch (statusCode) {
    case '400':
      if (resourceType && resourceId) {
        return `Invalid ${resourceType}_id parameter. Ensure the ${resourceType} ID is valid and exists.`;
      }
      return `Invalid parameters or request format. Check your input parameters.`;

    case '401':
      return `Authentication failed. Check your API key or session token.`;

    case '403':
      if (resourceType) {
        return `Access denied. You may not have permission to access this ${resourceType}.`;
      }
      return `Access denied. You may not have sufficient permissions for this operation.`;

    case '404':
      if (resourceType && resourceId) {
        return `${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)} not found. Check that the ${resourceType}_id (${resourceId}) is correct and the ${resourceType} exists.`;
      }
      if (resourceType) {
        return `${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)} not found. Check that the ${resourceType} exists.`;
      }
      return `Resource not found. Check your parameters and ensure the resource exists.`;

    case '413':
      return `Request payload too large. Try reducing the result set size or use query filters.`;

    case '500':
      if (
        operation.toLowerCase().includes('query') ||
        operation.toLowerCase().includes('execute')
      ) {
        return `Database server error. The query may have caused a timeout or database issue.`;
      }
      return `Metabase server error. The server may be experiencing issues.`;

    case '502':
    case '503':
      return `Metabase server temporarily unavailable. Try again later.`;

    default:
      return `Unexpected server response (${statusCode}). Please check the server status.`;
  }
}

/**
 * Get error message for non-HTTP errors
 */
function getGenericErrorMessage(errorMessage: string, context: ErrorContext): string {
  const { operation } = context;

  if (errorMessage.includes('timeout')) {
    return `${operation} timed out. Try again later or reduce the complexity of your request.`;
  }

  if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('network')) {
    return `Network error connecting to Metabase. Check your connection and Metabase URL.`;
  }

  if (errorMessage.includes('syntax') || errorMessage.includes('SQL')) {
    return `SQL syntax error. Check your query syntax and ensure all table/column names are correct.`;
  }

  if (errorMessage.includes('permission') || errorMessage.includes('access')) {
    return `Access denied. Check your permissions for this operation.`;
  }

  if (errorMessage.includes('database') || errorMessage.includes('Database')) {
    return `Database connection error. Ensure the database is accessible and your credentials are correct.`;
  }

  return `${operation} failed: ${errorMessage}`;
}

/**
 * Generate a flattened field list from a nested object structure
 * Used for creating reference documentation of API response structures
 */
export function generateFlattenedFields(obj: any, prefix = '', result: string[] = []): string[] {
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const currentPath = prefix ? `${prefix}.${key}` : key;
      const value = obj[key];

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Nested object - recurse
        generateFlattenedFields(value, currentPath, result);
      } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
        // Array of objects - add array notation and recurse with first element
        result.push(`${currentPath}[]`);
        generateFlattenedFields(value[0], `${currentPath}[]`, result);
      } else {
        // Leaf node
        result.push(currentPath);
      }
    }
  }
  return result;
}

/**
 * Convert actual data to type structure for documentation
 * Removes actual values and shows only the data structure/types
 */
export function generateTypeStructure(obj: any): any {
  if (obj === null) return 'null';
  if (obj === undefined) return 'undefined';

  if (Array.isArray(obj)) {
    if (obj.length === 0) return 'array (empty)';
    return [generateTypeStructure(obj[0])];
  }

  if (typeof obj === 'object') {
    const result: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        result[key] = generateTypeStructure(obj[key]);
      }
    }
    return result;
  }

  // Primitive types
  if (typeof obj === 'string') {
    // Check if it looks like a date
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(obj)) {
      return 'string (ISO date)';
    }
    // Check if it looks like a UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(obj)) {
      return 'string (UUID)';
    }
    return 'string';
  }

  return typeof obj;
}

/**
 * Save raw response structure to reference file for documentation
 * Used to maintain field references for optimization decisions
 */
export function saveRawStructure(model: string, rawData: any, enableSave: boolean = false): void {
  if (!enableSave) return;

  try {
    const docsDir = path.join(process.cwd(), 'docs', 'reference-responses');
    const filePath = path.join(docsDir, `${model}-raw-response.json`);

    // Generate structure and flattened fields
    const structure = generateTypeStructure(rawData);
    const flattenedFields = generateFlattenedFields(rawData).sort();

    const referenceDoc = {
      model,
      description: `Raw response structure for a Metabase ${model}. This shows the field structure without actual data values.`,
      status: 'AUTO-GENERATED from actual API response',
      generated_at: new Date().toISOString(),
      optimization_notes: {
        essential_fields: [],
        fields_to_investigate: [],
        likely_removable_fields: [],
        note: 'These fields need to be manually categorized based on usage analysis',
      },
      response_structure: structure,
      flattened_fields: flattenedFields,
    };

    // Ensure directory exists
    if (!fs.existsSync(docsDir)) {
      fs.mkdirSync(docsDir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(referenceDoc, null, 2));
    console.log(`Saved raw structure for ${model} to ${filePath}`);
  } catch (error) {
    console.warn(`Failed to save raw structure for ${model}:`, error);
  }
}
