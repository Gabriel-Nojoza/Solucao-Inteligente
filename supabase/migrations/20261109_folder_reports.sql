-- Relatorios da pasta: arquivos que o robo instalado no computador do cliente
-- sobe para a plataforma (ex.: relatorio exportado do WinThor). A rotina envia
-- o mais recente de cada pasta no horario programado.
--
-- Os arquivos ficam no bucket privado "folder-reports" (criado pela propria
-- plataforma no primeiro envio). Esta tabela guarda os dados de cada arquivo.

CREATE TABLE IF NOT EXISTS public.folder_reports (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Nome da pasta normalizado (minusculo, sem acento), usado para buscar
  folder_key     text        NOT NULL,
  -- Nome da pasta como esta no computador, usado na tela e na mensagem
  folder_name    text        NOT NULL,
  format         text        NOT NULL CHECK (format IN ('PDF', 'PNG')),
  file_name      text        NOT NULL,
  mimetype       text        NOT NULL,
  size_bytes     integer     NOT NULL,
  sha256         text        NOT NULL,
  storage_path   text        NOT NULL,
  -- Quando o arquivo foi salvo no computador (informado pelo robo)
  file_saved_at  timestamptz NOT NULL,
  -- Quando a plataforma recebeu o arquivo
  received_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_folder_reports_latest
  ON public.folder_reports (company_id, folder_key, format, file_saved_at DESC);

-- O mesmo arquivo (mesmo conteudo) nao e guardado duas vezes
CREATE UNIQUE INDEX IF NOT EXISTS idx_folder_reports_unique_content
  ON public.folder_reports (company_id, folder_key, format, sha256);

-- Sem politicas: so o servidor (service role) le e grava. Usuarios logados e
-- a chave anon nao acessam esta tabela diretamente.
ALTER TABLE public.folder_reports ENABLE ROW LEVEL SECURITY;

-- Na rotina: quais pastas e formatos enviar.
-- Formato: [{ "folder_key": "vendas", "folder_name": "Vendas", "formats": ["PDF", "PNG"] }]
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS folder_report_configs jsonb;

-- Na rotina: qual arquivo de cada pasta/formato ja foi enviado por ela, para
-- nao repetir o relatorio da manha no envio da tarde.
-- Formato: { "vendas|PDF": "<id do folder_report>" }
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS folder_last_sent jsonb;
