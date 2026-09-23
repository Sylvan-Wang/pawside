# Pawside activation report — 2026-09-07

Status refreshed 2026-09-08 after Netlify production-environment configuration and draft-deploy validation.

## Executive decision

| Layer | Status | Evidence boundary |
|---|---|---|
| Source and production build | `SOURCE_GO / NETLIFY_PREVIEW_HOLD` | TypeScript, ESLint, media validation, backend asset preflight, and the Next.js application build pass. Netlify's latest Next Runtime fails only while locally bundling the Node Proxy as an Edge Function on Windows; no draft deploy was created. |
| Fresh Supabase package | `BACKEND_DATA_GO` | All six migrations and the approved primary food seed path are applied to `sbwevlhzqujrtucppacl`; migration history, SQL contracts, data integrity, public reads, and both Advisors pass. |
| Existing Pawside journal | `DATA_READY / E2E_HOLD` | Auth, onboarding, workout, food, body metrics, history, weekly, export, and OpenAI-only server integration are source-ready; a real OpenAI provider smoke passes, but authenticated page and persistence flows remain unverified. |
| Pawside Method | `NO_GO` | The authoritative Tracking dataset, complete Push/Pull/Legs mappings, atomic initialization, progression, and recovery rules remain absent. |
| Public activation | `NO_GO` | The backend, reference data, and direct OpenAI provider evidence exist, but authenticated AI persistence, two-user RLS evidence, production SMTP, end-to-end evidence, and monitoring/rollback ownership remain incomplete. |

This report covers only `D:\Pawside`. Morrow was not inspected, merged, or modified.

## Remote target correction

- Confirmed target: `sbwevlhzqujrtucppacl`.
- `.env.local` resolves to `sbwevlhzqujrtucppacl.supabase.co`; the key value was not printed.
- Auth health returns HTTP 200 from GoTrue `v2.196.0`, proving the project and public key are online and matched.
- The CLI is authenticated and this checkout is linked to the confirmed project.
- All six local migrations match the remote migration history.
- Anonymous REST checks see the four intended public food-reference tables with HTTP 200; all 23 private/reference Method and user tables reject anonymous access with HTTP 401 / PostgreSQL `42501`.

## Asset inventory

### Application and routes

- Next.js 16.3.4 / React 19 application.
- The successful production build emitted 36 route entries: 15 API routes, 17 user-facing pages, one Auth callback, one not-found route, and two metadata routes, plus the Proxy boundary.
- Fifteen API routes cover AI review/plans/status, body metrics, daily summary, export, legacy food/workout, normalized food lookup, Method reads, onboarding, today's training, and weekly summary.
- The deprecated `middleware.ts` convention has been migrated without logic changes to `proxy.ts`.
- `/api/method/current` now treats the normal no-enrollment/draft-Method state as HTTP 200 with explicit `METHOD_NOT_READY` availability metadata instead of returning a misleading 404. This is a routing correction, not Method activation.

### OpenAI integration

- Pawside now has one server-side AI provider: OpenAI. The user-facing DeepSeek selector and provider fallback were removed.
- Daily reviews use the OpenAI Responses API with strict JSON Schema output. Responses expose `generation.source` as `openai`, `rules`, or `no_data`, so fallback cannot be mistaken for provider execution.
- Only real OpenAI daily reviews are cached. Missing-key or provider-error rule fallbacks are not persisted and therefore cannot mask later recovery.
- The previous placeholder `/api/ai/plans` endpoint now generates and persists a rate-limited OpenAI advisory draft. It is explicitly not Pawside Method, enrollment, progression, recovery, or prescription truth.
- `/api/ai/status` reports provider, configuration presence, model, and API family to an authenticated user without exposing the key.
- `OPENAI_API_KEY` is server-only. `.env.example` documents `OPENAI_MODEL`, `OPENAI_BASE_URL`, and timeout overrides; any `NEXT_PUBLIC_OPENAI_API_KEY` declaration fails preflight.
- Current local state is `provider=OpenAI / configured=true / direct provider smoke PASS`. The configured model returned a valid structured daily review.
- Node direct HTTPS did not inherit the active Windows proxy. The ignored `.env.proxy.local` and clean Next child-process launcher now route dev, build, start, and smoke traffic through the current local proxy without exposing the API key.

### Authentication and private data

- Browser and server Supabase clients use the public URL and anon key only.
- Email/password signup now distinguishes an immediate session from confirmation-pending.
- `/auth/callback` exchanges the PKCE code into the cookie-backed session; invalid/expired links reach a visible error page.
- Body metrics API input now rejects unknown fields, invalid dates, non-finite/range-invalid numbers, oversized notes/custom payloads, and requests without a measurement.
- `user_id` is assigned after validated input on the server, preventing client override; database errors are no longer returned verbatim.
- Database migrations define Auth-to-profile creation, explicit privileges, ownership RLS, forced RLS on normalized nutrition tables, and hardened trigger execution.

These are source facts. Signup, confirmation delivery, callback cookies, password reset, and two-user isolation remain unverified at runtime.

### Database reconstruction

Ordered migrations:

1. `20260413000000_v3_food_schema.sql`
2. `20260904000100_legacy_compatibility_schema.sql`
3. `20260904000200_method_foundation.sql`
4. `20260906000100_pawside_backend_activation_hardening.sql`
5. `20260906000200_workout_guide_media_foundation.sql`
6. `20260907000100_pawside_performance_advisor_hardening.sql`

Together they describe the fresh-project journal, structured food system, Method foundation, client/schema compatibility corrections, security hardening, exercise-media mappings, and Advisor-driven performance hardening. The Method record remains `draft` by design.

`supabase/config.toml` is local-only, contains no embedded secret, enables email-confirmation testing, and disables automatic seeds. The linked project ref is held in ignored CLI state. The latest official CLI applied all six migrations successfully to the confirmed project.

### Reference data and contracts

- The approved primary seed path is loaded: 1,698 canonical food rows and 1,698 nutrition rows after the generic “鸡蛋” patch, plus 12 aliases and 15 portion templates.
- `seed_food_data.sql` is explicitly transactional; the canonical patch and portion template completed successfully.
- `seed_part*` and `seeds/batches/*` are alternative chunked copies and must not be combined with the primary path.
- `pawside_backend_contract.sql` checks tables, required columns, nullability, constraints, trigger hardening, grants, and RLS.
- `workout_guide_media_contract.sql` checks provider metadata and prevents Method activation while active exercises lack confirmed mappings.
- `pawside_performance_contract.sql` passed against the remote project: seven requested foreign-key indexes and the optimized form of three food ownership policies were verified.

### Exercise media

- `@bryllim/workout-guide` is pinned exactly to `1.0.0`.
- The package supplies 302 exercises with three PNG frames each; Pawside animates the frames client-side and stores only mapping metadata.
- Five Push exercise mappings resolve to versioned jsDelivr URLs.
- Confirmed: bench press, incline dumbbell press, skull crusher.
- Candidate and visibly labeled: chest dip for 双杠臂屈伸, prone Y raise for Y 字侧平举.
- Attribution, source, and CC BY-SA 4.0 license links are rendered with the material.

Candidate mappings do not count as Method activation evidence.

### Operations assets

- `scripts/validate-backend-package.mjs` hashes and checks every required migration, contract, primary seed, config, package pin, environment-variable declaration, and local tool prerequisite without printing secret values.
- `PAWSIDE_BACKEND_RUNBOOK.md` defines source, local replay, remote dry-run, seed, SQL contract, Auth/RLS, and product-smoke gates.
- Remote seed execution is manual. Destructive linked resets are explicitly prohibited for production.
- Netlify Site `pawside` is linked to this checkout. The live custom domain is `https://paw-side.com`, and the published deploy remained unchanged during this configuration pass.
- Production resolves to the confirmed local Supabase URL and anon key, `AI_DEFAULT_PROVIDER=openai`, `MOCK_MODE=false`, `OPENAI_MODEL=gpt-5.6-luna`, and `NEXT_PUBLIC_SITE_URL=https://paw-side.com`. `OPENAI_API_KEY` is present as a Netlify secret and cannot be read back for exact-value comparison.
- DeepSeek key/model, Cloudflare AI Gateway, legacy Vite Supabase URL/key, and the unused Supabase service-role variable are absent from the authoritative Site environment-variable API.

## Verification result

| Check | Result |
|---|---|
| `npm.cmd run backend:preflight` | PASS for assets; its local-tool check still reports no globally installed CLI, Docker, or psql. The project uses the current CLI through `npx`. |
| Supabase CLI link and remote access | PASS; linked to `sbwevlhzqujrtucppacl`, dry-run passed, push passed, and migration history is aligned. |
| `npm.cmd run media:validate` | PASS, five mappings resolved; two remain candidates. |
| `npx.cmd tsc --noEmit --incremental false` | PASS. |
| `npm.cmd run lint` | PASS. |
| `npm.cmd run build` | PASS on Next.js 16.3.4; 36 emitted route entries including `/api/ai/status`. |
| Remote PostgreSQL migration execution | PASS; all six migrations applied and remote history matches local. |
| Backend SQL contract | PASS; trigger, required columns, privileges, private-table RLS, and draft Method status verified. |
| Exercise-media SQL contract | PASS; five mappings, three confirmed, two candidate, license/source metadata verified. |
| Anonymous REST boundary | PASS; four intended food-reference tables return 200 and 23 protected tables return 401 / `42501`. |
| Food seed integrity | PASS; 1,698 foods, 1,698 nutrition rows, 12 aliases, and 15 portions; zero missing/orphan nutrition rows and zero duplicate canonical names or per-food aliases. |
| Public food query | PASS; “鸡蛋” name search returns joined nutrition, and the generic canonical entry returns 138 kcal / 12.7 g protein with 1个 and 2个 portions. |
| Supabase Security Advisor | PASS; no security issues found. |
| Supabase Performance Advisor | PASS; no issues found after applying `20260907000100`. This verifies Advisor findings are cleared, not a measured latency improvement. |
| Performance migration and contract | PASS; `20260907000100` is present in remote history, with seven foreign-key indexes and three optimized RLS policies verified. |
| OpenAI source integration | PASS; Responses API, strict structured output, explicit generation source, real advisory-plan generation, rate limiting, and server-only key boundary compile and lint successfully. |
| OpenAI provider execution | PASS for direct smoke; configuration was recognized and `gpt-5.6-luna` returned a valid structured review with three insights, two actions, and an encouraging tone. |
| Netlify production environment | PASS; Supabase public values match local configuration, OpenAI-only and Mock-off flags resolve correctly, the Site URL is `https://paw-side.com`, and all six obsolete variables are absent from the authoritative API. Secret values were not printed. |
| Method empty-state API | PASS locally; two observed requests to `/api/method/current` returned 200 after the fix. The payload reports unavailable/draft state and does not falsely claim activation. |
| Netlify draft deploy | HOLD; Next.js compilation, TypeScript, all 33 generated pages, and function packaging reached the adapter stage, but `@netlify/plugin-nextjs` 5.15.13 failed on Windows while compiling the Node Proxy Edge wrapper because its CJS loader rewrote the drive-letter file URL incorrectly. No preview URL or production deploy was created. |
| OpenAI application persistence | HOLD; an authenticated daily-review cache write and advisory-plan row have not yet been verified through the running Pawside application. |
| Two-user RLS test | NOT RUN. |
| Journal end-to-end smoke test | NOT RUN. |
| Detailed production dependency audit | PASS after non-forced remediation; final npm audit reports 0 vulnerabilities across 489 dependencies. |

The local public environment points to the confirmed new target and its Auth health is reachable. Values were not printed or copied into reports.

## Remaining activation blockers

1. Authenticated OpenAI daily-review caching and advisory-plan persistence have not been verified in the running application.
2. Docker/Podman and psql are absent, so a separate local migration replay has not run.
3. Supabase Auth Site URL, allowed callback URL, and production SMTP are not configured and verified; the Netlify application Site URL is configured.
4. Two-user RLS, signup/profile trigger, confirmation callback, password reset, and journal CRUD lack runtime evidence.
5. Body Capture has no Storage bucket or media workflow.
6. Pawside Method truth data and deterministic transition cases are incomplete.
7. A Netlify draft deploy must be built on Netlify's Linux build infrastructure (or another Linux environment) to clear the Windows-only adapter packaging hold before any production publish approval.

## Recommended activation sequence

1. Produce a draft deploy through Netlify's Linux build path and verify `/auth`, `/api/ai/status`, and protected-route behavior; do not publish production yet.
2. Sign in to the running preview and verify one real daily review, one real advisory draft, generation metadata, and Supabase persistence.
3. Configure Supabase Auth URLs and production SMTP; run the two-user Auth/RLS cases.
4. Complete the remaining journal smoke test against the connected backend.
5. Optionally install Docker Desktop or Podman for a separate clean local migration replay.
6. Keep the dependency audit at zero and assign monitoring/rollback ownership before public activation.
7. Keep Method disabled until its independent truth-data gate passes.

No further database write is currently recommended. The immediate activation gate is a Linux-built Netlify draft deploy, followed by the authenticated OpenAI persistence test, Supabase Auth configuration, and two-user runtime verification.
