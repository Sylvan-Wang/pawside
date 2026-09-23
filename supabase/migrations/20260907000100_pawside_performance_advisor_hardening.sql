-- Pawside: address the actionable findings from Supabase Performance Advisor.
--
-- The three policy changes preserve the existing ownership semantics while
-- allowing PostgreSQL to evaluate auth.uid() once per statement instead of
-- once per candidate row. The seven indexes cover foreign-key columns that
-- were not the leading column of an existing index.

alter policy "users can manage own food logs"
  on public.user_food_logs
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "users can manage own food log items"
  on public.user_food_log_items
  using (
    exists (
      select 1
      from public.user_food_logs
      where id = user_food_log_items.food_log_id
        and user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.user_food_logs
      where id = user_food_log_items.food_log_id
        and user_id = (select auth.uid())
    )
  );

alter policy "users can manage own nutrition summary"
  on public.daily_nutrition_summary
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists exercise_media_exercise_id_idx
  on public.exercise_media(exercise_id);

create index if not exists exercise_prescriptions_exercise_id_idx
  on public.exercise_prescriptions(exercise_id);

create index if not exists method_enrollments_method_id_idx
  on public.method_enrollments(method_id);

create index if not exists method_split_exercises_exercise_id_idx
  on public.method_split_exercises(exercise_id);

create index if not exists session_prescriptions_cycle_id_idx
  on public.session_prescriptions(cycle_id);

create index if not exists session_prescriptions_method_split_id_idx
  on public.session_prescriptions(method_split_id);

create index if not exists user_exercise_progression_exercise_id_idx
  on public.user_exercise_progression(exercise_id);
