-- Method import foundation F2: exercise-centric history projections.
begin;
create view public.v_user_exercise_sets with (security_invoker = true) as
select se.user_id,
       public.canonical_exercise_id(ee.exercise_id) as exercise_id,
       ee.exercise_id as recorded_exercise_id,
       ws.id as workout_session_id,
       coalesce(ws.performed_at, ws.completed_at, ws.started_at) as performed_at,
       ws.log_date,
       se.set_index,
       se.actual_weight_kg,
       se.actual_reps,
       se.actual_rir,
       se.actual_duration_seconds,
       se.actual_distance_m,
       se.is_extra
from public.set_executions se
join public.exercise_executions ee on ee.id = se.exercise_execution_id
join public.workout_sessions ws on ws.id = se.workout_session_id
where ws.status = 'completed' and ws.deleted_at is null and se.status = 'completed';
grant select on public.v_user_exercise_sets to authenticated;

create view public.v_user_exercise_last_top with (security_invoker = true) as
with latest as (
  select distinct on (user_id, exercise_id) user_id, exercise_id, workout_session_id, performed_at
  from public.v_user_exercise_sets
  order by user_id, exercise_id, performed_at desc
)
select l.user_id, l.exercise_id, l.workout_session_id, l.performed_at,
       (select max(v.actual_weight_kg)
          from public.v_user_exercise_sets v
         where v.user_id = l.user_id
           and v.exercise_id = l.exercise_id
           and v.workout_session_id = l.workout_session_id) as top_weight_kg
from latest l;
grant select on public.v_user_exercise_last_top to authenticated;
commit;
