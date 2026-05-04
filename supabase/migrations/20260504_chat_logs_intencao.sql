alter table public.chat_logs
  add column if not exists intencao text,
  add column if not exists mes text;

create index if not exists idx_chat_logs_mes on public.chat_logs(mes);
create index if not exists idx_chat_logs_company_mes on public.chat_logs(company_id, mes);
