-- Method import foundation F3: source authority labels used by imported methods.
begin;
alter table public.method_rules add constraint method_rules_source_authority_v2_check
  check (source_authority in ('method_explicit', 'official_reconstructed', 'product_execution_default',
                              'unresolved', 'library_default', 'ai_inferred', 'user_corrected')) not valid;
alter table public.method_rules validate constraint method_rules_source_authority_v2_check;
alter table public.method_rules drop constraint method_rules_source_authority_check;

alter table public.method_prescription_field_values add constraint method_prescription_field_values_source_authority_v2_check
  check (source_authority in ('method_explicit', 'official_reconstructed', 'product_execution_default',
                              'unresolved', 'library_default', 'ai_inferred', 'user_corrected')) not valid;
alter table public.method_prescription_field_values validate constraint method_prescription_field_values_source_authority_v2_check;
alter table public.method_prescription_field_values drop constraint method_prescription_field_values_source_authority_check;
commit;
