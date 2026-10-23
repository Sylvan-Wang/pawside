-- Contract: recipes (migration 20261023000300_recipes). rollback-only.

begin;

do $test$
declare
  u1 uuid := gen_random_uuid();
  n integer;
  r_draft uuid;
  r_pub uuid;
begin
  insert into auth.users (id, email) values (u1, 'recipes@contract.test');

  insert into public.recipes (recipe_code, title, bv_id, source_url, status)
  values ('T-1', '草稿食谱', 'BV1aaaaaaaaa', 'https://www.bilibili.com/video/BV1aaaaaaaaa', 'draft')
  returning id into r_draft;
  insert into public.recipes (recipe_code, title, bv_id, source_url, status, verified_at, published_at)
  values ('T-2', '已发布食谱', 'BV1bbbbbbbbb', 'https://www.bilibili.com/video/BV1bbbbbbbbb', 'published', now(), now())
  returning id into r_pub;

  -- a published row must carry a verification time
  begin
    insert into public.recipes (recipe_code, title, source_url, status)
    values ('T-3', 'x', 'https://www.bilibili.com/video/BV1ccccccccc', 'published');
    raise exception 'recipes failed: a published recipe without verified_at was accepted';
  exception when check_violation then null;
  end;
  -- only bilibili video links
  begin
    insert into public.recipes (recipe_code, title, source_url) values ('T-4', 'x', 'https://evil.example/video/BV1ddddddddd');
    raise exception 'recipes failed: a non-bilibili link was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.recipes (recipe_code, title, source_url, kcal_claimed) values ('T-5', 'x', 'https://www.bilibili.com/video/BV1eeeeeeeee', 0);
    raise exception 'recipes failed: kcal 0 was accepted';
  exception when check_violation then null;
  end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u1::text, true);

  -- feature off: even a published row is invisible
  select count(*) into n from public.recipes;
  if n <> 0 then raise exception 'recipes failed: rows visible without the feature (%)', n; end if;

  execute 'reset role';
  insert into public.user_features (user_id, feature_key) values (u1, 'recipes');
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', u1::text, true);

  -- feature on: only the published row, never the draft
  select count(*) into n from public.recipes;
  if n <> 1 then raise exception 'recipes failed: expected exactly the published row, saw %', n; end if;
  select count(*) into n from public.recipes where id = r_draft;
  if n <> 0 then raise exception 'recipes failed: a draft is readable'; end if;

  -- clients cannot write
  begin
    insert into public.recipes (recipe_code, title, source_url) values ('T-6', 'x', 'https://www.bilibili.com/video/BV1fffffffff');
    raise exception 'recipes failed: a client inserted a recipe';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.recipes set status = 'retired' where id = r_pub;
    raise exception 'recipes failed: a client updated a recipe';
  exception when insufficient_privilege then null;
  end;

  -- anonymous users read nothing
  execute 'reset role';
  execute 'set local role anon';
  begin
    perform 1 from public.recipes limit 1;
    raise exception 'recipes failed: anon can read recipes';
  exception when insufficient_privilege then null;
  end;
end
$test$;

rollback;
