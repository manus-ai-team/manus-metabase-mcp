/**
 * Unit tests for the exportQuery handler
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleExportQuery } from '../../src/handlers/exportQuery.js';
import { McpError } from '../../src/types/core.js';
import {
  mockApiClient,
  mockLogger,
  resetAllMocks,
  createMockRequest,
  getLoggerFunctions
} from '../setup.js';

// Mock the config module to use test environment variables
vi.mock('../../src/config.js', () => ({
  config: {
    METABASE_URL: 'https://test-metabase.example.com',
    METABASE_API_KEY: 'test-api-key',
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    CACHE_TTL_MS: 600000,
    REQUEST_TIMEOUT_MS: 600000,
  },
  authMethod: 'api_key',
  AuthMethod: {
    SESSION: 'session',
    API_KEY: 'api_key',
  },
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Mock os module
vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/user'),
}));

// Mock path module
vi.mock('path', () => ({
  join: vi.fn((...args) => args.join('/')),
}));

describe('handleExportQuery', () => {
  beforeEach(() => {
    resetAllMocks();
    mockFetch.mockClear();
  });

  describe('Parameter validation', () => {
    it('should throw error when database_id parameter is missing', async () => {
      const request = createMockRequest('export_query', { query: 'SELECT * FROM users' });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      await expect(
        handleExportQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError)
      ).rejects.toThrow(McpError);
    });

    it('should throw error when query parameter is missing', async () => {
      const request = createMockRequest('export_query', { database_id: 1 });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      await expect(
        handleExportQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError)
      ).rejects.toThrow(McpError);
    });

    it('should throw error when format is invalid', async () => {
      const request = createMockRequest('export_query', {
        database_id: 1,
        query: 'SELECT * FROM users',
        format: 'invalid'
      });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      await expect(
        handleExportQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError)
      ).rejects.toThrow(McpError);
    });
  });

  describe('Export functionality', () => {
    it('should successfully export query in CSV format', async () => {
      const csvData = 'id,name\n1,John\n2,Jane';
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(csvData),
      });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('export_query', {
        database_id: 1,
        query: 'SELECT * FROM users',
        format: 'csv'
      });

      const result = await handleExportQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-metabase.example.com/api/dataset/csv',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('SELECT * FROM users'),
        })
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('success');
    });

    it('should successfully export query in JSON format', async () => {
      const jsonData = [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }];
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(jsonData),
      });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('export_query', {
        database_id: 1,
        query: 'SELECT * FROM users',
        format: 'json'
      });

      const result = await handleExportQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-metabase.example.com/api/dataset/json',
        expect.objectContaining({
          method: 'POST',
        })
      );

      expect(result.content[0].text).toContain('success');
    });

    it('should successfully export query in XLSX format', async () => {
      const xlsxData = new ArrayBuffer(1000);
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(xlsxData),
      });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('export_query', {
        database_id: 1,
        query: 'SELECT * FROM users',
        format: 'xlsx'
      });

      const result = await handleExportQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-metabase.example.com/api/dataset/xlsx',
        expect.objectContaining({
          method: 'POST',
        })
      );

      expect(result.content[0].text).toContain('success');
    });

    it('should use custom filename when provided', async () => {
      const csvData = 'id,name\n1,John';
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(csvData),
      });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('export_query', {
        database_id: 1,
        query: 'SELECT * FROM users',
        format: 'csv',
        filename: 'custom_export'
      });

      const result = await handleExportQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(result.content[0].text).toContain('custom_export');
    });

    it('should handle native parameters', async () => {
      const csvData = 'id,name\n1,John';
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(csvData),
      });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const nativeParameters = [
        { type: 'text', target: ['variable', ['template-tag', 'user_id']], value: '123' }
      ];

      const request = createMockRequest('export_query', {
        database_id: 1,
        query: 'SELECT * FROM users WHERE id = {{user_id}}',
        format: 'csv',
        native_parameters: nativeParameters
      });

      const result = await handleExportQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('parameters'),
        })
      );

      expect(result.content[0].text).toContain('success');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: 'Database error' }),
      });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('export_query', {
        database_id: 1,
        query: 'SELECT * FROM users',
        format: 'csv'
      });

      await expect(
        handleExportQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError)
      ).rejects.toThrow();
    });
  });

  describe('Default values', () => {
    it('should use CSV as default format', async () => {
      const csvData = 'id,name\n1,John';
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(csvData),
      });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('export_query', {
        database_id: 1,
        query: 'SELECT * FROM users'
      });

      await handleExportQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-metabase.example.com/api/dataset/csv',
        expect.any(Object)
      );
    });

    it('should use empty array for native_parameters when not specified', async () => {
      const csvData = 'id,name\n1,John';
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(csvData),
      });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('export_query', {
        database_id: 1,
        query: 'SELECT * FROM users'
      });

      await handleExportQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"parameters":[]'),
        })
      );
    });
  });

  describe('Logging', () => {
    it('should log debug information', async () => {
      const csvData = 'id,name\n1,John';
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(csvData),
      });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('export_query', {
        database_id: 1,
        query: 'SELECT * FROM users'
      });

      await handleExportQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockLogger.logDebug).toHaveBeenCalledWith(
        expect.stringContaining('CSV export row count')
      );
    });

    it('should log success information', async () => {
      const csvData = 'id,name\n1,John';
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(csvData),
      });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('export_query', {
        database_id: 1,
        query: 'SELECT * FROM users'
      });

      await handleExportQuery(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockLogger.logInfo).toHaveBeenCalledWith(
        expect.stringContaining('Successfully exported to')
      );
    });
  });
});
