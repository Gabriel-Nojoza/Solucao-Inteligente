-- Helper para pegar o company_id do JWT (app_metadata tem prioridade sobre user_metadata)
create or replace function public.auth_company_id()
returns text
language sql
stable
as $$
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> 'company_id',
    auth.jwt() -> 'user_metadata' ->> 'company_id'
  )
$$;

-- ─── companies ────────────────────────────────────────────────────────────────
alter table public.companies enable row level security;

create policy "companies_select_own"
  on public.companies
  for select
  using (id::text = public.auth_company_id());

-- ─── company_settings ─────────────────────────────────────────────────────────
alter table public.company_settings enable row level security;

create policy "company_settings_select_own"
  on public.company_settings
  for select
  using (company_id::text = public.auth_company_id());

create policy "company_settings_update_own"
  on public.company_settings
  for update
  using (company_id::text = public.auth_company_id());

-- ─── contacts ─────────────────────────────────────────────────────────────────
alter table public.contacts enable row level security;

create policy "contacts_all_own"
  on public.contacts
  for all
  using (company_id::text = public.auth_company_id());
