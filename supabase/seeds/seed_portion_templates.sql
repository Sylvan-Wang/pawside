-- Seed: Food portion templates (V3)
-- Maps common Chinese portion expressions to grams
-- Usage: "一个鸡蛋" → 50g, "一碗米饭" → 116g

-- NOTE: food_id values reference foods inserted by seed_food_data.sql
-- Run seed_food_data.sql first, then use subqueries to find food_id by name

insert into food_portion_templates (food_id, portion_name, weight_g, note)
select f.id, v.portion_name, v.weight_g, v.note
from foods f
join (values
  -- 蛋类
  ('鸡蛋(白皮)',   '1个',   50,   '中等大小鸡蛋'),
  ('鸡蛋(红皮)',   '1个',   55,   '中等大小红皮鸡蛋'),
  -- 主食
  ('米饭(蒸,籼米)','1小碗', 100,  '约100g熟米饭'),
  ('米饭(蒸,籼米)','1中碗', 150,  '约150g熟米饭'),
  ('米饭(蒸,籼米)','1大碗', 200,  '约200g熟米饭'),
  ('馒头',         '1个',   100,  '普通大小馒头'),
  ('面条(煮,切面)','1碗',   200,  '煮熟面条约200g'),
  ('面包(白)',     '1片',    30,  '普通切片面包'),
  -- 豆类
  ('豆浆',         '1杯',   250,  '标准杯250ml'),
  -- 肉类（生重）
  ('鸡胸脯肉',    '1块',    150,  '单块鸡胸约150g'),
  -- 蔬菜
  ('西兰花',       '1朵',    20,  '约20g/小朵'),
  -- 水果
  ('苹果',         '1个',   200,  '中等大小苹果'),
  ('香蕉',         '1根',   100,  '去皮后约100g'),
  ('橙',           '1个',   180,  '中等大小橙'),
  -- 坚果
  ('花生(炒)',     '一把',   15,  '约15粒花生'),
  ('核桃(干)',     '1个',    10,  '去壳核桃仁约10g')
) as v(canonical_name, portion_name, weight_g, note)
  on f.canonical_name = v.canonical_name
on conflict (food_id, portion_name) do nothing;
