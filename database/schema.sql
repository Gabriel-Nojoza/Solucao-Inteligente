-- =============================================================================
-- SCHEMA COMPLETO DO BANCO DE DADOS
-- PostgreSQL puro (sem Supabase)
-- Gerado a partir de todas as migrations do projeto
-- =============================================================================

-- Habilita extensão para gerar UUIDs
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- TABELA: users
-- Substitui auth.users do Supabase. Use bcrypt no password_hash.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.users (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text        NOT NULL UNIQUE,
  password_hash  text        NOT NULL,
  -- Metadados usados pelo sistema: company_id (uuid) e role ("admin" | "user")
  app_metadata   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);

-- =============================================================================
-- TABELA: companies
-- Cada empresa é um tenant isolado no sistema.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.companies (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL UNIQUE,
  slug       text        UNIQUE,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- TABELA: company_settings
-- Configurações chave/valor por empresa.
-- Chaves usadas: "powerbi", "n8n", "chat_ia", "dispatch_settings",
--               "usage_limits", "saved_automations"
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.company_settings (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  key        text        NOT NULL,
  value      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, key)
);

CREATE INDEX IF NOT EXISTS idx_company_settings_company_id ON public.company_settings(company_id);

-- Estrutura do campo "value" por chave:
--
-- key = "powerbi":
--   { "tenant_id": "...", "client_id": "...", "client_secret": "..." }
--
-- key = "n8n":
--   { "webhook_url": "...", "callback_secret": "...", "chat_webhook_url": "..." }
--
-- key = "chat_ia":
--   { "enabled": true, "webhook_url": "...", "trialDays": 30, "trialEndsAt": "2026-06-01" }
--
-- key = "dispatch_settings":
--   { "enabled": true, "expiryDate": "2026-12-31" }
--
-- key = "usage_limits":
--   { "chat_limit": 100, "chat_excess_price": 0.50 }

-- =============================================================================
-- TABELA: whatsapp_bot_instances
-- Instâncias do bot WhatsApp por empresa.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.whatsapp_bot_instances (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name                text        NOT NULL,
  manual_qr_code_url  text,
  is_default          boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_bot_instances_company_id
  ON public.whatsapp_bot_instances(company_id);

-- Garante que cada empresa tenha no máximo uma instância padrão
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_bot_instances_default
  ON public.whatsapp_bot_instances(company_id)
  WHERE is_default = true;

-- =============================================================================
-- TABELA: workspaces
-- Workspaces do Power BI sincronizados por empresa.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.workspaces (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  pbi_workspace_id text        NOT NULL,
  name             text        NOT NULL,
  is_active        boolean     NOT NULL DEFAULT true,
  synced_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspaces_company_id ON public.workspaces(company_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_company_pbi
  ON public.workspaces(company_id, pbi_workspace_id);

-- =============================================================================
-- TABELA: reports
-- Relatórios do Power BI sincronizados por empresa/workspace.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.reports (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  workspace_id   uuid        REFERENCES public.workspaces(id) ON DELETE SET NULL,
  pbi_report_id  text        NOT NULL,
  name           text        NOT NULL,
  web_url        text,
  embed_url      text,
  dataset_id     text,
  is_active      boolean     NOT NULL DEFAULT true,
  synced_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_company_id    ON public.reports(company_id);
CREATE INDEX IF NOT EXISTS idx_reports_workspace_id  ON public.reports(workspace_id);
CREATE INDEX IF NOT EXISTS idx_reports_dataset_id    ON public.reports(dataset_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_company_pbi
  ON public.reports(company_id, pbi_report_id);

-- =============================================================================
-- TABELA: contacts
-- Contatos WhatsApp (individuais ou grupos) por empresa.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.contacts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bot_instance_id     uuid        REFERENCES public.whatsapp_bot_instances(id) ON DELETE SET NULL,
  name                text        NOT NULL,
  phone               text,
  type                text        NOT NULL DEFAULT 'individual'
                                  CHECK (type IN ('individual', 'group')),
  whatsapp_group_id   text,
  is_active           boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_company_id      ON public.contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_bot_instance_id ON public.contacts(bot_instance_id);

-- =============================================================================
-- TABELA: schedules
-- Rotinas de envio agendado de relatórios via WhatsApp.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.schedules (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bot_instance_id  uuid        REFERENCES public.whatsapp_bot_instances(id) ON DELETE SET NULL,
  -- report_id aponta para um reports.id OU para um automations.id (automação salva)
  report_id        uuid,
  name             text        NOT NULL,
  cron_expression  text        NOT NULL,
  export_format    text        NOT NULL DEFAULT 'PDF'
                               CHECK (export_format IN ('PDF', 'PNG', 'PPTX', 'table', 'csv', 'pdf', 'xlsx')),
  message_template text,
  is_active        boolean     NOT NULL DEFAULT true,
  last_run_at      timestamptz,
  next_run_at      timestamptz,
  -- Campos de página única (legado - mantidos para compatibilidade)
  pbi_page_name    text,
  pbi_page_names   text[],
  -- Configuração de múltiplos relatórios por rotina
  -- Formato: [{ "report_id": "uuid", "pbi_page_name": "...", "pbi_page_names": [...] }]
  report_configs   jsonb,
  -- Imagem(ns) a enviar junto com a rotina
  image_url        text,
  image_urls       jsonb,
  -- Anexos por dia da semana: { "enabled": true, "days": { "1": ["<link>"], ... } } (0 = domingo)
  weekday_attachments jsonb,
  disable_after_send boolean NOT NULL DEFAULT false,
  -- Modo de envio de narração: 'none' = só relatório, 'audio' = voz, 'text' = texto
  send_mode        text        NOT NULL DEFAULT 'none'
                               CHECK (send_mode IN ('none', 'audio', 'text')),
  -- Relatorios da pasta (robo no computador do cliente). Ver tabela folder_reports.
  -- Formato: [{ "folder_key": "vendas", "folder_name": "Vendas", "formats": ["PDF", "PNG"] }]
  folder_report_configs jsonb,
  -- Arquivo ja enviado por pasta/formato. Formato: { "vendas|PDF": "<folder_reports.id>" }
  folder_last_sent jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_schedules_company_id ON public.schedules(company_id);

-- =============================================================================
-- TABELA: folder_reports
-- Arquivos (PDF/PNG) que o robo do computador do cliente sobe para a
-- plataforma. Os arquivos ficam no bucket privado "folder-reports".
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.folder_reports (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  folder_key     text        NOT NULL,
  folder_name    text        NOT NULL,
  format         text        NOT NULL CHECK (format IN ('PDF', 'PNG')),
  file_name      text        NOT NULL,
  mimetype       text        NOT NULL,
  size_bytes     integer     NOT NULL,
  sha256         text        NOT NULL,
  storage_path   text        NOT NULL,
  file_saved_at  timestamptz NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_folder_reports_latest
  ON public.folder_reports (company_id, folder_key, format, file_saved_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_folder_reports_unique_content
  ON public.folder_reports (company_id, folder_key, format, sha256);
ALTER TABLE public.folder_reports ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- TABELA: schedule_contacts
-- Relacionamento N:N entre rotinas e contatos.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.schedule_contacts (
  schedule_id  uuid NOT NULL REFERENCES public.schedules(id)  ON DELETE CASCADE,
  contact_id   uuid NOT NULL REFERENCES public.contacts(id)   ON DELETE CASCADE,
  PRIMARY KEY (schedule_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_contacts_schedule_id ON public.schedule_contacts(schedule_id);
CREATE INDEX IF NOT EXISTS idx_schedule_contacts_contact_id  ON public.schedule_contacts(contact_id);

-- =============================================================================
-- TABELA: automations
-- Automações de consulta DAX com envio via WhatsApp.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.automations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bot_instance_id  uuid        REFERENCES public.whatsapp_bot_instances(id) ON DELETE SET NULL,
  name             text        NOT NULL,
  dataset_id       text        NOT NULL,
  workspace_id     text,
  -- Colunas e medidas selecionadas do Power BI
  -- selected_columns: [{ "tableName": "...", "columnName": "..." }]
  -- selected_measures: [{ "tableName": "...", "measureName": "..." }]
  selected_columns  jsonb      NOT NULL DEFAULT '[]'::jsonb,
  selected_measures jsonb      NOT NULL DEFAULT '[]'::jsonb,
  -- Filtros aplicados à consulta
  -- filters: [{ "id": "...", "tableName": "...", "columnName": "...",
  --             "operator": "eq|neq|gt|lt|gte|lte|contains|startswith",
  --             "value": "...", "dataType": "...", "locked": false }]
  filters          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  dax_query        text,
  cron_expression  text,
  export_format    text        NOT NULL DEFAULT 'csv'
                               CHECK (export_format IN ('table', 'csv', 'pdf', 'xlsx')),
  message_template text,
  is_active        boolean     NOT NULL DEFAULT true,
  last_run_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automations_company_id ON public.automations(company_id);

-- =============================================================================
-- TABELA: automation_contacts
-- Relacionamento N:N entre automações e contatos.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.automation_contacts (
  automation_id  uuid NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  contact_id     uuid NOT NULL REFERENCES public.contacts(id)    ON DELETE CASCADE,
  PRIMARY KEY (automation_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_automation_contacts_automation_id ON public.automation_contacts(automation_id);
CREATE INDEX IF NOT EXISTS idx_automation_contacts_contact_id    ON public.automation_contacts(contact_id);

-- =============================================================================
-- TABELA: dispatch_logs
-- Log de cada envio feito pelo sistema (rotinas e automações).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.dispatch_logs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  schedule_id       uuid        REFERENCES public.schedules(id) ON DELETE SET NULL,
  report_name       text        NOT NULL,
  contact_name      text        NOT NULL,
  contact_phone     text,
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'exporting', 'sending', 'delivered', 'failed')),
  export_format     text,
  error_message     text,
  n8n_execution_id  text,
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_logs_company_id   ON public.dispatch_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_logs_schedule_id  ON public.dispatch_logs(schedule_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_logs_status       ON public.dispatch_logs(status);
CREATE INDEX IF NOT EXISTS idx_dispatch_logs_created_at   ON public.dispatch_logs(created_at);

-- =============================================================================
-- TABELA: campaigns
-- Campanhas de disparo individual para clientes extraídos do Power BI.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.campaigns (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bot_instance_id  uuid        REFERENCES public.whatsapp_bot_instances(id) ON DELETE SET NULL,
  name             text        NOT NULL,
  description      text,
  dataset_id       text        NOT NULL,
  workspace_id     text,
  dax_query        text,
  selected_columns  jsonb      NOT NULL DEFAULT '[]'::jsonb,
  selected_measures jsonb      NOT NULL DEFAULT '[]'::jsonb,
  filters          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Campos para construir query de clientes inativos
  customer_table   text,
  date_column      text,
  days_inactive    integer,
  -- Colunas do dataset que mapeiam para telefone e nome do cliente
  phone_column     text,
  name_column      text,
  message_template text        NOT NULL,
  image_url        text,
  cron_expression  text,
  is_active        boolean     NOT NULL DEFAULT true,
  last_run_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_company_id ON public.campaigns(company_id);

-- =============================================================================
-- TABELA: campaign_executions
-- Cada execução de uma campanha (manual ou agendada).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.campaign_executions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status        text        NOT NULL DEFAULT 'running'
                            CHECK (status IN ('running', 'completed', 'failed')),
  total_clients integer     NOT NULL DEFAULT 0,
  sent_count    integer     NOT NULL DEFAULT 0,
  failed_count  integer     NOT NULL DEFAULT 0,
  skipped_count integer     NOT NULL DEFAULT 0,
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_campaign_executions_campaign_id ON public.campaign_executions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_executions_company_id  ON public.campaign_executions(company_id);

-- =============================================================================
-- TABELA: campaign_sends
-- Registro de cada mensagem enviada dentro de uma execução de campanha.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.campaign_sends (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid        NOT NULL REFERENCES public.campaigns(id)           ON DELETE CASCADE,
  execution_id  uuid        REFERENCES public.campaign_executions(id)          ON DELETE CASCADE,
  company_id    uuid        NOT NULL REFERENCES public.companies(id)            ON DELETE CASCADE,
  client_name   text,
  client_phone  text,
  -- Dados completos do cliente extraídos do Power BI
  client_data   jsonb,
  message       text        NOT NULL,
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'sent', 'failed')),
  error_message text,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_sends_execution_id ON public.campaign_sends(execution_id);
CREATE INDEX IF NOT EXISTS idx_campaign_sends_campaign_id  ON public.campaign_sends(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_sends_company_id   ON public.campaign_sends(company_id);

-- =============================================================================
-- TABELA: user_workspace_access
-- Controle de quais workspaces cada usuário pode acessar.
-- Quando vazio = acesso total (admin).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.user_workspace_access (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_user_workspace_access_user_id      ON public.user_workspace_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_workspace_access_company_id   ON public.user_workspace_access(company_id);
CREATE INDEX IF NOT EXISTS idx_user_workspace_access_workspace_id ON public.user_workspace_access(workspace_id);

-- =============================================================================
-- TABELA: user_dataset_access
-- Controle de quais datasets Power BI cada usuário pode acessar.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.user_dataset_access (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  dataset_id   text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dataset_id)
);

CREATE INDEX IF NOT EXISTS idx_user_dataset_access_user_id      ON public.user_dataset_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_dataset_access_company_id   ON public.user_dataset_access(company_id);
CREATE INDEX IF NOT EXISTS idx_user_dataset_access_workspace_id ON public.user_dataset_access(workspace_id);
CREATE INDEX IF NOT EXISTS idx_user_dataset_access_dataset_id   ON public.user_dataset_access(dataset_id);

-- =============================================================================
-- TABELA: chat_logs
-- Registro de perguntas feitas ao Chat IA por empresa (controle de uso).
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.chat_logs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Intenção/pergunta do usuário (primeiros 500 caracteres)
  intencao   text,
  -- Mês de referência no formato "YYYY-MM" (para agrupamento de uso)
  mes        text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_logs_company_id  ON public.chat_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_chat_logs_created_at  ON public.chat_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_chat_logs_mes         ON public.chat_logs(mes);
CREATE INDEX IF NOT EXISTS idx_chat_logs_company_mes ON public.chat_logs(company_id, mes);

-- =============================================================================
-- DADOS INICIAIS
-- Cria a empresa padrão e o usuário administrador inicial.
-- Altere email e senha antes de executar em produção!
-- =============================================================================
INSERT INTO public.companies (name, slug)
VALUES ('Empresa Padrao', 'empresa-padrao')
ON CONFLICT (slug) DO NOTHING;

-- Para criar um admin, execute separadamente após ajustar a senha:
-- INSERT INTO public.users (email, password_hash, app_metadata)
-- VALUES (
--   'admin@suaempresa.com',
--   -- Gere o hash com: SELECT crypt('SUA_SENHA_AQUI', gen_salt('bf'));
--   crypt('SUA_SENHA_AQUI', gen_salt('bf')),
--   jsonb_build_object(
--     'company_id', (SELECT id FROM public.companies WHERE slug = 'empresa-padrao'),
--     'role', 'admin'
--   )
-- );
