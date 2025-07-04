import { OptimizedCard, OptimizedDashboard, OptimizedTable, OptimizedDatabase, OptimizedCollection, OptimizedField } from '../../types/optimized.js';

/**
 * Optimize card response by removing unnecessary fields that consume tokens
 * but aren't used by other handlers (execute_query, export_query, etc.)
 */
export function optimizeCardResponse(card: any): OptimizedCard {
  const optimized: OptimizedCard = {
    id: card.id,
    name: card.name,
    database_id: card.database_id,
    retrieved_at: new Date().toISOString()
  };

  // Add optional fields only if they exist and have meaningful values
  if (card.description) {
    optimized.description = card.description;
  }

  // Essential for execute_query and export_query
  if (card.dataset_query) {
    optimized.dataset_query = {
      type: card.dataset_query.type,
      database: card.dataset_query.database,
      native: card.dataset_query.native ? {
        query: card.dataset_query.native.query,
        template_tags: card.dataset_query.native.template_tags
      } : undefined
    };
  }

  if (card.collection_id !== null && card.collection_id !== undefined) {
    optimized.collection_id = card.collection_id;
  }

  if (card.query_type) {
    optimized.query_type = card.query_type;
  }

  if (card.archived !== undefined) {
    optimized.archived = card.archived;
  }

  if (card.can_write !== undefined) {
    optimized.can_write = card.can_write;
  }

  if (card.created_at) {
    optimized.created_at = card.created_at;
  }

  if (card.updated_at) {
    optimized.updated_at = card.updated_at;
  }

  // Minimal creator info
  if (card.creator) {
    optimized.creator = {
      id: card.creator.id,
      email: card.creator.email,
      first_name: card.creator.first_name,
      last_name: card.creator.last_name
    };
  }

  // Minimal collection info
  if (card.collection) {
    optimized.collection = {
      id: card.collection.id,
      name: card.collection.name,
      location: card.collection.location
    };
  }

  // Essential parameters for query execution
  if (card.parameters && Array.isArray(card.parameters) && card.parameters.length > 0) {
    optimized.parameters = card.parameters.map((param: any) => ({
      id: param.id,
      name: param.name,
      type: param.type,
      slug: param.slug,
      target: param.target
    }));
  }

  // Analytics data for future use
  if (card.view_count !== undefined) {
    optimized.view_count = card.view_count;
  }

  if (card.query_average_duration !== undefined) {
    optimized.query_average_duration = card.query_average_duration;
  }

  return optimized;
}

/**
 * Optimize dashboard response by removing unnecessary fields that consume tokens
 * but aren't used by other handlers. Focuses on layout, cards, and parameters.
 */
export function optimizeDashboardResponse(dashboard: any): OptimizedDashboard {
  const optimized: OptimizedDashboard = {
    id: dashboard.id,
    name: dashboard.name,
    retrieved_at: new Date().toISOString()
  };

  // Add optional fields only if they exist and have meaningful values
  if (dashboard.description) {
    optimized.description = dashboard.description;
  }

  if (dashboard.collection_id !== null && dashboard.collection_id !== undefined) {
    optimized.collection_id = dashboard.collection_id;
  }

  if (dashboard.archived !== undefined) {
    optimized.archived = dashboard.archived;
  }

  if (dashboard.can_write !== undefined) {
    optimized.can_write = dashboard.can_write;
  }

  if (dashboard.created_at) {
    optimized.created_at = dashboard.created_at;
  }

  if (dashboard.updated_at) {
    optimized.updated_at = dashboard.updated_at;
  }

  // Essential dashboard cards with optimized card data
  if (dashboard.dashcards && Array.isArray(dashboard.dashcards) && dashboard.dashcards.length > 0) {
    optimized.dashcards = dashboard.dashcards.map((dashcard: any) => {
      const optimizedDashcard: any = {
        id: dashcard.id,
        card_id: dashcard.card_id,
        dashboard_id: dashcard.dashboard_id,
        row: dashcard.row,
        col: dashcard.col,
        size_x: dashcard.size_x,
        size_y: dashcard.size_y
      };

      // Essential parameter mappings for dashboard filtering
      if (dashcard.parameter_mappings && Array.isArray(dashcard.parameter_mappings) && dashcard.parameter_mappings.length > 0) {
        optimizedDashcard.parameter_mappings = dashcard.parameter_mappings.map((mapping: any) => ({
          parameter_id: mapping.parameter_id,
          card_id: mapping.card_id,
          target: mapping.target
        }));
      }

      // Essential visualization settings
      if (dashcard.visualization_settings && Object.keys(dashcard.visualization_settings).length > 0) {
        optimizedDashcard.visualization_settings = dashcard.visualization_settings;
      }

      // Optimized card data (removing huge result_metadata)
      if (dashcard.card) {
        optimizedDashcard.card = {
          id: dashcard.card.id,
          name: dashcard.card.name,
          database_id: dashcard.card.database_id
        };

        // Add optional card fields only if they exist
        if (dashcard.card.description) {
          optimizedDashcard.card.description = dashcard.card.description;
        }

        if (dashcard.card.query_type) {
          optimizedDashcard.card.query_type = dashcard.card.query_type;
        }

        if (dashcard.card.display) {
          optimizedDashcard.card.display = dashcard.card.display;
        }

        // Essential for execute_query operations
        if (dashcard.card.dataset_query) {
          optimizedDashcard.card.dataset_query = {
            type: dashcard.card.dataset_query.type,
            database: dashcard.card.dataset_query.database,
            native: dashcard.card.dataset_query.native ? {
              query: dashcard.card.dataset_query.native.query,
              template_tags: dashcard.card.dataset_query.native.template_tags
            } : undefined
          };
        }

        // Essential parameters for query execution
        if (dashcard.card.parameters && Array.isArray(dashcard.card.parameters) && dashcard.card.parameters.length > 0) {
          optimizedDashcard.card.parameters = dashcard.card.parameters.map((param: any) => ({
            id: param.id,
            name: param.name,
            type: param.type,
            slug: param.slug,
            target: param.target
          }));
        }
      }

      return optimizedDashcard;
    });
  }

  // Essential dashboard-level parameters
  if (dashboard.parameters && Array.isArray(dashboard.parameters) && dashboard.parameters.length > 0) {
    optimized.parameters = dashboard.parameters.map((param: any) => ({
      id: param.id,
      name: param.name,
      type: param.type,
      slug: param.slug,
      sectionId: param.sectionId
    }));
  }

  // Dashboard tabs (if any)
  if (dashboard.tabs && Array.isArray(dashboard.tabs) && dashboard.tabs.length > 0) {
    optimized.tabs = dashboard.tabs;
  }

  // Layout settings
  if (dashboard.width) {
    optimized.width = dashboard.width;
  }

  if (dashboard.auto_apply_filters !== undefined) {
    optimized.auto_apply_filters = dashboard.auto_apply_filters;
  }

  // Minimal creator info
  if (dashboard.creator || dashboard['last-edit-info']) {
    const creator = dashboard.creator || dashboard['last-edit-info'];
    optimized.creator = {
      id: creator.id,
      email: creator.email,
      first_name: creator.first_name,
      last_name: creator.last_name
    };
  }

  // Minimal collection info
  if (dashboard.collection) {
    optimized.collection = {
      id: dashboard.collection.id,
      name: dashboard.collection.name,
      location: dashboard.collection.location
    };
  }

  return optimized;
}

/**
 * Optimize table response by removing unnecessary fields that consume tokens
 * but aren't used by other handlers. Focuses on essential schema information.
 */
export function optimizeTableResponse(table: any): OptimizedTable {
  const optimized: OptimizedTable = {
    id: table.id,
    name: table.name,
    db_id: table.db_id,
    display_name: table.display_name,
    entity_type: table.entity_type,
    active: table.active,
    created_at: table.created_at,
    updated_at: table.updated_at,
    field_order: table.field_order,
    is_upload: table.is_upload,
    initial_sync_status: table.initial_sync_status,
    retrieved_at: new Date().toISOString()
  };

  // Add optional fields only if they exist and have meaningful values
  if (table.description) {
    optimized.description = table.description;
  }

  if (table.schema) {
    optimized.schema = table.schema;
  }

  if (table.view_count !== undefined) {
    optimized.view_count = table.view_count;
  }

  if (table.estimated_row_count !== undefined) {
    optimized.estimated_row_count = table.estimated_row_count;
  }

  // Essential database information (simplified)
  if (table.db) {
    optimized.db = {
      id: table.db.id,
      name: table.db.name,
      engine: table.db.engine
    };

    // Add optional db fields
    if (table.db.description) {
      optimized.db.description = table.db.description;
    }

    if (table.db.timezone) {
      optimized.db.timezone = table.db.timezone;
    }

    if (table.db.dbms_version) {
      optimized.db.dbms_version = table.db.dbms_version;
    }

    if (table.db.is_sample !== undefined) {
      optimized.db.is_sample = table.db.is_sample;
    }

    if (table.db.is_on_demand !== undefined) {
      optimized.db.is_on_demand = table.db.is_on_demand;
    }

    if (table.db.uploads_enabled !== undefined) {
      optimized.db.uploads_enabled = table.db.uploads_enabled;
    }

    if (table.db.auto_run_queries !== undefined) {
      optimized.db.auto_run_queries = table.db.auto_run_queries;
    }
  }

  // Essential field information (without heavy fingerprint data)
  if (table.fields && Array.isArray(table.fields) && table.fields.length > 0) {
    optimized.fields = table.fields.map((field: any) => ({
      id: field.id,
      name: field.name,
      display_name: field.display_name,
      description: field.description || undefined,
      database_type: field.database_type,
      base_type: field.base_type,
      effective_type: field.effective_type,
      semantic_type: field.semantic_type || undefined,
      table_id: field.table_id,
      position: field.position,
      database_position: field.database_position,
      active: field.active,
      database_indexed: field.database_indexed,
      database_required: field.database_required,
      has_field_values: field.has_field_values,
      visibility_type: field.visibility_type,
      preview_display: field.preview_display,
      fk_target_field_id: field.fk_target_field_id || undefined,
      created_at: field.created_at,
      updated_at: field.updated_at
    }));
  }

  return optimized;
}

/**
 * Optimize database response by removing unnecessary fields that consume tokens
 * but aren't used by other handlers. Focuses on essential connection and table info.
 */
export function optimizeDatabaseResponse(database: any): OptimizedDatabase {
  const optimized: OptimizedDatabase = {
    id: database.id,
    name: database.name,
    engine: database.engine,
    retrieved_at: new Date().toISOString()
  };

  // Add optional fields only if they exist and have meaningful values
  if (database.description) {
    optimized.description = database.description;
  }

  if (database.timezone) {
    optimized.timezone = database.timezone;
  }

  if (database.auto_run_queries !== undefined) {
    optimized.auto_run_queries = database.auto_run_queries;
  }

  if (database.is_sample !== undefined) {
    optimized.is_sample = database.is_sample;
  }

  if (database.is_on_demand !== undefined) {
    optimized.is_on_demand = database.is_on_demand;
  }

  if (database.uploads_enabled !== undefined) {
    optimized.uploads_enabled = database.uploads_enabled;
  }

  if (database.dbms_version) {
    optimized.dbms_version = {
      flavor: database.dbms_version.flavor,
      version: database.dbms_version.version,
      'semantic-version': database.dbms_version['semantic-version']
    };
  }

  if (database.initial_sync_status) {
    optimized.initial_sync_status = database.initial_sync_status;
  }

  if (database.created_at) {
    optimized.created_at = database.created_at;
  }

  if (database.updated_at) {
    optimized.updated_at = database.updated_at;
  }

  // Essential table information (simplified)
  if (database.tables && Array.isArray(database.tables) && database.tables.length > 0) {
    optimized.tables = database.tables.map((table: any) => ({
      id: table.id,
      name: table.name,
      display_name: table.display_name,
      description: table.description || undefined,
      schema: table.schema || undefined,
      view_count: table.view_count || undefined,
      entity_type: table.entity_type || undefined,
      active: table.active,
      db_id: table.db_id,
      field_order: table.field_order,
      is_upload: table.is_upload,
      initial_sync_status: table.initial_sync_status,
      created_at: table.created_at,
      updated_at: table.updated_at,
      estimated_row_count: table.estimated_row_count || undefined
    }));
  }

  return optimized;
}

/**
 * Optimize collection response by removing unnecessary fields that consume tokens
 * but aren't used by other handlers. Collections are relatively small already.
 */
export function optimizeCollectionResponse(collection: any): OptimizedCollection {
  const optimized: OptimizedCollection = {
    id: collection.id,
    name: collection.name,
    archived: collection.archived,
    slug: collection.slug,
    can_write: collection.can_write,
    can_restore: collection.can_restore,
    is_sample: collection.is_sample,
    effective_location: collection.effective_location,
    location: collection.location,
    is_personal: collection.is_personal,
    created_at: collection.created_at,
    can_delete: collection.can_delete,
    retrieved_at: new Date().toISOString()
  };

  // Add optional fields only if they exist and have meaningful values
  if (collection.description) {
    optimized.description = collection.description;
  }

  if (collection.authority_level) {
    optimized.authority_level = collection.authority_level;
  }

  if (collection.personal_owner_id !== null && collection.personal_owner_id !== undefined) {
    optimized.personal_owner_id = collection.personal_owner_id;
  }

  if (collection.type) {
    optimized.type = collection.type;
  }

  if (collection.parent_id !== null && collection.parent_id !== undefined) {
    optimized.parent_id = collection.parent_id;
  }

  if (collection.namespace) {
    optimized.namespace = collection.namespace;
  }

  // Essential hierarchy information
  if (collection.effective_ancestors && Array.isArray(collection.effective_ancestors) && collection.effective_ancestors.length > 0) {
    optimized.effective_ancestors = collection.effective_ancestors.map((ancestor: any) => ({
      'metabase.collections.models.collection.root/is-root?': ancestor['metabase.collections.models.collection.root/is-root?'],
      authority_level: ancestor.authority_level,
      name: ancestor.name,
      is_personal: ancestor.is_personal,
      id: ancestor.id,
      can_write: ancestor.can_write
    }));
  }

  return optimized;
}

/**
 * Optimize field response by removing unnecessary fields that consume tokens
 * but aren't used by other handlers. Focuses on schema information and relationships.
 */
export function optimizeFieldResponse(field: any): OptimizedField {
  const optimized: OptimizedField = {
    id: field.id,
    name: field.name,
    display_name: field.display_name,
    database_type: field.database_type,
    base_type: field.base_type,
    effective_type: field.effective_type,
    table_id: field.table_id,
    position: field.position,
    database_position: field.database_position,
    active: field.active,
    database_indexed: field.database_indexed,
    database_required: field.database_required,
    has_field_values: field.has_field_values,
    visibility_type: field.visibility_type,
    preview_display: field.preview_display,
    created_at: field.created_at,
    updated_at: field.updated_at,
    table: {
      id: field.table.id,
      name: field.table.name,
      display_name: field.table.display_name,
      db_id: field.table.db_id
    },
    retrieved_at: new Date().toISOString()
  };

  // Add optional fields only if they exist and have meaningful values
  if (field.description) {
    optimized.description = field.description;
  }

  if (field.semantic_type) {
    optimized.semantic_type = field.semantic_type;
  }

  if (field.fk_target_field_id !== null && field.fk_target_field_id !== undefined) {
    optimized.fk_target_field_id = field.fk_target_field_id;
  }

  // Essential fingerprint data (simplified)
  if (field.fingerprint && field.fingerprint.global) {
    optimized.fingerprint = {
      global: {
        'distinct-count': field.fingerprint.global['distinct-count'],
        'nil%': field.fingerprint.global['nil%']
      }
    };
  }

  // Add optional table fields
  if (field.table.schema) {
    optimized.table.schema = field.table.schema;
  }

  if (field.table.entity_type) {
    optimized.table.entity_type = field.table.entity_type;
  }

  if (field.table.view_count !== undefined) {
    optimized.table.view_count = field.table.view_count;
  }

  // Essential target field information (for foreign keys)
  if (field.target) {
    optimized.target = {
      id: field.target.id,
      name: field.target.name,
      display_name: field.target.display_name,
      table_id: field.target.table_id,
      database_type: field.target.database_type,
      base_type: field.target.base_type,
      effective_type: field.target.effective_type
    };

    if (field.target.semantic_type) {
      optimized.target.semantic_type = field.target.semantic_type;
    }
  }

  return optimized;
}
