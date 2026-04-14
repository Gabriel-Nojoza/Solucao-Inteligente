alter table public.schedules
  add column if not exists pbi_page_names text[];

update public.schedules
set pbi_page_names = array[pbi_page_name]
where pbi_page_name is not null
  and (
    pbi_page_names is null
    or cardinality(pbi_page_names) = 0
  );
