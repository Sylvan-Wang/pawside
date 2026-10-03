-- Method import runtime: allow up to fourteen ordered Program Days.
begin;
alter table public.method_splits
  add constraint method_splits_order_index_v2_check
  check (order_index between 1 and 14) not valid;
alter table public.method_splits validate constraint method_splits_order_index_v2_check;
alter table public.method_splits drop constraint method_splits_order_index_check;
commit;
