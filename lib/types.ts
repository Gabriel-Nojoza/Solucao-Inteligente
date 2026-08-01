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
  bot_instance_id?: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface WhatsAppBotInstance {
  id: string
  name: string
  manual_qr_code_url?: string | null
  qr_code_url: string
  runtime_qr_code_url: string
  source: "runtime" | "manual" | "none"
  status: "starting" | "awaiting_qr" | "connected" | "reconnecting" | "offline" | "error"
  updated_at: string | null
  connected_at: string | null
  last_error: string | null
  phone_number: string | null
  display_name: string | null
  jid: string | null
  is_default?: boolean | null
  created_at?: string | null
  contacts_ready?: boolean
}

export type ScheduleExportFormat =
  | "PDF"
  | "PNG"
  | "HTML"
  | "PPTX"
  | "table"
  | "csv"
  | "pdf"
  | "xlsx"

export interface ScheduleReportConfig {
  report_id: string
  pbi_page_name?: string | null
  pbi_page_names?: string[] | null
  report_name?: string
  report_source?: "powerbi" | "created" | "unknown"
}

export interface Schedule {
  id: string
  name: string
  report_id: string
  bot_instance_id?: string | null
  report_configs?: ScheduleReportConfig[] | null
  pbi_page_name?: string | null
  pbi_page_names?: string[] | null
  cron_expression: string
  export_format: ScheduleExportFormat
  message_template: string | null
  image_url?: string | null
  image_urls?: string[] | null
  disable_after_send?: boolean
  send_mode?: "none" | "audio" | "text" | null
  is_active: boolean
  last_run_at: string | null
  next_run_at: string | null
  created_at: string
  updated_at?: string | null
  report_name?: string
  report_names?: string[]
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
  master_user_email?: string
  master_user_password?: string
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
  locked?: boolean
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
  bot_instance_id?: string | null
  selected_columns: SelectedColumn[]
  selected_measures: SelectedMeasure[]
  filters: QueryFilter[]
  dax_query: string | null
  cron_expression: string | null
  export_format: "table" | "csv" | "pdf" | "xlsx"
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

// === Campanhas ===

export interface Campaign {
  id: string
  company_id: string
  name: string
  description: string | null
  dataset_id: string
  workspace_id: string | null
  dax_query: string | null
  selected_columns: SelectedColumn[]
  selected_measures: SelectedMeasure[]
  filters: QueryFilter[]
  customer_table: string | null
  date_column: string | null
  days_inactive: number | null
  phone_column: string | null
  name_column: string | null
  message_template: string
  image_url: string | null
  bot_instance_id: string | null
  cron_expression: string | null
  is_active: boolean
  last_run_at: string | null
  manual_contacts: { name: string; phone: string }[]
  created_at: string
  updated_at: string
}

export interface CampaignClient {
  name: string | null
  phone: string | null
  data: Record<string, unknown>
}

export interface CampaignExecution {
  id: string
  campaign_id: string
  company_id: string
  status: "running" | "completed" | "failed"
  total_clients: number
  sent_count: number
  failed_count: number
  skipped_count: number
  started_at: string
  completed_at: string | null
}

export interface CampaignSend {
  id: string
  campaign_id: string
  execution_id: string | null
  company_id: string
  client_name: string | null
  client_phone: string | null
  client_data: Record<string, unknown> | null
  message: string
  status: "pending" | "sent" | "failed"
  error_message: string | null
  sent_at: string | null
  created_at: string
}
