import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleListResources, handleReadResource } from '../../src/handlers/resources/resourceHandlers.js';

// Mock the API client
vi.mock('../../src/api.js');

describe('Resource Handlers', () => {
  let mockApiClient: any;
  let mockLoggers: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockApiClient = {
      getSessionToken: vi.fn().mockResolvedValue('test-token'),
      getCurrentUser: vi.fn(),
      getCollectionsList: vi.fn(),
      getDatabasesList: vi.fn(),
      getCollection: vi.fn(),
      getCollectionItems: vi.fn(),
    };

    mockLoggers = {
      logInfo: vi.fn(),
      logDebug: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
    };
  });

  describe('handleListResources - Collections and Databases Only', () => {
    it('should list collections and databases only (no cards or dashboards)', async () => {

      const mockCollections = {
        data: [
          {
            id: 1,
            name: 'Finance',
            description: 'Financial reports',
            personal_owner_id: null,
            location: '/'
          },
          {
            id: 2,
            name: 'Marketing',
            description: 'Marketing analytics',
            personal_owner_id: null,
            location: '/'
          },
          {
            id: 3,
            name: 'Personal Collection',
            personal_owner_id: 5,
            location: '/'
          },
          {
            id: 4,
            name: 'Nested Collection',
            personal_owner_id: null,
            location: '/1/'
          }
        ],
        source: 'api'
      };

      const mockDatabases = {
        data: [
          {
            id: 1,
            name: 'Production DB',
            engine: 'postgres',
            is_sample: false
          },
          {
            id: 2,
            name: 'Sample Database',
            engine: 'h2',
            is_sample: true
          }
        ],
        source: 'api'
      };

      mockApiClient.getCurrentUser.mockResolvedValue({ data: { id: 5 }, source: 'api' });
      mockApiClient.getCollectionsList.mockResolvedValue(mockCollections);
      mockApiClient.getDatabasesList.mockResolvedValue(mockDatabases);

      const result = await handleListResources(
        { method: 'list' } as any,
        mockApiClient,
        mockLoggers.logInfo,
        mockLoggers.logError
      );

      // Check that API methods were called (no longer calling cards/dashboards)
      expect(mockApiClient.getCurrentUser).toHaveBeenCalled();
      expect(mockApiClient.getCollectionsList).toHaveBeenCalled();
      expect(mockApiClient.getDatabasesList).toHaveBeenCalled();

      // Should have 3 collections: 2 root collections + 1 personal collection (user ID = 5)
      const collectionResources = result.resources.filter(r => r.name.startsWith('[Collection]'));
      expect(collectionResources).toHaveLength(3);
      expect(collectionResources.some(r => r.name === '[Collection] Finance')).toBe(true);
      expect(collectionResources.some(r => r.name === '[Collection] Marketing')).toBe(true);
      expect(collectionResources.some(r => r.name === '[Collection] Personal Collection')).toBe(true);

      // Should have 1 database (sample databases filtered out)
      const databaseResources = result.resources.filter(r => r.name.startsWith('[Database]'));
      expect(databaseResources).toHaveLength(1);
      expect(databaseResources[0].name).toBe('[Database] Production DB');

      // Total should be 3 + 1 = 4
      expect(result.resources).toHaveLength(4);
    });

    it('should handle empty responses gracefully', async () => {
      mockApiClient.getCurrentUser.mockResolvedValue({ data: { id: 1 }, source: 'api' });
      mockApiClient.getCollectionsList.mockResolvedValue({ data: [], source: 'api' });
      mockApiClient.getDatabasesList.mockResolvedValue({ data: [], source: 'api' });

      const result = await handleListResources(
        { method: 'list' } as any,
        mockApiClient,
        mockLoggers.logInfo,
        mockLoggers.logError
      );

      expect(result.resources).toEqual([]);
    });

    it('should filter sample databases', async () => {
      const mockDatabases = {
        data: [
          { id: 1, name: 'Production DB', engine: 'postgres', is_sample: false },
          { id: 2, name: 'Sample Database', engine: 'h2', is_sample: true }
        ],
        source: 'api'
      };

      mockApiClient.getCurrentUser.mockResolvedValue({ data: { id: 1 }, source: 'api' });
      mockApiClient.getCollectionsList.mockResolvedValue({ data: [], source: 'api' });
      mockApiClient.getDatabasesList.mockResolvedValue(mockDatabases);

      const result = await handleListResources(
        { method: 'list' } as any,
        mockApiClient,
        mockLoggers.logInfo,
        mockLoggers.logError
      );

      // Should only include non-sample databases
      const databaseResources = result.resources.filter(r => r.name.startsWith('[Database]'));
      expect(databaseResources).toHaveLength(1);
      expect(databaseResources[0].name).toBe('[Database] Production DB');
    });

    it('should include user\'s own personal collection but exclude others', async () => {
      const mockCollections = {
        data: [
          {
            id: 1,
            name: 'Finance',
            description: 'Financial reports',
            personal_owner_id: null,
            location: '/'
          },
          {
            id: 2,
            name: 'User Personal Collection',
            personal_owner_id: 123,
            location: '/'
          },
          {
            id: 3,
            name: 'Other User Personal Collection',
            personal_owner_id: 456,
            location: '/'
          }
        ],
        source: 'api'
      };

      mockApiClient.getCurrentUser.mockResolvedValue({ data: { id: 123 }, source: 'api' });
      mockApiClient.getCollectionsList.mockResolvedValue(mockCollections);
      mockApiClient.getDatabasesList.mockResolvedValue({ data: [], source: 'api' });

      const result = await handleListResources(
        { method: 'list' } as any,
        mockApiClient,
        mockLoggers.logInfo,
        mockLoggers.logError
      );

      const collectionResources = result.resources.filter(r => r.name.startsWith('[Collection]'));
      expect(collectionResources).toHaveLength(2); // Finance + User's personal collection
      expect(collectionResources.some(r => r.name === '[Collection] Finance')).toBe(true);
      expect(collectionResources.some(r => r.name === '[Collection] User Personal Collection')).toBe(true);
      expect(collectionResources.some(r => r.name === '[Collection] Other User Personal Collection')).toBe(false);
    });

    it('should exclude all personal collections when getCurrentUser fails', async () => {
      const mockCollections = {
        data: [
          {
            id: 1,
            name: 'Finance',
            description: 'Financial reports',
            personal_owner_id: null,
            location: '/'
          },
          {
            id: 2,
            name: 'User Personal Collection',
            personal_owner_id: 123,
            location: '/'
          }
        ],
        source: 'api'
      };

      mockApiClient.getCurrentUser.mockRejectedValue(new Error('Failed to get user'));
      mockApiClient.getCollectionsList.mockResolvedValue(mockCollections);
      mockApiClient.getDatabasesList.mockResolvedValue({ data: [], source: 'api' });

      const result = await handleListResources(
        { method: 'list' } as any,
        mockApiClient,
        mockLoggers.logInfo,
        mockLoggers.logError
      );

      const collectionResources = result.resources.filter(r => r.name.startsWith('[Collection]'));
      expect(collectionResources).toHaveLength(1); // Only Finance collection
      expect(collectionResources[0].name).toBe('[Collection] Finance');
    });

    it('should filter nested collections correctly', async () => {
      const mockCollections = {
        data: [
          {
            id: 1,
            name: 'Root Collection',
            personal_owner_id: null,
            location: '/'
          },
          {
            id: 2,
            name: 'Nested Collection',
            personal_owner_id: null,
            location: '/1/'
          },
          {
            id: 3,
            name: 'User Personal Collection',
            personal_owner_id: 123,
            location: '/'
          }
        ],
        source: 'api'
      };

      mockApiClient.getCurrentUser.mockResolvedValue({ data: { id: 123 }, source: 'api' });
      mockApiClient.getCollectionsList.mockResolvedValue(mockCollections);
      mockApiClient.getDatabasesList.mockResolvedValue({ data: [], source: 'api' });

      const result = await handleListResources(
        { method: 'list' } as any,
        mockApiClient,
        mockLoggers.logInfo,
        mockLoggers.logError
      );

      const collectionResources = result.resources.filter(r => r.name.startsWith('[Collection]'));
      expect(collectionResources).toHaveLength(2); // Root Collection + User's personal collection
      expect(collectionResources.some(r => r.name === '[Collection] Root Collection')).toBe(true);
      expect(collectionResources.some(r => r.name === '[Collection] User Personal Collection')).toBe(true);
      expect(collectionResources.some(r => r.name === '[Collection] Nested Collection')).toBe(false);
    });

    it('should sort personal collections to the top of the collections list', async () => {
      const mockCollections = {
        data: [
          {
            id: 1,
            name: 'Analytics',
            description: 'Analytics collection',
            personal_owner_id: null,
            location: '/'
          },
          {
            id: 2,
            name: 'My Personal Collection',
            personal_owner_id: 123,
            location: '/'
          },
          {
            id: 3,
            name: 'Finance',
            description: 'Finance collection',
            personal_owner_id: null,
            location: '/'
          }
        ],
        source: 'api'
      };

      mockApiClient.getCurrentUser.mockResolvedValue({ data: { id: 123 }, source: 'api' });
      mockApiClient.getCollectionsList.mockResolvedValue(mockCollections);
      mockApiClient.getDatabasesList.mockResolvedValue({ data: [], source: 'api' });

      const result = await handleListResources(
        { method: 'list' } as any,
        mockApiClient,
        mockLoggers.logInfo,
        mockLoggers.logError
      );

      const collectionResources = result.resources.filter(r => r.name.startsWith('[Collection]'));
      expect(collectionResources).toHaveLength(3);
      
      // Personal collection should be first, then alphabetical order for regular collections
      expect(collectionResources[0].name).toBe('[Collection] My Personal Collection');
      expect(collectionResources[1].name).toBe('[Collection] Analytics');
      expect(collectionResources[2].name).toBe('[Collection] Finance');
    });
  });

  describe('handleReadResource - Collection Resources', () => {
    it('should handle individual collection resource with items', async () => {
      const mockCollection = {
        data: {
          id: 1,
          name: 'Marketing',
          description: 'Marketing analytics',
          location: '/',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-15T00:00:00Z',
          archived: false
        },
        source: 'api'
      };

      const mockCollectionItems = {
        data: [
          {
            id: 10,
            name: 'Marketing Dashboard',
            description: 'Marketing KPIs',
            model: 'dashboard',
            view_count: 150
          },
          {
            id: 20,
            name: 'Marketing Report',
            description: 'Monthly marketing report',
            model: 'card',
            view_count: 75
          },
          {
            id: 30,
            name: 'Campaigns',
            description: 'Campaign collection',
            model: 'collection'
          }
        ],
        source: 'api'
      };

      mockApiClient.getCollection.mockResolvedValue(mockCollection);
      mockApiClient.getCollectionItems.mockResolvedValue(mockCollectionItems);

      const result = await handleReadResource(
        { params: { uri: 'metabase://collection/1' } } as any,
        mockApiClient,
        mockLoggers.logInfo,
        mockLoggers.logWarn,
        mockLoggers.logDebug,
        mockLoggers.logError
      );

      const content = JSON.parse(result.contents[0].text!);
      expect(content.name).toBe('Marketing');
      expect(content.description).toBe('Marketing analytics');
      expect(content.items.total_count).toBe(3);
      expect(content.items.dashboards).toHaveLength(1);
      expect(content.items.cards).toHaveLength(1);
      expect(content.items.collections).toHaveLength(1);
      expect(content.items.dashboards[0].name).toBe('Marketing Dashboard');
      expect(content.items.cards[0].name).toBe('Marketing Report');
      expect(content.items.collections[0].name).toBe('Campaigns');
    });
  });
});