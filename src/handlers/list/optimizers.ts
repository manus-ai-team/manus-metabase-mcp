import { ListCard, ListDashboard, ListTable, ListDatabase, ListCollection } from './types.js';

/**
 * Optimize card response for list view - only essential identifier fields
 */
export function optimizeCardForList(card: any): ListCard {
  const optimized: ListCard = {
    id: card.id,
    name: card.name,
    database_id: card.database_id
  };

  if (card.description) optimized.description = card.description;
  if (card.collection_id !== null && card.collection_id !== undefined) optimized.collection_id = card.collection_id;
  if (card.archived !== undefined) optimized.archived = card.archived;
  if (card.created_at) optimized.created_at = card.created_at;
  if (card.updated_at) optimized.updated_at = card.updated_at;

  return optimized;
}

/**
 * Optimize dashboard response for list view - only essential identifier fields
 */
export function optimizeDashboardForList(dashboard: any): ListDashboard {
  const optimized: ListDashboard = {
    id: dashboard.id,
    name: dashboard.name
  };

  if (dashboard.description) optimized.description = dashboard.description;
  if (dashboard.collection_id !== null && dashboard.collection_id !== undefined) optimized.collection_id = dashboard.collection_id;
  if (dashboard.archived !== undefined) optimized.archived = dashboard.archived;
  if (dashboard.created_at) optimized.created_at = dashboard.created_at;
  if (dashboard.updated_at) optimized.updated_at = dashboard.updated_at;

  return optimized;
}

/**
 * Optimize table response for list view - only essential identifier fields
 */
export function optimizeTableForList(table: any): ListTable {
  const optimized: ListTable = {
    id: table.id,
    name: table.name,
    display_name: table.display_name,
    db_id: table.db_id,
    active: table.active
  };

  if (table.schema) optimized.schema = table.schema;
  if (table.entity_type) optimized.entity_type = table.entity_type;

  return optimized;
}

/**
 * Optimize database response for list view - only essential identifier fields
 */
export function optimizeDatabaseForList(database: any): ListDatabase {
  const optimized: ListDatabase = {
    id: database.id,
    name: database.name,
    engine: database.engine
  };

  if (database.description) optimized.description = database.description;
  if (database.is_sample !== undefined) optimized.is_sample = database.is_sample;
  if (database.created_at) optimized.created_at = database.created_at;
  if (database.updated_at) optimized.updated_at = database.updated_at;

  return optimized;
}

/**
 * Optimize collection response for list view - only essential identifier fields
 */
export function optimizeCollectionForList(collection: any): ListCollection {
  const optimized: ListCollection = {
    id: collection.id,
    name: collection.name,
    slug: collection.slug,
    archived: collection.archived,
    is_personal: collection.is_personal
  };

  if (collection.description) optimized.description = collection.description;
  if (collection.location) optimized.location = collection.location;
  if (collection.created_at) optimized.created_at = collection.created_at;

  return optimized;
}
