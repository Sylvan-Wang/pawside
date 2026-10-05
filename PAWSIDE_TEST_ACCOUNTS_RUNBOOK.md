# Pawside test-account seeding runbook

This runbook covers `scripts/seed-test-accounts.mts`, which creates 3 throwaway
Supabase auth accounts and drives them through the real app APIs to produce
realistic historical training/nutrition/recovery data for manual QA. It does
not touch `method_releases` or any Method template table, and it cannot
affect any existing user: it only ever creates or looks up the 3 exact
emails listed below.

## What it creates

| Persona | Email | Password | What it looks like |
| --- | --- | --- | --- |
| 模范用户 (full compliance) | `pawsidetest.fullcompliance@gmail.com` | `123456` | 28 days of history, training every other day with every prescribed set logged, 3 meals/day, one weekly weigh-in |
| 断续用户 (intermittent gaps) | `pawsidetest.intermittentgaps@gmail.com` | `123456` | 4 real training days over 3 weeks (one only 50% completed), one training session started 13 days ago and deliberately left unfinished (to exercise the stale-session banner), sparse/partial meal logging, one flagged recovery check-in |
| 新用户 (new, empty) | `pawsidetest.newuserempty@gmail.com` | `123456` | Onboarded and joined the Method, otherwise zero history |

These are brand-new, unmistakably-fake addresses. The script cannot rename,
delete, or overwrite any other account.

## Gate 1 — server-only configuration

Add these to `.env.local` (never commit it, never prefix with `NEXT_PUBLIC_`
except where already required):

```dotenv
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SEED_APP_BASE_URL=http://localhost:3000
```

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — keep it out of any browser
context and out of git. `SEED_APP_BASE_URL` must point at a running instance
of the app connected to the **same** Supabase project as the other three
variables, since the script authenticates and calls that instance's own API
routes rather than talking to Supabase directly for most of the data.

## Gate 2 — start the app

```powershell
npm.cmd run dev
```

Confirm it comes up against the intended Supabase project (check
`/api/ai/status` or just that sign-in works) before seeding.

## Gate 3 — run the seed script

In a second terminal:

```powershell
npm.cmd run seed:test-accounts
```

Expected console output, in order, for each of the 3 personas:
- `=== LABEL: email ===`
- `[LABEL] signed in as email (user_id)`
- `[LABEL] onboarded + joined Method`
- a line per seeded training day / meal / body metric / recovery check-in
- for INTERMITTENT: `[LABEL] left one session started 13 days ago, unfinished`

At the end:

```
================ DONE ================
Accounts (same password for all three, shown once):
  MODEL          pawsidetest.fullcompliance@gmail.com  (user_id=...)
  INTERMITTENT   pawsidetest.intermittentgaps@gmail.com  (user_id=...)
  NEW            pawsidetest.newuserempty@gmail.com  (user_id=...)
  password: 123456

To remove these test accounts later, run in the SQL editor:
  delete from auth.users where email in (...);
```

PASS requires all 3 personas complete with no thrown error. A `[LABEL] ...
failed (kept going): ...` warning for an individual set/meal/metric call is
not fatal — the script continues — but should be investigated if it shows up
before you rely on that persona's data.

## Gate 4 — verify by signing in

Sign in to the running app as any of the 3 emails above with password
`123456`. If you get "邮箱或密码错误" at this point, the seed script has not
actually been run yet against the project you're signing into (Gate 3 was
skipped, failed, or `SEED_APP_BASE_URL`/`NEXT_PUBLIC_SUPABASE_URL` pointed at
a different Supabase project than the one you're now testing against).

Then spot-check the shape you seeded: MODEL should show a long, mostly-full
history in `/history`; INTERMITTENT should show gaps and, if you started an
unfinished session, a stale-session banner when you open the app; NEW should
look like a freshly onboarded account with no history at all.

## Known fragility

`buildAuthCookie()` in the script reconstructs the `@supabase/ssr` cookie
format by hand from that package's source, because the app's API routes only
accept cookie-based auth, not a bearer token. If `@supabase/ssr` ever changes
its cookie encoding, this breaks. The script calls `verifyAuth()` right after
each sign-in specifically to catch that immediately and loudly (a thrown
error naming the persona) rather than silently seeding bad data — if you see
that error, the cookie format needs to be re-derived from the installed
`@supabase/ssr` version before anything else in this runbook will work.

## Cleanup

Run the `delete from auth.users where email in (...)` statement the script
prints (in the Supabase SQL editor, against the same project) to remove all
3 test accounts and their cascaded data.
