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
      getCardsList: vi.fn(),
      getDashboardsList: vi.fn(),
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

  describe('handleListResources - View-Based Approach', () => {
    it('should list top 20 cards, top 20 dashboards, all collections, and all databases', async () => {
      // Mock data with 25 cards - should get top 20 by views
      const mockCards = {
        data: Array.from({ length: 25 }, (_, i) => ({
          id: i + 1,
          name: `Card ${i + 1}`,
          description: `Description for card ${i + 1}`,
          view_count: 100 - i, // Descending view counts
          archived: false
        })),
        source: 'api'
      };

      // Mock data with 25 dashboards - should get top 20 by views
      const mockDashboards = {
        data: Array.from({ length: 25 }, (_, i) => ({
          id: i + 1,
          name: `Dashboard ${i + 1}`,
          description: `Description for dashboard ${i + 1}`,
          view_count: 200 - i, // Descending view counts
          archived: false
        })),
        source: 'api'
      };

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

      mockApiClient.getCardsList.mockResolvedValue(mockCards);
      mockApiClient.getDashboardsList.mockResolvedValue(mockDashboards);
      mockApiClient.getCollectionsList.mockResolvedValue(mockCollections);
      mockApiClient.getDatabasesList.mockResolvedValue(mockDatabases);

      const result = await handleListResources(
        { method: 'list' } as any,
        mockApiClient,
        mockLoggers.logInfo,
        mockLoggers.logError
      );

      // Check that all API methods were called
      expect(mockApiClient.getCardsList).toHaveBeenCalled();
      expect(mockApiClient.getDashboardsList).toHaveBeenCalled();
      expect(mockApiClient.getCollectionsList).toHaveBeenCalled();
      expect(mockApiClient.getDatabasesList).toHaveBeenCalled();

      // Should have exactly 20 cards (top by views)
      const cardResources = result.resources.filter(r => r.name.startsWith('[Card]'));
      expect(cardResources).toHaveLength(20);
      expect(cardResources[0].name).toBe('[Card] Card 1'); // Highest view count
      expect(cardResources[0].description).toContain('100 views');

      // Should have exactly 20 dashboards (top by views)
      const dashboardResources = result.resources.filter(r => r.name.startsWith('[Dashboard]'));
      expect(dashboardResources).toHaveLength(20);
      expect(dashboardResources[0].name).toBe('[Dashboard] Dashboard 1'); // Highest view count
      expect(dashboardResources[0].description).toContain('200 views');

      // Should have 2 root collections (personal and nested collections filtered out)
      const collectionResources = result.resources.filter(r => r.name.startsWith('[Collection]'));
      expect(collectionResources).toHaveLength(2);
      expect(collectionResources.some(r => r.name === '[Collection] Finance')).toBe(true);
      expect(collectionResources.some(r => r.name === '[Collection] Marketing')).toBe(true);

      // Should have 1 database (sample databases filtered out)
      const databaseResources = result.resources.filter(r => r.name.startsWith('[Database]'));
      expect(databaseResources).toHaveLength(1);
      expect(databaseResources[0].name).toBe('[Database] Production DB');

      // Total should be 20 + 20 + 2 + 1 = 43
      expect(result.resources).toHaveLength(43);
    });

    it('should handle empty responses gracefully', async () => {
      mockApiClient.getCardsList.mockResolvedValue({ data: [], source: 'api' });
      mockApiClient.getDashboardsList.mockResolvedValue({ data: [], source: 'api' });
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

    it('should filter archived cards and dashboards', async () => {
      const mockCards = {
        data: [
          { id: 1, name: 'Active Card', view_count: 100, archived: false },
          { id: 2, name: 'Archived Card', view_count: 200, archived: true }
        ],
        source: 'api'
      };

      const mockDashboards = {
        data: [
          { id: 1, name: 'Active Dashboard', view_count: 100, archived: false },
          { id: 2, name: 'Archived Dashboard', view_count: 200, archived: true }
        ],
        source: 'api'
      };

      mockApiClient.getCardsList.mockResolvedValue(mockCards);
      mockApiClient.getDashboardsList.mockResolvedValue(mockDashboards);
      mockApiClient.getCollectionsList.mockResolvedValue({ data: [], source: 'api' });
      mockApiClient.getDatabasesList.mockResolvedValue({ data: [], source: 'api' });

      const result = await handleListResources(
        { method: 'list' } as any,
        mockApiClient,
        mockLoggers.logInfo,
        mockLoggers.logError
      );

      // Should only include active cards and dashboards
      const cardResources = result.resources.filter(r => r.name.startsWith('[Card]'));
      expect(cardResources).toHaveLength(1);
      expect(cardResources[0].name).toBe('[Card] Active Card');

      const dashboardResources = result.resources.filter(r => r.name.startsWith('[Dashboard]'));
      expect(dashboardResources).toHaveLength(1);
      expect(dashboardResources[0].name).toBe('[Dashboard] Active Dashboard');
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