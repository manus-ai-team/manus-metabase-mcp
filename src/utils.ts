/**
 * Utility functions for the Metabase MCP server.
 */

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
 * Strip unnecessary fields from card objects to improve memory usage and performance
 * Only keeps fields that are actually used in MCP operations
 */
export function stripCardFields(card: any): MinimalCard {
  return {
    id: card.id,
    name: card.name,
    description: card.description || undefined,
    database_id: card.database_id,
    dataset_query: card.dataset_query ? {
      type: card.dataset_query.type,
      native: card.dataset_query.native ? {
        query: card.dataset_query.native.query,
        template_tags: card.dataset_query.native.template_tags
      } : undefined
    } : undefined,
    collection_id: card.collection_id,
    created_at: card.created_at,
    updated_at: card.updated_at
  };
}

/**
 * Calculate Levenshtein distance between two strings for fuzzy matching
 */
export function calculateLevenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];
  const len1 = str1.length;
  const len2 = str2.length;

  // Initialize matrix
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,     // deletion
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j - 1] + 1  // substitution
        );
      }
    }
  }

  return matrix[len1][len2];
}

/**
 * Calculate fuzzy match score (0-1, where 1 is perfect match)
 */
export function calculateFuzzyScore(query: string, target: string): number {
  if (!query || !target) return 0;

  const queryLower = query.toLowerCase().trim();
  const targetLower = target.toLowerCase().trim();

  // Exact match gets highest score
  if (queryLower === targetLower) return 1.0;

  // Check for word-based matches (split by spaces and check individual words)
  const queryWords = queryLower.split(/\s+/);
  const targetWords = targetLower.split(/\s+/);

  // Direct contains match gets high score
  if (targetLower.includes(queryLower)) {
    const ratio = queryLower.length / targetLower.length;
    return 0.85 + (ratio * 0.1); // 0.85-0.95 range for contains matches
  }

  // Check if query matches any complete word in target
  for (const queryWord of queryWords) {
    if (queryWord.length >= 3) { // Only check meaningful words
      for (const targetWord of targetWords) {
        if (targetWord === queryWord) {
          return 0.8; // High score for exact word match
        }
        if (targetWord.includes(queryWord) && queryWord.length >= 4) {
          return 0.75; // Good score for word contains
        }
      }
    }
  }

  // Try fuzzy matching on individual words for better typo handling
  let bestWordScore = 0;
  for (const queryWord of queryWords) {
    if (queryWord.length >= 3) {
      for (const targetWord of targetWords) {
        if (targetWord.length >= 3) {
          const distance = calculateLevenshteinDistance(queryWord, targetWord);
          const maxLength = Math.max(queryWord.length, targetWord.length);
          const wordSimilarity = 1 - (distance / maxLength);

          // Boost score for similar-length words
          const lengthDiff = Math.abs(queryWord.length - targetWord.length);
          const lengthPenalty = lengthDiff / maxLength * 0.2;
          const adjustedScore = Math.max(0, wordSimilarity - lengthPenalty);

          if (adjustedScore > bestWordScore) {
            bestWordScore = adjustedScore;
          }
        }
      }
    }
  }

  // If we found a good word match, use it
  if (bestWordScore >= 0.6) {
    return Math.min(bestWordScore + 0.1, 0.8); // Cap at 0.8 for fuzzy word matches
  }

  // Calculate Levenshtein distance for full string fuzzy matching
  const distance = calculateLevenshteinDistance(queryLower, targetLower);
  const maxLength = Math.max(queryLower.length, targetLower.length);

  // Convert distance to similarity score (0-1)
  const similarity = 1 - (distance / maxLength);

  // For shorter queries, be more lenient
  const lengthBonus = queryLower.length <= 5 ? 0.1 : 0;
  const finalScore = similarity + lengthBonus;

  // Apply threshold - only return scores above 0.4 for fuzzy matching
  return finalScore >= 0.4 ? Math.min(finalScore, 1.0) : 0;
}


/**
 * Perform intelligent hybrid search combining exact, substring, and fuzzy matching
 */
export function performHybridSearch<T>(
  items: T[],
  query: string,
  getSearchFields: (item: T) => { name?: string; description?: string; sql?: string },
  fuzzyThreshold: number = 0.4,
  maxResults: number = 50
): Array<T & { search_score: number; match_type: string; matched_field: string }> {
  const results: Array<T & { search_score: number; match_type: string; matched_field: string }> = [];
  const queryLower = query.toLowerCase().trim();

  for (const item of items) {
    const fields = getSearchFields(item);
    let bestScore = 0;
    let bestMatchType = '';
    let bestField = '';

    // Check each field (name, description, SQL)
    for (const [fieldName, fieldValue] of Object.entries(fields)) {
      if (!fieldValue) continue;

      const fieldLower = fieldValue.toLowerCase();
      let score = 0;
      let matchType = '';

      // 1. Exact match (highest priority)
      if (fieldLower === queryLower) {
        score = 1.0;
        matchType = 'exact';
      }
      // 2. Substring match (high priority)
      else if (fieldLower.includes(queryLower)) {
        // Score based on how much of the field the query represents
        const ratio = queryLower.length / fieldLower.length;
        score = 0.85 + (ratio * 0.1); // 0.85-0.95 range
        matchType = 'substring';
      }
      // 3. Fuzzy match (lower priority)
      else {
        const fuzzyScore = calculateFuzzyScore(query, fieldValue);
        if (fuzzyScore >= fuzzyThreshold) {
          score = fuzzyScore;
          matchType = 'fuzzy';
        }
      }

      // Keep the best match for this item
      if (score > bestScore) {
        bestScore = score;
        bestMatchType = matchType;
        bestField = `${fieldName}: ${fieldValue.substring(0, 50)}${fieldValue.length > 50 ? '...' : ''}`;
      }
    }

    // Add item if it has any match
    if (bestScore > 0) {
      results.push({
        ...item,
        search_score: bestScore,
        match_type: bestMatchType,
        matched_field: bestField
      });
    }
  }

  // Sort by score (descending) and limit results
  return results
    .sort((a, b) => b.search_score - a.search_score)
    .slice(0, maxResults);
}

/**
 * Perform exact phrase search
 */
export function performExactSearch<T>(
  items: T[],
  query: string,
  getSearchFields: (item: T) => { name?: string; description?: string; sql?: string },
  maxResults: number = 50
): Array<T & { matched_field: string }> {
  const results: Array<T & { matched_field: string }> = [];
  const queryLower = query.toLowerCase().trim();

  for (const item of items) {
    const fields = getSearchFields(item);
    let matchedField = '';

    // Check each field for exact phrase match
    for (const [fieldName, fieldValue] of Object.entries(fields)) {
      if (!fieldValue) continue;

      const fieldLower = fieldValue.toLowerCase();
      if (fieldLower.includes(queryLower)) {
        matchedField = `${fieldName}: ${fieldValue.substring(0, 50)}${fieldValue.length > 50 ? '...' : ''}`;
        break; // Take first match
      }
    }

    // Add item if exact phrase was found
    if (matchedField) {
      results.push({
        ...item,
        matched_field: matchedField
      });
    }
  }

  return results.slice(0, maxResults);
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

${format === 'xlsx' ?
    `Excel file exported successfully. ${saveFile && !fileSaveError ?
      `File has been saved to: ${savedFilePath}\nCompatible with: Excel, Google Sheets, LibreOffice Calc, and other spreadsheet applications` :
      'To save this Excel file:\n1. Set save_file: true in your export_query parameters\n2. The file will be automatically saved to your Downloads folder\n3. Open with Excel, Google Sheets, or any spreadsheet application'
    }\n\nTechnical Details:\n- Binary Data: Contains Excel binary data (.xlsx format)\n- High Capacity: Supports up to 1 million rows (vs. 2,000 row limit of standard queries)\n- Native Format: Preserves data types and formatting for spreadsheet applications` :
    '```' + format + '\n'
}`;
}
