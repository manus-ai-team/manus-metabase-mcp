// Supported model types for the list command
export type SupportedListModel = 'cards' | 'dashboards' | 'tables' | 'databases' | 'collections';

// Highly optimized list response interfaces - only essential identifier fields
export interface ListCard {
  id: number;
  name: string;
  description?: string;
  database_id: number;
  collection_id?: number;
  archived?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ListDashboard {
  id: number;
  name: string;
  description?: string;
  collection_id?: number;
  archived?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ListTable {
  id: number;
  name: string;
  display_name: string;
  db_id: number;
  schema?: string;
  entity_type?: string;
  active: boolean;
}

export interface ListDatabase {
  id: number;
  name: string;
  engine: string;
  description?: string;
  is_sample?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ListCollection {
  id: number;
  name: string;
  description?: string;
  slug: string;
  archived: boolean;
  location?: string;
  is_personal: boolean;
  created_at?: string;
}

// Union type for all list response types
export type ListResponse = ListCard | ListDashboard | ListTable | ListDatabase | ListCollection;
