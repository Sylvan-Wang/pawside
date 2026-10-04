-- Review center C2: register monthly review as an observable AI surface.
begin;
alter table public.ai_generations
  add constraint ai_generations_surface_v3_check check (surface in (
    'workout_session_feedback', 'meal_feedback', 'daily_review', 'weekly_review',
    'monthly_review', 'advisory_plan', 'coach_chat', 'method_import'
  )) not valid;
alter table public.ai_generations validate constraint ai_generations_surface_v3_check;
alter table public.ai_generations drop constraint ai_generations_surface_v2_check;
commit;
