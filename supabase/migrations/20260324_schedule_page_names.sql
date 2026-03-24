alter table public.schedules
  add column if not exists pbi_page_names text[];

update public.schedules
set pbi_page_names = array[btrim(pbi_page_name)]
where
  coalesce(array_length(pbi_page_names, 1), 0) = 0
  and nullif(btrim(pbi_page_name), '') is not null;
