-- ai_generations: the INSERT policy in production had been created without its role and
-- condition (cmd ALL, role public, no expression), so every AI generation log write was
-- rejected with 403. This restores the intended rule: a signed-in user may insert rows for
-- themselves only. ALTER POLICY is used so nothing has to be dropped. Select stays own-rows;
-- update/delete are not granted to authenticated.
--
-- Already applied to production.

alter policy ai_generations_insert_own on public.ai_generations
  to authenticated
  with check (user_id = (select auth.uid()));
