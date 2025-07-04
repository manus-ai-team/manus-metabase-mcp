import { z } from 'zod';

// Custom error enum
export enum ErrorCode {
  InternalError = 'internal_error',
  InvalidRequest = 'invalid_request',
  InvalidParams = 'invalid_params',
  MethodNotFound = 'method_not_found',
}

// Custom error class
export class McpError extends Error {
  code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'McpError';
  }
}

// API error type definition
export interface ApiError {
  status?: number;
  message?: string;
  data?: { message?: string };
}

// Create custom Schema object using z.object
export const ListResourceTemplatesRequestSchema = z.object({
  method: z.literal('resources/list_templates'),
});

export const ListToolsRequestSchema = z.object({
  method: z.literal('tools/list'),
});
