create table if not exists public.whatsapp_bot_instances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  manual_qr_code_url text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_bot_instances_company_id
  on public.whatsapp_bot_instances(company_id);

create unique index if not exists uq_whatsapp_bot_instances_default
  on public.whatsapp_bot_instances(company_id)
  where is_default = true;

alter table public.contacts
  add column if not exists bot_instance_id uuid references public.whatsapp_bot_instances(id) on delete set null;

alter table public.schedules
  add column if not exists bot_instance_id uuid references public.whatsapp_bot_instances(id) on delete set null;

do $$
declare
  company_row record;
  default_instance_id uuid;
begin
  for company_row in
    select id
    from public.companies
  loop
    select id
    into default_instance_id
    from public.whatsapp_bot_instances
    where company_id = company_row.id
    order by is_default desc, created_at asc
    limit 1;

    if default_instance_id is null then
      insert into public.whatsapp_bot_instances (
        company_id,
        name,
        is_default
      )
      values (
        company_row.id,
        'WhatsApp principal',
        true
      )
      returning id into default_instance_id;
    else
      update public.whatsapp_bot_instances
      set
        is_default = (id = default_instance_id),
        updated_at = now()
      where company_id = company_row.id;
    end if;

    update public.contacts
    set bot_instance_id = default_instance_id
    where company_id = company_row.id
      and bot_instance_id is null;

    update public.schedules
    set bot_instance_id = default_instance_id
    where company_id = company_row.id
      and bot_instance_id is null;
  end loop;
end $$;

alter table public.whatsapp_bot_instances enable row level security;

drop policy if exists whatsapp_bot_instances_isolation on public.whatsapp_bot_instances;
create policy whatsapp_bot_instances_isolation on public.whatsapp_bot_instances
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
