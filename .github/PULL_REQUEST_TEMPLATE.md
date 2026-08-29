## Issue

Closes #<!-- issue number -->

## Motivation

<!-- Observable reason for this change. -->

## Scope

<!-- Bounded files and behavior. -->

## Parent/child security boundary

<!-- Parent owns lifecycle; child edits only supplied paths. -->

## Runtime deny policy

SQL, HTTP, pg_net, collector, deploy, secrets, migrations, Cron, and production operations are denied.

## Tests

- [ ] `npm run test:bridge`
- [ ] `npm run check`
- [ ] `git diff --check`

## Manual post-merge configuration

<!-- Labels and branch protection are owner-managed. -->

## Explicit non-goals

<!-- No batch/watch, installer, runtime, or production automation. -->
