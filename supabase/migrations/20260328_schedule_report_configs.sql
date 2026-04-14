alter table public.schedules
  add column if not exists report_configs jsonb;

update public.schedules
set report_configs = jsonb_build_array(
  jsonb_strip_nulls(
    jsonb_build_object(
      'report_id', report_id,
      'pbi_page_name', pbi_page_name,
      'pbi_page_names',
      case
        when pbi_page_names is not null and cardinality(pbi_page_names) > 0 then to_jsonb(pbi_page_names)
        when pbi_page_name is not null then jsonb_build_array(pbi_page_name)
        else null
      end
    )
  )
)
where report_id is not null
  and (
    report_configs is null
    or report_configs = 'null'::jsonb
    or report_configs = '[]'::jsonb
  );
