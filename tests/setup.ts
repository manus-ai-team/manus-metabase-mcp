/**
 * Test setup and utilities for Metabase MCP Server tests
 */

import { vi } from 'vitest';

// Mock environment variables for testing
process.env.METABASE_URL = 'https://test-metabase.example.com';
process.env.METABASE_API_KEY = 'test-api-key';
process.env.LOG_LEVEL = 'error'; // Reduce noise in tests
process.env.NODE_ENV = 'test';

// Mock API client with all methods
export const mockApiClient = {
  // Individual item retrieval methods
  getCard: vi.fn(),
  getDashboard: vi.fn(),
  getTable: vi.fn(),
  getDatabase: vi.fn(),
  getCollection: vi.fn(),
  getCollectionItems: vi.fn(),
  getField: vi.fn(),

  // List retrieval methods
  getCardsList: vi.fn(),
  getDashboardsList: vi.fn(),
  getTablesList: vi.fn(),
  getDatabasesList: vi.fn(),
  getCollectionsList: vi.fn(),

  // Generic request method
  request: vi.fn(),

  // Cache clearing methods - individual items
  clearCardsCache: vi.fn(),
  clearDashboardsCache: vi.fn(),
  clearTablesCache: vi.fn(),
  clearDatabasesCache: vi.fn(),
  clearCollectionsCache: vi.fn(),
  clearFieldsCache: vi.fn(),

  // Cache clearing methods - lists
  clearCardsListCache: vi.fn(),
  clearDashboardsListCache: vi.fn(),
  clearTablesListCache: vi.fn(),
  clearDatabasesListCache: vi.fn(),
  clearCollectionsListCache: vi.fn(),
  clearListCaches: vi.fn(),

  // Cache clearing methods - combined
  clearAllCache: vi.fn(),

  // Session token property
  sessionToken: 'mock-session-token',
};

// Mock logger functions
export const mockLogger = {
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logFatal: vi.fn(),
};

// Helper function to get logger functions as tuple
export function getLoggerFunctions() {
  return [mockLogger.logDebug, mockLogger.logInfo, mockLogger.logWarn, mockLogger.logError] as const;
}

// Sample test data
export const sampleCard = {
  id: 1,
  name: 'Test Card',
  description: 'A test card',
  database_id: 1,
  dataset_query: {
    type: 'native',
    native: {
      query: 'SELECT * FROM test_table',
    },
  },
  collection_id: 1,
  created_at: '2023-01-01T00:00:00.000Z',
  updated_at: '2023-01-01T00:00:00.000Z',
};

export const sampleDashboard = {
  id: 1,
  name: 'Test Dashboard',
  description: 'A test dashboard',
  collection_id: 1,
  created_at: '2023-01-01T00:00:00.000Z',
  updated_at: '2023-01-01T00:00:00.000Z',
};

export const sampleTable = {
  id: 1,
  name: 'test_table',
  display_name: 'Test Table',
  description: 'A test table',
  database_id: 1,
  schema: 'public',
  created_at: '2023-01-01T00:00:00.000Z',
  updated_at: '2023-01-01T00:00:00.000Z',
};

export const sampleDatabase = {
  id: 1,
  name: 'Test Database',
  description: 'A test database',
  engine: 'postgres',
  created_at: '2023-01-01T00:00:00.000Z',
  updated_at: '2023-01-01T00:00:00.000Z',
};

export const sampleCollection = {
  id: 1,
  name: 'Test Collection',
  description: 'A test collection',
  color: '#509EE3',
  created_at: '2023-01-01T00:00:00.000Z',
  updated_at: '2023-01-01T00:00:00.000Z',
};

export const sampleCollectionItems = [
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
];

export const sampleField = {
  id: 1,
  name: 'test_field',
  display_name: 'Test Field',
  description: 'A test field',
  table_id: 1,
  base_type: 'type/Text',
  database_type: 'varchar',
  effective_type: 'type/Text',
  position: 1,
  database_position: 1,
  active: true,
  database_indexed: false,
  database_required: false,
  has_field_values: 'none',
  visibility_type: 'normal',
  preview_display: true,
  table: {
    id: 1,
    name: 'test_table',
    display_name: 'Test Table',
    db_id: 1,
  },
  created_at: '2023-01-01T00:00:00.000Z',
  updated_at: '2023-01-01T00:00:00.000Z',
};

export const sampleQueryResult = {
  data: {
    rows: [
      ['value1', 'value2'],
      ['value3', 'value4'],
    ],
    cols: [
      { name: 'column1', display_name: 'Column 1' },
      { name: 'column2', display_name: 'Column 2' },
    ],
  },
  row_count: 2,
  status: 'completed',
};

// Helper function to create mock request
export function createMockRequest(toolName: string, args: Record<string, any> = {}) {
  return {
    method: 'tools/call' as const,
    params: {
      name: toolName,
      arguments: args,
    },
  };
}

// Helper function to create cached response
export function createCachedResponse<T>(data: T, source: 'cache' | 'api' = 'api') {
  return {
    data,
    source,
    fetchTime: Date.now(),
  };
}

// Reset all mocks
export function resetAllMocks() {
  vi.clearAllMocks();
  Object.values(mockApiClient).forEach(mock => {
    if (vi.isMockFunction(mock)) {
      mock.mockReset();
    }
  });
  Object.values(mockLogger).forEach(mock => {
    if (vi.isMockFunction(mock)) {
      mock.mockReset();
    }
  });
}
