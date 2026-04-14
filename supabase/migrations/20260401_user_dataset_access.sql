create table if not exists public.user_dataset_access (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  dataset_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, dataset_id)
);

create index if not exists idx_user_dataset_access_user_id
  on public.user_dataset_access(user_id);
create index if not exists idx_user_dataset_access_company_id
  on public.user_dataset_access(company_id);
create index if not exists idx_user_dataset_access_workspace_id
  on public.user_dataset_access(workspace_id);
create index if not exists idx_user_dataset_access_dataset_id
  on public.user_dataset_access(dataset_id);

alter table public.user_dataset_access enable row level security;

drop policy if exists user_dataset_access_isolation on public.user_dataset_access;
create policy user_dataset_access_isolation on public.user_dataset_access
for all
using (
  company_id::text = coalesce(
    auth.jwt() -> 'app_metadata' ->> 'company_id',
    auth.jwt() -> 'user_metadata' ->> 'company_id'
  )
  and (
    user_id = auth.uid()
    or coalesce(
      auth.jwt() -> 'app_metadata' ->> 'role',
      auth.jwt() -> 'user_metadata' ->> 'role'
    ) = 'admin'
  )
)
with check (
  company_id::text = coalesce(
    auth.jwt() -> 'app_metadata' ->> 'company_id',
    auth.jwt() -> 'user_metadata' ->> 'company_id'
  )
  and coalesce(
    auth.jwt() -> 'app_metadata' ->> 'role',
    auth.jwt() -> 'user_metadata' ->> 'role'
  ) = 'admin'
);
