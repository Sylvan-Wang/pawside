-- Method import B5: generation telemetry surface.
begin;
alter table public.ai_generations
  add constraint ai_generations_surface_v2_check check (surface in (
    'workout_session_feedback', 'meal_feedback', 'daily_review', 'weekly_review',
    'advisory_plan', 'coach_chat', 'method_import'
  )) not valid;
alter table public.ai_generations validate constraint ai_generations_surface_v2_check;
alter table public.ai_generations drop constraint ai_generations_surface_check;
commit;
