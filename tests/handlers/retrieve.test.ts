/**
 * Unit tests for the retrieve handler
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleRetrieve } from '../../src/handlers/retrieve/index.js';
import { McpError } from '../../src/types/core.js';
import {
  mockApiClient,
  mockLogger,
  resetAllMocks,
  createMockRequest,
  createCachedResponse,
  getLoggerFunctions,
  sampleCard,
  sampleDashboard,
  sampleTable,
  sampleDatabase,
  sampleCollection,
  sampleField
} from '../setup.js';

describe('handleRetrieve', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  describe('Parameter validation', () => {
    it('should throw error when model parameter is missing', async () => {
      const request = createMockRequest('retrieve', { ids: [1] });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      await expect(
        handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError)
      ).rejects.toThrow(McpError);

      expect(mockLogger.logWarn).toHaveBeenCalledWith(
        'Missing model parameter in retrieve request',
        { requestId: 'test-request-id' }
      );
    });

    it('should throw error when ids parameter is missing', async () => {
      const request = createMockRequest('retrieve', { model: 'card' });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      await expect(
        handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError)
      ).rejects.toThrow(McpError);

      expect(mockLogger.logWarn).toHaveBeenCalledWith(
        'Missing or invalid ids parameter in retrieve request',
        { requestId: 'test-request-id' }
      );
    });

    it('should throw error when ids parameter is empty array', async () => {
      const request = createMockRequest('retrieve', { model: 'card', ids: [] });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      await expect(
        handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError)
      ).rejects.toThrow(McpError);

      expect(mockLogger.logWarn).toHaveBeenCalledWith(
        'Missing or invalid ids parameter in retrieve request',
        { requestId: 'test-request-id' }
      );
    });

    it('should throw error when model is invalid', async () => {
      const request = createMockRequest('retrieve', { model: 'invalid-model', ids: [1] });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      await expect(
        handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError)
      ).rejects.toThrow(McpError);

      expect(mockLogger.logWarn).toHaveBeenCalledWith(
        'Invalid model parameter: invalid-model',
        expect.objectContaining({ 
          requestId: 'test-request-id',
          validValues: expect.any(Array)
        })
      );
    });

    it('should throw error when too many IDs are requested', async () => {
      const tooManyIds = Array.from({ length: 101 }, (_, i) => i + 1); // Assuming MAX_IDS_PER_REQUEST is 100
      const request = createMockRequest('retrieve', { model: 'card', ids: tooManyIds });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      await expect(
        handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError)
      ).rejects.toThrow(McpError);

      expect(mockLogger.logWarn).toHaveBeenCalledWith(
        expect.stringContaining('Too many IDs requested'),
        { requestId: 'test-request-id' }
      );
    });

    it('should throw error when ID is not a positive integer', async () => {
      const request = createMockRequest('retrieve', { model: 'card', ids: [0] });
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      await expect(
        handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError)
      ).rejects.toThrow(McpError);

      expect(mockLogger.logWarn).toHaveBeenCalledWith(
        'Invalid id parameter - must be a positive number',
        expect.objectContaining({ 
          requestId: 'test-request-id',
          value: 0
        })
      );
    });
  });

  describe('Card retrieval', () => {
    it('should successfully retrieve cards', async () => {
      mockApiClient.getCard.mockResolvedValue(createCachedResponse(sampleCard));
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('retrieve', { model: 'card', ids: [1] });
      const result = await handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockApiClient.getCard).toHaveBeenCalledWith(1);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Test Card');
    });

    it('should handle multiple card IDs', async () => {
      mockApiClient.getCard.mockResolvedValue(createCachedResponse(sampleCard));
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('retrieve', { model: 'card', ids: [1, 2] });
      const result = await handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockApiClient.getCard).toHaveBeenCalledTimes(2);
      expect(mockApiClient.getCard).toHaveBeenCalledWith(1);
      expect(mockApiClient.getCard).toHaveBeenCalledWith(2);
      expect(result.content[0].text).toContain('successful_retrievals');
    });

    it('should handle API errors for card retrieval', async () => {
      const apiError = new Error('API Error');
      mockApiClient.getCard.mockRejectedValue(apiError);
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('retrieve', { model: 'card', ids: [1] });
      
      // When all requests fail, it should now throw an error instead of returning partial success
      await expect(
        handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError)
      ).rejects.toThrow();

      expect(mockApiClient.getCard).toHaveBeenCalledWith(1);
    });

    it('should handle partial failures (some succeed, some fail)', async () => {
      const sampleCard = { id: 1, name: 'Test Card' };
      const apiError = new Error('API Error');
      
      // First call succeeds, second fails
      mockApiClient.getCard
        .mockResolvedValueOnce(createCachedResponse(sampleCard))
        .mockRejectedValueOnce(apiError);
        
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('retrieve', { model: 'card', ids: [1, 2] });
      const result = await handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockApiClient.getCard).toHaveBeenCalledTimes(2);
      expect(result.content[0].text).toContain('successful_retrievals');
      expect(result.content[0].text).toContain('failed_retrievals');
      expect(result.content[0].text).toContain('1/2 cards successfully');
    });

    it('should include values_source_type and values_source_config in card parameters', async () => {
      const cardWithParameters = {
        ...sampleCard,
        parameters: [
          {
            id: 'param1',
            name: 'Test Parameter',
            type: 'category',
            slug: 'test_param',
            target: ['dimension', ['template-tag', 'test_param']],
            values_source_type: 'static-list',
            values_source_config: {
              values: ['option1', 'option2', 'option3']
            }
          },
          {
            id: 'param2',
            name: 'Simple Parameter',
            type: 'text',
            slug: 'simple_param',
            target: ['dimension', ['template-tag', 'simple_param']]
            // No values_source_type or values_source_config
          }
        ]
      };
      
      mockApiClient.getCard.mockResolvedValue(createCachedResponse(cardWithParameters));
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('retrieve', { model: 'card', ids: [1] });
      const result = await handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(result.content).toHaveLength(1);
      const responseData = JSON.parse(result.content[0].text);
      
      // Check that optimized card includes parameters
      expect(responseData.results).toHaveLength(1);
      const optimizedCard = responseData.results[0];
      expect(optimizedCard.parameters).toHaveLength(2);
      
      // Check first parameter has values source information
      const param1 = optimizedCard.parameters.find((p: any) => p.id === 'param1');
      expect(param1).toBeDefined();
      expect(param1.values_source_type).toBe('static-list');
      expect(param1.values_source_config).toEqual({
        values: ['option1', 'option2', 'option3']
      });
      
      // Check second parameter doesn't have values source information
      const param2 = optimizedCard.parameters.find((p: any) => p.id === 'param2');
      expect(param2).toBeDefined();
      expect(param2.values_source_type).toBeUndefined();
      expect(param2.values_source_config).toBeUndefined();
    });
  });

  describe('Database retrieval', () => {
    it('should handle database not found error correctly', async () => {
      // Mock a 404 error with enhanced error details for non-existent database
      const mockError = {
        details: {
          category: 'resource_not_found',
          httpStatus: 404,
          retryable: false
        },
        message: 'database not found: 999'
      };
      Object.setPrototypeOf(mockError, McpError.prototype);
      
      mockApiClient.getDatabase.mockRejectedValue(mockError);
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('retrieve', { model: 'database', ids: [999] });
      
      // Should throw a proper resource not found error, not a database connection error
      await expect(
        handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError)
      ).rejects.toThrow('database not found');

      expect(mockApiClient.getDatabase).toHaveBeenCalledWith(999);
    });
  });

  describe('Dashboard retrieval', () => {
    it('should successfully retrieve dashboards', async () => {
      mockApiClient.getDashboard.mockResolvedValue(createCachedResponse(sampleDashboard));
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('retrieve', { model: 'dashboard', ids: [1] });
      const result = await handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockApiClient.getDashboard).toHaveBeenCalledWith(1);
      expect(result.content[0].text).toContain('Test Dashboard');
    });
  });

  describe('Table retrieval', () => {
    it('should successfully retrieve tables', async () => {
      mockApiClient.getTable.mockResolvedValue(createCachedResponse(sampleTable));
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('retrieve', { model: 'table', ids: [1] });
      const result = await handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockApiClient.getTable).toHaveBeenCalledWith(1);
      expect(result.content[0].text).toContain('Test Table');
    });
  });

  describe('Database retrieval', () => {
    it('should successfully retrieve databases', async () => {
      mockApiClient.getDatabase.mockResolvedValue(createCachedResponse(sampleDatabase));
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('retrieve', { model: 'database', ids: [1] });
      const result = await handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockApiClient.getDatabase).toHaveBeenCalledWith(1);
      expect(result.content[0].text).toContain('Test Database');
    });
  });

  describe('Collection retrieval', () => {
    it('should successfully retrieve collections', async () => {
      mockApiClient.getCollection.mockResolvedValue(createCachedResponse(sampleCollection));
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('retrieve', { model: 'collection', ids: [1] });
      const result = await handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockApiClient.getCollection).toHaveBeenCalledWith(1);
      expect(result.content[0].text).toContain('Test Collection');
    });
  });

  describe('Field retrieval', () => {
    it('should successfully retrieve fields', async () => {
      mockApiClient.getField.mockResolvedValue(createCachedResponse(sampleField));
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('retrieve', { model: 'field', ids: [1] });
      const result = await handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockApiClient.getField).toHaveBeenCalledWith(1);
      expect(result.content[0].text).toContain('successful_retrievals');
      expect(result.content[0].text).toContain('Test Field');
    });
  });

  describe('Logging', () => {
    it('should log debug information', async () => {
      mockApiClient.getCard.mockResolvedValue(createCachedResponse(sampleCard));
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('retrieve', { model: 'card', ids: [1] });
      await handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockLogger.logDebug).toHaveBeenCalledWith('Retrieving card details for IDs: 1');
    });

    it('should log success information', async () => {
      mockApiClient.getCard.mockResolvedValue(sampleCard);
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('retrieve', { model: 'card', ids: [1] });
      await handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(mockLogger.logInfo).toHaveBeenCalledWith(
        'Successfully retrieved 1 cards (source: api)'
      );
    });
  });

  describe('Cache source handling', () => {
    it('should indicate cache source in response', async () => {
      mockApiClient.getCard.mockResolvedValue(createCachedResponse(sampleCard, 'cache'));
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('retrieve', { model: 'card', ids: [1] });
      const result = await handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(result.content[0].text).toContain('"primary_source": "cache"');
    });

    it('should indicate API source in response', async () => {
      mockApiClient.getCard.mockResolvedValue(sampleCard);
      const [logDebug, logInfo, logWarn, logError] = getLoggerFunctions();

      const request = createMockRequest('retrieve', { model: 'card', ids: [1] });
      const result = await handleRetrieve(request, 'test-request-id', mockApiClient as any, logDebug, logInfo, logWarn, logError);

      expect(result.content[0].text).toContain('"primary_source": "api"');
    });
  });
});
