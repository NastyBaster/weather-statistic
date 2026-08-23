# Project status

**Last updated:** 2026-08-23

This is the concise, sanitized continuity record. Update it when a stage merges; keep detailed
procedures and raw evidence out of this file.

## Completed stages

| Stage | Result | Status |
| --- | --- | --- |
| 1 | Responsive static demo UI | Complete |
| 2 | Development and production Supabase foundation | Complete |
| 3 | Email/password authentication, recovery, and profiles | Complete |
| 3.1 | Accessible, localized auth UX | Complete |
| 4.1 | Personal locations from a local Ukrainian catalog and two-user RLS validation | Complete |
| 5.0 | Forecast provider/data contract and schema | Complete |
| 5.1 | Manual forecast collector and development runtime validation | Complete |
| 5.1.1 | Production collector rollout and sanitized validation | Complete |

Google OAuth is configured and working in development and production.

## Current environments

- **Development:** authentication, profiles, personal locations, forecast schema, and the manual
  collector have been validated.
- **Production:** authentication, Google OAuth, personal locations, and the applied forecast
  schema are active. The `collect-forecasts` Edge Function is deployed with JWT verification and
  was validated as a manual-only, server-side operation.
- **Sanitized collector baseline:** 2 terminal successful manual runs, 0 running runs, 24
  snapshots, and 0 duplicate identities. The first run created 24 snapshots and the same-local-date
  second run created 0. RLS, immutability, and sanitized log review passed.

There is no scheduler and no production UI trigger. Personal locations are real, but UI weather
and history remain intentionally demonstrative; production snapshots are not displayed. Never
mix demo and real data without an explicit, visible boundary. Observations, accuracy calculations,
and the real-data dashboard remain deferred. Global geocoding is optional and deferred.

## Working model

Browser/cloud Codex is the planner and reviewer. Local Codex CLI executes grouped repository and
authorized environment operations from the real clone. A cloud snapshot may contain only a
synthetic `work` branch; consult the actual clone rather than treating that snapshot as canonical.
