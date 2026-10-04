-- O-24: the table had an own-row RLS policy but no authenticated table grant,
-- so PostgreSQL rejected access before RLS could apply.
begin;
revoke all on table public.nutrition_targets from anon, authenticated;
grant select, insert, update, delete on table public.nutrition_targets to authenticated;
revoke all on table public.body_metric_write_receipts from anon, authenticated;
grant select, insert, update, delete on table public.body_metric_write_receipts to authenticated;
commit;
