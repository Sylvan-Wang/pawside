-- Sign-ups by first-touch channel (lib/site/attribution.ts).
-- Run in the Supabase SQL editor. Accounts created before 2026-11-09, or by people who
-- never opened the public site first, show up as "(unknown)".
select
  coalesce(raw_user_meta_data #>> '{signup_source,source}', '(unknown)') as source,
  coalesce(raw_user_meta_data #>> '{signup_source,campaign}', '') as campaign,
  count(*) as signups,
  count(*) filter (where created_at > now() - interval '7 days') as last_7_days,
  count(*) filter (where email_confirmed_at is not null) as confirmed
from auth.users
group by 1, 2
order by signups desc;
