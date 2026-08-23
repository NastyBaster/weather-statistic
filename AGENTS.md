# Repository agent guidance

## Project and environments

- Forecast Reality Check is an educational, non-commercial project.
- The canonical repository is `NastyBaster/weather-statistic`; `main` is the canonical branch.
- A browser/cloud Codex workspace may expose only a synthetic `work` branch and may omit
  `main` or `origin`. This is not repository drift and does not prove that GitHub Connector
  access is missing. Browser Codex plans and reviews; local Codex CLI executes repository,
  GitHub, Supabase, and deployment work from `C:\Projects\weather-statistic`, where the real
  `main` and `origin/main` are available.
- Before planning or editing, read every applicable `AGENTS.md`, inspect the actual repository,
  and read `docs/project-status.md` and `docs/roadmap.md`. Do not assume an old prompt remains
  current. Update both continuity documents when a stage merges.

## Delivery rules

- Use trunk-based development: one bounded stage, one short-lived branch, and one pull request.
  Never commit directly to `main`.
- Use Conventional Commits.
- Do not edit an applied migration. Make every schema change in a new migration.
- Never commit project references, UUIDs, JWTs, access tokens, service-role keys, database
  passwords, provider secrets, secret digests, or raw logs. The service role is server-side only.
- Production work requires an explicitly confirmed target and explicit authorization. Never
  infer permission to configure a scheduler, deploy schema or functions, invoke a collector,
  or perform destructive production operations. Define rollback and sanitized evidence
  requirements before authorized production work begins.

## Checks

- For every change run `npm run check`, `git diff --check`, and `git status`.
- For Edge Function changes also run `deno fmt --check supabase/functions`,
  `deno lint supabase/functions`,
  `deno check supabase/functions/collect-forecasts/index.ts supabase/functions/collect-forecasts/collector.test.ts`,
  and `deno test --allow-env supabase/functions/collect-forecasts`.
- Take a screenshot for every perceptible change to the runnable web UI.
