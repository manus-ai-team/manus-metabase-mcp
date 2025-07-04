/**
 * Unit tests for the executeQuery handler
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleExecuteQuery } from '../../src/handlers/executeQuery.js';
import { McpError } from '../../src/types/core.js';
import {
  mockApiClient,
  mockLogger,
  resetAllMocks,
  createMockRequest,
  getLoggerFunctions,
  sampleQueryResult
} from '../setup.js';

describe('handleExecuteQuery', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  describe('Parameter validation', () => {
    it('should throw error when database_id parameter is missing', async () => {
      const request = createMockRequest('execute_query', { query: 'SELECT 1' });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      await expect(
        handleExecuteQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError)
      ).rejects.toThrow(McpError);

      expect(mockLogger.logWarn).toHaveBeenCalledWith(
        'Missing database_id parameter in execute_query request',
        { requestId: 'test-request-id' }
      );
    });

    it('should throw error when query parameter is missing', async () => {
      const request = createMockRequest('execute_query', { database_id: 1 });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      await expect(
        handleExecuteQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError)
      ).rejects.toThrow(McpError);

      expect(mockLogger.logWarn).toHaveBeenCalledWith(
        'Missing or invalid query parameter in execute_query request',
        { requestId: 'test-request-id' }
      );
    });

    it('should throw error when query parameter is not a string', async () => {
      const request = createMockRequest('execute_query', { database_id: 1, query: 123 });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      await expect(
        handleExecuteQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError)
      ).rejects.toThrow(McpError);

      expect(mockLogger.logWarn).toHaveBeenCalledWith(
        'Missing or invalid query parameter in execute_query request',
        { requestId: 'test-request-id' }
      );
    });

    it('should throw error when row_limit is too small', async () => {
      const request = createMockRequest('execute_query', {
        database_id: 1,
        query: 'SELECT 1',
        row_limit: 0
      });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      await expect(
        handleExecuteQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError)
      ).rejects.toThrow(McpError);

      expect(mockLogger.logWarn).toHaveBeenCalledWith(
        'Invalid row_limit parameter: 0. Must be between 1 and 2000.',
        { requestId: 'test-request-id' }
      );
    });

    it('should throw error when row_limit is too large', async () => {
      const request = createMockRequest('execute_query', {
        database_id: 1,
        query: 'SELECT 1',
        row_limit: 3000
      });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      await expect(
        handleExecuteQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError)
      ).rejects.toThrow(McpError);

      expect(mockLogger.logWarn).toHaveBeenCalledWith(
        'Invalid row_limit parameter: 3000. Must be between 1 and 2000.',
        { requestId: 'test-request-id' }
      );
    });
  });

  describe('Query execution', () => {
    it('should successfully execute a simple query', async () => {
      mockApiClient.request.mockResolvedValue(sampleQueryResult);
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('execute_query', {
        database_id: 1,
        query: 'SELECT * FROM users'
      });

      const result = await handleExecuteQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockApiClient.request).toHaveBeenCalledWith('/api/dataset', {
        method: 'POST',
        body: JSON.stringify({
          type: 'native',
          native: {
            query: 'SELECT * FROM users LIMIT 500',
            template_tags: {},
          },
          parameters: [],
          database: 1,
        }),
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('success');
    });

    it('should use custom row limit', async () => {
      mockApiClient.request.mockResolvedValue(sampleQueryResult);
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('execute_query', {
        database_id: 1,
        query: 'SELECT * FROM users',
        row_limit: 100
      });

      await handleExecuteQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockApiClient.request).toHaveBeenCalledWith('/api/dataset', {
        method: 'POST',
        body: JSON.stringify({
          type: 'native',
          native: {
            query: 'SELECT * FROM users LIMIT 100',
            template_tags: {},
          },
          parameters: [],
          database: 1,
        }),
      });
    });

    it('should preserve existing LIMIT clause if more restrictive', async () => {
      mockApiClient.request.mockResolvedValue(sampleQueryResult);
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('execute_query', {
        database_id: 1,
        query: 'SELECT * FROM users LIMIT 10',
        row_limit: 100
      });

      await handleExecuteQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockApiClient.request).toHaveBeenCalledWith('/api/dataset', {
        method: 'POST',
        body: JSON.stringify({
          type: 'native',
          native: {
            query: 'SELECT * FROM users LIMIT 10',
            template_tags: {},
          },
          parameters: [],
          database: 1,
        }),
      });
    });

    it('should override existing LIMIT clause if less restrictive', async () => {
      mockApiClient.request.mockResolvedValue(sampleQueryResult);
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('execute_query', {
        database_id: 1,
        query: 'SELECT * FROM users LIMIT 1000',
        row_limit: 100
      });

      await handleExecuteQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockApiClient.request).toHaveBeenCalledWith('/api/dataset', {
        method: 'POST',
        body: JSON.stringify({
          type: 'native',
          native: {
            query: 'SELECT * FROM users LIMIT 100',
            template_tags: {},
          },
          parameters: [],
          database: 1,
        }),
      });
    });

    it('should handle native parameters', async () => {
      mockApiClient.request.mockResolvedValue(sampleQueryResult);
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const nativeParameters = [
        { type: 'text', target: ['variable', ['template-tag', 'user_id']], value: '123' }
      ];

      const request = createMockRequest('execute_query', {
        database_id: 1,
        query: 'SELECT * FROM users WHERE id = {{user_id}}',
        native_parameters: nativeParameters
      });

      await handleExecuteQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockApiClient.request).toHaveBeenCalledWith('/api/dataset', {
        method: 'POST',
        body: JSON.stringify({
          type: 'native',
          native: {
            query: 'SELECT * FROM users WHERE id = {{user_id}} LIMIT 500',
            template_tags: {},
          },
          parameters: nativeParameters,
          database: 1,
        }),
      });
    });

    it('should handle API errors', async () => {
      const apiError = new Error('Database connection failed');
      mockApiClient.request.mockRejectedValue(apiError);
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('execute_query', {
        database_id: 1,
        query: 'SELECT * FROM users'
      });

      await expect(
        handleExecuteQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError)
      ).rejects.toThrow(McpError);
    });
  });

  describe('Query formatting', () => {
    it('should handle queries with different whitespace', async () => {
      mockApiClient.request.mockResolvedValue(sampleQueryResult);
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('execute_query', {
        database_id: 1,
        query: '  SELECT * FROM users  \n\n  '
      });

      await handleExecuteQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockApiClient.request).toHaveBeenCalledWith('/api/dataset', {
        method: 'POST',
        body: JSON.stringify({
          type: 'native',
          native: {
            query: 'SELECT * FROM users LIMIT 500',
            template_tags: {},
          },
          parameters: [],
          database: 1,
        }),
      });
    });

    it('should handle queries ending with semicolon', async () => {
      mockApiClient.request.mockResolvedValue(sampleQueryResult);
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('execute_query', {
        database_id: 1,
        query: 'SELECT * FROM users;'
      });

      await handleExecuteQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockApiClient.request).toHaveBeenCalledWith('/api/dataset', {
        method: 'POST',
        body: JSON.stringify({
          type: 'native',
          native: {
            query: 'SELECT * FROM users LIMIT 500;',
            template_tags: {},
          },
          parameters: [],
          database: 1,
        }),
      });
    });
  });

  describe('Logging', () => {
    it('should log debug information', async () => {
      mockApiClient.request.mockResolvedValue(sampleQueryResult);
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('execute_query', {
        database_id: 1,
        query: 'SELECT * FROM users'
      });

      await handleExecuteQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockLogger.logDebug).toHaveBeenCalledWith(
        'Executing SQL query against database ID: 1 with row limit: 500'
      );
    });

    it('should log success information', async () => {
      mockApiClient.request.mockResolvedValue(sampleQueryResult);
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('execute_query', {
        database_id: 1,
        query: 'SELECT * FROM users'
      });

      await handleExecuteQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockLogger.logInfo).toHaveBeenCalledWith(
        expect.stringContaining('Successfully executed SQL query against database: 1')
      );
    });
  });

  describe('Default values', () => {
    it('should use default row limit when not specified', async () => {
      mockApiClient.request.mockResolvedValue(sampleQueryResult);
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('execute_query', {
        database_id: 1,
        query: 'SELECT * FROM users'
      });

      await handleExecuteQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockApiClient.request).toHaveBeenCalledWith('/api/dataset', {
        method: 'POST',
        body: JSON.stringify({
          type: 'native',
          native: {
            query: 'SELECT * FROM users LIMIT 500',
            template_tags: {},
          },
          parameters: [],
          database: 1,
        }),
      });
    });

    it('should use empty array for native_parameters when not specified', async () => {
      mockApiClient.request.mockResolvedValue(sampleQueryResult);
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('execute_query', {
        database_id: 1,
        query: 'SELECT * FROM users'
      });

      await handleExecuteQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockApiClient.request).toHaveBeenCalledWith('/api/dataset', {
        method: 'POST',
        body: JSON.stringify({
          type: 'native',
          native: {
            query: 'SELECT * FROM users LIMIT 500',
            template_tags: {},
          },
          parameters: [],
          database: 1,
        }),
      });
    });
  });
});
