set session_replication_role = replica;

insert into food_aliases (food_id, alias, alias_type) values
  (1252, '原味豆浆', 'synonym'),
  (653, '里脊肉', 'synonym'),
  (653, '猪里脊', 'synonym'),
  (608, '里脊', 'synonym'),
  (608, '牛里脊', 'synonym');

-- Re-enable triggers

set session_replication_role = DEFAULT;
