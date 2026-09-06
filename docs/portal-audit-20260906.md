# Teacher Portal v519 review

## Scope and delivery

Reviewed the portal entry point and direct data engines, login/admin routing, attendance import and overview, student statistics/calendar/Synchro, weekly timetable and cache invalidation. Existing offline checks also cover hours agreements, issue reports, homeroom, enrollment, flow/stop dashboards and the API router. This is not exhaustive proof of every role, browser, API or production mutation.

The existing internal administrative UI and backend permissions remain authoritative. No new dependencies, visual redesign, database schema changes or operational attendance writes are part of this release.

## Corrected defects

| Invariant | Change / verification |
| --- | --- |
| Last selected file owns the preview | Generation guard, immediate submit invalidation, file error recovery; 22 Access input race cases |
| Last selected month owns the screen | Guard overview and student-statistics success/failure/fallback callbacks; reversed response tests |
| A refresh uses refreshed lessons | Weekly view merges returned results, rather than rereading older raw rows |
| Fresh student-scoped cache takes precedence | Prefer scoped calendar cache; invalidate full-month index with statistics, then rebuild after fresh teacher entries |
| Conflicting duplicate input cannot silently disappear | Reject differing attendance/hour/note duplicates with a correction instruction; equivalent duplicates still collapse |
| Accepted correction appears in final preview | Remove replaced lesson keys before merging timestamped existing rows |
| Transport errors are not empty results | Reject malformed Supabase/Synchro responses; bound Synchro fetch/body reading to 20 seconds with timeout cleanup |
| Admin client routing reflects login result | Preserve strict boolean isAdmin in currentUser; server authorization unchanged |
| Login fields have accessible names | Explicit labels/autocomplete; composing Enter does not submit |

## Verification

`node scripts/test-offline.mjs`: explicit allowlist of 25 offline suites. Live/database tests are intentionally excluded. Stale version-number assertions now check version format; exact current tab membership, function signature and 31-action router inventory were updated without removing functional checks.

Inline JavaScript and direct engine syntax checks and `git diff --check` are required before deployment. Run-specific browser and release evidence lives under `.superloopy/evidence/frontend/20260906T041401Z-portal-audit/`.

## Remaining limitations

- Production data-changing scenarios (actual upload, deletion, attendance submission, hours agreement) were not used as test fixtures. They require controlled data and human acceptance, not unsolicited operational writes.
- Response-order tests use actual extracted functions with mocked transports; this establishes client behavior, not server latency or concurrency correctness.
- The monolithic HTML and mixed Apps Script/Supabase paths remain maintainability risks. No broad architecture migration was attempted during this repair release.
- No load benchmark, penetration test or comprehensive assistive-technology/device study was performed; no percentage speedup or universal usability claim is made.
