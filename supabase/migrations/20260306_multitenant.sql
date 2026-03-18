-- Multi-tenant base migration (company isolation)
-- Apply in Supabase SQL Editor before using the updated API routes.

create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (company_id, key)
);

do $$
declare
  default_company_id uuid;
begin
  select id into default_company_id from public.companies order by created_at asc limit 1;

  if default_company_id is null then
    insert into public.companies (name, slug)
    values ('Empresa Padrao', 'empresa-padrao')
    returning id into default_company_id;
  end if;

  alter table public.workspaces add column if not exists company_id uuid;
  alter table public.reports add column if not exists company_id uuid;
  alter table public.contacts add column if not exists company_id uuid;
  alter table public.schedules add column if not exists company_id uuid;
  alter table public.dispatch_logs add column if not exists company_id uuid;
  alter table public.automations add column if not exists company_id uuid;

  update public.workspaces set company_id = default_company_id where company_id is null;
  update public.reports set company_id = default_company_id where company_id is null;
  update public.contacts set company_id = default_company_id where company_id is null;
  update public.schedules set company_id = default_company_id where company_id is null;
  update public.dispatch_logs set company_id = default_company_id where company_id is null;
  update public.automations set company_id = default_company_id where company_id is null;

  begin
    alter table public.workspaces alter column company_id set not null;
  exception when others then null;
  end;
  begin
    alter table public.reports alter column company_id set not null;
  exception when others then null;
  end;
  begin
    alter table public.contacts alter column company_id set not null;
  exception when others then null;
  end;
  begin
    alter table public.schedules alter column company_id set not null;
  exception when others then null;
  end;
  begin
    alter table public.dispatch_logs alter column company_id set not null;
  exception when others then null;
  end;
  begin
    alter table public.automations alter column company_id set not null;
  exception when others then null;
  end;

  -- Migrate old global settings table (if present) to company_settings
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'settings'
  ) then
    insert into public.company_settings (company_id, key, value, updated_at)
    select
      default_company_id,
      s.key,
      coalesce(s.value::jsonb, '{}'::jsonb),
      coalesce(s.updated_at, now())
    from public.settings s
    on conflict (company_id, key) do update
      set value = excluded.value,
          updated_at = excluded.updated_at;
  end if;

  update auth.users
  set
    raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('company_id', default_company_id::text),
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('company_id', default_company_id::text)
  where
    coalesce(raw_app_meta_data ->> 'company_id', raw_user_meta_data ->> 'company_id', '') = '';
end $$;

create index if not exists idx_company_settings_company_id on public.company_settings(company_id);
create index if not exists idx_workspaces_company_id on public.workspaces(company_id);
create index if not exists idx_reports_company_id on public.reports(company_id);
create index if not exists idx_contacts_company_id on public.contacts(company_id);
create index if not exists idx_schedules_company_id on public.schedules(company_id);
create index if not exists idx_dispatch_logs_company_id on public.dispatch_logs(company_id);
create index if not exists idx_automations_company_id on public.automations(company_id);

create unique index if not exists uq_workspaces_company_pbi
  on public.workspaces(company_id, pbi_workspace_id);
create unique index if not exists uq_reports_company_pbi
  on public.reports(company_id, pbi_report_id);

alter table public.workspaces enable row level security;
alter table public.reports enable row level security;
alter table public.contacts enable row level security;
alter table public.schedules enable row level security;
alter table public.dispatch_logs enable row level security;
alter table public.automations enable row level security;
alter table public.company_settings enable row level security;

drop policy if exists company_settings_isolation on public.company_settings;
create policy company_settings_isolation on public.company_settings
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
