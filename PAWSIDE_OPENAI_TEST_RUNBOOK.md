# Pawside OpenAI test runbook

This runbook applies only to `D:\Pawside`. It does not activate Pawside Method
and does not use or modify Morrow.

## Gate 1 — server-only configuration

Add the key locally to `.env.local`. Never paste it into a browser variable,
commit it, or prefix it with `NEXT_PUBLIC_`.

```dotenv
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-5.6-luna
```

`OPENAI_MODEL` is optional; the application defaults to `gpt-5.6-luna`.

On this Windows host, Node direct HTTPS does not inherit the enabled system
proxy. The ignored `.env.proxy.local` provides `HTTP_PROXY`,
`HTTPS_PROXY`, and `NO_PROXY`. Pawside's Next launcher passes these as
environment variables to a clean child process, while the AI smoke command
opts directly into Node's native environment-proxy support.

## Gate 2 — direct provider smoke

```powershell
npm.cmd run ai:smoke
```

PASS requires:

- `stage=configuration`, `provider=openai`, and `configured=true`;
- `stage=provider` and `ok=true`;
- a structured response with summary, insights, actions, and tone.

A build or `configured=true` alone is not Provider evidence.

## Gate 3 — authenticated application test

Start Pawside:

```powershell
npm.cmd run dev
```

Then sign in and verify:

1. `GET /api/ai/status` returns OpenAI, the expected model, Responses API, and
   `configured=true`; it never returns the key.
2. Record at least one workout or meal for the selected date.
3. Open `/history/YYYY-MM-DD`. The first `POST /api/ai/daily-review` returns
   `generation.source=openai` and `cached=false`.
4. Reload the same date. The database-backed response returns `cached=true`.
5. Confirm one `ai_generated_content` row for that user/date with
   `prompt_version=openai_daily_review_v2`.
6. Generate an advisory draft through `POST /api/ai/plans`; confirm
   `provider=openai`, `status=draft`, and one user-owned `ai_plans` row.

If OpenAI is unavailable, daily review returns `generation.source=rules` with
an explicit `fallback_reason` and does not cache that fallback. The plan route
returns a typed 429, 502, or 503 error and does not persist a placeholder.

## Current evidence boundary

- Source, TypeScript, lint, and production build: PASS.
- Missing-key behavior: PASS with explicit `not_configured`.
- Real OpenAI request: HOLD until `OPENAI_API_KEY` is supplied locally.
- Supabase persistence and page-level AI flow: HOLD until an authenticated live
  case is run.
