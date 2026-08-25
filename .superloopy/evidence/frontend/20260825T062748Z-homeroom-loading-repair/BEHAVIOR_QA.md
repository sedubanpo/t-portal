# Homeroom loading repair — behavior QA

Date: 2026-08-25 (Asia/Seoul)
Target: SEDU Teacher Portal `v512`

## Reported failure

- Mobile in-app browser remained on the shared loading overlay at 85% after selecting `담임 업무`.
- The 85% state is the loading animation cap; it was not a server-reported progress value.

## Root cause

- `ensureHomeroomBootstrapData()` configured a `google.script.run` success callback but never invoked `getLoginBootstrapData()` and did not attach a failure callback.
- Consequently, the completion callback never ran whenever the homeroom bootstrap cache was not already considered populated.
- The old cache test also rejected valid empty results (`homeroomStudents.length === 0`), making new teachers and teachers without homeroom assignments more likely to enter the broken path.
- Account-management's newer random Firebase UID format was not the direct cause. It caused the new teacher to use the slower legacy bootstrap route, which exposed the latent portal bug.

## Repair

- Replaced the incomplete runner chain with the portal's authenticated `runLoginBootstrapRequest_()` path.
- Treats empty teacher maps and zero homeroom assignments as valid loaded results.
- Coalesces concurrent bootstrap requests and releases all callers on success, failure, or timeout.
- Starts homeroom assignment and monthly attendance requests in parallel.
- Adds a 16-second bootstrap timeout and a 20-second overall open guard. The modal opens with available data and a recoverable warning instead of remaining blocked.
- Late successful responses refresh an already-open modal.
- Closing the modal invalidates stale callbacks.
- The refresh control now performs a real server re-fetch.

## Automated verification

- `node scripts/test-homeroom-loading-repair.mjs` — PASS
  - one network request for concurrent callers
  - zero-assignment success is cached
  - timeout releases the pending state
  - incomplete `google.script.run` chain is absent
- `node scripts/test-teacher-hours-instant-agreement.mjs` — PASS
- `node scripts/test-weekly-timetable-direct.mjs` — PASS
- `node scripts/test-login-bootstrap-snapshot.mjs` — PASS
- `node scripts/test-portal-favicon.mjs` — PASS
- `git diff --check` — PASS

## Live account/API verification

- Firebase user `김현진` exists, is active, and has `role=authenticated`.
- Live `getLoginBootstrap` response for that account succeeded in 7.855 seconds.
- Response shape: student metadata 2 rows, homeroom assignments 0 rows, S-LMS teacher map present.
- This validates the exact zero-assignment condition that the old cache predicate mishandled.
- Three-account canary also passed with authenticated isolation and anonymous rejection. Supabase snapshot reads completed in 388–410 ms; legacy server refreshes ranged from 12.229–22.345 seconds. The new timeout guards therefore protect slow legacy responses while allowing late data to refresh the open screen.

## Outcome criteria

- No request path can leave the full-screen loader indefinitely at 85%.
- A teacher with no homeroom assignment opens the homeroom screen as an empty valid state.
- Transient bootstrap failure is recoverable through the refresh button.
- Existing teacher-hours, weekly timetable, login snapshot, and favicon safeguards remain green.
