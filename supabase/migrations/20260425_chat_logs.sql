create table if not exists public.chat_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_logs_company_id on public.chat_logs(company_id);
create index if not exists idx_chat_logs_created_at on public.chat_logs(created_at);

alter table public.chat_logs enable row level security;

create policy chat_logs_isolation on public.chat_logs
for all
using (
  company_id::text = coalesce(
    auth.jwt() -> 'app_metadata' ->> 'company_id',
    auth.jwt() -> 'user_metadata' ->> 'company_id'
  )
)
with check (
  company_id::text = coalesce(
    auth.jwt() -> 'app_metadata' ->> 'company_id',
    auth.jwt() -> 'user_metadata' ->> 'company_id'
  )
);
