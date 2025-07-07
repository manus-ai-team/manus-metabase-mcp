import { describe, it, expect } from 'vitest';
import { createErrorFromHttpResponse } from '../../src/utils/errorFactory.js';
import { ErrorCategory, RecoveryAction } from '../../src/types/core.js';

describe('API Error Resource Extraction', () => {
  describe('Resource type detection', () => {
    it('should create database not found error for database 404', () => {
      const error = createErrorFromHttpResponse(
        404,
        { message: 'Database not found' },
        'API request to /api/database/999',
        'database',
        999
      );
      
      expect(error.message).toBe('database not found: 999');
      expect(error.details.category).toBe(ErrorCategory.RESOURCE_NOT_FOUND);
      expect(error.details.recoveryAction).toBe(RecoveryAction.CHECK_RESOURCE_EXISTS);
      expect(error.details.retryable).toBe(false);
    });

    it('should create card not found error for card 404', () => {
      const error = createErrorFromHttpResponse(
        404,
        { message: 'Card not found' },
        'API request to /api/card/123',
        'card',
        123
      );
      
      expect(error.message).toBe('card not found: 123');
      expect(error.details.category).toBe(ErrorCategory.RESOURCE_NOT_FOUND);
    });

    it('should create dashboard not found error for dashboard 404', () => {
      const error = createErrorFromHttpResponse(
        404,
        { message: 'Dashboard not found' },
        'API request to /api/dashboard/456',
        'dashboard',
        456
      );
      
      expect(error.message).toBe('dashboard not found: 456');
      expect(error.details.category).toBe(ErrorCategory.RESOURCE_NOT_FOUND);
    });

    it('should fallback to generic error when resource type is not provided', () => {
      const error = createErrorFromHttpResponse(
        404,
        { message: 'Not found' },
        'API request to /api/unknown/endpoint'
      );
      
      expect(error.message).toBe('Metabase item not found');
      expect(error.details.category).toBe(ErrorCategory.RESOURCE_NOT_FOUND);
    });
  });

  describe('Error message patterns', () => {
    it('should differentiate database not found from database connection errors', () => {
      // Database not found (should be resource_not_found)
      const notFoundError = createErrorFromHttpResponse(
        404,
        { message: 'Database with id 999 not found' },
        'API request to /api/database/999',
        'database',
        999
      );
      
      expect(notFoundError.details.category).toBe(ErrorCategory.RESOURCE_NOT_FOUND);
      expect(notFoundError.details.recoveryAction).toBe(RecoveryAction.CHECK_RESOURCE_EXISTS);
      
      // Database connection error (should be database category)
      const connectionError = createErrorFromHttpResponse(
        500,
        { message: 'Database connection timeout' },
        'API request to /api/database/1/tables'
      );
      
      expect(connectionError.details.category).toBe(ErrorCategory.QUERY_EXECUTION);
      expect(connectionError.details.recoveryAction).toBe(RecoveryAction.REDUCE_QUERY_COMPLEXITY);
    });
  });
});