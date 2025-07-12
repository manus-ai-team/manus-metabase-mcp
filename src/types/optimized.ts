/**
 * Optimized response interfaces for Metabase retrieve operations.
 * These interfaces contain only essential fields to reduce token usage
 * while preserving functionality for MCP operations.
 */

/**
 * Optimized card interface containing only essential fields for MCP operations
 */
export interface OptimizedCard {
  id: number;
  name: string;
  description?: string;
  database_id: number;
  dataset_query?: {
    type?: string;
    database?: number;
    native?: {
      query?: string;
      template_tags?: Record<string, any>;
    };
  };
  collection_id?: number;
  query_type?: string;
  archived?: boolean;
  can_write?: boolean;
  created_at?: string;
  updated_at?: string;
  creator?: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
  };
  collection?: {
    id: number;
    name: string;
    location?: string;
  };
  parameters?: Array<{
    id: string;
    name: string;
    type: string;
    slug: string;
    target?: any;
    values_source_type?: string;
    values_source_config?: {
      values?: string[];
    };
  }>;
  view_count?: number;
  query_average_duration?: number;
  retrieved_at: string;
}

/**
 * Optimized dashboard interface containing only essential fields for MCP operations
 */
export interface OptimizedDashboard {
  id: number;
  name: string;
  description?: string;
  collection_id?: number;
  archived?: boolean;
  can_write?: boolean;
  created_at?: string;
  updated_at?: string;
  dashcards?: Array<{
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
        database?: number;
        native?: {
          query?: string;
          template_tags?: Record<string, any>;
        };
      };
      parameters?: Array<{
        id: string;
        name: string;
        type: string;
        slug: string;
        target?: any;
        values_source_type?: string;
        values_source_config?: {
          values?: string[];
        };
      }>;
    };
  }>;
  parameters?: Array<{
    id: string;
    name: string;
    type: string;
    slug: string;
    sectionId?: string;
    values_source_type?: string;
    values_source_config?: {
      values?: string[];
    };
  }>;
  tabs?: Array<any>;
  width?: string;
  auto_apply_filters?: boolean;
  creator?: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
  };
  collection?: {
    id: number;
    name: string;
    location?: string;
  };
  retrieved_at: string;
}

/**
 * Optimized table interface containing only essential fields for MCP operations
 */
export interface OptimizedTable {
  id: number;
  name: string;
  description?: string;
  schema?: string;
  view_count?: number;
  db_id: number;
  display_name: string;
  entity_type: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
  field_order: string;
  is_upload: boolean;
  initial_sync_status: string;
  estimated_row_count?: number;
  db?: {
    id: number;
    name: string;
    description?: string;
    engine: string;
    timezone?: string;
    dbms_version?: any;
    is_sample?: boolean;
    is_on_demand?: boolean;
    uploads_enabled?: boolean;
    auto_run_queries?: boolean;
  };
  fields?: Array<{
    id: number;
    name: string;
    display_name: string;
    description?: string;
    database_type: string;
    base_type: string;
    effective_type: string;
    semantic_type?: string;
    table_id: number;
    position: number;
    database_position: number;
    active: boolean;
    database_indexed: boolean;
    database_required: boolean;
    has_field_values: string;
    visibility_type: string;
    preview_display: boolean;
    fk_target_field_id?: number;
    created_at: string;
    updated_at: string;
  }>;
  retrieved_at: string;
}

/**
 * Optimized database interface containing only essential fields for MCP operations
 */
export interface OptimizedDatabase {
  id: number;
  name: string;
  description?: string;
  engine: string;
  timezone?: string;
  auto_run_queries?: boolean;
  is_sample?: boolean;
  is_on_demand?: boolean;
  uploads_enabled?: boolean;
  dbms_version?: {
    flavor?: string;
    version?: string;
    'semantic-version'?: number[];
  };
  initial_sync_status?: string;
  created_at?: string;
  updated_at?: string;
  tables?: Array<{
    id: number;
    name: string;
    display_name: string;
    description?: string;
    schema?: string;
    view_count?: number;
    entity_type?: string;
    active: boolean;
    db_id: number;
    field_order: string;
    is_upload: boolean;
    initial_sync_status: string;
    created_at: string;
    updated_at: string;
    estimated_row_count?: number;
  }>;
  pagination?: {
    total_tables: number;
    table_offset: number;
    table_limit: number;
    current_page_size: number;
    has_more: boolean;
    next_offset?: number;
  };
  retrieved_at: string;
}

/**
 * Optimized collection interface containing only essential fields for MCP operations
 */
export interface OptimizedCollection {
  id: number;
  name: string;
  description?: string;
  archived: boolean;
  slug: string;
  can_write: boolean;
  authority_level?: string;
  personal_owner_id?: number;
  type?: string;
  effective_ancestors?: Array<{
    'metabase.collections.models.collection.root/is-root?'?: boolean;
    authority_level?: string;
    name: string;
    is_personal: boolean;
    id: string | number;
    can_write: boolean;
  }>;
  can_restore: boolean;
  is_sample: boolean;
  effective_location: string;
  parent_id?: number;
  location: string;
  namespace?: string;
  is_personal: boolean;
  created_at: string;
  can_delete: boolean;
  retrieved_at: string;
}

/**
 * Optimized field interface containing only essential fields for MCP operations
 */
export interface OptimizedField {
  id: number;
  name: string;
  display_name: string;
  description?: string;
  database_type: string;
  base_type: string;
  effective_type: string;
  semantic_type?: string;
  table_id: number;
  position: number;
  database_position: number;
  active: boolean;
  database_indexed: boolean;
  database_required: boolean;
  has_field_values: string;
  visibility_type: string;
  preview_display: boolean;
  fk_target_field_id?: number;
  created_at: string;
  updated_at: string;
  fingerprint?: {
    global?: {
      'distinct-count'?: number;
      'nil%'?: number;
    };
  };
  // Simplified table reference
  table: {
    id: number;
    name: string;
    display_name: string;
    db_id: number;
    schema?: string;
    entity_type?: string;
    view_count?: number;
  };
  // Simplified target field reference (for foreign keys)
  target?: {
    id: number;
    name: string;
    display_name: string;
    table_id: number;
    database_type: string;
    base_type: string;
    effective_type: string;
    semantic_type?: string;
  };
  retrieved_at: string;
}

/**
 * Union type for all optimized response types
 */
export type OptimizedResponse =
  | OptimizedCard
  | OptimizedDashboard
  | OptimizedTable
  | OptimizedDatabase
  | OptimizedCollection
  | OptimizedField;
