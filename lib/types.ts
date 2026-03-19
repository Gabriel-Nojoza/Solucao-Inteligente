export interface Workspace {
  id: string
  pbi_workspace_id: string
  name: string
  is_active: boolean
  synced_at: string | null
  created_at: string
  report_count?: number
}

export interface Report {
  id: string
  workspace_id: string
  pbi_report_id: string
  name: string
  web_url: string | null
  embed_url: string | null
  dataset_id: string | null
  is_active: boolean
  synced_at: string | null
  created_at: string
  workspace_name?: string
}

export interface Contact {
  id: string
  name: string
  phone: string | null
  type: "individual" | "group"
  whatsapp_group_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type ScheduleExportFormat =
  | "PDF"
  | "PNG"
  | "PPTX"
  | "table"
  | "csv"
  | "pdf"

export interface Schedule {
  id: string
  name: string
  report_id: string
  pbi_page_name?: string | null
  cron_expression: string
  export_format: ScheduleExportFormat
  message_template: string | null
  is_active: boolean
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
  updated_at?: string | null
  report_name?: string
  report_source?: "powerbi" | "created" | "unknown"
  contacts?: Contact[]
}

export interface DispatchLog {
  id: string
  schedule_id: string | null
  report_name: string
  contact_name: string
  contact_phone: string | null
  status: "pending" | "exporting" | "sending" | "delivered" | "failed"
  export_format: string | null
  error_message: string | null
  n8n_execution_id: string | null
  started_at: string
  completed_at: string | null
  created_at: string
}

export interface Setting {
  id: string
  key: string
  value: Record<string, string>
  updated_at: string
}

export interface PowerBIConfig {
  tenant_id: string
  client_id: string
  client_secret: string
}

export interface N8NConfig {
  webhook_url: string
  callback_secret: string
}

export interface GeneralConfig {
  app_name: string
  timezone: string
}

// === Automations / Query Builder ===

export interface DatasetTable {
  name: string
  description?: string
  isHidden: boolean
}

export interface DatasetColumn {
  tableName: string
  columnName: string
  dataType: string
  isHidden: boolean
  expression?: string
}

export interface DatasetMeasure {
  tableName: string
  measureName: string
  expression: string
  dataType?: string
  isHidden?: boolean
}

export interface QueryFilter {
  id: string
  tableName: string
  columnName: string
  operator:
    | "eq"
    | "neq"
    | "gt"
    | "lt"
    | "gte"
    | "lte"
    | "contains"
    | "startswith"
  value: string
  valueTo?: string
  dataType: string
}

export interface SelectedColumn {
  tableName: string
  columnName: string
}

export interface SelectedMeasure {
  tableName: string
  measureName: string
}

export interface Automation {
  id: string
  name: string
  dataset_id: string
  workspace_id: string | null
  selected_columns: SelectedColumn[]
  selected_measures: SelectedMeasure[]
  filters: QueryFilter[]
  dax_query: string | null
  cron_expression: string | null
  export_format: "table" | "csv" | "pdf"
  message_template: string | null
  is_active: boolean
  last_run_at: string | null
  created_at: string
  updated_at: string
  contacts?: Contact[]
  workspace_name?: string
}

export interface DAXQueryResult {
  columns: Array<{ name: string; dataType: string }>
  rows: Array<Record<string, unknown>>
}
