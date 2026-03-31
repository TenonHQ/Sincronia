export interface TableField {
  name: string;
  label: string;
  type: string;
  max_length: string;
  mandatory: boolean;
  reference: string;
  default_value: string;
  inherited_from: string | null;
}

export interface RawTableData {
  label: string;
  scope: string;
  parent: string | null;
  hierarchy: string[];
  fields: TableField[];
}

export interface RawSchemaMap {
  [tableName: string]: RawTableData;
}

export interface TableSchema {
  table_name: string;
  label: string;
  scope: string;
  parent: string | null;
  hierarchy: string[];
  created_at: string;
  field_count: number;
  fields: TableField[];
}

export interface AppSummary {
  application: string;
  table_count: number;
  tables: Array<{
    name: string;
    label: string;
    field_count: number;
    has_parent: boolean;
  }>;
  generated_at: string;
}

export interface SchemaIndex {
  instance: string;
  generated_at: string;
  total_tables: number;
  scopes: string[];
  applications: Array<{
    name: string;
    table_count: number;
    tables: string[];
  }>;
}

export interface SchemaOptions {
  instance: string;
  username: string;
  password: string;
  outputDir: string;
  scopes: string[];
}

export interface OrganizeOptions {
  schema: RawSchemaMap;
  outputDir: string;
  instance: string;
  scopes: string[];
}

export interface AppTableGroup {
  [appName: string]: RawSchemaMap;
}
