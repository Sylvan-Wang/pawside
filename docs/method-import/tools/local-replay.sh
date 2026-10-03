#!/usr/bin/env bash
# 本地回放：在临时 PostgreSQL 里重放 supabase/migrations，并可选地叠加 docs/method-import/sql 的草案。
#
# 用途：没有 Docker 和 Supabase CLI 的环境（如云端沙箱）里验证迁移能否从空库按序执行。
# 它不替代 CI（CI 用 supabase db start、db lint、supabase/tests/*.sql），只是更快的本地预检。
#
# 用法：
#   docs/method-import/tools/local-replay.sh                 # 只回放 supabase/migrations
#   docs/method-import/tools/local-replay.sh --with-drafts   # 再依次应用 sql/01..05 草案
#   docs/method-import/tools/local-replay.sh --contracts     # 回放后运行 supabase/tests/*.sql（每个都在事务内回滚）
#   docs/method-import/tools/local-replay.sh --draft-tests   # 叠加草案后运行 docs/method-import/sql/tests/*_contract.sql（rollback-only）
#   docs/method-import/tools/local-replay.sh --keep          # 结束后保留数据库，打印连接方式
#
# 要求：PostgreSQL 16 的二进制（默认找 /usr/lib/postgresql/*/bin，可用 PGBIN 覆盖）；不能以 root 运行。
# 云端沙箱里是 root 时：先 `useradd -m pgrunner`，再 `su pgrunner -c "<本脚本>"`。
#
# 局限：auth 模式和角色是桩（只有 auth.users、auth.uid()、auth.role()）；
#       不含 Supabase 的存储、实时、扩展等。验证的是 SQL 结构与行为，不是 Supabase 平台。

set -euo pipefail

WITH_DRAFTS=0; RUN_CONTRACTS=0; DRAFT_TESTS=0; KEEP=0
for arg in "$@"; do
  case "$arg" in
    --with-drafts) WITH_DRAFTS=1 ;;
    --contracts) RUN_CONTRACTS=1 ;;
    --draft-tests) DRAFT_TESTS=1; WITH_DRAFTS=1 ;;
    --keep) KEEP=1 ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

if [ "$(id -u)" = "0" ]; then
  echo "不能以 root 运行 PostgreSQL。请用普通用户运行（见脚本头部说明）。" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/initdb" ] || { echo "找不到 PostgreSQL 二进制，请设置 PGBIN" >&2; exit 2; }

WORK="$(mktemp -d)"
PORT="${PGPORT:-54399}"
DB="pawside_replay"
DRAFT_FAILED=0
export PGHOST="$WORK" PGPORT="$PORT"

cleanup() {
  if [ "$KEEP" = "0" ]; then
    "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

"$PGBIN/initdb" -D "$WORK/data" -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -p $PORT -c listen_addresses=" -l "$WORK/pg.log" -w start >/dev/null
"$PGBIN/psql" -d postgres -qc "create database $DB" >/dev/null

PSQL=("$PGBIN/psql" -d "$DB" -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" >/dev/null <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then create role supabase_admin nologin; end if;
end $$;
create schema auth;
create table auth.users (
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;
grant usage on schema auth to anon, authenticated, service_role;
create schema if not exists extensions;
-- Supabase 会给 public 模式下新建的对象设置默认权限（迁移里"revoke all … from anon, authenticated"
-- 之所以有意义，正是因为默认有授权）。不模拟它，权限类测试会得出与线上不同的结论。
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
SQL

count=0
for f in $(ls "$ROOT"/supabase/migrations/*.sql | sort); do
  if ! out="$("${PSQL[@]}" -f "$f" 2>&1 >/dev/null)"; then
    echo "FAIL  $(basename "$f")"; echo "$out" | head -5; exit 1
  fi
  count=$((count + 1))
done
echo "OK    回放 supabase/migrations：$count 个文件"

if [ "$WITH_DRAFTS" = "1" ]; then
  for f in $(ls "$ROOT"/docs/method-import/sql/0[1-9]-draft-migrations.sql 2>/dev/null | sort); do
    if ! out="$("${PSQL[@]}" -f "$f" 2>&1 >/dev/null)"; then
      echo "FAIL  $(basename "$f")"; echo "$out" | head -5; exit 1
    fi
    echo "OK    应用草案 $(basename "$f")"
  done
fi

if [ "$RUN_CONTRACTS" = "1" ]; then
  # 合约失败不中断：逐个运行、汇总。用"纯 master 的失败列表"与"叠加草案后的失败列表"对比，
  # 判断某个失败是不是草案造成的。
  pass=0; failed_list=""
  for f in $(ls "$ROOT"/supabase/tests/*.sql | sort); do
    if "${PSQL[@]}" -f "$f" >/dev/null 2>"$WORK/contract.err"; then
      pass=$((pass + 1))
    else
      failed_list="$failed_list $(basename "$f")"
      echo "FAIL  contract $(basename "$f"): $(grep -m1 -i 'error' "$WORK/contract.err" | cut -c1-160)"
    fi
  done
  echo "OK    SQL 合约通过 $pass 个；失败：${failed_list:- 无}"
fi

if [ "$DRAFT_TESTS" = "1" ]; then
  dpass=0; dfailed=""
  for f in $(ls "$ROOT"/docs/method-import/sql/tests/*_contract.sql 2>/dev/null | sort); do
    if "${PSQL[@]}" -f "$f" >/dev/null 2>"$WORK/contract.err"; then
      dpass=$((dpass + 1)); echo "OK    草案合约 $(basename "$f")"
    else
      dfailed="$dfailed $(basename "$f")"
      echo "FAIL  草案合约 $(basename "$f"): $(grep -m1 -i 'error' "$WORK/contract.err" | cut -c1-200)"
    fi
  done
  echo "OK    草案合约通过 $dpass 个；失败：${dfailed:- 无}"
  [ -z "$dfailed" ] || DRAFT_FAILED=1
fi

tables="$("$PGBIN/psql" -d "$DB" -Atc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
echo "OK    public 表数量：$tables"

if [ "$KEEP" = "1" ]; then
  echo "已保留数据库。连接：PGHOST=$WORK PGPORT=$PORT $PGBIN/psql -d $DB"
  echo "结束后清理：$PGBIN/pg_ctl -D $WORK/data -m immediate stop && rm -rf $WORK"
fi

exit "$DRAFT_FAILED"
