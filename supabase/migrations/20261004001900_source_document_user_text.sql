-- Method import foundation F4: register pasted user text as a source type.
begin;
alter table public.method_source_documents add constraint method_source_documents_source_type_v2_check
  check (source_type in ('transcript', 'official_video', 'prd', 'spec', 'workbook', 'product_patch', 'user_text')) not valid;
alter table public.method_source_documents validate constraint method_source_documents_source_type_v2_check;
alter table public.method_source_documents drop constraint method_source_documents_source_type_check;
commit;
