-- Patch: promote common generic names as canonical entries
-- Run AFTER seed_food_data.sql
-- Inserts a generic "鸡蛋" entry using 鸡蛋(白皮) nutrition values,
-- then aliases both variants back to it.

do $$
declare
  v_egg_id    integer;
  v_white_id  integer;
  v_red_id    integer;
begin
  -- Look up existing variant ids
  select id into v_white_id from foods where canonical_name = '鸡蛋(白皮)' limit 1;
  select id into v_red_id   from foods where canonical_name = '鸡蛋(红皮)' limit 1;

  -- Insert generic canonical "鸡蛋" (copy nutrition from 白皮)
  insert into foods (canonical_name, category, source)
  values ('鸡蛋', '蛋类', 'China Food Composition Table')
  on conflict (canonical_name) do nothing
  returning id into v_egg_id;

  -- If it already existed, fetch its id
  if v_egg_id is null then
    select id into v_egg_id from foods where canonical_name = '鸡蛋';
  end if;

  -- Copy nutrition from 鸡蛋(白皮)
  insert into food_nutrition (food_id, energy_kcal, protein_g, fat_g, carb_g, fiber_g)
  select v_egg_id, energy_kcal, protein_g, fat_g, carb_g, fiber_g
  from food_nutrition
  where food_id = v_white_id
  on conflict (food_id) do nothing;

  -- Aliases: variants → generic
  if v_white_id is not null then
    insert into food_aliases (food_id, alias, alias_type)
    values (v_egg_id, '鸡蛋(白皮)', 'synonym')
    on conflict do nothing;
  end if;

  if v_red_id is not null then
    insert into food_aliases (food_id, alias, alias_type)
    values (v_egg_id, '鸡蛋(红皮)', 'synonym')
    on conflict do nothing;
  end if;

  -- Common spoken aliases
  insert into food_aliases (food_id, alias, alias_type) values
    (v_egg_id, '鸡蛋（白皮）', 'synonym'),
    (v_egg_id, '鸡蛋（红皮）', 'synonym'),
    (v_egg_id, '土鸡蛋',       'synonym'),
    (v_egg_id, '生鸡蛋',       'synonym'),
    (v_egg_id, '整蛋',         'synonym')
  on conflict do nothing;

  -- Portion template
  insert into food_portion_templates (food_id, portion_name, weight_g, note)
  values
    (v_egg_id, '1个', 50, '中等大小鸡蛋约50g'),
    (v_egg_id, '2个', 100, '两个鸡蛋约100g')
  on conflict do nothing;

end $$;
